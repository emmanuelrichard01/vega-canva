import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Only the socket is mocked.
 *
 * `doc.ts` builds a `Y.Doc`, a WebSocket provider and an IndexedDB connection
 * at import time, which is why nothing in this directory had a test. Replacing
 * just that module with a real `Y.Doc` and a stub provider leaves the actual
 * `mutations.ts` — the real CRDT writes, the real gate — under test. Mocking
 * `../engine/document` wholesale, as the hook tests do, would assert only that
 * the mock behaves like the mock.
 */
vi.mock('./doc', async () => {
  const Y = await import('yjs');
  const doc = new Y.Doc();
  return {
    doc,
    objectsMap: doc.getMap('objects'),
    groupsMap: doc.getMap('groups'),
    identitiesMap: doc.getMap('identities'),
    provider: {
      awareness: {
        getLocalState: () => ({}),
        setLocalStateField: () => {},
        getStates: () => new Map(),
      },
    },
  };
});

const { createNode, updateNode, deleteNode, readNode } = await import('./mutations');
const { objectsMap } = await import('./doc');
const { setRoomRole } = await import('../model/permissions');

/**
 * The role gate on the only write path.
 *
 * These assert the *rule*, not a control. Every editing surface ends up in
 * `mutations.ts`, so a viewer arriving by any route — a rail nobody remembered
 * to hide, a keyboard shortcut, a panel added next year — is refused here.
 *
 * Before this existed, tools and dragging were gated and the contextual rail
 * was not, so a viewer could recolour a shape and embolden its label. Those
 * writes landed in their local document and were then dropped by a server that
 * had marked the connection read-only: their copy of the board forked from
 * everyone else's, and to them it looked like it had worked. A divergence that
 * resembles success is a worse failure than a refusal.
 */
describe('the write path refuses a role that cannot edit', () => {
  const shape = (id: string) =>
    ({ id, type: 'shape', x: 0, y: 0, width: 10, height: 10 }) as never;

  beforeEach(() => {
    setRoomRole('editor');
    Array.from(objectsMap.keys()).forEach((k) => objectsMap.delete(k));
  });
  afterEach(() => setRoomRole('editor'));

  it('lets an editor write', () => {
    expect(createNode(shape('n1'))).toBe('n1');
    updateNode('n1', { width: 99 });
    expect(readNode('n1')?.width).toBe(99);
  });

  it('refuses createNode for a viewer, and returns no id', () => {
    setRoomRole('viewer');
    expect(createNode(shape('nope'))).toBe('');
    expect(readNode('nope')).toBeNull();
  });

  it('refuses createNode for a commenter', () => {
    setRoomRole('commenter');
    expect(createNode(shape('nope2'))).toBe('');
    expect(readNode('nope2')).toBeNull();
  });

  /**
   * The reported hole, stated as what it actually was: every control on the
   * contextual rail is an `updateNode` call and nothing more.
   */
  it('refuses the edits the contextual rail used to make', () => {
    createNode(shape('n1'));
    setRoomRole('viewer');

    updateNode('n1', { appearance: { fill: 'rgb(255 0 0)' } });
    updateNode('n1', { fontWeight: 700 });
    updateNode('n1', { fontStyle: 'italic' });

    const node = readNode('n1');
    expect(node?.appearance).toBeUndefined();
    expect(node?.fontWeight).toBeUndefined();
    expect(node?.fontStyle).toBeUndefined();
  });

  it('refuses deleteNode for a viewer', () => {
    createNode(shape('n1'));
    setRoomRole('viewer');
    deleteNode('n1');
    expect(readNode('n1')).not.toBeNull();
  });

  it('lets an editor delete, so the gate is the role and not the function', () => {
    createNode(shape('n1'));
    deleteNode('n1');
    expect(readNode('n1')).toBeNull();
  });
});
