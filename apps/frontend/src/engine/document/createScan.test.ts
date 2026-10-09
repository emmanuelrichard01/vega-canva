import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * `createNode` inside one transaction reuses a single scan of the document for
 * stacking and frame membership. These hold that the reuse is invisible: the
 * results match what a fresh scan per create would give.
 */
vi.mock('./doc', async () => {
  const Y = await import('yjs');
  const doc = new Y.Doc();
  return {
    doc,
    objectsMap: doc.getMap('objects'),
    groupsMap: doc.getMap('groups'),
    identitiesMap: doc.getMap('identities'),
    metadataMap: doc.getMap('metadata'),
    provider: { awareness: { getLocalState: () => ({}), setLocalStateField: () => {}, getStates: () => new Map() } },
  };
});

const { createNode, updateNode, deleteNode, nextZIndex } = await import('./mutations');
const { doc, objectsMap } = await import('./doc');
const { setRoomRole } = await import('../model/permissions');

const read = (id: string, key: string) => objectsMap.get(id)?.get(key);
const box = (id: string, x: number, y: number, type = 'shape') => ({ id, type, x, y, width: 100, height: 100 });

describe('createNode within one transaction', () => {
  beforeEach(() => {
    setRoomRole('editor');
    doc.transact(() => objectsMap.clear());
  });

  it('stacks each new node above the last, and above what was there', () => {
    createNode(box('old', 0, 0));
    updateNode('old', { zIndex: 40 });
    doc.transact(() => {
      createNode(box('a', 0, 0));
      createNode(box('b', 0, 0));
      createNode(box('c', 0, 0));
    });
    expect([read('a', 'zIndex'), read('b', 'zIndex'), read('c', 'zIndex')]).toEqual([41, 42, 43]);
    expect(nextZIndex()).toBe(44);
  });

  it('puts a node into a frame created earlier in the same transaction', () => {
    doc.transact(() => {
      createNode({ ...box('f', 0, 0, 'frame'), width: 1000, height: 1000 });
      createNode(box('inside', 400, 400));
      createNode(box('outside', 2000, 2000));
    });
    expect(read('inside', 'frameId')).toBe('f');
    expect(read('outside', 'frameId')).toBeUndefined();
  });

  it('sees a frame moved or deleted earlier in the same transaction', () => {
    createNode({ ...box('f', 0, 0, 'frame'), width: 1000, height: 1000 });
    doc.transact(() => {
      updateNode('f', { x: 5000 });
      createNode(box('left-behind', 400, 400));
      createNode(box('followed', 5400, 400));
    });
    expect(read('left-behind', 'frameId')).toBeUndefined();
    expect(read('followed', 'frameId')).toBe('f');

    doc.transact(() => {
      deleteNode('f');
      createNode(box('orphan', 5400, 400));
    });
    expect(read('orphan', 'frameId')).toBeUndefined();
  });

  it('raises a node created after a z-index change in the same transaction above it', () => {
    createNode(box('a', 0, 0));
    doc.transact(() => {
      updateNode('a', { zIndex: 100 });
      createNode(box('b', 0, 0));
    });
    expect(read('b', 'zIndex')).toBe(101);
  });
});
