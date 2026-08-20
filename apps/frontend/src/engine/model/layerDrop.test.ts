import { describe, expect, it } from 'vitest';
import { planLayerDrop, type DropNode } from './layerDrop';

/**
 * Where a dragged row lands.
 *
 * The panel that called this could only reorder — there was no way to drag an
 * object into a group, out of one, or between two, so it drew a hierarchy it
 * gave you no means to edit. It also rewrote `zIndex` on every node in the
 * document, one write each, outside any transaction.
 *
 * Both halves are asserted here: that membership follows the drop target, and
 * that a drop touches only the rows it has to.
 */

/** A board, front to back. Highest z first, matching the panel's own order. */
function board(...rows: [string, string | undefined][]) {
  const objects: Record<string, DropNode> = {};
  const order: string[] = [];
  rows.forEach(([id, parentId], i) => {
    objects[id] = { id, zIndex: rows.length - i, parentId };
    order.push(id);
  });
  return { objects, order };
}

/** The parent a plan assigns to one id, or `undefined` if it did not touch it. */
const parentOf = (plans: ReturnType<typeof planLayerDrop>, id: string) =>
  plans.find((p) => p.id === id)?.changes.parentId;

const touched = (plans: ReturnType<typeof planLayerDrop>) => plans.map((p) => p.id).sort();

describe('planLayerDrop', () => {
  describe('reordering', () => {
    it('moves a row to where it was dropped', () => {
      const { objects, order } = board(['a', undefined], ['b', undefined], ['c', undefined]);
      const plans = planLayerDrop({ order, objects, moving: ['c'], targetId: 'a' });

      // `c` takes `a`'s place at the front, so it must end up above it.
      const zc = plans.find((p) => p.id === 'c')!.changes.zIndex!;
      const za = plans.find((p) => p.id === 'a')?.changes.zIndex ?? objects.a.zIndex;
      expect(zc).toBeGreaterThan(za);
    });

    it('touches only the rows whose position actually changed', () => {
      // The whole document used to be rewritten for one move.
      const { objects, order } = board(
        ['a', undefined], ['b', undefined], ['c', undefined], ['d', undefined], ['e', undefined]
      );
      const plans = planLayerDrop({ order, objects, moving: ['b'], targetId: 'c' });
      expect(plans.length).toBeLessThan(order.length);
    });

    it('does nothing when the row is dropped on itself', () => {
      const { objects, order } = board(['a', undefined], ['b', undefined]);
      expect(planLayerDrop({ order, objects, moving: ['a'], targetId: 'a' })).toEqual([]);
    });

    it('keeps a multi-row drag in its own order', () => {
      // Dragging three rows must not shuffle them against each other on the way.
      const { objects, order } = board(
        ['a', undefined], ['b', undefined], ['c', undefined], ['d', undefined]
      );
      const plans = planLayerDrop({ order, objects, moving: ['a', 'b'], targetId: 'd' });
      const za = plans.find((p) => p.id === 'a')!.changes.zIndex!;
      const zb = plans.find((p) => p.id === 'b')!.changes.zIndex!;
      expect(za).toBeGreaterThan(zb);
    });
  });

  describe('membership', () => {
    it('joins a group when dropped on the group row', () => {
      const { objects, order } = board(['loose', undefined], ['m1', 'g1'], ['m2', 'g1']);
      const plans = planLayerDrop({
        order, objects, moving: ['loose'], targetId: 'g1', targetIsGroup: true,
      });
      expect(parentOf(plans, 'loose')).toBe('g1');
    });

    it('joins a group when dropped on one of its members', () => {
      // Dropping beside something is the same statement as dropping on the
      // folder: this is where it belongs now.
      const { objects, order } = board(['loose', undefined], ['m1', 'g1']);
      const plans = planLayerDrop({ order, objects, moving: ['loose'], targetId: 'm1' });
      expect(parentOf(plans, 'loose')).toBe('g1');
    });

    /**
     * Leaving a group needs no separate gesture: drop it beside something that
     * is not in one. That is the whole reason the rule is "inherit the target's
     * parent" rather than "join the target's group if it has one".
     */
    it('leaves a group when dropped on a loose row', () => {
      const { objects, order } = board(['m1', 'g1'], ['m2', 'g1'], ['loose', undefined]);
      const plans = planLayerDrop({ order, objects, moving: ['m1'], targetId: 'loose' });
      expect(parentOf(plans, 'm1')).toBeUndefined();
      // And it really was a change, not an untouched row.
      expect(touched(plans)).toContain('m1');
    });

    it('moves from one group straight into another', () => {
      const { objects, order } = board(['a1', 'g1'], ['b1', 'g2']);
      const plans = planLayerDrop({ order, objects, moving: ['a1'], targetId: 'b1' });
      expect(parentOf(plans, 'a1')).toBe('g2');
    });

    it('does not rewrite the parent of rows that were not dragged', () => {
      const { objects, order } = board(['loose', undefined], ['m1', 'g1'], ['m2', 'g1']);
      const plans = planLayerDrop({ order, objects, moving: ['loose'], targetId: 'g1', targetIsGroup: true });
      for (const id of ['m1', 'm2']) {
        expect(plans.find((p) => p.id === id)?.changes.parentId).toBeUndefined();
      }
    });

    it('takes a whole group with it when every member is dragged', () => {
      const { objects, order } = board(['m1', 'g1'], ['m2', 'g1'], ['loose', undefined]);
      const plans = planLayerDrop({ order, objects, moving: ['m1', 'm2'], targetId: 'loose' });
      expect(parentOf(plans, 'm1')).toBeUndefined();
      expect(parentOf(plans, 'm2')).toBeUndefined();
    });

    it('does nothing when a group is dropped onto its own member', () => {
      // Not a cycle to guard against, just a gesture that means nothing.
      const { objects, order } = board(['m1', 'g1'], ['m2', 'g1']);
      expect(planLayerDrop({ order, objects, moving: ['m1', 'm2'], targetId: 'm1' })).toEqual([]);
    });

    it('leaves membership alone when the target is already the same group', () => {
      const { objects, order } = board(['m1', 'g1'], ['m2', 'g1']);
      const plans = planLayerDrop({ order, objects, moving: ['m2'], targetId: 'm1' });
      // Reordering within a group is a reorder, not a reparent.
      expect(plans.every((p) => p.changes.parentId === undefined)).toBe(true);
    });
  });

  describe('edges', () => {
    it('returns nothing when nothing is being dragged', () => {
      const { objects, order } = board(['a', undefined]);
      expect(planLayerDrop({ order, objects, moving: [], targetId: 'a' })).toEqual([]);
    });

    it('ignores a dragged id that is not on the board', () => {
      const { objects, order } = board(['a', undefined], ['b', undefined]);
      const plans = planLayerDrop({ order, objects, moving: ['ghost'], targetId: 'a' });
      expect(plans.every((p) => p.id !== 'ghost')).toBe(true);
    });

    it('drops at the end when the group it targets has no members yet', () => {
      const { objects, order } = board(['a', undefined], ['b', undefined]);
      const plans = planLayerDrop({
        order, objects, moving: ['a'], targetId: 'empty', targetIsGroup: true,
      });
      expect(parentOf(plans, 'a')).toBe('empty');
    });

    it('never assigns two rows the same z-index', () => {
      const { objects, order } = board(
        ['a', undefined], ['b', 'g1'], ['c', 'g1'], ['d', undefined], ['e', undefined]
      );
      const plans = planLayerDrop({ order, objects, moving: ['e'], targetId: 'b' });
      const finalZ = new Map<string, number>();
      for (const id of order) finalZ.set(id, objects[id].zIndex);
      for (const p of plans) if (p.changes.zIndex !== undefined) finalZ.set(p.id, p.changes.zIndex);
      expect(new Set(finalZ.values()).size).toBe(finalZ.size);
    });
  });
});
