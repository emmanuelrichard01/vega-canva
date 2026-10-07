import { cubicAt, moveHandle, toCubics } from './pathGeometry';
import type { BezierGeometry, Point } from './schema';

/**
 * Bend a curve by dragging a point on it.
 *
 * The grabbed point follows the pointer exactly. The two control points of
 * that one curve move to make it so, each weighted by how near the grab is to
 * its end, so grabbing near an anchor mostly swings that anchor's handle. At
 * the middle of the curve both move by 4/3 of the drag, the classic result.
 *
 * Smooth anchors stay smooth: the handles move through `moveHandle`, which
 * rotates the opposite handle to keep the tangent continuous, as dragging a
 * handle by hand would.
 *
 * Always computed from the geometry at the start of the drag, so a long drag
 * does not accumulate error, and returning the pointer to where it started
 * gives back the original curve.
 */
export function bendSegment(start: BezierGeometry, curve: number, t: number, target: Point): BezierGeometry {
  const cubics = toCubics(start);
  const c = cubics[curve];
  if (!c) return start;
  const n = start.segments.length;
  const from = curve;
  const to = (curve + 1) % n;

  // Too near an end, the curve barely responds to its controls there and the
  // weights blow up. Grabbing at an anchor is an anchor drag, not a bend.
  const u = Math.min(0.9, Math.max(0.1, t));
  const at = cubicAt(c, u);
  const dx = target.x - at.x;
  const dy = target.y - at.y;

  const b1 = 3 * (1 - u) * (1 - u) * u;
  const b2 = 3 * (1 - u) * u * u;
  const s = 1 / (b1 * (1 - u) + b2 * u);
  const w1 = s * (1 - u);
  const w2 = s * u;

  const c1 = { x: c.c1x + dx * w1, y: c.c1y + dy * w1 };
  const c2 = { x: c.c2x + dx * w2, y: c.c2y + dy * w2 };

  const withOut = moveHandle(start, from, 'out', c1);
  return moveHandle(withOut, to, 'in', c2);
}
