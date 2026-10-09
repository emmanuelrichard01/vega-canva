/**
 * Moving, scaling and turning a *set of anchors*, rather than a whole object.
 *
 * Direct selection draws a box around the picked points, the way Figma and
 * Illustrator do, and that box can be dragged, scaled from any edge or corner,
 * and rotated from just outside a corner. All three are one affine map applied
 * to each picked anchor *and its handles*, so curves keep their shape relative
 * to the points they hang from rather than being left behind.
 *
 * Pure arithmetic: the editor turns pointer travel into a matrix with the
 * helpers below and hands the matrix to `transformAnchors`.
 */

import type { Point } from './schema';
import { anchorKey, type AnchorRef } from './pathEditing';
import { fromAnchors, subpathsOf, toAnchors, type Anchor, type ContourGeometry } from './pathGeometry';

/** `x' = a·x + c·y + e`, `y' = b·x + d·y + f`, the canvas' own convention. */
export type Affine = readonly [number, number, number, number, number, number];

export const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

export function apply(m: Affine, p: Point): Point {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

export const translation = (dx: number, dy: number): Affine => [1, 0, 0, 1, dx, dy];

/** Scale about a fixed point, which stays where it is. */
export function scalingAbout(origin: Point, sx: number, sy: number): Affine {
  return [sx, 0, 0, sy, origin.x - origin.x * sx, origin.y - origin.y * sy];
}

/** Turn about a pivot by `radians`, clockwise on screen (y grows downward). */
export function rotationAbout(pivot: Point, radians: number): Affine {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [cos, sin, -sin, cos, pivot.x - pivot.x * cos + pivot.y * sin, pivot.y - pivot.x * sin - pivot.y * cos];
}

/**
 * Apply one map to every named anchor and its two handles.
 *
 * Contours with nothing picked are passed through untouched (same objects), so
 * a transform of three points on one glyph does not rebuild the other hundred.
 */
export function transformAnchors(geo: ContourGeometry, refs: readonly AnchorRef[], m: Affine): ContourGeometry {
  if (refs.length === 0) return geo;
  const bySub = new Map<number, Set<number>>();
  for (const r of refs) {
    let set = bySub.get(r.sub);
    if (!set) bySub.set(r.sub, (set = new Set()));
    set.add(r.index);
  }
  const subs = subpathsOf(geo);
  const next = subs.map((sub, s) => {
    const chosen = bySub.get(s);
    if (!chosen) return sub;
    const anchors = toAnchors(sub).map((a, i) => (chosen.has(i) ? mapAnchor(a, m) : a));
    return fromAnchors(anchors, sub.closed);
  });
  if (geo.kind === 'compound') return { ...geo, subpaths: next };
  return next[0] ?? geo;
}

function mapAnchor(a: Anchor, m: Affine): Anchor {
  const p = apply(m, a);
  const out: Anchor = { x: p.x, y: p.y };
  if (a.inX !== undefined && a.inY !== undefined) {
    const h = apply(m, { x: a.inX, y: a.inY });
    out.inX = h.x;
    out.inY = h.y;
  }
  if (a.outX !== undefined && a.outY !== undefined) {
    const h = apply(m, { x: a.outX, y: a.outY });
    out.outX = h.x;
    out.outY = h.y;
  }
  return out;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A handle on the point-selection box: a corner, an edge midpoint, or the rotation zone past a corner. */
export type BoxHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export const BOX_HANDLES: readonly BoxHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** Where a handle sits on the box, as fractions of its width and height. */
export function handleFraction(h: BoxHandle): { fx: number; fy: number } {
  const fx = h.includes('w') ? 0 : h.includes('e') ? 1 : 0.5;
  const fy = h.includes('n') ? 0 : h.includes('s') ? 1 : 0.5;
  return { fx, fy };
}

export function handlePoint(box: Box, h: BoxHandle): Point {
  const { fx, fy } = handleFraction(h);
  return { x: box.x + box.width * fx, y: box.y + box.height * fy };
}

/** The handle diagonally (or directly) opposite: what a scale holds still. */
export function oppositeHandle(h: BoxHandle): BoxHandle {
  const flip: Record<string, string> = { n: 's', s: 'n', e: 'w', w: 'e' };
  return h.split('').map((c) => flip[c]).join('') as BoxHandle;
}

/**
 * The scale a handle drag means.
 *
 * `from` and `to` are the pointer at the press and now. The fixed point is the
 * opposite handle, or the box centre with `fromCentre` (Alt). An edge handle
 * scales one axis; `uniform` (Shift) makes a corner keep the box's proportions.
 * A box with no extent along an axis cannot be scaled along it, and is not.
 */
export function scaleFromHandle(
  box: Box,
  handle: BoxHandle,
  from: Point,
  to: Point,
  opts: { uniform?: boolean; fromCentre?: boolean } = {}
): { origin: Point; sx: number; sy: number; matrix: Affine } {
  const { fx, fy } = handleFraction(handle);
  const origin = opts.fromCentre
    ? { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    : handlePoint(box, oppositeHandle(handle));
  const grip = handlePoint(box, handle);
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  const axis = (gripV: number, originV: number, d: number) => {
    const span = gripV - originV;
    if (Math.abs(span) < 1e-9) return 1;
    return (span + d) / span;
  };
  let sx = fx === 0.5 ? 1 : axis(grip.x, origin.x, dx);
  let sy = fy === 0.5 ? 1 : axis(grip.y, origin.y, dy);

  if (opts.uniform) {
    if (fx === 0.5) sx = Math.abs(sy) * Math.sign(sx || 1);
    else if (fy === 0.5) sy = Math.abs(sx) * Math.sign(sy || 1);
    else {
      const s = Math.abs(sx) > Math.abs(sy) ? sx : sy;
      sx = Math.abs(s) * Math.sign(sx || 1);
      sy = Math.abs(s) * Math.sign(sy || 1);
    }
  }
  return { origin, sx, sy, matrix: scalingAbout(origin, sx, sy) };
}

/**
 * The rotation a drag about `pivot` means, in radians, optionally snapped to
 * `snapDeg` steps (Shift gives 15°).
 */
export function rotationFromDrag(pivot: Point, from: Point, to: Point, snapDeg = 0): number {
  const a0 = Math.atan2(from.y - pivot.y, from.x - pivot.x);
  const a1 = Math.atan2(to.y - pivot.y, to.x - pivot.x);
  let delta = a1 - a0;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  if (snapDeg > 0) {
    const step = (snapDeg * Math.PI) / 180;
    delta = Math.round(delta / step) * step;
  }
  return delta;
}

/**
 * Which part of the point-selection box is under `p`, if any.
 *
 * Sizes are in geometry units: the caller divides its screen tolerances by the
 * zoom. A press just outside a corner, within `rotateReach`, is a rotation, as
 * in Figma; on a handle it is a scale.
 */
export function boxHandleAt(
  box: Box,
  p: Point,
  grip: number,
  rotateReach: number
): { kind: 'scale'; handle: BoxHandle } | { kind: 'rotate'; handle: BoxHandle } | null {
  // A box collapsed along an axis has only its scalable handles: a row of
  // points has no top and bottom to pull apart.
  const flatX = box.width < 1e-9;
  const flatY = box.height < 1e-9;
  for (const h of BOX_HANDLES) {
    const { fx, fy } = handleFraction(h);
    if ((flatX && fx !== 0.5) || (flatY && fy !== 0.5)) continue;
    if (flatX && flatY) continue;
    const at = handlePoint(box, h);
    if (Math.abs(p.x - at.x) <= grip && Math.abs(p.y - at.y) <= grip) return { kind: 'scale', handle: h };
  }
  if (flatX || flatY) return null;
  for (const h of ['nw', 'ne', 'se', 'sw'] as const) {
    const at = handlePoint(box, h);
    const { fx, fy } = handleFraction(h);
    const ox = fx === 0 ? -1 : 1;
    const oy = fy === 0 ? -1 : 1;
    const dx = (p.x - at.x) * ox;
    const dy = (p.y - at.y) * oy;
    // Outside the corner on at least one axis, and within reach of it.
    if ((dx > 0 || dy > 0) && dx > -grip && dy > -grip && Math.hypot(Math.max(0, dx), Math.max(0, dy)) <= rotateReach) {
      return { kind: 'rotate', handle: h };
    }
  }
  return null;
}

/** Whether `p` is inside the box (inclusive), padded by `pad`. */
export function insideBox(box: Box, p: Point, pad = 0): boolean {
  return p.x >= box.x - pad && p.x <= box.x + box.width + pad && p.y >= box.y - pad && p.y <= box.y + box.height + pad;
}

/** Keys of a ref list, for set membership. */
export const refKeys = (refs: readonly AnchorRef[]): Set<string> => new Set(refs.map(anchorKey));
