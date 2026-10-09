import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

vi.mock('./doc', async () => {
  const Y = await import('yjs');
  const doc = new Y.Doc();
  return {
    doc,
    objectsMap: doc.getMap('objects'),
    groupsMap: doc.getMap('groups'),
    identitiesMap: doc.getMap('identities'),
    metadataMap: doc.getMap('metadata'),
    DERIVED_ORIGIN: 'derived',
    provider: { awareness: { getLocalState: () => ({}), setLocalStateField: () => {}, getStates: () => new Map() } },
  };
});

const { createNode } = await import('./mutations');
const { scheduleDerivedPatch } = await import('./derivedPatches');
const { doc, objectsMap } = await import('./doc');
const { setRoomRole } = await import('../model/permissions');

const origins: unknown[] = [];
doc.on('afterTransaction', (tr: { origin: unknown }) => origins.push(tr.origin));

describe('scheduleDerivedPatch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setRoomRole('editor');
    doc.transact(() => objectsMap.clear());
    for (let i = 0; i < 5; i++) createNode({ id: `n${i}`, type: 'shape', x: 0, y: 0, width: 10, height: 10 });
    origins.length = 0;
  });
  afterEach(() => vi.useRealTimers());

  it('commits everything due in the same tick as one transaction', () => {
    for (let i = 0; i < 5; i++) scheduleDerivedPatch(`n${i}`, { x: i * 10 });
    expect(origins).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(origins).toEqual(['derived']);
    expect([0, 1, 2, 3, 4].map((i) => objectsMap.get(`n${i}`)!.get('x'))).toEqual([0, 10, 20, 30, 40]);
  });

  it('drops a cancelled entry and one whose guard refuses, and keeps the latest per node', () => {
    const cancel = scheduleDerivedPatch('n0', { x: 99 });
    scheduleDerivedPatch('n1', { x: 99 }, { guard: () => false });
    scheduleDerivedPatch('n2', { x: 1 });
    scheduleDerivedPatch('n2', { x: 2 });
    cancel();
    vi.advanceTimersByTime(1);
    expect(objectsMap.get('n0')!.get('x')).toBe(0);
    expect(objectsMap.get('n1')!.get('x')).toBe(0);
    expect(objectsMap.get('n2')!.get('x')).toBe(2);
    expect(origins).toHaveLength(1);
  });

  it('waits out its delay and commits user-origin writes as an ordinary edit', () => {
    scheduleDerivedPatch('n3', { width: 50 }, { delay: 180, origin: null });
    vi.advanceTimersByTime(100);
    expect(objectsMap.get('n3')!.get('width')).toBe(10);
    vi.advanceTimersByTime(100);
    expect(objectsMap.get('n3')!.get('width')).toBe(50);
    expect(origins).toEqual([null]);
    expect(objectsMap.get('n3')!.get('updatedAt')).toBeTypeOf('number');
  });
});
