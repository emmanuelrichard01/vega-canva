import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The real mutation layer over a real Y.Doc, with an undo manager that never merges. */
vi.mock('./doc', async () => {
  const Y = await import('yjs');
  const doc = new Y.Doc();
  const objectsMap = doc.getMap('objects');
  const groupsMap = doc.getMap('groups');
  return {
    doc,
    objectsMap,
    groupsMap,
    identitiesMap: doc.getMap('identities'),
    metadataMap: doc.getMap('metadata'),
    commentsMap: doc.getMap('comments'),
    fontsMap: doc.getMap('fonts'),
    undoManager: new Y.UndoManager([objectsMap, groupsMap], { captureTimeout: 0 }),
    DERIVED_ORIGIN: 'derived',
    provider: {
      awareness: { getLocalState: () => ({}), setLocalStateField: () => {}, getStates: () => new Map() },
    },
  };
});

const { doc, objectsMap, groupsMap, undoManager } = await import('./doc');
const { readAllNodes } = await import('./mutations');
const { setRoomRole } = await import('../model/permissions');
const { useStore } = await import('../../hooks/useStore');
const { flattenToPath, outlineStrokeOf, applyBoolean } = await import('./vectorOps');
const { toCubics } = await import('../model/pathGeometry');

type Seed = Record<string, unknown> & { id: string };

/** Put nodes in the document and in the store the operations read from. */
function seed(nodes: Seed[]) {
  doc.transact(() => {
    for (const n of nodes) {
      const m = new (objectsMap.constructor as new () => import('yjs').Map<unknown>)();
      Object.entries(n).forEach(([k, v]) => m.set(k, v));
      objectsMap.set(n.id, m);
    }
  });
  useStore.setState({ objects: Object.fromEntries(nodes.map((n) => [n.id, n])) as never });
  undoManager.clear();
}

const shape = (id: string, extra: Record<string, unknown> = {}): Seed => ({
  id,
  type: 'shape',
  x: 0,
  y: 0,
  width: 100,
  height: 60,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
  opacity: 1,
  zIndex: 7,
  locked: false,
  geometry: { kind: 'rect' },
  appearance: { fill: [{ type: 'solid', color: '#ff0000' }], cornerRadius: 12 },
  ...extra,
});

beforeEach(() => {
  setRoomRole('editor');
  doc.transact(() => {
    [...objectsMap.keys()].forEach((k) => objectsMap.delete(k));
    [...groupsMap.keys()].forEach((k) => groupsMap.delete(k));
  });
  undoManager.clear();
});

describe('flattenToPath', () => {
  it('keeps the corner radius as curves, keeps the stacking, and undoes in one step', () => {
    seed([shape('s')]);
    const id = flattenToPath('s')!;
    const nodes = readAllNodes();
    expect(Object.keys(nodes)).toEqual([id]);
    const path = nodes[id] as { geometry: Parameters<typeof toCubics>[0]; zIndex: number };
    expect(path.zIndex).toBe(7);
    // Four straight edges and four rounded corners.
    const curved = toCubics(path.geometry).filter((c) => c.c1x !== c.x0 || c.c1y !== c.y0);
    expect(curved.length).toBeGreaterThanOrEqual(4);

    undoManager.undo();
    expect(Object.keys(readAllNodes())).toEqual(['s']);
  });
});

describe('outlineStrokeOf', () => {
  it('outlines a turned shape in place, as one undo step', () => {
    seed([shape('r', { rotation: 30, appearance: { stroke: { color: '#00f', width: 8 } } })]);
    const id = outlineStrokeOf('r')!;
    const out = readAllNodes()[id] as { rotation: number; x: number; y: number; width: number; height: number };
    expect(out.rotation).toBe(30);
    // The stroke reaches 4 px outside the box on every side, so the outline's
    // box is the shape's grown by 4, about the same centre.
    expect(out.width).toBeCloseTo(108, 0);
    expect(out.x + out.width / 2).toBeCloseTo(50, 0);
    expect(out.y + out.height / 2).toBeCloseTo(30, 0);
    undoManager.undo();
    expect(Object.keys(readAllNodes())).toEqual(['r']);
  });
});

describe('applyBoolean', () => {
  it('subtracts a circle from a rectangle with curves intact, in one step', () => {
    seed([
      shape('back', { zIndex: 1, appearance: {} }),
      shape('front', { zIndex: 2, x: 60, y: 10, width: 40, height: 40, geometry: { kind: 'ellipse' }, appearance: {} }),
    ]);
    const id = applyBoolean('subtract', ['front', 'back'])!;
    const nodes = readAllNodes();
    expect(Object.keys(nodes)).toEqual([id]);
    const geometry = (nodes[id] as { geometry: Parameters<typeof toCubics>[0] }).geometry;
    const cubics = toCubics(geometry);
    // A bite with a curved edge: a few dozen segments at most, some curved.
    expect(cubics.length).toBeLessThan(30);
    expect(cubics.some((c) => c.c1x !== c.x0 || c.c1y !== c.y0)).toBe(true);
    undoManager.undo();
    expect(Object.keys(readAllNodes()).sort()).toEqual(['back', 'front']);
  });
});
