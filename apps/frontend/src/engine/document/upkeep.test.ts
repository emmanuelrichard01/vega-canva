import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as Y from 'yjs';

/**
 * Only the socket is mocked: a real `Y.Doc` stands in for the room, so these
 * exercise the real mutations, observer and upkeep against real CRDT merges.
 */
vi.mock('./doc', async () => {
  const Y2 = await import('yjs');
  const doc = new Y2.Doc();
  return {
    doc,
    objectsMap: doc.getMap('objects'),
    groupsMap: doc.getMap('groups'),
    identitiesMap: doc.getMap('identities'),
    metadataMap: doc.getMap('metadata'),
    commentsMap: doc.getMap('comments'),
    DERIVED_ORIGIN: 'derived',
    provider: {
      awareness: {
        clientID: doc.clientID,
        getLocalState: () => ({}),
        setLocalStateField: () => {},
        getStates: () => new Map(),
      },
    },
  };
});

const { doc, objectsMap, groupsMap } = await import('./doc');
const { createNode, updateNode, applyGroupPlan } = await import('./mutations');
const { observeNodes } = await import('./observe');
const { sweepEmptyGroups, repairFrameMembership } = await import('./upkeep');
const { electedClient } = await import('./election');
const { descendantsOfFrame } = await import('../model/frames');
const { setRoomRole } = await import('../model/permissions');

function clear() {
  doc.transact(() => {
    Array.from(objectsMap.keys()).forEach((k) => objectsMap.delete(k));
    Array.from(groupsMap.keys()).forEach((k) => groupsMap.delete(k));
  });
}

/** A second replica, seeded with the room's current state. */
function replica(): Y.Doc {
  const other = new Y.Doc();
  Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
  return other;
}

function merge(a: Y.Doc, b: Y.Doc) {
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
}

const frame = (id: string, x: number, y: number, w = 400, h = 300) =>
  ({ id, type: 'frame', x, y, width: w, height: h }) as never;
const shape = (id: string, x: number, y: number) =>
  ({ id, type: 'shape', x, y, width: 40, height: 40 }) as never;

beforeEach(() => {
  setRoomRole('editor');
  clear();
});

describe('observeNodes', () => {
  it('credits a nested change to its node and reports whether it was local', () => {
    createNode({ ...(shape('n1', 0, 0) as object), appearance: {} } as never);
    const nested = new Y.Map<unknown>();
    doc.transact(() => objectsMap.get('n1')!.set('style', nested));

    const seen: Array<{ changed: string[]; local: boolean }> = [];
    const off = observeNodes(({ changed, local }) => seen.push({ changed: [...changed], local }));
    nested.set('width', 3);
    const remote = replica();
    (remote.getMap('objects').get('n1') as Y.Map<unknown>).set('x', 99);
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote, Y.encodeStateVector(doc)));
    off();

    expect(seen).toEqual([
      { changed: ['n1'], local: true },
      { changed: ['n1'], local: false },
    ]);
  });
});

describe('the group sweep', () => {
  it('reads the live document, so it cannot delete groups a replay snapshot predates', () => {
    createNode({ ...(shape('m1', 0, 0) as object), parentId: 'g1' } as never);
    applyGroupPlan({ nodes: [], groups: [], remove: [], create: { id: 'g1' } });
    applyGroupPlan({ nodes: [], groups: [], remove: [], create: { id: 'empty' } });

    sweepEmptyGroups(null);

    expect(groupsMap.has('g1')).toBe(true);
    expect(groupsMap.has('empty')).toBe(false);
  });

  it('writes under the derived origin when asked, so it stays out of undo', () => {
    const undo = new Y.UndoManager([objectsMap, groupsMap]);
    applyGroupPlan({ nodes: [], groups: [], remove: [], create: { id: 'empty' } });
    undo.clear();

    sweepEmptyGroups('derived');

    expect(groupsMap.has('empty')).toBe(false);
    expect(undo.undoStack.length).toBe(0);
  });
});

describe('frame membership repair', () => {
  it('releases a note dropped into a frame that someone else moved at the same time', () => {
    createNode(frame('F', 0, 0));
    const other = replica();

    // Here: the frame is dragged far away.
    updateNode('F', { x: 2000 });
    // There, concurrently: a note is dropped where the frame used to be.
    const note = new Y.Map<unknown>();
    other.transact(() => {
      Object.entries({ id: 'N', type: 'shape', x: 100, y: 100, width: 40, height: 40, zIndex: 5, frameId: 'F' })
        .forEach(([k, v]) => note.set(k, v));
      other.getMap('objects').set('N', note);
    });
    merge(doc, other);

    expect(objectsMap.get('N')!.get('frameId')).toBe('F');
    expect(repairFrameMembership(new Set(['F', 'N']), 'derived')).toBe(1);
    expect(objectsMap.get('N')!.get('frameId')).toBeUndefined();
  });

  it('breaks a membership cycle without letting a delete cascade follow it', () => {
    createNode(frame('big', 0, 0, 1000, 1000));
    createNode(frame('small', 100, 100, 200, 200));
    createNode({ ...(shape('inBig', 800, 800) as object) } as never);
    doc.transact(() => {
      objectsMap.get('small')!.set('frameId', 'big');
      objectsMap.get('big')!.set('frameId', 'small');
      objectsMap.get('inBig')!.set('frameId', 'big');
    });

    const nodes = Array.from(objectsMap.entries()).map(([id, m]) => ({
      id,
      frameId: m.get('frameId') as string | undefined,
    }));
    // Deleting the small frame must not take the big one and its contents.
    expect(descendantsOfFrame('small', nodes)).toEqual([]);

    repairFrameMembership(null, 'derived');
    expect(objectsMap.get('small')!.get('frameId')).toBe('big');
    expect(objectsMap.get('big')!.get('frameId')).toBeUndefined();
  });

  it('leaves valid memberships and unframed nodes alone', () => {
    createNode(frame('F', 0, 0));
    createNode(shape('inside', 10, 10));
    createNode(shape('outside', 900, 900));
    expect(objectsMap.get('inside')!.get('frameId')).toBe('F');
    expect(repairFrameMembership(null, 'derived')).toBe(0);
  });
});

describe('the elected writer', () => {
  it('is the lowest clientID that can write', () => {
    const states = new Map<number, Record<string, unknown>>([
      [5, { canWrite: true }],
      [2, { canWrite: false }],
      [9, { canWrite: true }],
    ]);
    expect(electedClient(states)).toBe(5);
  });

  it('never elects a client that has not said it can write', () => {
    expect(electedClient(new Map([[3, {}], [7, { canWrite: true }]]))).toBe(7);
    expect(electedClient(new Map([[3, { canWrite: false }]]))).toBeNull();
  });
});
