import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { migrateDoc } from './migrateDoc';
import { isCanonical } from './normalize';
import { SCHEMA_VERSION } from '../model/schema';

function makeDoc(nodes: Record<string, Record<string, unknown>>) {
  const doc = new Y.Doc();
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const metadata = doc.getMap<string>('metadata');

  doc.transact(() => {
    Object.entries(nodes).forEach(([id, fields]) => {
      const ymap = new Y.Map<unknown>();
      Object.entries(fields).forEach(([k, v]) => ymap.set(k, v));
      objects.set(id, ymap);
    });
  });

  return { doc, objects, metadata };
}

const LEGACY_ROOM = {
  s1: {
    id: 's1', type: 'shape', x: 10, y: 20, visible: true,
    content: { shapeType: 'rect', fill: '#ff0000', width: 80, height: 40 },
  },
  n1: {
    id: 'n1', type: 'sticky', x: 0, y: 0, width: 200, height: 200,
    text: 'stale', content: { text: 'real', fontSize: 20 },
    appearance: { theme: 'mint' },
    metadata: { authorName: 'Ada', authorColor: '#000', reactions: { '🔥': 1 } },
  },
  p1: {
    id: 'p1', type: 'path', x: 5, y: 5, width: 10, height: 10,
    segments: [{ x: 0, y: 0 }, { x: 3, y: 3 }], closed: false,
  },
};

describe('migrateDoc', () => {
  it('rewrites legacy nodes and stamps the schema version', () => {
    const { doc, objects, metadata } = makeDoc(LEGACY_ROOM);

    const result = migrateDoc(doc, objects, metadata);

    expect(result.migrated).toBe(3);
    expect(result.skipped).toBe(0);
    expect(metadata.get('schemaVersion')).toBe(String(SCHEMA_VERSION));

    objects.forEach((ymap) => expect(isCanonical(ymap.toJSON())).toBe(true));
  });

  it('removes every legacy carrier field', () => {
    const { doc, objects, metadata } = makeDoc(LEGACY_ROOM);
    migrateDoc(doc, objects, metadata);

    const shape = objects.get('s1')!.toJSON() as Record<string, unknown>;
    const sticky = objects.get('n1')!.toJSON() as Record<string, unknown>;

    expect(shape.content).toBeUndefined();
    expect(shape.visible).toBeUndefined();
    // A sticky has no `appearance` in the canonical model at all — leaving
    // `appearance.theme` behind is what made the migration re-run forever.
    expect(sticky.appearance).toBeUndefined();
    expect(sticky.metadata).toBeUndefined();
    expect(sticky.theme).toBe('mint');
  });

  it('is idempotent — a second run migrates nothing', () => {
    const { doc, objects, metadata } = makeDoc(LEGACY_ROOM);

    migrateDoc(doc, objects, metadata);
    const second = migrateDoc(doc, objects, metadata);

    expect(second.migrated).toBe(0);
    expect(second.skipped).toBe(3);
  });

  it('does not mutate an already-canonical document', () => {
    const { doc, objects, metadata } = makeDoc(LEGACY_ROOM);
    migrateDoc(doc, objects, metadata);

    const before = JSON.stringify(objects.toJSON());
    migrateDoc(doc, objects, metadata);
    expect(JSON.stringify(objects.toJSON())).toBe(before);
  });

  it('converges when two peers migrate the same document concurrently', () => {
    // Both peers start from the same legacy state and migrate independently
    // without seeing each other — the realistic race when two people open a
    // stale room at once.
    const a = makeDoc(LEGACY_ROOM);
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a.doc));
    const bObjects = b.getMap<Y.Map<unknown>>('objects');
    const bMetadata = b.getMap<string>('metadata');

    migrateDoc(a.doc, a.objects, a.metadata);
    migrateDoc(b, bObjects, bMetadata);

    // Exchange updates in both directions.
    Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a.doc));

    expect(a.objects.toJSON()).toEqual(bObjects.toJSON());
    a.objects.forEach((ymap) => expect(isCanonical(ymap.toJSON())).toBe(true));
  });

  it('leaves a node written by an old peer readable, and migrates it next run', () => {
    const { doc, objects, metadata } = makeDoc(LEGACY_ROOM);
    migrateDoc(doc, objects, metadata);

    // An older client that has not been updated writes a pre-v2 node.
    const stale = new Y.Map<unknown>();
    doc.transact(() => {
      stale.set('id', 'old');
      stale.set('type', 'shape');
      stale.set('content', { shapeType: 'hexagon', width: 33, height: 44 });
      objects.set('old', stale);
    });

    expect(isCanonical(objects.get('old')!.toJSON())).toBe(false);

    const result = migrateDoc(doc, objects, metadata);
    expect(result.migrated).toBe(1);
    expect(result.skipped).toBe(3);

    const migrated = objects.get('old')!.toJSON() as Record<string, unknown>;
    expect(migrated.width).toBe(33);
    // `hexagon` stopped being a kind when polygons gained a side count; the
    // migration is what keeps the shape the same across that change.
    expect(migrated.geometry).toMatchObject({ kind: 'polygon', points: 6 });
  });
});

describe('CRDT convergence', () => {
  it('two peers editing different nodes converge to the same state', () => {
    const a = makeDoc(LEGACY_ROOM);
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a.doc));
    const bObjects = b.getMap<Y.Map<unknown>>('objects');

    a.objects.get('s1')!.set('x', 999);
    bObjects.get('n1')!.set('y', -42);

    Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a.doc));

    expect(a.objects.toJSON()).toEqual(bObjects.toJSON());
    expect(a.objects.get('s1')!.get('x')).toBe(999);
    expect(bObjects.get('n1')!.get('y')).toBe(-42);
  });

  it('a delete on one peer beats a concurrent field edit on the other', () => {
    const a = makeDoc(LEGACY_ROOM);
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a.doc));
    const bObjects = b.getMap<Y.Map<unknown>>('objects');

    a.objects.delete('s1');
    bObjects.get('s1')!.set('x', 123);

    Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a.doc));

    // Whatever the outcome, both sides must agree on it.
    expect(a.objects.toJSON()).toEqual(bObjects.toJSON());
    expect(a.objects.has('s1')).toBe(false);
  });
});
