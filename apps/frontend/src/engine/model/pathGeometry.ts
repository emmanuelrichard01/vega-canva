/**
 * Bezier paths, as arithmetic.
 *
 * The stored form (`BezierGeometry.segments`) is the one an SVG `d` string
 * wants: each entry is *the curve arriving at this anchor*, carrying the two
 * control points of that curve. It renders in one pass with no bookkeeping,
 * which is why it was chosen and why it stays.
 *
 * It is the wrong shape for an editor. Dragging the handle that leaves anchor
 * 3 has to write `segments[4].cp1`, and dragging the one that arrives at it
 * writes `segments[3].cp2` — two different indices for the two ends of what a
 * person sees as one anchor's pair of handles. So this module also offers an
 * **anchor-centric** view, `toAnchors`/`fromAnchors`, and everything the editor
 * touches works in that.
 *
 * ## The closing curve
 *
 * A closed path has one more curve than an open one: the run from the last
 * anchor back to the first. There was nowhere to put its handles, so it was
 * always a straight line — you could close a path but not round the join.
 *
 * `segments[0].cp1`/`cp2` are that curve's controls. Segment 0 has no arriving
 * curve on an open path, so those two fields were declared, ignored by every
 * reader, and always undefined; on a closed path the curve arriving at anchor 0
 * is exactly the closing one. The rule "segment *i* describes the curve
 * arriving at anchor *i*" therefore holds for every index without an exception,
 * and no field changed meaning.
 */

import type {
  BezierGeometry,
  BezierSegment,
  CompoundGeometry,
  PathGeometry,
  Point,
} from './schema';

/** Anything made of closed contours: one run of anchors, or several. */
export type ContourGeometry = BezierGeometry | CompoundGeometry;

/** The contours of either form, so callers stop writing the same ternary. */
export function subpathsOf(geo: ContourGeometry): readonly BezierGeometry[] {
  return geo.kind === 'compound' ? geo.subpaths : [geo];
}

/**
 * One cubic, with both endpoints and both controls spelled out.
 *
 * Every routine below — flattening, splitting, bounds, hit-testing — wants the
 * curve as four points rather than as "this segment plus the one before it".
 * Deriving that once here is what keeps the `?? previous anchor` fallback for
 * a handleless anchor from being repeated in five places, each free to get it
 * subtly wrong.
 */
export interface Cubic {
  x0: number;
  y0: number;
  c1x: number;
  c1y: number;
  c2x: number;
  c2y: number;
  x1: number;
  y1: number;
}

/** An anchor and its two handles, in absolute node-local coordinates. */
export interface Anchor {
  x: number;
  y: number;
  /** Control point of the curve *arriving* here. Absent means a straight run in. */
  inX?: number;
  inY?: number;
  /** Control point of the curve *leaving* here. Absent means a straight run out. */
  outX?: number;
  outY?: number;
}

/**
 * How a pair of handles behave when one of them is dragged.
 *
 * Derived from the handles themselves rather than stored: two handles that are
 * collinear with their anchor *are* smooth, and a field claiming otherwise
 * would be a second source of truth that a path arriving from an import, an
 * undo or another client could contradict.
 */
export type HandleMode = 'corner' | 'smooth' | 'mirrored';

/** Below this, two positions are the same point. Well under a device pixel at any usable zoom. */
const EPS = 1e-6;

// ---------------------------------------------------------------------------
// Conversions
// ---------------------------------------------------------------------------

/** The curves of a path, in drawing order. Empty for a path with fewer than two anchors. */
export function toCubics(geo: ContourGeometry): Cubic[] {
  return subpathsOf(geo).flatMap((sub) => {
    const segs = sub.segments;
    if (segs.length < 2) return [];

    const cubics: Cubic[] = [];
    const curve = (from: BezierSegment, to: BezierSegment): Cubic => ({
      x0: from.x,
      y0: from.y,
      // An anchor placed without dragging has no handles. Collapsing the control
      // onto its own endpoint degenerates the cubic into the straight line
      // between them, which is exactly what such an anchor should draw.
      c1x: to.cp1x ?? from.x,
      c1y: to.cp1y ?? from.y,
      c2x: to.cp2x ?? to.x,
      c2y: to.cp2y ?? to.y,
      x1: to.x,
      y1: to.y,
    });

    for (let i = 1; i < segs.length; i++) cubics.push(curve(segs[i - 1], segs[i]));
    if (sub.closed) cubics.push(curve(segs[segs.length - 1], segs[0]));
    return cubics;
  });
}

/** The anchor-centric view: every anchor with both of its own handles. */
export function toAnchors(geo: ContourGeometry): Anchor[] {
  return subpathsOf(geo).flatMap((sub) => {
    const segs = sub.segments;
    const n = segs.length;
    return segs.map((s, i) => {
      // The curve leaving anchor i is the one arriving at anchor i+1 — which for
      // the last anchor of a closed path wraps to the closing curve at index 0.
      const next = i + 1 < n ? segs[i + 1] : sub.closed ? segs[0] : undefined;
      const anchor: Anchor = { x: s.x, y: s.y };
      // Segment 0 of an *open* path has no arriving curve, so its cp2 is not a
      // handle of anything and is dropped rather than shown.
      if ((i > 0 || sub.closed) && s.cp2x !== undefined && s.cp2y !== undefined) {
        anchor.inX = s.cp2x;
        anchor.inY = s.cp2y;
      }
      if (next?.cp1x !== undefined && next?.cp1y !== undefined) {
        anchor.outX = next.cp1x;
        anchor.outY = next.cp1y;
      }
      return anchor;
    });
  });
}

/** Back to the stored form. The inverse of `toAnchors` for every path it can produce. */
export function fromAnchors(anchors: readonly Anchor[], closed: boolean): BezierGeometry {
  const n = anchors.length;
  const segments: BezierSegment[] = anchors.map((a, i) => {
    const seg: BezierSegment = { x: a.x, y: a.y };
    // Whoever leaves the previous anchor owns this segment's cp1: index 0's
    // predecessor is the last anchor, which only exists when the path closes.
    const prev = i > 0 ? anchors[i - 1] : closed ? anchors[n - 1] : undefined;
    if (prev?.outX !== undefined && prev?.outY !== undefined) {
      seg.cp1x = prev.outX;
      seg.cp1y = prev.outY;
    }
    if ((i > 0 || closed) && a.inX !== undefined && a.inY !== undefined) {
      seg.cp2x = a.inX;
      seg.cp2y = a.inY;
    }
    return seg;
  });
  return { kind: 'bezier', segments, closed };
}

/** An SVG `d` string for the stored path, in node-local coordinates. */
export function pathData(geo: BezierGeometry): string {
  const segs = geo.segments;
  if (segs.length === 0) return '';
  if (segs.length === 1) return `M ${segs[0].x} ${segs[0].y}`;

  let d = `M ${segs[0].x} ${segs[0].y}`;
  for (const c of toCubics(geo)) {
    d += ` C ${c.c1x} ${c.c1y} ${c.c2x} ${c.c2y} ${c.x1} ${c.y1}`;
  }
  // `Z` after the closing cubic, not instead of it: the cubic has already
  // drawn the run home, and Z now closes a gap of zero length — which is what
  // makes the join take the line-join rather than two loose caps.
  if (geo.closed) d += ' Z';
  return d;
}

/** A polygon (or polyline) as an SVG `d` string. The form booleans and stroke outlines produce. */
export function polygonData(rings: readonly (readonly Point[])[]): string {
  return rings
    .filter((r) => r.length > 1)
    .map((r) => `M ${r.map((p) => `${p.x} ${p.y}`).join(' L ')} Z`)
    .join(' ');
}

// ---------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------

/** The point at parameter `t` along a cubic. */
export function cubicAt(c: Cubic, t: number): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const d = 3 * u * t * t;
  const e = t * t * t;
  return {
    x: a * c.x0 + b * c.c1x + d * c.c2x + e * c.x1,
    y: a * c.y0 + b * c.c1y + d * c.c2y + e * c.y1,
  };
}

/**
 * First derivative (tangent vector) of a cubic at parameter `t`.
 *
 * The derivative of B(t) = (1-t)^3 P0 + 3(1-t)^2 t P1 + 3(1-t) t^2 P2 + t^3 P3 is
 * B'(t) = 3(1-t)^2 (P1-P0) + 6(1-t)t (P2-P1) + 3t^2 (P3-P2). The direction
 * of this vector is the tangent at `t`, and its magnitude is proportional
 * to the parametric speed.
 */
export function cubicDerivativeAt(c: Cubic, t: number): Point {
  const u = 1 - t;
  const a = 3 * u * u;
  const b = 6 * u * t;
  const d = 3 * t * t;
  return {
    x: a * (c.c1x - c.x0) + b * (c.c2x - c.c1x) + d * (c.x1 - c.c2x),
    y: a * (c.c1y - c.y0) + b * (c.c2y - c.c1y) + d * (c.y1 - c.c2y),
  };
}

/**
 * Second derivative of a cubic at parameter `t`.
 *
 * B''(t) = 6(1-t)(P2 - 2P1 + P0) + 6t(P3 - 2P2 + P1). Needed for
 * curvature computation: the osculating circle's radius depends on the
 * cross product of the first and second derivatives.
 */
export function cubicSecondDerivativeAt(c: Cubic, t: number): Point {
  const u = 1 - t;
  return {
    x: 6 * u * (c.c2x - 2 * c.c1x + c.x0) + 6 * t * (c.x1 - 2 * c.c2x + c.c1x),
    y: 6 * u * (c.c2y - 2 * c.c1y + c.y0) + 6 * t * (c.y1 - 2 * c.c2y + c.c1y),
  };
}

/**
 * Radius of the osculating circle at parameter `t` along a cubic.
 *
 * R = |v'|^3 / |v' x v''|, where the cross product in 2D is the scalar
 * v'x * v''y - v'y * v''x. Returns `Infinity` for straight segments where the
 * cross product vanishes -- the curve has zero curvature, which the UI
 * interprets as "no curvature indicator to display".
 */
export function curvatureRadiusAt(c: Cubic, t: number): number {
  const d1 = cubicDerivativeAt(c, t);
  const d2 = cubicSecondDerivativeAt(c, t);
  const cross = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(cross) < 1e-12) return Infinity;
  const speed = Math.hypot(d1.x, d1.y);
  return Math.abs((speed * speed * speed) / cross);
}

/**
 * The curvature radius at an anchor, from both the arriving and departing curves.
 *
 * `in` is the radius of the curve arriving at the anchor (at t=1 of the previous
 * cubic), `out` is the radius of the curve departing (at t=0 of the next cubic).
 * Either is `Infinity` when the corresponding segment is straight or missing.
 *
 * This is the number the PathEditor displays as a readout on picked anchors,
 * and the arc it draws is sized from it.
 */
export function anchorCurvatureRadius(
  geo: BezierGeometry,
  index: number
): { in: number; out: number } {
  const cubics = toCubics(geo);
  const n = geo.segments.length;
  if (n < 2) return { in: Infinity, out: Infinity };

  // The curve arriving at anchor `index` is cubic[index-1] (evaluated at t=1),
  // or for a closed path with index 0 it wraps to the last cubic.
  let inRadius = Infinity;
  const inIdx = index > 0 ? index - 1 : geo.closed ? cubics.length - 1 : -1;
  if (inIdx >= 0 && inIdx < cubics.length) {
    inRadius = curvatureRadiusAt(cubics[inIdx], 1);
  }

  // The curve departing from anchor `index` is cubic[index] (evaluated at t=0).
  let outRadius = Infinity;
  const outIdx = index < cubics.length ? index : -1;
  if (outIdx >= 0) {
    outRadius = curvatureRadiusAt(cubics[outIdx], 0);
  }

  return { in: inRadius, out: outRadius };
}

/**
 * How far a cubic's controls stray from the straight line between its ends.
 *
 * The standard flatness measure, kept squared so the subdivision loop never
 * takes a square root. A curve whose controls sit on the chord is the chord.
 */
function flatnessSq(c: Cubic): number {
  const dx = c.x1 - c.x0;
  const dy = c.y1 - c.y0;
  // Distance from each control to the *infinite* line through the endpoints,
  // times the chord length — dividing by it once at the end is cheaper than
  // twice inside, and the degenerate case is handled below.
  const d1 = Math.abs((c.c1x - c.x1) * dy - (c.c1y - c.y1) * dx);
  const d2 = Math.abs((c.c2x - c.x1) * dy - (c.c2y - c.y1) * dx);
  const sum = d1 + d2;
  const chordSq = dx * dx + dy * dy;
  // A zero-length chord is a loop: the controls are the only thing with any
  // extent, so measure against them directly instead of dividing by nothing.
  if (chordSq < EPS) {
    const ax = c.c1x - c.x0;
    const ay = c.c1y - c.y0;
    const bx = c.c2x - c.x0;
    const by = c.c2y - c.y0;
    return Math.max(ax * ax + ay * ay, bx * bx + by * by);
  }
  return (sum * sum) / chordSq;
}

/** Split a cubic at `t` into the two cubics that together draw the same curve. */
export function splitCubic(c: Cubic, t: number): [Cubic, Cubic] {
  // de Casteljau: every point below is an interpolation of two points above it,
  // and the ones on the left and right edges of the triangle are the controls
  // of the two halves. Exact — no curve fitting, so a split changes nothing on
  // screen, which is the whole requirement for inserting an anchor.
  const lerp = (ax: number, ay: number, bx: number, by: number): [number, number] => [
    ax + (bx - ax) * t,
    ay + (by - ay) * t,
  ];
  const [p01x, p01y] = lerp(c.x0, c.y0, c.c1x, c.c1y);
  const [p12x, p12y] = lerp(c.c1x, c.c1y, c.c2x, c.c2y);
  const [p23x, p23y] = lerp(c.c2x, c.c2y, c.x1, c.y1);
  const [p012x, p012y] = lerp(p01x, p01y, p12x, p12y);
  const [p123x, p123y] = lerp(p12x, p12y, p23x, p23y);
  const [mx, my] = lerp(p012x, p012y, p123x, p123y);

  return [
    { x0: c.x0, y0: c.y0, c1x: p01x, c1y: p01y, c2x: p012x, c2y: p012y, x1: mx, y1: my },
    { x0: mx, y0: my, c1x: p123x, c1y: p123y, c2x: p23x, c2y: p23y, x1: c.x1, y1: c.y1 },
  ];
}

/**
 * How close a polyline has to hug its curve, in node-local units.
 *
 * A quarter of a unit is a quarter of a screen pixel at 100% zoom and stays
 * under one pixel out to 400%, which is as far as anyone inspects the result
 * of a boolean. Tighter costs points in every downstream polygon for a
 * difference nobody can see.
 */
export const FLATTEN_TOLERANCE = 0.25;

/** Guard against a pathological curve subdividing forever. 2^16 segments is far past any real path. */
const MAX_FLATTEN_DEPTH = 16;

function flattenCubic(c: Cubic, toleranceSq: number, depth: number, out: Point[]): void {
  if (depth >= MAX_FLATTEN_DEPTH || flatnessSq(c) <= toleranceSq) {
    out.push({ x: c.x1, y: c.y1 });
    return;
  }
  const [a, b] = splitCubic(c, 0.5);
  flattenCubic(a, toleranceSq, depth + 1, out);
  flattenCubic(b, toleranceSq, depth + 1, out);
}

/**
 * The path as a point list, close enough that the difference is invisible.
 *
 * Adaptive rather than a fixed number of samples per curve: a curve that is
 * nearly straight gets two points and a tight one gets as many as it needs.
 * Sampling every curve at, say, 32 steps would be simultaneously wasteful on
 * the first and visibly faceted on the second.
 *
 * The result is *not* closed by repeating the first point — a closed path is
 * declared closed, and a duplicated final point is a degenerate edge that
 * upsets every polygon algorithm that receives one.
 */
export function flattenPath(geo: ContourGeometry, tolerance = FLATTEN_TOLERANCE): Point[] {
  if (geo.kind === 'compound') {
    return geo.subpaths.flatMap((sub) => flattenPath(sub, tolerance));
  }
  const segs = geo.segments;
  if (segs.length === 0) return [];
  const points: Point[] = [{ x: segs[0].x, y: segs[0].y }];
  const toleranceSq = tolerance * tolerance;
  for (const c of toCubics(geo)) flattenCubic(c, toleranceSq, 0, points);
  // The closing curve ends exactly where the path started; keeping that point
  // would make the first and last entries identical.
  if (geo.closed) points.pop();
  return points;
}

/**
 * The path's bounding box in node-local coordinates.
 *
 * From the flattened points rather than from the control polygon. The control
 * hull is a bound, but a loose one — a curve pulled hard in one direction can
 * report a box half again too big, which would show up as a selection
 * rectangle standing off the shape.
 */
export function pathBounds(geo: ContourGeometry): { x: number; y: number; width: number; height: number } {
  const points = flattenPath(geo);
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

/** Which curve of the path, and where along it. What a click on the path resolves to. */
export interface PathHit {
  /** Index into `toCubics(geo)`. For a closed path the last entry is the closing curve. */
  curve: number;
  /** Parameter along that curve. */
  t: number;
  /** Distance from the queried point, in node-local units. */
  distance: number;
  point: Point;
}

/** Samples per curve when locating a click. 24 puts the coarse guess within a few units on any real curve. */
const HIT_SAMPLES = 24;

/**
 * The closest point on the path to `p`.
 *
 * A coarse sweep followed by a local refinement, rather than solving the
 * quintic that the exact answer requires. The refinement converges to well
 * inside a pixel, and the only consumers are "insert an anchor here" and "did
 * this click land on the outline" — both of which are judged by eye.
 */
export function nearestPointOnPath(geo: BezierGeometry, p: Point): PathHit | null {
  const cubics = toCubics(geo);
  if (cubics.length === 0) return null;

  let best: PathHit | null = null;
  const consider = (curve: number, t: number, c: Cubic) => {
    const point = cubicAt(c, t);
    const dx = point.x - p.x;
    const dy = point.y - p.y;
    const distance = Math.hypot(dx, dy);
    if (!best || distance < best.distance) best = { curve, t, distance, point };
  };

  for (let i = 0; i < cubics.length; i++) {
    for (let s = 0; s <= HIT_SAMPLES; s++) consider(i, s / HIT_SAMPLES, cubics[i]);
  }
  if (!best) return null;

  // Binary refinement around the winner. Ten halvings take the bracket from
  // one sample step to a thousandth of it, which is far below the precision a
  // pointer can express.
  let span = 1 / HIT_SAMPLES;
  for (let i = 0; i < 10; i++) {
    span /= 2;
    const current: PathHit = best;
    const c = cubics[current.curve];
    consider(current.curve, Math.max(0, current.t - span), c);
    consider(current.curve, Math.min(1, current.t + span), c);
  }
  return best;
}

/**
 * Add an anchor partway along a curve, without moving the path.
 *
 * The split is exact, so the outline is pixel-identical before and after —
 * which is the entire point. An "insert" that nudged the shape would make
 * adding a handle a destructive act, and people insert anchors precisely
 * because they do not want to redraw what is already right.
 */
export function insertAnchor(geo: BezierGeometry, hit: Pick<PathHit, 'curve' | 't'>): BezierGeometry {
  const cubics = toCubics(geo);
  const c = cubics[hit.curve];
  if (!c) return geo;

  const [left, right] = splitCubic(c, Math.min(1, Math.max(0, hit.t)));
  const anchors = toAnchors(geo);
  // Curve *i* runs from anchor *i* to anchor *i+1*, wrapping to 0 for the
  // closing curve — so the new anchor lands immediately after anchor `curve`.
  const from = hit.curve;
  const to = (hit.curve + 1) % anchors.length;

  const next = anchors.map((a) => ({ ...a }));
  // Splitting changes the neighbours' inner handles too: the halves have
  // shorter controls than the whole did.
  next[from].outX = left.c1x;
  next[from].outY = left.c1y;
  next[to].inX = right.c2x;
  next[to].inY = right.c2y;

  const inserted: Anchor = {
    x: left.x1,
    y: left.y1,
    inX: left.c2x,
    inY: left.c2y,
    outX: right.c1x,
    outY: right.c1y,
  };
  next.splice(from + 1, 0, inserted);
  return fromAnchors(next, geo.closed);
}

/**
 * Drop an anchor, keeping the rest of the path where it is.
 *
 * The neighbours' handles are left alone, so the two curves that met at the
 * removed anchor become one that leaves and arrives the same way. The shape
 * changes — it has to, a curve was removed — but it changes only between those
 * two neighbours rather than being refitted end to end.
 *
 * Returns `null` when there would be nothing left worth drawing, which is the
 * caller's cue to delete the node rather than leave a path of one point.
 */
export function removeAnchor(geo: BezierGeometry, index: number): BezierGeometry | null {
  const anchors = toAnchors(geo);
  if (index < 0 || index >= anchors.length) return geo;
  if (anchors.length <= 2) return null;
  const next = anchors.filter((_, i) => i !== index);
  return fromAnchors(next, geo.closed);
}

function handleMode(a: Anchor): HandleMode {
  if (a.inX === undefined || a.outX === undefined) return 'corner';
  const inDx = a.x - (a.inX ?? a.x);
  const inDy = a.y - (a.inY ?? a.y);
  const outDx = (a.outX ?? a.x) - a.x;
  const outDy = (a.outY ?? a.y) - a.y;
  const inLen = Math.hypot(inDx, inDy);
  const outLen = Math.hypot(outDx, outDy);
  if (inLen < EPS || outLen < EPS) return 'corner';
  // Collinear and pointing the same way. The cross product alone would also
  // accept handles folded back on top of each other, which is a cusp, not a
  // smooth join — hence the dot-product check as well.
  const cross = inDx * outDy - inDy * outDx;
  const dot = inDx * outDx + inDy * outDy;
  if (Math.abs(cross) > EPS * inLen * outLen || dot <= 0) return 'corner';
  return Math.abs(inLen - outLen) < EPS * Math.max(inLen, outLen) ? 'mirrored' : 'smooth';
}

/** The mode of the anchor at `index`, as derived from where its handles actually are. */
export function anchorMode(geo: BezierGeometry, index: number): HandleMode {
  const anchors = toAnchors(geo);
  const a = anchors[index];
  return a ? handleMode(a) : 'corner';
}

/**
 * Move one handle, and whatever else that implies.
 *
 * The opposite handle follows unless the anchor is a corner: a smooth anchor
 * keeps its direction and its own length, a mirrored one keeps both. `break`
 * forces the pair apart, which is how a corner is made — the alternative,
 * a stored flag, would let the flag and the geometry disagree.
 */
export function moveHandle(
  geo: BezierGeometry,
  index: number,
  which: 'in' | 'out',
  to: Point,
  opts: { break?: boolean } = {}
): BezierGeometry {
  const anchors = toAnchors(geo).map((a) => ({ ...a }));
  const a = anchors[index];
  if (!a) return geo;

  const mode = opts.break ? 'corner' : handleMode(a);
  if (which === 'in') {
    a.inX = to.x;
    a.inY = to.y;
  } else {
    a.outX = to.x;
    a.outY = to.y;
  }

  if (mode !== 'corner') {
    const dx = to.x - a.x;
    const dy = to.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len > EPS) {
      const other = which === 'in' ? { x: a.outX, y: a.outY } : { x: a.inX, y: a.inY };
      const otherLen =
        mode === 'mirrored' || other.x === undefined || other.y === undefined
          ? len
          : Math.hypot(other.x - a.x, other.y - a.y);
      // Opposite direction, own length: that is what "smooth" means, and it is
      // why dragging one handle of a smooth anchor rotates the other without
      // stretching it.
      const ox = a.x - (dx / len) * otherLen;
      const oy = a.y - (dy / len) * otherLen;
      if (which === 'in') {
        a.outX = ox;
        a.outY = oy;
      } else {
        a.inX = ox;
        a.inY = oy;
      }
    }
  }
  return fromAnchors(anchors, geo.closed);
}

/**
 * Move an anchor, carrying its handles with it.
 *
 * Handles are stored absolutely, so an anchor that moved without them would
 * leave them behind and turn a smooth curve inside out. They travel by the
 * same delta, which keeps the curve's shape and moves where it sits.
 */
export function moveAnchor(geo: BezierGeometry, index: number, to: Point): BezierGeometry {
  const anchors = toAnchors(geo).map((a) => ({ ...a }));
  const a = anchors[index];
  if (!a) return geo;
  const dx = to.x - a.x;
  const dy = to.y - a.y;
  a.x = to.x;
  a.y = to.y;
  if (a.inX !== undefined && a.inY !== undefined) {
    a.inX += dx;
    a.inY += dy;
  }
  if (a.outX !== undefined && a.outY !== undefined) {
    a.outX += dx;
    a.outY += dy;
  }
  return fromAnchors(anchors, geo.closed);
}

/**
 * Straighten an anchor into a corner, or round it into a smooth one.
 *
 * The smooth direction is taken from the line between the two neighbours,
 * which is the standard construction and the one that produces a curve
 * continuing the path's existing sweep rather than an arbitrary bulge.
 */
/**
 * Set an anchor's handle alignment.
 *
 * ## Why `mirrored` had to be added here
 *
 * `HandleMode` has always declared three — `corner`, `smooth`, `mirrored` —
 * and `handleMode` derives all three from where the handles actually are, so
 * `moveHandle` has always *honoured* a mirrored anchor: drag one side and the
 * other follows in both direction and length.
 *
 * But this function accepted two, so there was no way to ask for the third.
 * A mirrored anchor could only come about by accident — by dragging until the
 * two lengths happened to match within epsilon. That is a capability the model
 * declares, the renderer honours, and nothing can reach: invariant 6 from the
 * inside, and the reason it hid for so long is that it fails by being merely
 * unavailable rather than by looking broken.
 *
 * ## What each mode means
 *
 * - **corner** — no handles at all. The curve arrives and leaves along the
 *   straight lines to its neighbours.
 * - **smooth** — collinear, independent lengths. Dragging one handle rotates
 *   the other without stretching it, which is what keeps a long approach and a
 *   short departure while the join stays tangent-continuous.
 * - **mirrored** — collinear *and* equal length. The join is symmetric, which
 *   is what a circle's anchors are and what you want when the curve either
 *   side of a point should carry the same weight.
 *
 * Made symmetric by **averaging** the two lengths rather than taking one side:
 * picking a side makes the result depend on which handle happened to be
 * longer, so the same gesture on the same anchor gives two different curves
 * depending on history nobody can see.
 */
export function setAnchorMode(
  geo: BezierGeometry,
  index: number,
  mode: HandleMode
): BezierGeometry {
  const anchors = toAnchors(geo).map((a) => ({ ...a }));
  const a = anchors[index];
  if (!a) return geo;

  if (mode === 'corner') {
    delete a.inX;
    delete a.inY;
    delete a.outX;
    delete a.outY;
    return fromAnchors(anchors, geo.closed);
  }

  if (mode === 'mirrored' && a.inX !== undefined && a.outX !== undefined) {
    /**
     * Already curved: keep the direction it has and equalise the lengths.
     *
     * Re-deriving the direction from the neighbours — which is what the
     * `smooth` path below does — would throw away a tangent the user has
     * already aimed, and turn "make this symmetric" into "reset this". The
     * axis comes from the two handles as they stand, so only the lengths move.
     */
    const inDx = a.x - (a.inX ?? a.x);
    const inDy = a.y - (a.inY ?? a.y);
    const outDx = (a.outX ?? a.x) - a.x;
    const outDy = (a.outY ?? a.y) - a.y;
    const inLen = Math.hypot(inDx, inDy);
    const outLen = Math.hypot(outDx, outDy);
    if (inLen > EPS || outLen > EPS) {
      // The outgoing direction, falling back to the incoming one when the
      // outgoing handle sits on the anchor and has no direction of its own.
      const dx = outLen > EPS ? outDx / outLen : inDx / inLen;
      const dy = outLen > EPS ? outDy / outLen : inDy / inLen;
      const len = (inLen + outLen) / 2;
      a.inX = a.x - dx * len;
      a.inY = a.y - dy * len;
      a.outX = a.x + dx * len;
      a.outY = a.y + dy * len;
      return fromAnchors(anchors, geo.closed);
    }
  }

  const n = anchors.length;
  const prev = index > 0 ? anchors[index - 1] : geo.closed ? anchors[n - 1] : undefined;
  const next = index + 1 < n ? anchors[index + 1] : geo.closed ? anchors[0] : undefined;
  // An endpoint of an open path has one neighbour; aim at it and let the other
  // handle fall on the opposite side.
  const ref1 = prev ?? next;
  const ref2 = next ?? prev;
  if (!ref1 || !ref2) return geo;

  const dx = ref2.x - ref1.x;
  const dy = ref2.y - ref1.y;
  const len = Math.hypot(dx, dy);
  if (len < EPS) return geo;
  // A third of the way to each neighbour: the length that makes a run of
  // smoothed anchors approximate a circle closely, and the same figure every
  // other editor uses for this gesture.
  const rawIn = Math.hypot(a.x - ref1.x, a.y - ref1.y) / 3;
  const rawOut = Math.hypot(ref2.x - a.x, ref2.y - a.y) / 3;
  // A corner being made symmetric has no existing tangent to keep, so the
  // direction comes from the neighbours as it does for `smooth` — but the two
  // lengths are averaged, which is the whole difference between the modes.
  const inLen = mode === 'mirrored' ? (rawIn + rawOut) / 2 : rawIn;
  const outLen = mode === 'mirrored' ? (rawIn + rawOut) / 2 : rawOut;
  a.inX = a.x - (dx / len) * inLen;
  a.inY = a.y - (dy / len) * inLen;
  a.outX = a.x + (dx / len) * outLen;
  a.outY = a.y + (dy / len) * outLen;
  return fromAnchors(anchors, geo.closed);
}

/**
 * Shift every anchor and handle by a delta.
 *
 * Paths store their geometry relative to the node origin, so an edit that
 * changes the bounding box has to move the node and move the geometry the
 * other way to keep it where it was drawn. `reframe` is the second half of
 * that pair.
 */
/**
 * Every point of a path through one function: anchors and control points alike.
 *
 * ## Why control points go through the same map
 *
 * A cubic is *affine-invariant*: transforming its four control points and
 * drawing the curve through them gives exactly the curve you would get by
 * transforming every point along the original. So a rotate, a scale, a shear or
 * any combination of them is applied here, to four numbers per segment, and is
 * exact — no flattening, no tolerance, no resampling.
 *
 * That is what lets a boolean operate on a rotated object at all. Refusing them
 * — which is what the vector operations used to do — was never about the maths
 * being hard; it was that nothing here could express the transform.
 *
 * The mapper must be affine. A perspective or a bend would move the curve
 * *between* its control points, and transforming the four would silently give
 * the wrong shape rather than an error.
 */
export function mapPath<T extends ContourGeometry>(geo: T, fn: (p: Point) => Point): T {
  if (geo.kind === 'compound') {
    return { ...geo, subpaths: geo.subpaths.map((s) => mapPath(s, fn)) } as T;
  }
  return {
    ...geo,
    segments: geo.segments.map((s) => {
      const a = fn({ x: s.x, y: s.y });
      const seg: BezierSegment = { x: a.x, y: a.y };
      if (s.cp1x !== undefined) {
        const c = fn({ x: s.cp1x, y: s.cp1y ?? 0 });
        seg.cp1x = c.x;
        seg.cp1y = c.y;
      }
      if (s.cp2x !== undefined) {
        const c = fn({ x: s.cp2x, y: s.cp2y ?? 0 });
        seg.cp2x = c.x;
        seg.cp2y = c.y;
      }
      return seg;
    }),
  } as T;
}

export function translatePath<T extends ContourGeometry>(geo: T, dx: number, dy: number): T {
  if (dx === 0 && dy === 0) return geo;
  if (geo.kind === 'compound') {
    return { ...geo, subpaths: geo.subpaths.map((s) => translatePath(s, dx, dy)) };
  }
  return {
    ...geo,
    segments: geo.segments.map((s) => ({
      x: s.x + dx,
      y: s.y + dy,
      ...(s.cp1x !== undefined ? { cp1x: s.cp1x + dx, cp1y: (s.cp1y ?? 0) + dy } : null),
      ...(s.cp2x !== undefined ? { cp2x: s.cp2x + dx, cp2y: (s.cp2y ?? 0) + dy } : null),
    })),
  };
}

/** The box around every contour. `pathBounds` for a shape that may have more than one. */
export function contourBounds(geo: ContourGeometry): { x: number; y: number; width: number; height: number } {
  const boxes = subpathsOf(geo)
    .map(pathBounds)
    .filter((b) => b.width > 0 || b.height > 0);
  if (boxes.length === 0) return pathBounds(subpathsOf(geo)[0] ?? { kind: 'bezier', segments: [], closed: false });
  const minX = Math.min(...boxes.map((b) => b.x));
  const minY = Math.min(...boxes.map((b) => b.y));
  const maxX = Math.max(...boxes.map((b) => b.x + b.width));
  const maxY = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** `pathData` for either form. Several contours become several `M…Z` runs in one string. */
export function contourData(geo: ContourGeometry): string {
  return subpathsOf(geo).map(pathData).filter(Boolean).join(' ');
}

/**
 * Re-origin a path so its geometry starts at 0,0, reporting where the node
 * has to move to compensate.
 *
 * Editing an anchor changes the path's extent, and a node whose `width`/
 * `height` no longer describe its contents has a selection box and a hit area
 * that are both wrong. Every edit therefore ends here.
 */
export function reframePath<T extends ContourGeometry>(geo: T): {
  geometry: T;
  dx: number;
  dy: number;
  width: number;
  height: number;
} {
  const b = contourBounds(geo);
  return {
    geometry: translatePath(geo, -b.x, -b.y),
    dx: b.x,
    dy: b.y,
    // A straight horizontal path has zero height and would otherwise be a node
    // with no area to click, so both are floored at one unit.
    width: Math.max(1, b.width),
    height: Math.max(1, b.height),
  };
}

// ---------------------------------------------------------------------------
// Resizing
// ---------------------------------------------------------------------------

/**
 * The extent the geometry actually occupies, for any of the three path forms.
 *
 * This is the number a resize has to divide by, and it is *not* the same thing
 * as `node.width`/`node.height`. Every path is born re-origined — `PenTool`
 * normalizes a freehand stroke to its own bounds, and every vector edit ends in
 * `reframePath` — so the two agree at creation and after every edit. Dragging a
 * transformer handle is the one gesture that moved the node's box **without
 * touching the geometry**, which is what left a resized path drawing at exactly
 * its old size while the layers panel and the radar reported the new one.
 *
 * Measuring the geometry rather than trusting a stored scale factor is what
 * makes `scalePathGeometry` self-healing: a path already stretched by the old
 * behaviour is corrected the first time it is resized again, instead of
 * inheriting the discrepancy forever.
 */
export function pathNaturalSize(geo: PathGeometry): { width: number; height: number } {
  if (geo.kind === 'freehand') {
    /**
     * Measured from the `svgPath` — the outline that is actually drawn.
     *
     * This first derived the size from the *centreline* grown by the nib,
     * mirroring how `PenTool` framed the node. That agreed on a fresh stroke
     * and drifted on every resize after it, because the two halves of the sum
     * do not scale together: `scalePathGeometry` scales the outline by
     * `(sx, sy)` and the nib by `min(|sx|, |sy|)`, so after a non-uniform
     * stretch the measurement no longer described the shape it was measuring.
     * `fitPathToBox` would then find a discrepancy it had itself created and
     * scale again on the next drag — a stroke that crept every time it was
     * touched.
     *
     * Measuring the outline removes the whole class: the numbers below are the
     * numbers `scaleSvgPath` multiplies, so the measurement scales exactly
     * with the thing it measures and fitting is idempotent by construction.
     */
    const nums = geo.svgPath.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi);
    if (!nums || nums.length < 4) return { width: 1, height: 1 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i + 1 < nums.length; i += 2) {
      const x = parseFloat(nums[i]);
      const y = parseFloat(nums[i + 1]);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    return {
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY),
    };
  }
  const b = contourBounds(geo);
  return { width: Math.max(1, b.width), height: Math.max(1, b.height) };
}

/**
 * Path commands whose numbers are not a plain run of absolute x,y pairs.
 *
 * `H`/`V` carry a single ordinate, and `A` carries radii and three flags that
 * must not be multiplied by anything. Nothing this app authors emits them —
 * the pencil writes `M`/`Q`/`Z` and the pen writes `M`/`C`/`Z` — but an
 * imported document could, and silently scaling a flag would corrupt the arc
 * rather than resize it. Such a path is left alone instead.
 */
const UNSCALABLE_COMMANDS = /[HhVvAa]/;

/** Multiply every absolute coordinate pair in an SVG `d` string. */
function scaleSvgPath(d: string, sx: number, sy: number): string {
  if (UNSCALABLE_COMMANDS.test(d)) return d;
  let axis = 0;
  return d.replace(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi, (n) => {
    const scaled = parseFloat(n) * (axis === 0 ? sx : sy);
    axis ^= 1;
    // Trimmed to a tenth of a unit. These strings are regenerated on every
    // resize and a full float per ordinate triples the size of a scribble in
    // the document for precision no renderer can draw.
    return String(Math.round(scaled * 10) / 10);
  });
}

/**
 * Scale a path's own geometry about its origin.
 *
 * Baked into the stored form rather than applied as a Konva `scaleX`/`scaleY`
 * on the way out, and the editor is the reason. `PathEditor` mounts its anchors
 * in world space at `node.x`/`node.y` and draws them at raw geometry
 * coordinates — it reads no scale at all — so a renderer-side stretch would put
 * the outline in one place and its own handles in another. Baking keeps one
 * set of numbers that the renderer, the editor, the hit test, the eraser's
 * centreline and the gradient's unit box all agree on, which is the same
 * invariant `reframePath` exists to hold.
 */
export function scalePathGeometry<T extends PathGeometry>(geo: T, sx: number, sy: number): T {
  if (!Number.isFinite(sx) || !Number.isFinite(sy) || (sx === 1 && sy === 1)) return geo;
  if (geo.kind === 'freehand') {
    return {
      ...geo,
      svgPath: scaleSvgPath(geo.svgPath, sx, sy),
      points: geo.points.map((p) => ({ x: p.x * sx, y: p.y * sy })),
      // The nib follows the smaller axis. A stroke stretched wide should not
      // also read as drawn with a fatter pen, and the two axes disagree about
      // what "the" new weight is, so the conservative one wins.
      strokeSize: Math.max(1, geo.strokeSize * Math.min(Math.abs(sx), Math.abs(sy))),
    };
  }
  if (geo.kind === 'compound') {
    return { ...geo, subpaths: geo.subpaths.map((s) => scalePathGeometry(s, sx, sy)) };
  }
  return {
    ...geo,
    segments: geo.segments.map((s) => ({
      x: s.x * sx,
      y: s.y * sy,
      ...(s.cp1x !== undefined ? { cp1x: s.cp1x * sx, cp1y: (s.cp1y ?? 0) * sy } : null),
      ...(s.cp2x !== undefined ? { cp2x: s.cp2x * sx, cp2y: (s.cp2y ?? 0) * sy } : null),
    })),
  };
}

/**
 * Fit a path's geometry to a box, whatever state it is currently in.
 *
 * The entry point a resize should call: it measures rather than accumulating,
 * so it is idempotent and repairs a path that a previous resize left behind.
 * Returns `null` when the geometry already fits, so a caller can skip the write
 * entirely — a drag that only moved a node must not rewrite its whole outline.
 */
export function fitPathToBox<T extends PathGeometry>(
  geo: T,
  width: number,
  height: number
): T | null {
  const natural = pathNaturalSize(geo);
  const sx = width / natural.width;
  const sy = height / natural.height;
  // A twentieth of a percent. Below that the rewrite costs document bytes and
  // an undo entry to move nothing anybody can see.
  if (Math.abs(sx - 1) < 0.0005 && Math.abs(sy - 1) < 0.0005) return null;
  return scalePathGeometry(geo, sx, sy);
}

/* --------------------------------------------------------------- curvature */

/** The osculating circle at a point on a path: the circle the curve is locally. */
export interface Curvature {
  /** Radius in world units. Large means nearly straight. */
  radius: number;
  /** Centre of that circle, on the concave side. */
  cx: number;
  cy: number;
  /** Signed curvature, so a caller can tell which way the curve bends. */
  kappa: number;
}

/**
 * Curvature where the curve *leaves* an anchor.
 *
 * ## What this is for
 *
 * A Bézier handle tells you the tangent — which way the curve sets off — and
 * says almost nothing about how hard it bends. Two handles of very different
 * lengths can look similar on screen while producing curves that are nothing
 * alike, and the difference only shows once you zoom or stroke it. The
 * osculating circle is the missing half: it is the circle the curve *is*, at
 * that instant, so a run of anchors carrying similar circles is a run that
 * will read as one smooth sweep.
 *
 * ## The arithmetic
 *
 * For a cubic `P0 P1 P2 P3`, at `t = 0`:
 *
 * ```text
 *   P'(0)  = 3(P1 − P0)
 *   P''(0) = 6(P2 − 2P1 + P0) = 6((P2 − P1) − (P1 − P0))
 *   κ      = |P' × P''| / |P'|³ = (2/3)·|(P1−P0) × (P2−P1)| / |P1−P0|³
 * ```
 *
 * Signed rather than absolute, because the sign is which side the centre sits
 * on and a caller drawing the circle needs it. The centre is one radius along
 * the normal, and the normal's direction is the sign of that cross product.
 *
 * ## The two degenerate cases, and why they return null rather than Infinity
 *
 * A **straight** segment has zero curvature and an infinite radius. There is
 * no circle to draw and `Infinity` would propagate into whatever tried; a
 * caller that has to check for it will eventually forget. A **zero-length
 * outgoing handle** has no `P'` at all, so the tangent is undefined at that
 * end and the formula divides by zero. Both are "there is no osculating circle
 * here", which is one answer, so they give one.
 */
export function curvatureAt(geo: BezierGeometry, index: number): Curvature | null {
  const anchors = toAnchors(geo);
  const n = anchors.length;
  const a = anchors[index];
  if (!a) return null;
  const next = index + 1 < n ? anchors[index + 1] : geo.closed ? anchors[0] : undefined;
  if (!next) return null;

  // The outgoing cubic's four points. A missing handle sits on its own anchor,
  // which is what a corner is and what makes that segment a straight line.
  const p0 = { x: a.x, y: a.y };
  const p1 = { x: a.outX ?? a.x, y: a.outY ?? a.y };
  const p2 = { x: next.inX ?? next.x, y: next.inY ?? next.y };

  const ax = p1.x - p0.x;
  const ay = p1.y - p0.y;
  const bx = p2.x - p1.x;
  const by = p2.y - p1.y;
  const speed = Math.hypot(ax, ay);
  if (speed < EPS) return null;

  const cross = ax * by - ay * bx;
  const kappa = ((2 / 3) * cross) / (speed * speed * speed);
  if (Math.abs(kappa) < EPS) return null;

  const radius = 1 / Math.abs(kappa);
  // The normal, turned towards the concave side by the sign of the curvature.
  const sign = kappa > 0 ? 1 : -1;
  const nx = (-ay / speed) * sign;
  const ny = (ax / speed) * sign;
  return { radius, cx: p0.x + nx * radius, cy: p0.y + ny * radius, kappa };
}
