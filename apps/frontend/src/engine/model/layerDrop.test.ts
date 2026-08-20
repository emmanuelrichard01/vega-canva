import { describe, expect, it } from 'vitest';
import { dropZone, planLayerDrop, type DropNode, type DropResult, type DropRow, type DropWhere } from './layerDrop';

/**
 * Where a dragged row lands.
 *
 * The case that matters most here is the one the first version of this could
 * not express at all: taking an object *out* of a group when every row on
 * screen belongs to one. That is the top edge of a group header, and it is
 * asserted below in `above the folder is not in the folder`.
 */

/** A board, front to back. Highest z first, matching the panel's own order. */
function board(...spec: [string, string | undefined][]) {
  const objects: Record<string, DropNode> = {};
  const order: string[] = [];
  spec.forEach(([id, parentId], i) => {
    objects[id] = { id, zIndex: spec.length - i, parentId };
    order.push(id);
  });

  /** The rows the panel would draw: a header before each group's first member. */
  const rows: DropRow[] = [];
  const seen = new Set<string>();
  for (const id of order) {
    const parent = objects[id].parentId;
    if (parent) {
      if (!seen.has(parent)) {
        seen.add(parent);
        rows.push({ id: parent, kind: 'group' });
      }
      rows.push({ id, kind: 'object' });
      continue;
    }
    rows.push({ id, kind: 'object' });
  }
  /** The group records those parentIds imply, all top level unless nested. */
  const groups: Record<string, { id: string; parentId?: string }> = {};
  for (const r of rows) if (r.kind === 'group') groups[r.id] = { id: r.id };

  return { objects, order, rows, groups };
}

/** Node patches only — the shape the ordering and membership cases assert on. */
const drop = (
  b: ReturnType<typeof board>,
  moving: string[],
  id: string,
  where: DropWhere,
  collapsed?: string
) => full(b, moving, id, where, collapsed).nodes;

const full = (
  b: ReturnType<typeof board>,
  moving: string[],
  id: string,
  where: DropWhere,
  collapsed?: string,
  extra: { groups?: Record<string, { id: string; parentId?: string }>; movingGroup?: string } = {}
): DropResult =>
  planLayerDrop({
    order: b.order,
    objects: b.objects,
    rows: collapsed ? b.rows.map((r) => (r.id === collapsed ? { ...r, collapsed: true } : r)) : b.rows,
    moving,
    target: { id, where },
    ...extra,
  });

/** The parent a plan assigns to one id, or `undefined` if it did not touch it. */
type Patches = DropResult['nodes'];

const parentOf = (plans: Patches, id: string) =>
  plans.find((p) => p.id === id)?.changes.parentId;

/** Did the plan mention this row at all? */
const touched = (plans: Patches, id: string) => plans.some((p) => p.id === id);

/** The stack after applying a plan, front to back. */
function settle(b: ReturnType<typeof board>, plans: Patches) {
  const z = new Map(b.order.map((id) => [id, b.objects[id].zIndex]));
  for (const p of plans) if (p.changes.zIndex !== undefined) z.set(p.id, p.changes.zIndex);
  return [...z.entries()].sort((a, b2) => b2[1] - a[1]).map(([id]) => id);
}

describe('planLayerDrop', () => {
  describe('ordering', () => {
    it('puts a row above the one whose top edge it was dropped on', () => {
      const b = board(['a', undefined], ['b', undefined], ['c', undefined]);
      expect(settle(b, drop(b, ['c'], 'a', 'before'))).toEqual(['c', 'a', 'b']);
    });

    it('puts a row below the one whose bottom edge it was dropped on', () => {
      const b = board(['a', undefined], ['b', undefined], ['c', undefined]);
      expect(settle(b, drop(b, ['a'], 'c', 'after'))).toEqual(['b', 'c', 'a']);
    });

    it('distinguishes the two edges of the same row', () => {
      // The whole reason a row is three targets: same row, opposite results.
      const b = board(['a', undefined], ['b', undefined], ['c', undefined]);
      expect(settle(b, drop(b, ['c'], 'b', 'before'))).toEqual(['a', 'c', 'b']);
      expect(settle(b, drop(b, ['c'], 'b', 'after'))).toEqual(['a', 'b', 'c']);
    });

    it('does nothing when a row is dropped on itself', () => {
      const b = board(['a', undefined], ['b', undefined]);
      expect(drop(b, ['a'], 'a', 'before')).toEqual([]);
    });

    it('keeps a multi-row drag in its own order', () => {
      const b = board(['a', undefined], ['b', undefined], ['c', undefined], ['d', undefined]);
      expect(settle(b, drop(b, ['a', 'b'], 'd', 'after'))).toEqual(['c', 'd', 'a', 'b']);
    });

    it('lands beside the nearest row still in the list when the anchor is itself being dragged', () => {
      // Dragging two of a group's members onto the third: the anchor for the
      // insert has been lifted out, and the selection must not fall to the
      // bottom of the document because of it.
      const b = board(['a', undefined], ['b', undefined], ['c', undefined], ['d', undefined]);
      const plans = drop(b, ['b', 'c'], 'c', 'after');
      expect(plans).toEqual([]); // dropped on one of its own rows
      const other = drop(b, ['a', 'b'], 'b', 'after');
      expect(other).toEqual([]);
    });

    it('never assigns two rows the same z-index', () => {
      const b = board(['a', undefined], ['b', 'g1'], ['c', 'g1'], ['d', undefined], ['e', undefined]);
      const plans = drop(b, ['e'], 'b', 'before');
      const z = new Map(b.order.map((id) => [id, b.objects[id].zIndex]));
      for (const p of plans) if (p.changes.zIndex !== undefined) z.set(p.id, p.changes.zIndex);
      expect(new Set(z.values()).size).toBe(z.size);
    });
  });

  describe('membership', () => {
    it('joins a group when dropped into the group row', () => {
      const b = board(['loose', undefined], ['m1', 'g1'], ['m2', 'g1']);
      expect(parentOf(drop(b, ['loose'], 'g1', 'inside'), 'loose')).toBe('g1');
    });

    it('joins a group when dropped beside one of its members', () => {
      const b = board(['loose', undefined], ['m1', 'g1'], ['m2', 'g1']);
      expect(parentOf(drop(b, ['loose'], 'm1', 'after'), 'loose')).toBe('g1');
    });

    /**
     * The case the one-zone model could not express.
     *
     * Every row on this board belongs to a group, so under the old rule — take
     * the target row's parent — there was nowhere to aim that meant "out". The
     * folder's top edge means it, unambiguously, and it is always on screen.
     */
    it('above the folder is not in the folder', () => {
      const b = board(['m1', 'g1'], ['m2', 'g1']);
      const plans = drop(b, ['m2'], 'g1', 'before');
      expect(touched(plans, 'm2')).toBe(true);
      expect(parentOf(plans, 'm2')).toBeUndefined();
    });

    it('lands inside an open folder when dropped on its bottom edge', () => {
      // Its bottom edge sits directly above its own first child, so "below the
      // header" and "at the top of the folder" are the same place.
      const b = board(['loose', undefined], ['m1', 'g1']);
      expect(parentOf(drop(b, ['loose'], 'g1', 'after'), 'loose')).toBe('g1');
    });

    it('lands below a shut folder when dropped on its bottom edge', () => {
      // Shut, nothing sits between that edge and the next row, so the same
      // gesture means the opposite thing — which is what the eye reads.
      const b = board(['m1', 'g1'], ['m2', 'g1'], ['loose', undefined]);
      const plans = drop(b, ['loose'], 'g1', 'after', 'g1');
      expect(parentOf(plans, 'loose')).toBeUndefined();
      expect(settle(b, plans)).toEqual(['m1', 'm2', 'loose']);
    });

    it('moves from one group straight into another', () => {
      const b = board(['a1', 'g1'], ['b1', 'g2']);
      expect(parentOf(drop(b, ['a1'], 'b1', 'after'), 'a1')).toBe('g2');
    });

    it('does not rewrite the parent of rows that were not dragged', () => {
      const b = board(['loose', undefined], ['m1', 'g1'], ['m2', 'g1']);
      const plans = drop(b, ['loose'], 'g1', 'inside');
      for (const id of ['m1', 'm2']) {
        expect(plans.find((p) => p.id === id)?.changes.parentId).toBeUndefined();
      }
    });

    it('takes a whole group out when every member is dragged above its header', () => {
      const b = board(['m1', 'g1'], ['m2', 'g1'], ['loose', undefined]);
      const plans = drop(b, ['m1', 'm2'], 'loose', 'after');
      expect(parentOf(plans, 'm1')).toBeUndefined();
      expect(parentOf(plans, 'm2')).toBeUndefined();
    });

    it('reordering inside a group is a reorder, not a reparent', () => {
      const b = board(['m1', 'g1'], ['m2', 'g1'], ['m3', 'g1']);
      const plans = drop(b, ['m3'], 'm1', 'before');
      expect(plans.every((p) => p.changes.parentId === undefined)).toBe(true);
      expect(settle(b, plans)).toEqual(['m3', 'm1', 'm2']);
    });

    it('refuses to drop a group into itself', () => {
      const b = board(['m1', 'g1'], ['m2', 'g1']);
      expect(drop(b, ['m1', 'm2'], 'g1', 'inside')).toEqual([]);
    });

    it('merges one group into another when a whole group is dropped inside it', () => {
      // Groups are flat — a group *is* the parentId its members share — so
      // there is no nesting to fall back on. Merging is the honest result.
      const b = board(['a1', 'g1'], ['a2', 'g1'], ['b1', 'g2']);
      const plans = drop(b, ['a1', 'a2'], 'g2', 'inside');
      expect(parentOf(plans, 'a1')).toBe('g2');
      expect(parentOf(plans, 'a2')).toBe('g2');
    });
  });

  describe('edges', () => {
    it('returns nothing when nothing is being dragged', () => {
      const b = board(['a', undefined]);
      expect(drop(b, [], 'a', 'before')).toEqual([]);
    });

    it('ignores a dragged id that is not on the board', () => {
      const b = board(['a', undefined], ['b', undefined]);
      expect(drop(b, ['ghost'], 'a', 'before')).toEqual([]);
    });

    it('drops at the end when the group it targets has no members left', () => {
      const b = board(['a', undefined], ['m1', 'g1']);
      // Dragging the group's only member into the group it is already in.
      expect(drop(b, ['m1'], 'g1', 'inside')).toEqual([]);
    });

    it('treats a frame like any other row — before and after, never inside', () => {
      // Frame membership is geometric (`frameId`), so a drop here must not
      // claim it. The frame is a plain object row and takes a plain parent.
      const b = board(['frame', undefined], ['a', undefined]);
      const plans = drop(b, ['a'], 'frame', 'before');
      expect(settle(b, plans)).toEqual(['a', 'frame']);
      expect(parentOf(plans, 'a')).toBeUndefined();
    });
  });
});

/**
 * Dragging a folder, now that a folder can hold one.
 *
 * The distinction these pin is the one the flat model had no way to make:
 * moving a folder must move *the folder*, leaving its members pointing at it.
 * Rewriting their `parentId` instead would dissolve it into wherever it landed,
 * which is exactly the flattening nesting exists to end.
 */
describe('planLayerDrop with nested groups', () => {
  const nested = () => {
    const b = board(['a1', 'inner'], ['a2', 'inner'], ['b1', 'outer'], ['loose', undefined]);
    b.groups.inner = { id: 'inner', parentId: 'outer' };
    b.groups.outer = { id: 'outer' };
    return b;
  };

  it('reparents the folder, not its members', () => {
    const b = board(['a1', 'g1'], ['a2', 'g1'], ['b1', 'g2']);
    const plan = full(b, ['a1', 'a2'], 'g2', 'inside', undefined, {
      groups: b.groups,
      movingGroup: 'g1',
    });
    expect(plan.groups).toEqual([{ id: 'g1', parentId: 'g2' }]);
    // The members keep their own membership: `g1` still holds them, and `g1`
    // is what moved.
    expect(plan.nodes.every((p) => p.changes.parentId === undefined)).toBe(true);
  });

  it('refuses to put a folder inside itself', () => {
    const b = nested();
    const plan = full(b, ['b1', 'a1', 'a2'], 'outer', 'inside', undefined, {
      groups: b.groups,
      movingGroup: 'outer',
    });
    expect(plan).toEqual({ nodes: [], groups: [] });
  });

  it('refuses to put a folder inside one of its own descendants', () => {
    // A real cycle, not merely a pointless gesture: written to the document,
    // every walk over the tree would have to defend against it forever.
    const b = nested();
    const plan = full(b, ['a1', 'a2', 'b1'], 'inner', 'inside', undefined, {
      groups: b.groups,
      movingGroup: 'outer',
    });
    expect(plan.groups).toEqual([]);
    expect(plan.nodes).toEqual([]);
  });

  it('takes a folder out to its parent, not to the root', () => {
    // Above an *inner* folder means "in the outer one, above this". Reading it
    // as the root would eject the dragged rows two levels instead of none.
    const b = nested();
    const plan = full(b, ['loose'], 'inner', 'before', undefined, { groups: b.groups });
    expect(parentOf(plan.nodes, 'loose')).toBe('outer');
  });

  it('anchors above a folder at its first node however deep that is', () => {
    // `outer` opens onto `inner`, so its first *node* is two levels down.
    const b = nested();
    const plan = full(b, ['loose'], 'outer', 'before', undefined, { groups: b.groups });
    expect(settle(b, plan.nodes)).toEqual(['loose', 'a1', 'a2', 'b1']);
  });

  it('leaves the folder record alone when a folder drag does not change level', () => {
    const b = board(['a1', 'g1'], ['a2', 'g1'], ['loose', undefined]);
    const plan = full(b, ['a1', 'a2'], 'loose', 'after', undefined, {
      groups: b.groups,
      movingGroup: 'g1',
    });
    // Already top level, staying top level: reordering only.
    expect(plan.groups).toEqual([]);
  });
});

describe('dropZone', () => {
  it('splits a plain row down the middle, with no dead band', () => {
    expect(dropZone(0, 32, false)).toBe('before');
    expect(dropZone(15, 32, false)).toBe('before');
    expect(dropZone(17, 32, false)).toBe('after');
    expect(dropZone(32, 32, false)).toBe('after');
  });

  it('gives a container a generous middle', () => {
    // "Into the folder" is the harder thing to aim at and usually the reason
    // you hovered a folder at all.
    expect(dropZone(2, 32, true)).toBe('before');
    expect(dropZone(16, 32, true)).toBe('inside');
    expect(dropZone(30, 32, true)).toBe('after');
  });

  it('does not divide by a zero height', () => {
    expect(dropZone(0, 0, true)).toBe('before');
  });
});
