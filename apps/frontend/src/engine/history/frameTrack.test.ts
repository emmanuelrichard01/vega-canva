import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { FrameTrack } from './frameTrack';
import { ReplayEngine, readFrame } from './frames';
import { TimelineBuilder, decodeBase64Update, type RawUpdate } from './sessionTimeline';

function b64(u: Uint8Array): string {
  let s = '';
  u.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s);
}

/** A seeded log of creates, edits, nested edits, deletes and group changes, after an optional baseline. */
function makeLog(rows: number, seed = 7, withBaseline = false) {
  let r = seed;
  const rand = (n: number) => {
    r = (r * 16807) % 2147483647;
    return r % n;
  };
  const doc = new Y.Doc();
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const groups = doc.getMap<unknown>('groups');
  const add = (id: string) => {
    const node = new Y.Map<unknown>();
    node.set('type', 'sticky');
    node.set('x', rand(1000));
    node.set('y', rand(1000));
    node.set('text', `note ${id}`);
    node.set('style', new Y.Map<unknown>([['fill', '#fc0']]));
    objects.set(id, node);
  };
  let next = 0;
  let baseline: Uint8Array | null = null;
  if (withBaseline) {
    for (let i = 0; i < 10; i++) add(`b${i}`);
    baseline = Y.encodeStateAsUpdate(doc);
  }
  const log: RawUpdate[] = [];
  doc.on('update', (u: Uint8Array) => {
    log.push({ id: log.length + 1, createdAt: new Date(1_700_000_000_000 + log.length * 2000).toISOString(), update: b64(u) });
  });
  while (log.length < rows) {
    const ids = [...objects.keys()];
    const op = ids.length < 3 ? 0 : rand(10);
    const id = ids[rand(Math.max(1, ids.length))];
    if (op <= 1) add(`n${next++}`);
    else if (op <= 5) objects.get(id)!.set('x', rand(5000));
    else if (op === 6) (objects.get(id)!.get('style') as Y.Map<unknown>).set('fill', `#${rand(4096).toString(16)}`);
    else if (op === 7) objects.delete(id);
    else if (op === 8) groups.set(`g${rand(4)}`, { members: [id] });
    else doc.transact(() => {
      objects.get(id)!.set('y', rand(5000));
      add(`n${next++}`);
    });
  }
  return { log, baseline };
}

/** The board at `index` the slow, obviously correct way: replay from the start. */
function replayFromStart(log: RawUpdate[], baseline: Uint8Array | null, index: number) {
  const doc = new Y.Doc();
  if (baseline) Y.applyUpdate(doc, baseline);
  for (let i = 0; i <= index; i++) Y.applyUpdate(doc, decodeBase64Update(log[i].update));
  const out = { objects: readFrame(doc), groups: doc.getMap('groups').toJSON() };
  doc.destroy();
  return out;
}

function trackEngine(log: RawUpdate[], baseline: Uint8Array | null, every?: number) {
  const builder = new TimelineBuilder({ baseline, track: every ?? true });
  builder.push(log);
  builder.step(Infinity);
  const track = builder.frameTrack!;
  const timeline = builder.snapshot();
  builder.destroy();
  return { engine: new ReplayEngine({ log: () => log, keyframes: () => timeline.keyframes, baseline, track }, 4), track, timeline };
}

describe('FrameTrack seeking', () => {
  it('gives the same board at every index as replaying from the start', () => {
    const { log, baseline } = makeLog(120, 11, true);
    const { engine, track } = trackEngine(log, baseline, 8);
    expect(track.length).toBe(log.length);
    for (let i = -1; i < log.length; i++) {
      const got = engine.seek(i).state;
      const want = replayFromStart(log, baseline, i);
      expect(got.objects).toEqual(want.objects);
      expect(got.groups).toEqual(want.groups);
    }
  });

  it('agrees with replay for random jumps in both directions, whatever the checkpoint spacing', () => {
    for (const every of [1, 5, 16, 64]) {
      const { log, baseline } = makeLog(200, 3 + every);
      const { engine } = trackEngine(log, baseline, every);
      let r = every;
      for (let k = 0; k < 40; k++) {
        r = (r * 48271) % 2147483647;
        const i = (r % (log.length + 1)) - 1;
        expect(engine.seek(i).state.objects).toEqual(replayFromStart(log, baseline, i).objects);
      }
    }
  });

  it('matches the keyframe (Yjs) engine frame for frame', () => {
    const { log, baseline } = makeLog(150, 5, true);
    const { engine } = trackEngine(log, baseline);
    const kb = new TimelineBuilder({ baseline, keyframeEvery: 10 });
    kb.push(log);
    kb.step(Infinity);
    const kt = kb.snapshot();
    kb.destroy();
    const yjs = new ReplayEngine({ log: () => log, keyframes: () => kt.keyframes, baseline }, 4);
    expect(kt.keyframes.length).toBeGreaterThan(0);
    for (const i of [149, 3, 77, -1, 76, 78, 10, 140, 0]) {
      expect(engine.seek(i).state.objects).toEqual(yjs.seek(i).state.objects);
      expect(engine.peek(i).groups).toEqual(yjs.peek(i).groups);
    }
  });

  it('keeps untouched objects as the same reference and reports exactly what changed', () => {
    const { log, baseline } = makeLog(60, 9, true);
    const { engine } = trackEngine(log, baseline);
    const a = engine.seek(30);
    const b = engine.seek(31);
    const want = replayFromStart(log, baseline, 31).objects;
    for (const id of Object.keys(want)) {
      if (!b.changedIds.includes(id)) expect(b.state.objects[id]).toBe(a.state.objects[id]);
    }
    for (const id of b.changedIds) expect(b.state.objects[id]).toEqual(want[id]);
  });

  it('records nothing for rows that change no objects or groups, and skips encoding keyframes', () => {
    const doc = new Y.Doc();
    const log: RawUpdate[] = [];
    doc.on('update', (u: Uint8Array) => log.push({ createdAt: new Date(0).toISOString(), update: b64(u) }));
    doc.getMap('meta').set('title', 'x');
    doc.getMap<Y.Map<unknown>>('objects').set('a', new Y.Map<unknown>([['x', 1]]));
    const { track, timeline, engine } = trackEngine(log, null, 1);
    expect(timeline.keyframes).toEqual([]);
    expect(track.frameAt(0).objects).toEqual({});
    expect(engine.seek(1).state.objects).toEqual({ a: { x: 1 } });
  });

  it('starts a forward step from the frame already held rather than the checkpoint', () => {
    const track = new FrameTrack({ objects: {}, groups: {} }, 100);
    for (let i = 0; i < 50; i++) track.record({ objects: [[`n${i}`, { i }]], groups: null });
    const at40 = track.frameAt(40);
    const at41 = track.frameAt(41, { index: 40, frame: at40 });
    expect(Object.keys(at41.objects)).toHaveLength(42);
    expect(at41.objects.n0).toBe(at40.objects.n0);
    // A held frame past the target is ignored.
    expect(Object.keys(track.frameAt(10, { index: 40, frame: at40 }).objects)).toHaveLength(11);
  });
});
