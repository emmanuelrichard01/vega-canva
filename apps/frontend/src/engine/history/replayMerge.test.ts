import { describe, expect, it, vi } from 'vitest';
import { mergeReplayObjects } from './replayMerge';
import type { AnyNode } from '../model/schema';

/**
 * What a playback frame costs, and — more importantly — what it must not get
 * wrong.
 *
 * Carrying a node forward is what keeps the canvas still: a memoized renderer
 * compares object identity, so a frame that rebuilds every node re-renders the
 * whole board. But carry forward a node that *did* change and it draws at a
 * stale position, which looks exactly like the tearing this replaced. Both
 * failure modes are asserted here.
 */

const node = (id: string, over: Partial<AnyNode> = {}) =>
  ({ id, type: 'sticky', x: 0, y: 0, width: 10, height: 10, ...over }) as AnyNode;

/** Stands in for the read boundary; tags what it produced so it is traceable. */
const normalize = (raw: Record<string, unknown>, id: string) =>
  ({ ...(raw as object), id, normalized: true }) as unknown as AnyNode;

describe('mergeReplayObjects', () => {
  it('normalizes everything when the change set is unknown', () => {
    // A rewind rebuilds the document and cannot say what moved.
    const previous = { a: node('a'), b: node('b') };
    const snapshot = { a: { x: 1 }, b: { x: 2 } };

    const result = mergeReplayObjects(previous, snapshot, null, normalize);

    expect(result.touched.sort()).toEqual(['a', 'b']);
    expect(result.objects.a).not.toBe(previous.a);
  });

  /**
   * The property the whole change exists for: an unchanged node keeps its
   * previous object, so `React.memo` holds and the renderer does not run.
   */
  it('carries an unchanged node forward by reference', () => {
    const previous = { a: node('a'), b: node('b') };
    const snapshot = { a: { x: 1 }, b: { x: 2 } };

    const result = mergeReplayObjects(previous, snapshot, ['b'], normalize);

    expect(result.objects.a).toBe(previous.a);
    expect(result.objects.b).not.toBe(previous.b);
    expect(result.touched).toEqual(['b']);
  });

  it('does the normalizing work only for what changed', () => {
    const spy = vi.fn(normalize);
    const previous = Object.fromEntries(
      Array.from({ length: 50 }, (_, i) => [`n${i}`, node(`n${i}`)])
    );
    const snapshot = Object.fromEntries(
      Array.from({ length: 50 }, (_, i) => [`n${i}`, { x: i }])
    );

    mergeReplayObjects(previous, snapshot, ['n7'], spy);

    // Fifty nodes on screen, one moved: one normalization, not fifty.
    expect(spy).toHaveBeenCalledTimes(1);
  });

  /**
   * The dangerous direction. A node named in the change set must be rebuilt
   * even though one is sitting in `previous` under the same id — otherwise it
   * renders at the position it held a frame ago.
   */
  it('rebuilds a changed node rather than trusting the one on screen', () => {
    const previous = { a: node('a', { x: 0 }) };
    const snapshot = { a: { x: 999 } };

    const result = mergeReplayObjects(previous, snapshot, ['a'], normalize);

    expect(result.objects.a).not.toBe(previous.a);
    expect((result.objects.a as unknown as { x: number }).x).toBe(999);
  });

  /**
   * A node that appears for the first time is not in `previous`, so there is
   * nothing to carry — it must be normalized whatever the change set says. A
   * change set that under-reports would otherwise drop new objects silently,
   * which is precisely "most objects never showed up".
   */
  it('normalizes a node it has never seen, even if unlisted', () => {
    const result = mergeReplayObjects({}, { fresh: { x: 5 } }, [], normalize);

    expect(result.objects.fresh).toBeDefined();
    expect(result.touched).toEqual(['fresh']);
  });

  it('reports nodes that have gone', () => {
    const previous = { a: node('a'), b: node('b') };
    const result = mergeReplayObjects(previous, { a: { x: 1 } }, ['a'], normalize);

    expect(result.removed).toEqual(['b']);
    expect(result.objects.b).toBeUndefined();
  });

  it('reports nothing removed when the board only grew', () => {
    const result = mergeReplayObjects({ a: node('a') }, { a: {}, b: {} }, ['b'], normalize);
    expect(result.removed).toEqual([]);
    expect(Object.keys(result.objects).sort()).toEqual(['a', 'b']);
  });

  it('produces an empty board for an empty snapshot', () => {
    // Rewinding to before the first update: everything on screen is removed.
    const previous = { a: node('a'), b: node('b') };
    const result = mergeReplayObjects(previous, {}, null, normalize);

    expect(result.objects).toEqual({});
    expect(result.removed.sort()).toEqual(['a', 'b']);
    expect(result.touched).toEqual([]);
  });

  it('drops a node the boundary refuses', () => {
    // `normalizeNode` returning null means the raw data was unusable; it must
    // not land in the objects map as undefined.
    const refuse = () => null;
    const result = mergeReplayObjects({}, { bad: {} }, null, refuse);

    expect(Object.keys(result.objects)).toEqual([]);
    expect(result.touched).toEqual([]);
  });

  it('never lists an id as both touched and removed', () => {
    const previous = { a: node('a'), b: node('b'), c: node('c') };
    const snapshot = { a: { x: 1 }, b: { x: 2 } };
    const result = mergeReplayObjects(previous, snapshot, ['a'], normalize);

    for (const id of result.touched) {
      expect(result.removed).not.toContain(id);
    }
    expect(result.removed).toEqual(['c']);
  });

  it('keeps every id the snapshot holds, however the change set is drawn', () => {
    // The objects map is the document at that moment; the change set only ever
    // decides how much work to do, never what exists.
    const previous = { a: node('a'), b: node('b') };
    const snapshot = { a: {}, b: {}, c: {} };

    for (const changed of [null, [], ['a'], ['a', 'b', 'c']]) {
      const result = mergeReplayObjects(previous, snapshot, changed, normalize);
      expect(Object.keys(result.objects).sort(), String(changed)).toEqual(['a', 'b', 'c']);
    }
  });
});
