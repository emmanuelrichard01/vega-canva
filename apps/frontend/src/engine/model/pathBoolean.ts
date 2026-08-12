/**
 * Union, subtract, intersect, exclude.
 *
 * ## What this does and does not preserve
 *
 * The operands are flattened to polygons first, clipped, and returned as
 * polygons. Curves do not survive: uniting two circles gives a contour of a
 * few hundred straight segments that is indistinguishable from the curved
 * answer on screen and obviously not curved the moment you open it in the path
 * editor.
 *
 * That is a real limitation and it is the deliberate choice. A boolean that
 * keeps its curves has to intersect cubics with cubics, which means a root
 * finder, an offset-curve fitter and a tolerance story for every one of them —
 * a library-sized problem, and the libraries that solve it want a canvas and a
 * global scope. The flattening tolerance here is a quarter of a unit, so the
 * error is a quarter of a pixel at 100%; what is lost is editability, not
 * fidelity.
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

export type BooleanOp = 'union' | 'subtract' | 'intersect' | 'exclude';

export const BOOLEAN_OPS: readonly BooleanOp[] = ['union', 'subtract', 'intersect', 'exclude'];

/** A shape to be clipped: one or more closed contours, filled as one. */
export type BooleanOperand = BezierGeometry | CompoundGeometry;

/** `polygon-clipping`'s idea of a polygon: rings of `[x, y]` pairs. */
type Ring = [number, number][];

function toRings(operand: BooleanOperand): Ring[] {
  const subpaths = operand.kind === 'compound' ? operand.subpaths : [operand];
  const rings: Ring[] = [];
  for (const sub of subpaths) {
    // An open path encloses nothing, so there is nothing to clip against. It is
    // closed here rather than rejected: a person who draws three sides of a
    // triangle and asks for a union means the triangle, and the alternative is
    // an operation that silently does nothing.
    const points = flattenPath(sub);
    if (points.length < 3) continue;
    const ring: Ring = points.map((p) => [p.x, p.y]);
    // The clipper wants the first position repeated at the end.
    ring.push([points[0].x, points[0].y]);
    rings.push(ring);
  }
  return rings;
}

function fromMultiPolygon(result: clipping.MultiPolygon): CompoundGeometry {
  const subpaths: BezierGeometry[] = [];
  for (const polygon of result) {
    for (const ring of polygon) {
      // The clipper repeats the first position at the end of every ring; a
      // path that declares itself closed would draw that repeat as a
      // zero-length segment, which is a degenerate join at one arbitrary
      // corner of the result.
      const points: Point[] = ring.slice(0, -1).map(([x, y]) => ({ x, y }));
      if (points.length < 3) continue;
      subpaths.push({
        kind: 'bezier',
        segments: points.map((p) => ({ x: p.x, y: p.y })),
        closed: true,
      });
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
export function booleanPaths(op: BooleanOp, operands: readonly BooleanOperand[]): CompoundGeometry | null {
  if (operands.length < 2) return null;

  const polygons = operands.map(toRings).filter((rings) => rings.length > 0);
  if (polygons.length < 2) return null;

  const [first, ...rest] = polygons;
  let result: clipping.MultiPolygon;
  try {
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

  const geometry = fromMultiPolygon(result);
  return geometry.subpaths.length > 0 ? geometry : null;
}
