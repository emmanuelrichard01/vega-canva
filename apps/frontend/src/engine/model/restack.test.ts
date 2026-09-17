import { describe, expect, it } from 'vitest';
import type { AnyNode } from './schema';
import { restackOrder, restackSelection } from './restack';

function node(id: string, zIndex: number, x = 0, y = 0, size = 100): AnyNode {
  return {
    id, type: 'shape', x, y, width: size, height: size, rotation: 0, scaleX: 1, scaleY: 1,
    opacity: 1, zIndex, locked: false, hidden: false, createdBy: 'a', createdAt: 0, updatedAt: 0,
  } as unknown as AnyNode;
}

/** Apply patches and read back the drawn order, bottom first. */
function drawn(all: AnyNode[], patches: { id: string; changes: Record<string, unknown> }[]) {
  const next = all.map((n) => {
    const p = patches.find((q) => q.id === n.id);
    return p ? ({ ...n, ...p.changes } as AnyNode) : n;
  });
  return [...next].sort((a, b) => a.zIndex - b.zIndex).map((n) => n.id);
}

describe('restack', () => {
  it('brings a selection to the front in its own stacking order, not selection order', () => {
    const all = [node('a', 1), node('b', 2), node('c', 3)];
    // Selected top-first: the old code would have put b above a.
    const patches = restackSelection(all, ['b', 'a'], 'front');
    expect(drawn(all, patches)).toEqual(['c', 'a', 'b']);
  });

  it('sends a selection to the back keeping its order', () => {
    const all = [node('a', 1), node('b', 2), node('c', 3)];
    expect(drawn(all, restackSelection(all, ['c', 'b'], 'back'))).toEqual(['b', 'c', 'a']);
  });

  it('does nothing when the selection is already where it would go', () => {
    const all = [node('a', 1), node('b', 2)];
    expect(restackSelection(all, ['b'], 'front')).toEqual([]);
    expect(restackSelection(all, ['a'], 'back')).toEqual([]);
  });

  it('steps forward past the next object that overlaps, skipping ones far away', () => {
    // far sits between a and near in the list, but on the other side of the board.
    const all = [node('a', 1, 0, 0), node('far', 2, 5000, 5000), node('near', 3, 50, 50)];
    expect(drawn(all, restackSelection(all, ['a'], 'forward'))).toEqual(['far', 'near', 'a']);
  });

  it('steps backward past the next overlapping object below', () => {
    const all = [node('under', 1, 50, 50), node('far', 2, 5000, 5000), node('a', 3)];
    expect(drawn(all, restackSelection(all, ['a'], 'backward'))).toEqual(['a', 'under', 'far']);
  });

  it('does not step forward when nothing overlaps above', () => {
    const all = [node('a', 1, 0, 0), node('far', 2, 5000, 5000)];
    expect(restackOrder(all, ['a'], 'forward')).toBeNull();
  });

  it('never moves a selected object that is already above the one being passed', () => {
    const all = [node('a', 1), node('x', 2), node('b', 3)];
    expect(drawn(all, restackSelection(all, ['a', 'b'], 'forward'))).toEqual(['x', 'a', 'b']);
  });

  it('breaks ties from duplicated objects without renumbering the board', () => {
    const all = [node('a', 5), node('x', 5), node('y', 5), node('far', 9, 9000, 9000)];
    const patches = restackSelection(all, ['a'], 'forward');
    expect(drawn(all, patches)).toEqual(['x', 'a', 'y', 'far']);
    // `far` sat well above the tie and must not have been touched.
    expect(patches.find((p) => p.id === 'far')).toBeUndefined();
  });

  it('slots into a gap with fractions rather than moving the neighbours', () => {
    const all = [node('a', 1), node('x', 2), node('y', 3)];
    const patches = restackSelection(all, ['a'], 'forward');
    expect(patches).toHaveLength(1);
    expect(drawn(all, patches)).toEqual(['x', 'a', 'y']);
  });
});
