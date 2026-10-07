import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { PhysicsSession } from './session';

function board() {
  const doc = new Y.Doc();
  const map = doc.getMap<Y.Map<number>>('objects');
  doc.transact(() => {
    for (const id of ['a', 'b', 'c']) {
      const m = new Y.Map<number>();
      m.set('x', 0);
      map.set(id, m);
    }
  });
  const undo = new Y.UndoManager([map], { captureTimeout: 0 });
  undo.stopCapturing();
  return { doc, map, undo };
}

const move = (doc: Y.Doc, map: Y.Map<Y.Map<number>>, id: string, x: number) =>
  doc.transact(() => map.get(id)!.set('x', x));

describe('physics session', () => {
  it('without a session each settle is its own undo step', () => {
    const { doc, map, undo } = board();
    ['a', 'b', 'c'].forEach((id, i) => move(doc, map, id, i + 1));
    expect(undo.undoStack.length).toBe(3);
  });

  it('merges every settle in a session into one undo step', () => {
    const { doc, map, undo } = board();
    const session = new PhysicsSession(undo);
    session.begin();
    ['a', 'b', 'c'].forEach((id, i) => move(doc, map, id, i + 1));
    session.end();
    expect(undo.undoStack.length).toBe(1);

    undo.undo();
    expect(['a', 'b', 'c'].map((id) => map.get(id)!.get('x'))).toEqual([0, 0, 0]);
  });

  it('does not swallow an edit made just before, or after', () => {
    const { doc, map, undo } = board();
    const session = new PhysicsSession(undo);
    move(doc, map, 'a', 9);
    session.begin();
    move(doc, map, 'b', 1);
    move(doc, map, 'c', 1);
    session.end();
    move(doc, map, 'a', 10);
    expect(undo.undoStack.length).toBe(3);
  });

  it('restores the normal capture window, and ending twice is harmless', () => {
    const { undo } = board();
    undo.captureTimeout = 500;
    const session = new PhysicsSession(undo);
    session.begin();
    session.begin();
    expect(undo.captureTimeout).toBe(Number.POSITIVE_INFINITY);
    session.end();
    session.end();
    expect(undo.captureTimeout).toBe(500);
    expect(session.active).toBe(false);
  });
});
