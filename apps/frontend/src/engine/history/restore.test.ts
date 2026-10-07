import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Restore, through the real mutation layer. Only the socket-owning `doc.ts`
 * is replaced, with a real `Y.Doc` and a real undo manager.
 */
vi.mock('../document/doc', async () => {
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

const { doc, objectsMap, groupsMap, undoManager } = await import('../document/doc');
const { createNode, readAllNodes } = await import('../document/mutations');
const { setRoomRole } = await import('../model/permissions');
const { restoreVersion } = await import('./restore');
const { watchLiveChanges } = await import('./liveChanges');
const Y = await import('yjs');

const sticky = (id: string, x: number, extra: Record<string, unknown> = {}) =>
  createNode({ id, type: 'sticky', x, y: 0, width: 100, height: 100, text: id, ...extra });

beforeEach(() => {
  setRoomRole('editor');
  doc.transact(() => {
    [...objectsMap.keys()].forEach((k) => objectsMap.delete(k));
    [...groupsMap.keys()].forEach((k) => groupsMap.delete(k));
  });
  undoManager.clear();
});

describe('restoreVersion', () => {
  it('writes the version as one new forward transaction that undoes in one step', () => {
    sticky('a', 10);
    sticky('b', 20);
    const version = { objects: readAllNodes(), groups: {} };
    const zA = version.objects.a.zIndex;

    // Later edits: a moved, b deleted, c added.
    objectsMap.get('a')!.set('x', 999);
    objectsMap.delete('b');
    sticky('c', 30);
    undoManager.clear();

    const updates: Uint8Array[] = [];
    const record = (u: Uint8Array) => updates.push(u);
    doc.on('update', record);
    restoreVersion(version);
    doc.off('update', record);

    const live = readAllNodes();
    expect(Object.keys(live).sort()).toEqual(['a', 'b']);
    expect(live.a.x).toBe(10);
    expect(live.b.text).toBe('b');
    // The version's stacking, not a fresh top slot.
    expect(live.a.zIndex).toBe(zA);
    // One update: peers and the log see a single forward edit.
    expect(updates).toHaveLength(1);

    undoManager.undo();
    const undone = readAllNodes();
    expect(Object.keys(undone).sort()).toEqual(['a', 'c']);
    expect(undone.a.x).toBe(999);
  });

  it('restores a single object and leaves the rest of the board alone', () => {
    sticky('a', 10);
    sticky('b', 20);
    const version = { objects: readAllNodes(), groups: {} };
    objectsMap.get('a')!.set('x', 500);
    objectsMap.get('b')!.set('x', 600);
    restoreVersion(version, new Set(['a']));
    const live = readAllNodes();
    expect(live.a.x).toBe(10);
    expect(live.b.x).toBe(600);
  });

  it('brings back the group a restored object belonged to', () => {
    sticky('a', 10, { parentId: 'g1' });
    groupsMap.set('g1', { id: 'g1', name: 'Cluster' });
    const version = { objects: readAllNodes(), groups: groupsMap.toJSON() };
    objectsMap.delete('a');
    groupsMap.delete('g1');
    restoreVersion(version);
    expect(groupsMap.get('g1')).toEqual({ id: 'g1', name: 'Cluster' });
    expect(readAllNodes().a.parentId).toBe('g1');
  });

  it('is refused for a viewer, without attempting a write', () => {
    sticky('a', 10);
    const version = { objects: readAllNodes(), groups: {} };
    objectsMap.get('a')!.set('x', 77);
    setRoomRole('viewer');
    const updates: Uint8Array[] = [];
    const record = (u: Uint8Array) => updates.push(u);
    doc.on('update', record);
    expect(restoreVersion(version)).toBeNull();
    doc.off('update', record);
    expect(updates).toHaveLength(0);
    expect(readAllNodes().a.x).toBe(77);
  });
});

describe('watchLiveChanges', () => {
  it('counts remote edits to the board and ignores local ones', () => {
    const counts: number[] = [];
    const stop = watchLiveChanges(doc, [objectsMap, groupsMap], (n) => counts.push(n));
    sticky('local', 1);
    const peer = new Y.Doc();
    const node = new Y.Map();
    node.set('type', 'sticky');
    peer.getMap('objects').set('remote', node);
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer), 'remote');
    peer.getMap('metadata').set('name', 'x');
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer), 'remote');
    stop();
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer), 'remote');
    expect(counts).toEqual([1]);
  });
});
