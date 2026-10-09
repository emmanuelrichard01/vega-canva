/**
 * Union, subtract, intersect, exclude.
 *
 * ## What this does and does not preserve
 *
 * The operands are flattened to polygons, clipped, and the result is fitted
 * back to cubics (`curveFit`): corners where outlines cross stay corners,
 * arcs come back as a few smooth anchors, and straight runs come back as
 * lines. Intersecting cubics with cubics exactly is a library-sized problem;
 * clip-then-refit gets within a third of a pixel at 100% and gives the editor
 * the same handful of anchors Illustrator would.
 *
 * ## Why the operands must be in world coordinates
 *
 * Every path stores its geometry relative to its own node origin, so two paths
 * that overlap on screen have no relationship at all in their local
 * coordinates. Callers translate into world space before asking, and the
 * result comes back in world space for the caller to re-origin — which is
 * `reframePath`'s job.
 */

import * as clipping from 'polygon-clipping';
import type { BezierGeometry, CompoundGeometry, Point } from './schema';
import { flattenPath } from './pathGeometry';
import { FIT_TOLERANCE, fitClosedRing, isSliver, ringArea } from './curveFit';

export type BooleanOp = 'union' | 'subtract' | 'intersect' | 'exclude';

export const BOOLEAN_OPS: readonly BooleanOp[] = ['union', 'subtract', 'intersect', 'exclude'];

/** A shape to be clipped: one or more closed contours, filled as one. */
export type BooleanOperand = BezierGeometry | CompoundGeometry;

/** `polygon-clipping`'s idea of a polygon: rings of `[x, y]` pairs. */
type Ring = [number, number][];

function ringsOf(operand: BooleanOperand): { ring: Ring; area: number }[] {
  const subpaths = operand.kind === 'compound' ? operand.subpaths : [operand];
  const rings: { ring: Ring; area: number }[] = [];
  for (const sub of subpaths) {
    // An open path encloses nothing, so there is nothing to clip against. It is
    // closed here rather than rejected: a person who draws three sides of a
    // triangle and asks for a union means the triangle, and the alternative is
    // an operation that silently does nothing.
    const points = flattenPath(sub);
    if (points.length < 3) continue;
    const area = ringArea(points);
    if (Math.abs(area) < 1e-6) continue;
    const ring: Ring = points.map((p) => [p.x, p.y]);
    // The clipper wants the first position repeated at the end.
    ring.push([points[0].x, points[0].y]);
    rings.push({ ring, area });
  }
  return rings;
}

/**
 * The region an operand fills, as the clipper's multipolygon.
 *
 * The clipper reads a polygon as *one outer ring followed by its holes*, and a
 * compound path is not that: "HI" outlined is two unrelated outer rings, and
 * handing them over as one polygon made the second letter a "hole" outside
 * the first, which the clipper then dropped. So each contour goes in as its
 * own polygon and the fill rule is applied explicitly:
 *
 * - **even-odd**: a point is filled when it is inside an odd number of
 *   contours, which is exactly the xor of all of them;
 * - **nonzero** (outlined text): contours wound one way add, the other way
 *   subtract. Fonts wind outers and counters oppositely, so the union of the
 *   one minus the union of the other is the letterform.
 */
function regionOf(operand: BooleanOperand): clipping.MultiPolygon | null {
  const rings = ringsOf(operand);
  if (rings.length === 0) return null;
  if (rings.length === 1) return [[rings[0].ring]];
  const polys = rings.map((r) => [r.ring] as clipping.Polygon);
  const nonzero = operand.kind === 'compound' && operand.fillRule === 'nonzero';
  if (!nonzero) return clipping.xor(polys[0], ...polys.slice(1));

  // The outer direction is whichever the largest contour takes.
  const largest = rings.reduce((a, b) => (Math.abs(b.area) > Math.abs(a.area) ? b : a));
  const sign = Math.sign(largest.area);
  const add = polys.filter((_, i) => Math.sign(rings[i].area) === sign);
  const cut = polys.filter((_, i) => Math.sign(rings[i].area) !== sign);
  const filled = add.length > 1 ? clipping.union(add[0], ...add.slice(1)) : [add[0]];
  return cut.length > 0 ? clipping.difference(filled, ...cut) : filled;
}

function fromMultiPolygon(result: clipping.MultiPolygon, tolerance: number): CompoundGeometry {
  const subpaths: BezierGeometry[] = [];
  for (const polygon of result) {
    for (const ring of polygon) {
      // The clipper repeats the first position at the end of every ring.
      const points: Point[] = ring.slice(0, -1).map(([x, y]) => ({ x, y }));
      if (points.length < 3) continue;
      // Hairlines where two edges nearly coincide: real output of a clipper,
      // never what anybody meant, and invisible until they are selected.
      if (isSliver(points)) continue;
      // Curves back: a union of two circles is a handful of smooth anchors
      // again, not a few hundred straight segments.
      const fitted = fitClosedRing(points, tolerance);
      if (fitted) subpaths.push(fitted);
    }
  }
  return { kind: 'compound', subpaths };
}

/**
 * Apply an operation to two or more shapes, in world coordinates.
 *
 * Order matters for `subtract` only, where everything after the first is
 * removed from it — which is why the caller passes them in z-order rather than
 * in selection order. Selection order is whatever sequence the clicks
 * happened in, and "subtract" would then mean something different depending on
 * which of two objects you happened to click first.
 *
 * Returns `null` when the result is empty: intersecting two shapes that do not
 * overlap is a legitimate question with the answer "nothing", and producing an
 * empty node instead of declining would delete both operands in exchange for
 * something invisible and unselectable.
 */
export function booleanPaths(
  op: BooleanOp,
  operands: readonly BooleanOperand[],
  tolerance = FIT_TOLERANCE
): CompoundGeometry | null {
  if (operands.length < 2) return null;

  let result: clipping.MultiPolygon;
  try {
    const regions = operands.map(regionOf).filter((r): r is clipping.MultiPolygon => r !== null && r.length > 0);
    if (regions.length < 2) return null;
    const [first, ...rest] = regions;
    switch (op) {
      case 'union':
        result = clipping.union(first, ...rest);
        break;
      case 'subtract':
        result = clipping.difference(first, ...rest);
        break;
      case 'intersect':
        result = clipping.intersection(first, ...rest);
        break;
      case 'exclude':
        result = clipping.xor(first, ...rest);
        break;
    }
  } catch {
    // The clipper throws on geometry it cannot resolve — a self-intersection
    // landing exactly on a vertex, most often. There is nothing useful to do
    // about it and nothing worse than a half-applied boolean, so the operation
    // declines and the operands stay as they were.
    return null;
  }

  const geometry = fromMultiPolygon(result, tolerance);
  return geometry.subpaths.length > 0 ? geometry : null;
}
