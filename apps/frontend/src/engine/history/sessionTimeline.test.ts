import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { buildTimeline, materialiseAt, type RawUpdate } from './sessionTimeline';

/**
 * The timeline builder is the piece that turns a raw CRDT log into something a
 * person can navigate, so these tests pin the two properties that matter:
 * a run of related transactions collapses into one described moment, and
 * seeking reproduces the exact document state for that moment.
 */

/** Records each transaction on `doc` the way the server's `onChange` hook does. */
function recorder(doc: Y.Doc, log: RawUpdate[], startMs = 1_700_000_000_000) {
  let tick = 0;
  doc.on('update', (update: Uint8Array) => {
    let binary = '';
    update.forEach(byte => { binary += String.fromCharCode(byte); });
    log.push({ createdAt: new Date(startMs + tick * 100).toISOString(), update: btoa(binary) });
    tick++;
  });
}

function makeNode(fields: Record<string, unknown>) {
  const map = new Y.Map<unknown>();
  Object.entries(fields).forEach(([k, v]) => map.set(k, v));
  return map;
}

const AUTHOR = {
  createdBy: '', // filled with the doc's real clientID per test
  createdByName: 'Ada',
  createdByColor: '#7C3AED',
};

function baseNode(doc: Y.Doc, over: Record<string, unknown> = {}) {
  return makeNode({
    type: 'sticky',
    x: 10,
    y: 20,
    width: 200,
    height: 200,
    text: 'Ship the thing',
    ...AUTHOR,
    createdBy: String(doc.clientID),
    ...over,
  });
}

describe('buildTimeline', () => {
  it('describes a create with the author and the object name', () => {
    const doc = new Y.Doc();
    const log: RawUpdate[] = [];
    recorder(doc, log);
    doc.getMap('objects').set('a', baseNode(doc));

    const timeline = buildTimeline(log);

    expect(timeline.moments).toHaveLength(1);
    expect(timeline.moments[0].kind).toBe('create');
    // Named from the node's own text, via the shared nodeLabel rule.
    expect(timeline.moments[0].label).toBe('Ada added Ship the thing');
    expect(timeline.moments[0].authorName).toBe('Ada');
    expect(timeline.moments[0].authorColor).toBe('#7C3AED');
  });

  it('folds a drag into one moment instead of one per transaction', () => {
    const doc = new Y.Doc();
    const log: RawUpdate[] = [];
    // Record from the start, as the server does: a log that omits a node's
    // creation cannot reach that node at all, which is the correct behaviour
    // for a trimmed log but useless as a fixture.
    recorder(doc, log);
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    objects.set('a', baseNode(doc));

    const node = objects.get('a')!;
    for (let i = 0; i < 12; i++) {
      node.set('x', 10 + i * 4);
    }

    const timeline = buildTimeline(log);

    expect(log).toHaveLength(13); // 1 create + 12 moves
    expect(timeline.moments.map(m => m.kind)).toEqual(['create', 'move']);
    expect(timeline.moments[1].updateCount).toBe(12);
    // Points at the last transaction of the run, so seeking to this moment
    // shows the drag completed rather than half-finished.
    expect(timeline.moments[1].index).toBe(12);
    expect(timeline.totalUpdates).toBe(13);
  });

  it('does not fold two different kinds of change together', () => {
    const doc = new Y.Doc();
    const log: RawUpdate[] = [];
    recorder(doc, log);
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    objects.set('a', baseNode(doc));

    const node = objects.get('a')!;
    node.set('x', 50);
    node.set('text', 'Renamed');
    node.set('hidden', true);

    const timeline = buildTimeline(log);
    expect(timeline.moments.map(m => m.kind)).toEqual(['create', 'move', 'text', 'visibility']);
  });

  it('separates runs that are far apart in time', () => {
    const doc = new Y.Doc();
    const log: RawUpdate[] = [];
    recorder(doc, log);
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    objects.set('a', baseNode(doc));
    const node = objects.get('a')!;
    node.set('x', 30);
    node.set('x', 40);

    // Same author, same field, but a long pause before the last one: two
    // deliberate nudges, not one drag.
    log[2].createdAt = new Date(new Date(log[1].createdAt).getTime() + 60_000).toISOString();

    const timeline = buildTimeline(log, { coalesceWindowMs: 1200 });
    expect(timeline.moments.map(m => m.kind)).toEqual(['create', 'move', 'move']);
  });

  it('still names an object in the moment that deletes it', () => {
    const doc = new Y.Doc();
    const log: RawUpdate[] = [];
    recorder(doc, log);
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    objects.set('a', baseNode(doc));
    objects.delete('a');

    const timeline = buildTimeline(log);
    expect(timeline.moments.map(m => m.kind)).toEqual(['create', 'delete']);
    // The node is gone from the document by the time the delete is described,
    // so the label has to come from the name remembered before it vanished.
    expect(timeline.moments[1].label).toContain('Ship the thing');
  });

  it('attributes a deletion, which carries no structs to read a client from', () => {
    const doc = new Y.Doc();
    const log: RawUpdate[] = [];
    recorder(doc, log);
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    objects.set('a', baseNode(doc));
    objects.delete('a');

    const timeline = buildTimeline(log);
    const deletion = timeline.moments.find(m => m.kind === 'delete')!;
    // Yjs encodes a deletion in the delete set rather than as new structs, so
    // this only works if attribution falls back to reading that.
    expect(deletion.authorId).toBe(String(doc.clientID));
    expect(deletion.label).toBe('Ada deleted Ship the thing');
  });

  it('ignores the updatedAt stamp when classifying a change', () => {
    const doc = new Y.Doc();
    const log: RawUpdate[] = [];
    recorder(doc, log);
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    objects.set('a', baseNode(doc));

    const node = objects.get('a')!;
    // Exactly what mutations.updateNode writes: the real field plus bookkeeping.
    doc.transact(() => {
      node.set('x', 90);
      node.set('y', 120);
      node.set('updatedAt', Date.now());
    });

    const timeline = buildTimeline(log);
    // Without filtering, `updatedAt` is unclassifiable and drags the whole
    // moment down to 'mixed' — "changed" instead of "moved".
    expect(timeline.moments.map(m => m.kind)).toEqual(['create', 'move']);
    expect(timeline.moments[1].label).toBe('Ada moved Ship the thing');
  });

  it('does not invent a moment for a transaction that only bumps updatedAt', () => {
    const doc = new Y.Doc();
    const log: RawUpdate[] = [];
    recorder(doc, log);
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    objects.set('a', baseNode(doc));
    objects.get('a')!.set('updatedAt', Date.now());

    const timeline = buildTimeline(log);
    expect(timeline.moments.map(m => m.kind)).toEqual(['create']);
  });

  it('names an editor who never created anything, via the identities map', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const log: RawUpdate[] = [];
    recorder(docA, log);
    recorder(docB, log);

    // Ada creates the node; Linus only ever edits it, so `createdByName` can
    // never name him.
    docA.getMap('objects').set('a', baseNode(docA));
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    docB.getMap<{ name: string; color: string }>('identities')
      .set(String(docB.clientID), { name: 'Linus', color: '#059669' });
    (docB.getMap('objects').get('a') as Y.Map<unknown>).set('x', 999);

    const timeline = buildTimeline(log);
    const edit = timeline.moments.find(m => m.kind === 'move')!;
    expect(edit.authorName).toBe('Linus');
    expect(edit.authorColor).toBe('#059669');
  });

  it('does not create a moment for an identity announcement', () => {
    const doc = new Y.Doc();
    const log: RawUpdate[] = [];
    recorder(doc, log);
    doc.getMap<{ name: string; color: string }>('identities')
      .set(String(doc.clientID), { name: 'Ada', color: '#7C3AED' });

    const timeline = buildTimeline(log);
    expect(timeline.moments).toHaveLength(0);
  });

  it('reports each distinct contributor once', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const log: RawUpdate[] = [];
    recorder(docA, log);
    recorder(docB, log);

    docA.getMap('objects').set('a', baseNode(docA, { text: 'From Ada' }));
    docB.getMap('objects').set('b', makeNode({
      type: 'sticky', x: 0, y: 0, width: 100, height: 100, text: 'From Linus',
      createdBy: String(docB.clientID), createdByName: 'Linus', createdByColor: '#059669',
    }));

    const timeline = buildTimeline(log);
    const names = timeline.authors.map(a => a.name).sort();
    expect(names).toEqual(['Ada', 'Linus']);
  });

  it('survives a corrupt row rather than losing the whole session', () => {
    const doc = new Y.Doc();
    const log: RawUpdate[] = [];
    recorder(doc, log);
    doc.getMap('objects').set('a', baseNode(doc));
    log.push({ createdAt: new Date().toISOString(), update: 'not-valid-base64-yjs!!' });

    const timeline = buildTimeline(log);
    expect(timeline.moments.length).toBeGreaterThanOrEqual(1);
  });
});

describe('materialiseAt', () => {
  it('reproduces the document as of a given index', () => {
    const doc = new Y.Doc();
    const log: RawUpdate[] = [];
    recorder(doc, log);
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    objects.set('a', baseNode(doc));
    objects.set('b', baseNode(doc, { text: 'Second' }));
    objects.delete('a');

    const timeline = buildTimeline(log);

    // After the first transaction: only 'a' exists.
    const first = materialiseAt(log, 0, timeline.keyframes);
    expect([...first.doc.getMap('objects').keys()]).toEqual(['a']);

    // After all of them: 'a' is gone, 'b' remains.
    const last = materialiseAt(log, log.length - 1, timeline.keyframes);
    expect([...last.doc.getMap('objects').keys()]).toEqual(['b']);
  });

  it('reuses the existing doc when scrubbing forward', () => {
    const doc = new Y.Doc();
    const log: RawUpdate[] = [];
    recorder(doc, log);
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    objects.set('a', baseNode(doc));
    objects.set('b', baseNode(doc, { text: 'Second' }));

    const timeline = buildTimeline(log);
    const step1 = materialiseAt(log, 0, timeline.keyframes);
    const step2 = materialiseAt(log, 1, timeline.keyframes, step1);

    expect(step2.doc).toBe(step1.doc); // forward scrub is incremental
    expect(step2.appliedThrough).toBe(1);
    expect([...step2.doc.getMap('objects').keys()].sort()).toEqual(['a', 'b']);
  });

  it('rewinds without replaying from the very beginning', () => {
    const doc = new Y.Doc();
    const log: RawUpdate[] = [];
    recorder(doc, log);
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    for (let i = 0; i < 40; i++) {
      objects.set(`n${i}`, baseNode(doc, { text: `Note ${i}` }));
    }

    const timeline = buildTimeline(log, { maxKeyframes: 8 });
    expect(timeline.keyframes.length).toBeGreaterThan(0);

    const atEnd = materialiseAt(log, log.length - 1, timeline.keyframes);
    const rewound = materialiseAt(log, 20, timeline.keyframes, atEnd);

    expect(rewound.doc).not.toBe(atEnd.doc); // a rewind needs a fresh doc
    expect(rewound.appliedThrough).toBe(20);
    expect([...rewound.doc.getMap('objects').keys()]).toHaveLength(21);
  });
});
