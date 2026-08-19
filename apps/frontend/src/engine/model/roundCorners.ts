/**
 * Rounding the corners of any outline, not just a rectangle's.
 *
 * ## Why this is not Konva's `cornerRadius`
 *
 * That is a property of `Rect`, and a rectangle is the one shape that already
 * had rounded corners for free. Every other shape with a corner — a triangle,
 * a hexagon, a star's ten points, the sharp tip at the bottom of a heart — had
 * no way to soften one at all, and the control the properties panel offers was
 * hidden for all of them because it would have done nothing.
 *
 * ## What a corner is here
 *
 * A junction between two curve segments where the direction changes sharply.
 * Not every junction: a flattened circle is a hundred junctions and none of
 * them is a corner, so the turn has to exceed a threshold before it counts.
 * That single test is what lets one function serve a polygon, a star and a
 * heart — a heart has exactly one corner, at its tip, and its lobes are left
 * untouched because they never turn sharply enough to qualify.
 *
 * ## How one is rounded
 *
 * Trim `radius` of arc length off the end of the incoming segment and the
 * start of the outgoing one, then join the two new endpoints with a curve
 * whose handles run along the original tangents. That is what makes the fillet
 * meet the shape smoothly instead of showing two kinks where a naive arc would
 * be pasted in.
 *
 * Trimming by *arc length* rather than by parameter matters: a cubic's
 * parameter is not proportional to distance along it, so trimming at `t = 0.2`
 * takes a different amount off a curve than off a straight line, and a
 * hexagon's corners would come out unequal.
 *
 * Everything here is pure — cubics in, cubics out — because a rounding bug
 * looks like a slightly different shape, which is exactly the kind nobody
 * spots by looking.
 */

import { cubicAt, splitCubic, toCubics, type Cubic } from './pathGeometry';
import type { BezierGeometry, BezierSegment, Point } from './schema';

/**
 * How sharp a turn has to be before it counts as a corner, in radians.
 *
 * About seventeen degrees. Below it the junction is part of a curve — the
 * lobes of a heart, the facets of a flattened ellipse — and rounding those
 * would eat the shape rather than soften it.
 */
export const CORNER_THRESHOLD = 0.3;

/**
 * The sharpest turn still worth rounding, in radians — about 168 degrees.
 *
 * Past this the two edges have almost doubled back on each other: a needle, a
 * hairline spike, the seam where a shape closes on itself. A fillet there does
 * not soften a corner, it replaces a point with a blob and erases the feature
 * that made the shape recognisable. Illustrator and Photoshop both decline
 * these, and this is what "decline" means numerically.
 *
 * A five-pointed star's tip turns about 144 degrees and is comfortably inside,
 * which is the case that fixes the threshold: star points must round.
 */
export const MAX_TURN = 2.94;

/** How much of a segment may be given to a corner. Both ends can take this. */
const MAX_SHARE = 0.45;

/**
 * Whether a junction is worth rounding at all.
 *
 * Shared with the handle that draws the knob, so a knob never appears on a
 * corner the rounder will decline — an affordance for something that does
 * nothing is worse than no affordance.
 */
export function isRoundableTurn(angle: number): boolean {
  return angle >= CORNER_THRESHOLD && angle <= MAX_TURN;
}

const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const len = (p: Point): number => Math.hypot(p.x, p.y);

/** The direction a cubic leaves its start, and arrives at its end. */
function tangents(c: Cubic): { out: Point; in: Point } {
  const start = { x: c.x0, y: c.y0 };
  const end = { x: c.x1, y: c.y1 };
  const h1 = { x: c.c1x, y: c.c1y };
  const h2 = { x: c.c2x, y: c.c2y };
  // Falls back to the chord when a handle sits on its own anchor, which is
  // what a straight segment looks like once it is expressed as a cubic.
  const out = len(sub(h1, start)) > 1e-9 ? sub(h1, start) : sub(end, start);
  const into = len(sub(end, h2)) > 1e-9 ? sub(end, h2) : sub(end, start);
  return { out, in: into };
}

/** Approximate arc length of a cubic, by sampling. */
function arcLength(c: Cubic, steps = 16): number {
  let total = 0;
  let previous: Point = { x: c.x0, y: c.y0 };
  for (let i = 1; i <= steps; i += 1) {
    const p = cubicAt(c, i / steps);
    total += len(sub(p, previous));
    previous = p;
  }
  return total;
}

/**
 * The parameter at which a cubic has covered `distance` from its start.
 *
 * Walked rather than solved: the closed form does not exist for a cubic's arc
 * length, and sixteen samples is well inside the tolerance the flattener
 * already accepts everywhere else.
 */
function paramAtLength(c: Cubic, distance: number, steps = 16): number {
  let travelled = 0;
  let previous: Point = { x: c.x0, y: c.y0 };
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const p = cubicAt(c, t);
    const d = len(sub(p, previous));
    if (travelled + d >= distance) {
      const within = d === 0 ? 0 : (distance - travelled) / d;
      return (i - 1 + within) / steps;
    }
    travelled += d;
    previous = p;
  }
  return 1;
}

/** The angle between arriving along `a` and leaving along `b`. */
export function turnBetween(a: Point, b: Point): number {
  const la = len(a);
  const lb = len(b);
  if (la < 1e-9 || lb < 1e-9) return 0;
  const cos = Math.min(1, Math.max(-1, (a.x * b.x + a.y * b.y) / (la * lb)));
  return Math.acos(cos);
}

/**
 * Round every corner of a closed path.
 *
 * A radius of zero, or a path with nothing sharp in it, returns the geometry
 * untouched — including the same object, so a caller can compare by identity
 * to know whether anything happened.
 */
export function roundPathCorners(geo: BezierGeometry, radius: number): BezierGeometry {
  if (!(radius > 0) || !geo.closed) return geo;
  const cubics = toCubics(geo);
  if (cubics.length < 2) return geo;

  const lengths = cubics.map((c) => arcLength(c));

  /**
   * How much each junction takes off the segments either side of it.
   *
   * Resolved for every corner *before* any trimming, because a segment with a
   * corner at both ends has to share: a small triangle's radius is limited by
   * its own edges, and taking the full radius at each end independently would
   * make the two trims overlap and turn the edge inside out.
   */
  const take = cubics.map(() => ({ start: 0, end: 0 }));
  for (let i = 0; i < cubics.length; i += 1) {
    const previous = (i - 1 + cubics.length) % cubics.length;
    const arriving = tangents(cubics[previous]).in;
    const leaving = tangents(cubics[i]).out;
    if (!isRoundableTurn(turnBetween(arriving, leaving))) continue;
    const room = Math.min(lengths[previous], lengths[i]) * MAX_SHARE;
    const r = Math.min(radius, room);
    if (r <= 0) continue;
    take[previous].end = r;
    take[i].start = r;
  }

  if (take.every((t) => t.start === 0 && t.end === 0)) return geo;

  // Trim each segment by whatever its two ends were allotted, and remember the
  // tangent at each cut so the fillet can leave and arrive along it.
  const trimmed: Array<{ cubic: Cubic; cutStart: boolean; cutEnd: boolean } | null> = cubics.map(
    (c, i) => {
      const { start, end } = take[i];
      let piece = c;
      if (start > 0) {
        const t = paramAtLength(piece, start);
        piece = splitCubic(piece, t)[1];
      }
      if (end > 0) {
        const remaining = arcLength(piece);
        if (remaining <= end) return null;
        const t = paramAtLength(piece, remaining - end);
        piece = splitCubic(piece, t)[0];
      }
      return { cubic: piece, cutStart: start > 0, cutEnd: end > 0 };
    }
  );

  const out: Cubic[] = [];
  for (let i = 0; i < trimmed.length; i += 1) {
    const here = trimmed[i];
    if (!here) continue;
    out.push(here.cubic);

    // Find the next surviving segment; a fillet joins across any that the trim
    // consumed entirely, which is what a radius larger than a whole edge means.
    let j = (i + 1) % trimmed.length;
    let guard = 0;
    while (!trimmed[j] && guard < trimmed.length) {
      j = (j + 1) % trimmed.length;
      guard += 1;
    }
    const next = trimmed[j];
    if (!next || !here.cutEnd) continue;

    const a: Point = { x: here.cubic.x1, y: here.cubic.y1 };
    const b: Point = { x: next.cubic.x0, y: next.cubic.y0 };
    const outward = tangents(here.cubic).in;
    const inward = tangents(next.cubic).out;
    // A third of the gap is the standard handle length for a two-point fillet:
    // long enough to round, short enough not to bulge past the corner it
    // replaces.
    const reach = len(sub(b, a)) / 3;
    const unit = (p: Point): Point => {
      const l = len(p) || 1;
      return { x: p.x / l, y: p.y / l };
    };
    const ua = unit(outward);
    const ub = unit(inward);
    out.push({
      x0: a.x, y0: a.y,
      c1x: a.x + ua.x * reach, c1y: a.y + ua.y * reach,
      c2x: b.x - ub.x * reach, c2y: b.y - ub.y * reach,
      x1: b.x, y1: b.y,
    });
  }

  if (out.length === 0) return geo;

  /**
   * Back into segment form.
   *
   * A `BezierSegment` is an *anchor* carrying the handles of the curve that
   * arrives at it, so a run of cubics becomes: the first cubic's start as a
   * bare anchor, then one segment per cubic holding that cubic's two controls
   * and its endpoint. The closing curve's endpoint is the first anchor and is
   * therefore dropped — `toCubics` reconstructs it from `closed`.
   */
  const segments: BezierSegment[] = [{ x: out[0].x0, y: out[0].y0 }];
  out.forEach((c, i) => {
    const last = i === out.length - 1;
    const anchor = { x: c.x1, y: c.y1, cp1x: c.c1x, cp1y: c.c1y, cp2x: c.c2x, cp2y: c.c2y };
    if (last) {
      // The wrap-around curve's handles belong to the first anchor.
      segments[0].cp1x = c.c1x;
      segments[0].cp1y = c.c1y;
      segments[0].cp2x = c.c2x;
      segments[0].cp2y = c.c2y;
      return;
    }
    segments.push(anchor);
  });

  return { kind: 'bezier', closed: true, segments };
}
