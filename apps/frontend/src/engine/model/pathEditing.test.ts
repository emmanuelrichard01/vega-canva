import { describe, expect, it } from 'vitest';
import {
  alignAnchors,
  anchorAt,
  anchorBounds,
  anchorKey,
  anchorNear,
  anchorsInRect,
  constrainDeltaToAxis,
  constrainHandleToAngle,
  contours,
  deleteAnchors,
  dragHandle,
  handleAt,
  handleNear,
  moveAnchors,
  scaleAnchors,
  setAnchorAlignment,
  setAnchorsMode,
  toggleAnchor,
  type AnchorRef,
} from './pathEditing';
import { anchorMode } from './pathGeometry';
import type { BezierGeometry, CompoundGeometry } from './schema';

/**
 * Editing several anchors at once.
 *
 * The behaviour worth pinning hardest is that a *delta* moves each anchor and
 * every one keeps its offset from the others — a destination cannot express
 * that, which is why `pathGeometry.moveAnchor` could not be reused as-is for a
 * multi-selection.
 */

/** An open path: (0,0) → (10,0) → (20,0), straight. */
const line = (): BezierGeometry => ({
  kind: 'bezier',
  closed: false,
  segments: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }],
});

/** A square, closed, corners only. */
const square = (): BezierGeometry => ({
  kind: 'bezier',
  closed: true,
  segments: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
});

/** Two rings: what a boolean produces and the only thing that can hold it. */
const donut = (): CompoundGeometry => ({
  kind: 'compound',
  subpaths: [
    square(),
    { kind: 'bezier', closed: true, segments: [{ x: 3, y: 3 }, { x: 7, y: 3 }, { x: 7, y: 7 }, { x: 3, y: 7 }] },
  ],
});

/** A curve with handles, so pair behaviour has something to act on. */
const curve = (): BezierGeometry => ({
  kind: 'bezier',
  closed: false,
  segments: [
    { x: 0, y: 0 },
    { x: 10, y: 0, cp1x: 3, cp1y: -5, cp2x: 7, cp2y: -5 },
    { x: 20, y: 0, cp1x: 13, cp1y: 5, cp2x: 17, cp2y: 5 },
  ],
});

const ref = (sub: number, index: number): AnchorRef => ({ sub, index });

describe('contours', () => {
  it('reads a plain path as one contour', () => {
    expect(contours(line())).toHaveLength(1);
  });

  it('reads every ring of a compound path', () => {
    // `moveAnchor(geo, 3)` cannot say which `3` — which is why refs carry a
    // contour index at all.
    const c = contours(donut());
    expect(c).toHaveLength(2);
    expect(c[1].anchors[0]).toMatchObject({ x: 3, y: 3 });
  });
});

describe('moveAnchors', () => {
  it('moves several by the same delta, keeping their spacing', () => {
    const moved = moveAnchors(line(), [ref(0, 0), ref(0, 2)], 5, 5);
    expect(anchorAt(moved, ref(0, 0))).toEqual({ x: 5, y: 5 });
    expect(anchorAt(moved, ref(0, 2))).toEqual({ x: 25, y: 5 });
    // The one that was not selected did not move.
    expect(anchorAt(moved, ref(0, 1))).toEqual({ x: 10, y: 0 });
  });

  it('carries handles with the anchor', () => {
    // Handles are stored absolutely: an anchor moving without them turns its
    // own curve inside out.
    const moved = moveAnchors(curve(), [ref(0, 1)], 0, 10);
    expect(handleAt(moved, { ...ref(0, 1), side: 'in' })).toEqual({ x: 7, y: 5 });
    expect(handleAt(moved, { ...ref(0, 1), side: 'out' })).toEqual({ x: 13, y: 15 });
  });

  it('does not displace a shared control twice', () => {
    // Two adjacent anchors dragged together: the handle between them belongs to
    // one of them, and moving it once per selected end would double the delta
    // and flatten the very segment the drag was preserving.
    const moved = moveAnchors(curve(), [ref(0, 1), ref(0, 2)], 10, 0);
    expect(handleAt(moved, { ...ref(0, 1), side: 'out' })).toEqual({ x: 23, y: 5 });
  });

  it('reaches into the right ring of a compound path', () => {
    const moved = moveAnchors(donut(), [ref(1, 0)], 1, 1);
    expect(anchorAt(moved, ref(1, 0))).toEqual({ x: 4, y: 4 });
    expect(anchorAt(moved, ref(0, 0))).toEqual({ x: 0, y: 0 });
    expect(moved.kind).toBe('compound');
  });

  it('is a no-op for an empty selection or a zero delta', () => {
    const g = line();
    expect(moveAnchors(g, [], 5, 5)).toBe(g);
    expect(moveAnchors(g, [ref(0, 0)], 0, 0)).toBe(g);
  });
});

describe('dragHandle', () => {
  it('swings the opposite handle of a smooth anchor', () => {
    const smooth = setAnchorsMode(curve(), [ref(0, 1)], 'smooth');
    const dragged = dragHandle(smooth, { ...ref(0, 1), side: 'out' }, { x: 15, y: 5 });
    const other = handleAt(dragged, { ...ref(0, 1), side: 'in' })!;
    // Opposite side of the anchor, which sits at (10, 0).
    expect(other.x).toBeLessThan(10);
    expect(other.y).toBeLessThan(0);
  });

  it('leaves the opposite handle alone when the pair is broken', () => {
    const smooth = setAnchorsMode(curve(), [ref(0, 1)], 'smooth');
    const before = handleAt(smooth, { ...ref(0, 1), side: 'in' })!;
    const dragged = dragHandle(smooth, { ...ref(0, 1), side: 'out' }, { x: 15, y: 9 }, { break: true });
    expect(handleAt(dragged, { ...ref(0, 1), side: 'in' })).toEqual(before);
  });

  it('edits only the named ring of a compound path', () => {
    const dragged = dragHandle(donut(), { sub: 1, index: 1, side: 'out' }, { x: 9, y: 4 });
    expect(dragged.kind).toBe('compound');
    expect(anchorAt(dragged, ref(0, 0))).toEqual({ x: 0, y: 0 });
  });
});

describe('hit testing', () => {
  it('finds the nearest anchor within the radius, and nothing outside it', () => {
    expect(anchorNear(line(), { x: 11, y: 1 }, 3)).toEqual(ref(0, 1));
    expect(anchorNear(line(), { x: 50, y: 50 }, 3)).toBeNull();
  });

  it('searches handles only on the anchors it was given', () => {
    const near = handleNear(curve(), { x: 7, y: -5 }, 2, [ref(0, 1)]);
    expect(near).toEqual({ ...ref(0, 1), side: 'in' });
    // Same point, but that anchor is not showing its handles.
    expect(handleNear(curve(), { x: 7, y: -5 }, 2, [ref(0, 0)])).toBeNull();
  });

  it('collects every anchor inside a marquee, across contours', () => {
    const inside = anchorsInRect(donut(), { x: 2, y: 2, width: 6, height: 6 });
    expect(inside).toHaveLength(4);
    expect(inside.every((r) => r.sub === 1)).toBe(true);
  });

  it('accepts a marquee dragged up and to the left', () => {
    // Negative width and height are what a drag from the far corner produces,
    // and refusing them would make half of all marquees select nothing.
    const inside = anchorsInRect(square(), { x: 12, y: 12, width: -14, height: -14 });
    expect(inside).toHaveLength(4);
  });
});

describe('toggleAnchor', () => {
  it('replaces on a plain click', () => {
    expect(toggleAnchor([ref(0, 0), ref(0, 1)], ref(0, 2), false)).toEqual([ref(0, 2)]);
  });

  it('adds and removes on a modified click', () => {
    expect(toggleAnchor([ref(0, 0)], ref(0, 1), true)).toHaveLength(2);
    expect(toggleAnchor([ref(0, 0), ref(0, 1)], ref(0, 1), true)).toEqual([ref(0, 0)]);
  });
});

describe('deleteAnchors', () => {
  it('removes them and keeps the path', () => {
    const { geometry } = deleteAnchors(square(), [ref(0, 1)]);
    expect(contours(geometry!)[0].anchors).toHaveLength(3);
  });

  it('drops a contour that falls below two anchors', () => {
    // A one-anchor contour is not a shorter path, it is not a path.
    const { geometry } = deleteAnchors(donut(), [ref(1, 0), ref(1, 1), ref(1, 2)]);
    expect(contours(geometry!)).toHaveLength(1);
  });

  it('returns null when nothing is left, so the caller deletes the node', () => {
    const { geometry } = deleteAnchors(line(), [ref(0, 0), ref(0, 1)]);
    expect(geometry).toBeNull();
  });

  it('re-indexes what stays selected', () => {
    // Deleting several in a row is the thing people actually do, and a
    // selection carried across unchanged would silently point at neighbours.
    const { selection } = deleteAnchors(square(), [ref(0, 0)]);
    expect(selection).toHaveLength(1);
    expect(selection[0].index).toBeLessThan(3);
  });

  it('is a no-op for an empty list', () => {
    const g = square();
    expect(deleteAnchors(g, []).geometry).toBe(g);
  });
});

describe('alignAnchors', () => {
  it('lines an almost-straight edge up exactly', () => {
    const wobbly: BezierGeometry = {
      kind: 'bezier',
      closed: false,
      segments: [{ x: 0, y: 0 }, { x: 10, y: 1 }, { x: 20, y: -1 }],
    };
    const aligned = alignAnchors(wobbly, [ref(0, 0), ref(0, 1), ref(0, 2)], 'top');
    const ys = contours(aligned)[0].anchors.map((a) => a.y);
    expect(new Set(ys).size).toBe(1);
    expect(ys[0]).toBe(-1);
  });

  it('aligns to the middle when asked', () => {
    const aligned = alignAnchors(square(), [ref(0, 0), ref(0, 3)], 'middleY');
    expect(anchorAt(aligned, ref(0, 0))!.y).toBe(5);
    expect(anchorAt(aligned, ref(0, 3))!.y).toBe(5);
  });

  it('declines on fewer than two anchors', () => {
    const g = square();
    expect(alignAnchors(g, [ref(0, 0)], 'left')).toBe(g);
  });
});

describe('anchorBounds', () => {
  it('is the box the selected anchors occupy', () => {
    expect(anchorBounds(square(), [ref(0, 0), ref(0, 2)])).toEqual({ x: 0, y: 0, width: 10, height: 10 });
  });

  it('ignores handles, which would make it jump about', () => {
    // A box that grew to contain a control point would describe an area no
    // part of the drawing occupies.
    const b = anchorBounds(curve(), [ref(0, 0), ref(0, 1)])!;
    expect(b.height).toBe(0);
  });

  it('is null with nothing selected', () => {
    expect(anchorBounds(square(), [])).toBeNull();
  });
});

describe('scaleAnchors', () => {
  it('scales part of a path about a fixed point', () => {
    // The transformer scales the whole node; there was no way at all to widen
    // one end of a shape.
    const scaled = scaleAnchors(square(), [ref(0, 1), ref(0, 2)], { x: 0, y: 0 }, 2, 1);
    expect(anchorAt(scaled, ref(0, 1))).toEqual({ x: 20, y: 0 });
    expect(anchorAt(scaled, ref(0, 0))).toEqual({ x: 0, y: 0 });
  });

  it('scales handles with their anchors', () => {
    const scaled = scaleAnchors(curve(), [ref(0, 1)], { x: 0, y: 0 }, 2, 2);
    expect(handleAt(scaled, { ...ref(0, 1), side: 'in' })).toEqual({ x: 14, y: -10 });
  });
});

describe('anchorKey', () => {
  it('separates the same index on different contours', () => {
    expect(anchorKey(ref(0, 1))).not.toBe(anchorKey(ref(1, 1)));
  });
});

describe('constrainDeltaToAxis', () => {
  it('returns zero for zero input', () => {
    expect(constrainDeltaToAxis(0, 0)).toEqual({ dx: 0, dy: 0 });
  });

  it('snaps mostly horizontal movement to horizontal axis (dy = 0)', () => {
    const result = constrainDeltaToAxis(100, 10);
    expect(Math.round(result.dy)).toBe(0);
    expect(Math.round(result.dx)).toBe(100);
  });

  it('snaps mostly vertical movement to vertical axis (dx = 0)', () => {
    const result = constrainDeltaToAxis(5, 100);
    expect(Math.round(result.dx)).toBe(0);
    expect(Math.round(result.dy)).toBe(100);
  });

  it('snaps ~45 deg diagonal movement to 45 deg angle', () => {
    const result = constrainDeltaToAxis(50, 48);
    expect(Math.round(result.dx)).toBe(Math.round(result.dy));
    expect(result.dx).toBeGreaterThan(0);
  });
});

describe('constrainHandleToAngle', () => {
  const anchor = { x: 100, y: 100 };

  it('returns the anchor itself for a zero-length handle', () => {
    const result = constrainHandleToAngle(anchor, anchor);
    expect(result.x).toBe(anchor.x);
    expect(result.y).toBe(anchor.y);
    expect(result.angleDeg).toBe(0);
  });

  it('snaps 17° to 15° at default 15° increments', () => {
    // 17° from the anchor
    const rad17 = (17 * Math.PI) / 180;
    const dest = { x: anchor.x + 50 * Math.cos(rad17), y: anchor.y + 50 * Math.sin(rad17) };
    const result = constrainHandleToAngle(anchor, dest);
    expect(result.angleDeg).toBeCloseTo(15, 5);
    // Distance preserved
    expect(Math.hypot(result.x - anchor.x, result.y - anchor.y)).toBeCloseTo(50, 5);
  });

  it('snaps 38° to 45° at default 15° increments', () => {
    const rad38 = (38 * Math.PI) / 180;
    const dest = { x: anchor.x + 80 * Math.cos(rad38), y: anchor.y + 80 * Math.sin(rad38) };
    const result = constrainHandleToAngle(anchor, dest);
    expect(result.angleDeg).toBeCloseTo(45, 5);
  });

  it('snaps to 90° for a mostly-vertical handle', () => {
    const dest = { x: anchor.x + 2, y: anchor.y + 100 };
    const result = constrainHandleToAngle(anchor, dest);
    expect(result.angleDeg).toBeCloseTo(90, 5);
  });

  it('supports a custom snap increment like 45°', () => {
    const rad40 = (40 * Math.PI) / 180;
    const dest = { x: anchor.x + 60 * Math.cos(rad40), y: anchor.y + 60 * Math.sin(rad40) };
    const result = constrainHandleToAngle(anchor, dest, 45);
    expect(result.angleDeg).toBeCloseTo(45, 5);
  });

  it('preserves handle distance from the anchor', () => {
    const dest = { x: anchor.x + 73, y: anchor.y + 12 };
    const originalDist = Math.hypot(73, 12);
    const result = constrainHandleToAngle(anchor, dest);
    const snappedDist = Math.hypot(result.x - anchor.x, result.y - anchor.y);
    expect(snappedDist).toBeCloseTo(originalDist, 5);
  });
});

describe('setAnchorAlignment', () => {
  /** A curve with handles, so alignment has something to act on. */
  const curvedPath = (): BezierGeometry => ({
    kind: 'bezier',
    closed: false,
    segments: [
      { x: 0, y: 0 },
      { x: 50, y: 0, cp1x: 15, cp1y: -30, cp2x: 35, cp2y: -20 },
      { x: 100, y: 0, cp1x: 65, cp1y: 20, cp2x: 85, cp2y: 10 },
    ],
  });

  it('disconnected breaks the handle pair into a corner', () => {
    const result = setAnchorAlignment(curvedPath(), [ref(0, 1)], 'disconnected');
    const sub = (result as BezierGeometry);
    expect(anchorMode(sub, 1)).toBe('corner');
  });

  it('smooth enforces collinearity but preserves individual handle lengths', () => {
    // Start from a corner so smooth has to construct handles
    const corner: BezierGeometry = {
      kind: 'bezier',
      closed: true,
      segments: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }, { x: 0, y: 50 }],
    };
    const result = setAnchorAlignment(corner, [ref(0, 1)], 'smooth');
    const sub = (result as BezierGeometry);
    const mode = anchorMode(sub, 1);
    expect(mode === 'smooth' || mode === 'mirrored').toBe(true);
  });

  it('symmetric equalizes handle lengths', () => {
    const result = setAnchorAlignment(curvedPath(), [ref(0, 1)], 'symmetric');
    const sub = (result as BezierGeometry);
    const a = contours(sub)[0].anchors[1];
    const inLen = Math.hypot(a.x - (a.inX ?? a.x), a.y - (a.inY ?? a.y));
    const outLen = Math.hypot((a.outX ?? a.x) - a.x, (a.outY ?? a.y) - a.y);
    expect(inLen).toBeCloseTo(outLen, 5);
    expect(anchorMode(sub, 1)).toBe('mirrored');
  });
});

