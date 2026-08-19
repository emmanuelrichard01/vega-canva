import type { Point } from './schema';

/**
 * Thin a freehand stroke down to the points that carry its shape.
 *
 * ## Why this is worth doing
 *
 * A pencil stroke is sampled at whatever rate the pointer reports — on a
 * 120Hz tablet, a two-second line is a couple of hundred points, and a long
 * sweep across a board can be five hundred. Every one of those is stored in
 * the CRDT, replicated to every client, written into every snapshot and
 * serialized into every export, and the great majority of them sit on a
 * straight run where the one before and the one after already say everything.
 *
 * Douglas–Peucker keeps the points that carry the *shape*: it finds the sample
 * furthest from the straight line between the two ends, and if that distance
 * is under the tolerance it throws away everything between them. A corner
 * survives because it is far from that line; a hundred samples down a straight
 * edge do not, because they are not.
 *
 * ## Why it runs on the centreline and not the outline
 *
 * The stored `svgPath` is what `perfect-freehand` produced, and it is the
 * *outline* of the stroke — its shape is the pen's, not the hand's, and
 * thinning it would visibly flatten the nib. The centreline is the record of
 * where the hand went, which is what the eraser splits on and what a future
 * re-render would want. Simplifying that changes nothing on screen and is
 * where nearly all the points are.
 *
 * ## A note on history
 *
 * A `pathSimplifier` module carrying this algorithm existed in this codebase
 * for its whole life with **no importers at all**, while the README and the
 * spec both claimed the pencil ran through it. It was deleted rather than
 * wired in, because wiring a module to make a stale comment true is the wrong
 * order of operations. This is the same algorithm, added deliberately, at the
 * one point where it earns its place: the commit.
 */

/** Perpendicular distance from `p` to the segment `a`–`b`. */
function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  // A degenerate segment is a point, and the distance to it is the distance to
  // that point — dividing by its length would be dividing by zero.
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);

  // How far along the segment the nearest point lies, clamped to its ends so
  // a sample beyond either end measures to the end rather than to the
  // infinite line, which would under-report and drop a real corner.
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Douglas–Peucker, iteratively.
 *
 * Written with an explicit stack rather than recursion: a stroke is
 * user-supplied and unbounded, and a recursive implementation on a
 * pathological one — a long stroke where every point is a corner — recurses
 * once per point and overflows. This cannot.
 */
export function simplifyPoints(points: readonly Point[], tolerance = 1.2): Point[] {
  if (points.length <= 2 || tolerance <= 0) return [...points];

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    if (last - first < 2) continue;

    let furthest = -1;
    let maxDistance = tolerance;
    for (let i = first + 1; i < last; i++) {
      const d = distanceToSegment(points[i], points[first], points[last]);
      if (d > maxDistance) {
        maxDistance = d;
        furthest = i;
      }
    }

    // Nothing between these two ends strays far enough to be worth keeping.
    if (furthest === -1) continue;
    keep[furthest] = 1;
    stack.push([first, furthest], [furthest, last]);
  }

  const out: Point[] = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
  return out;
}
