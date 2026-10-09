/**
 * Polygons back into curves.
 *
 * The clipper behind booleans and outline-stroke works on polygons, so a union
 * of two circles used to come back as a ring of a few hundred straight
 * segments: right on screen, and a few hundred anchors the moment you opened
 * it in the path editor. Illustrator and Figma both hand back curves. This is
 * the step that does that here.
 *
 * ## How
 *
 * 1. **Corners first.** A vertex is a corner when it turns much harder than
 *    its neighbours (or very hard outright). Turn size alone is not enough: a
 *    small circle flattened at a quarter-pixel tolerance turns 40° per chord,
 *    and calling each of those a corner would put the polygon straight back.
 *    The corners of a boolean (where two outlines cross) and of a rectangle
 *    stand out against their neighbours, which is the test.
 * 2. **Each run between corners** is fitted with Philip Schneider's algorithm
 *    ("An Algorithm for Automatically Fitting Digitized Curves", Graphics
 *    Gems, 1990): least-squares cubic with the end tangents fixed, Newton
 *    reparameterisation, and a split at the worst point when one cubic is not
 *    enough. Runs that are straight within tolerance become lines with no
 *    handles at all, so a rectangle comes back as four anchors.
 * 3. **A ring with no corner** is fitted as one closed run whose seam tangent
 *    is shared, so the start anchor is as smooth as the rest.
 */

import type { BezierGeometry, BezierSegment, Point } from './schema';

/** Default fitting tolerance, in geometry units: a fifth of a pixel at 100%. */
export const FIT_TOLERANCE = 0.2;

interface Cubic4 {
  p0: Point;
  p1: Point;
  p2: Point;
  p3: Point;
}

const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: Point, s: number): Point => ({ x: a.x * s, y: a.y * s });
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
const len = (a: Point) => Math.hypot(a.x, a.y);
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
function unit(a: Point): Point {
  const l = len(a);
  return l < 1e-12 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
}

function bezierAt(c: Cubic4, t: number): Point {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const d = 3 * mt * t * t;
  const e = t * t * t;
  return {
    x: a * c.p0.x + b * c.p1.x + d * c.p2.x + e * c.p3.x,
    y: a * c.p0.y + b * c.p1.y + d * c.p2.y + e * c.p3.y,
  };
}

function bezierD1(c: Cubic4, t: number): Point {
  const mt = 1 - t;
  return {
    x: 3 * (mt * mt * (c.p1.x - c.p0.x) + 2 * mt * t * (c.p2.x - c.p1.x) + t * t * (c.p3.x - c.p2.x)),
    y: 3 * (mt * mt * (c.p1.y - c.p0.y) + 2 * mt * t * (c.p2.y - c.p1.y) + t * t * (c.p3.y - c.p2.y)),
  };
}

function bezierD2(c: Cubic4, t: number): Point {
  const mt = 1 - t;
  return {
    x: 6 * (mt * (c.p2.x - 2 * c.p1.x + c.p0.x) + t * (c.p3.x - 2 * c.p2.x + c.p1.x)),
    y: 6 * (mt * (c.p2.y - 2 * c.p1.y + c.p0.y) + t * (c.p3.y - 2 * c.p2.y + c.p1.y)),
  };
}

function chordParams(pts: readonly Point[]): number[] {
  const u = [0];
  for (let i = 1; i < pts.length; i++) u.push(u[i - 1] + dist(pts[i], pts[i - 1]));
  const total = u[u.length - 1] || 1;
  return u.map((v) => v / total);
}

function generate(pts: readonly Point[], u: readonly number[], t1: Point, t2: Point): Cubic4 {
  const first = pts[0];
  const last = pts[pts.length - 1];
  let c00 = 0;
  let c01 = 0;
  let c11 = 0;
  let x0 = 0;
  let x1 = 0;
  for (let i = 0; i < pts.length; i++) {
    const t = u[i];
    const mt = 1 - t;
    const b0 = mt * mt * mt;
    const b1 = 3 * mt * mt * t;
    const b2 = 3 * mt * t * t;
    const b3 = t * t * t;
    const a1 = mul(t1, b1);
    const a2 = mul(t2, b2);
    c00 += dot(a1, a1);
    c01 += dot(a1, a2);
    c11 += dot(a2, a2);
    const tmp = sub(pts[i], add(mul(first, b0 + b1), mul(last, b2 + b3)));
    x0 += dot(a1, tmp);
    x1 += dot(a2, tmp);
  }
  const det = c00 * c11 - c01 * c01;
  let alpha1 = 0;
  let alpha2 = 0;
  if (Math.abs(det) > 1e-12) {
    alpha1 = (x0 * c11 - x1 * c01) / det;
    alpha2 = (c00 * x1 - c01 * x0) / det;
  }
  const seg = dist(first, last);
  const eps = 1e-6 * seg;
  // The least-squares answer can put a handle behind its anchor or collapse it;
  // the Wu/Barsky heuristic of a third of the chord is the safe fallback.
  if (alpha1 < eps || alpha2 < eps || alpha1 > seg * 2 || alpha2 > seg * 2) {
    alpha1 = alpha2 = seg / 3;
  }
  return { p0: first, p1: add(first, mul(t1, alpha1)), p2: add(last, mul(t2, alpha2)), p3: last };
}

function maxError(pts: readonly Point[], c: Cubic4, u: readonly number[]): { error: number; split: number } {
  let error = 0;
  let split = Math.floor(pts.length / 2);
  for (let i = 1; i < pts.length - 1; i++) {
    const d = dist(bezierAt(c, u[i]), pts[i]);
    if (d > error) {
      error = d;
      split = i;
    }
  }
  return { error, split };
}

function reparameterize(pts: readonly Point[], c: Cubic4, u: readonly number[]): number[] {
  return u.map((t, i) => {
    const d = sub(bezierAt(c, t), pts[i]);
    const d1 = bezierD1(c, t);
    const d2 = bezierD2(c, t);
    const den = dot(d1, d1) + dot(d, d2);
    if (Math.abs(den) < 1e-12) return t;
    return Math.min(1, Math.max(0, t - dot(d, d1) / den));
  });
}

function fitRun(pts: readonly Point[], t1: Point, t2: Point, tol: number, out: Cubic4[], depth = 0): void {
  if (pts.length === 2 || depth > 24) {
    const d = dist(pts[0], pts[pts.length - 1]) / 3;
    out.push({ p0: pts[0], p1: add(pts[0], mul(t1, d)), p2: add(pts[pts.length - 1], mul(t2, d)), p3: pts[pts.length - 1] });
    return;
  }
  let u = chordParams(pts);
  let c = generate(pts, u, t1, t2);
  let { error, split } = maxError(pts, c, u);
  if (error <= tol) {
    out.push(c);
    return;
  }
  if (error <= tol * 4) {
    for (let k = 0; k < 6; k++) {
      u = reparameterize(pts, c, u);
      c = generate(pts, u, t1, t2);
      ({ error, split } = maxError(pts, c, u));
      if (error <= tol) {
        out.push(c);
        return;
      }
    }
  }
  split = Math.max(1, Math.min(pts.length - 2, split));
  const centre = unit(sub(pts[split - 1], pts[split + 1]));
  fitRun(pts.slice(0, split + 1), t1, centre, tol, out, depth + 1);
  fitRun(pts.slice(split), mul(centre, -1), t2, tol, out, depth + 1);
}

/** Whether every point of the run lies within `tol` of its chord. */
function straight(pts: readonly Point[], tol: number): boolean {
  const a = pts[0];
  const b = pts[pts.length - 1];
  const ab = sub(b, a);
  const l = len(ab);
  if (l < 1e-9) return pts.every((p) => dist(p, a) <= tol);
  for (let i = 1; i < pts.length - 1; i++) {
    const ap = sub(pts[i], a);
    const cross = Math.abs(ab.x * ap.y - ab.y * ap.x) / l;
    const along = dot(ap, ab) / (l * l);
    if (cross > tol || along < -0.01 || along > 1.01) return false;
  }
  return true;
}

/** Drop repeated points, including a closing repeat of the first. */
function dedupe(points: readonly Point[], eps: number): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    if (out.length === 0 || dist(out[out.length - 1], p) > eps) out.push(p);
  }
  while (out.length > 1 && dist(out[0], out[out.length - 1]) <= eps) out.pop();
  return out;
}

function turnAt(prev: Point, p: Point, next: Point): number {
  const a = unit(sub(p, prev));
  const b = unit(sub(next, p));
  return Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
}

const HARD_TURN = (75 * Math.PI) / 180;
const SOFT_TURN = (28 * Math.PI) / 180;

/** Indices of the ring's corners. */
export function findCorners(ring: readonly Point[]): number[] {
  const n = ring.length;
  if (n < 3) return ring.map((_, i) => i);
  const turns = ring.map((p, i) => turnAt(ring[(i - 1 + n) % n], p, ring[(i + 1) % n]));
  const corners: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = turns[i];
    const neighbour = Math.max(turns[(i - 1 + n) % n], turns[(i + 1) % n]);
    if (t >= HARD_TURN || (t >= SOFT_TURN && t > neighbour * 2.2)) corners.push(i);
  }
  return corners;
}

/**
 * Fit a closed polygon ring with as few cubics as the tolerance allows.
 *
 * Returns a closed bezier contour in the stored form, or null for a ring with
 * fewer than three distinct points.
 */
export function fitClosedRing(points: readonly Point[], tol = FIT_TOLERANCE): BezierGeometry | null {
  const ring = dedupe(points, 1e-6);
  const n = ring.length;
  if (n < 3) return null;

  const corners = findCorners(ring);
  const cubics: Cubic4[] = [];
  const lines: boolean[] = [];

  const pushRun = (run: Point[], t1: Point, t2: Point) => {
    if (straight(run, tol)) {
      const a = run[0];
      const b = run[run.length - 1];
      cubics.push({ p0: a, p1: a, p2: b, p3: b });
      lines.push(true);
      return;
    }
    const before = cubics.length;
    fitRun(run, t1, t2, tol, cubics);
    for (let k = before; k < cubics.length; k++) lines.push(false);
  };

  if (corners.length === 0) {
    // One seamless loop. The seam's tangent is the central difference across
    // it, used as the leaving tangent at the start and the arriving one at the
    // end, so the start anchor is smooth.
    const run = [...ring, ring[0]];
    const seam = unit(sub(ring[1], ring[n - 1]));
    pushRun(run, seam, mul(seam, -1));
  } else {
    for (let k = 0; k < corners.length; k++) {
      const from = corners[k];
      const to = corners[(k + 1) % corners.length];
      const run: Point[] = [];
      let i = from;
      run.push(ring[i]);
      do {
        i = (i + 1) % n;
        run.push(ring[i]);
      } while (i !== to);
      const t1 = unit(sub(run[1], run[0]));
      const t2 = unit(sub(run[run.length - 2], run[run.length - 1]));
      pushRun(run, t1, t2);
    }
  }

  // Stored form: segment i is the curve *arriving* at anchor i; segment 0
  // carries the closing curve. The cubics run anchor 0 → 1 → … → 0.
  const m = cubics.length;
  if (m < 2) return null;
  const segments: BezierSegment[] = [];
  for (let k = 0; k < m; k++) {
    const arriving = cubics[(k - 1 + m) % m];
    const isLine = lines[(k - 1 + m) % m];
    const seg: BezierSegment = { x: arriving.p3.x, y: arriving.p3.y };
    if (!isLine) {
      seg.cp1x = arriving.p1.x;
      seg.cp1y = arriving.p1.y;
      seg.cp2x = arriving.p2.x;
      seg.cp2y = arriving.p2.y;
    }
    segments.push(seg);
  }
  return { kind: 'bezier', segments, closed: true };
}

/** Signed area of a ring (positive when clockwise on a y-down canvas). */
export function ringArea(points: readonly Point[]): number {
  let a = 0;
  for (let i = 0, n = points.length; i < n; i++) {
    const p = points[i];
    const q = points[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/**
 * Whether a ring is a sliver: a clipping artefact with almost no area for its
 * length, like the hairline left where two edges very nearly coincide.
 */
export function isSliver(points: readonly Point[], minArea = 0.5, minThickness = 0.15): boolean {
  const area = Math.abs(ringArea(points));
  if (area < minArea) return true;
  let perimeter = 0;
  for (let i = 0, n = points.length; i < n; i++) perimeter += dist(points[i], points[(i + 1) % n]);
  // Mean thickness of a strip is twice its area over its perimeter.
  return (2 * area) / Math.max(perimeter, 1e-9) < minThickness;
}
