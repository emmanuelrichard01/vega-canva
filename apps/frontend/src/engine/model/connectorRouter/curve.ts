/**
 * Curved connectors that go around things.
 *
 * A curve is fitted over the elbow route the router found: through both ends,
 * both stub tips and the middle of every leg between them, as a centripetal
 * Catmull-Rom spline. That inherits everything the elbow route knows (which
 * side of each obstacle to pass, leaving and arriving along the port normals)
 * and turns it into one continuous sweep.
 *
 * A curve through leg midpoints cuts the elbow's corners, and a tight corner
 * cut too far reaches into the box it was going around. So every sample is
 * checked against the obstacles; where one intrudes, the nearest elbow corner
 * is pinned into the spline, which pulls the curve back toward the elbow route
 * at exactly that turn, and the curve is refitted. Catmull-Rom is C1 at every
 * control point, so a pinned corner tightens the turn without a kink. If the
 * curve still intrudes after every corner it could pin, it falls back to the
 * elbow route with rounded corners, which is clear by construction.
 *
 * Pure and deterministic: the same route and obstacles always give the same
 * points.
 */

import type { Pt, Rect } from './geometry';

/** Clearance a curve keeps from an obstacle's own box, inside the router's margin. */
export const CURVE_CLEARANCE = 6;
const STEPS_PER_SPAN = 10;
const MAX_REFITS = 8;

function dedupe(points: readonly Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(last.x - p.x, last.y - p.y) > 1e-3) out.push(p);
  }
  return out;
}

function catmullRom(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const knot = (a: Pt, b: Pt, ti: number) => ti + Math.max(1e-4, Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y)));
  const t0 = 0;
  const t1 = knot(p0, p1, t0);
  const t2 = knot(p1, p2, t1);
  const t3 = knot(p2, p3, t2);
  const tt = t1 + (t2 - t1) * t;
  const lerp = (a: Pt, b: Pt, ta: number, tb: number): Pt => {
    const span = tb - ta;
    if (span === 0) return a;
    const u = (tt - ta) / span;
    return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
  };
  const a1 = lerp(p0, p1, t0, t1);
  const a2 = lerp(p1, p2, t1, t2);
  const a3 = lerp(p2, p3, t2, t3);
  const b1 = lerp(a1, a2, t0, t2);
  const b2 = lerp(a2, a3, t1, t3);
  return lerp(b1, b2, t1, t2);
}

/** Sample a centripetal Catmull-Rom spline through `controls`, ends included. */
export function sampleSpline(controls: readonly Pt[], stepsPerSpan = STEPS_PER_SPAN): Pt[] {
  const pts = dedupe(controls);
  if (pts.length < 3) return pts.map((p) => ({ ...p }));
  const out: Pt[] = [{ ...pts[0] }];
  for (let i = 0; i + 1 < pts.length; i += 1) {
    // The end tangents are reflected, so the curve leaves the first control
    // heading for the second: along the stub, which is the port normal.
    const p0 = i === 0 ? { x: 2 * pts[0].x - pts[1].x, y: 2 * pts[0].y - pts[1].y } : pts[i - 1];
    const p3 =
      i + 2 < pts.length
        ? pts[i + 2]
        : { x: 2 * pts[i + 1].x - pts[i].x, y: 2 * pts[i + 1].y - pts[i].y };
    for (let s = 1; s <= stepsPerSpan; s += 1) out.push(catmullRom(p0, pts[i], pts[i + 1], p3, s / stepsPerSpan));
  }
  return out;
}

/**
 * The spline's controls for an elbow route: both ends, both stub tips, each
 * pinned corner, and the middle of every interior leg.
 */
function controlsFor(route: readonly Pt[], pinned: ReadonlySet<number>): Pt[] {
  const n = route.length;
  const out: Pt[] = [route[0], route[1]];
  for (let i = 1; i + 1 < n - 1; i += 1) {
    // Leg i runs from corner i to corner i+1.
    if (pinned.has(i) && i > 1) out.push(route[i]);
    out.push({ x: (route[i].x + route[i + 1].x) / 2, y: (route[i].y + route[i + 1].y) / 2 });
  }
  out.push(route[n - 2], route[n - 1]);
  return out;
}

function inside(r: Rect, p: Pt): boolean {
  return p.x > r.minX && p.x < r.maxX && p.y > r.minY && p.y < r.maxY;
}

/** The first sample, if any, that enters one of the boxes. Ends are allowed to touch. */
export function intrusion(samples: readonly Pt[], boxes: readonly Rect[]): number {
  for (let i = 1; i + 1 < samples.length; i += 1) {
    for (const r of boxes) if (inside(r, samples[i])) return i;
  }
  return -1;
}

/** Round an elbow route's corners by sampling a quadratic at each, for the fallback. */
function roundedElbows(route: readonly Pt[], radius: number): Pt[] {
  if (route.length < 3) return route.map((p) => ({ ...p }));
  const out: Pt[] = [{ ...route[0] }];
  for (let i = 1; i + 1 < route.length; i += 1) {
    const prev = route[i - 1];
    const corner = route[i];
    const next = route[i + 1];
    const inLen = Math.hypot(corner.x - prev.x, corner.y - prev.y);
    const outLen = Math.hypot(next.x - corner.x, next.y - corner.y);
    const r = Math.min(radius, inLen * 0.49, outLen * 0.49);
    if (!(r > 0.5)) {
      out.push({ ...corner });
      continue;
    }
    const a = { x: corner.x + ((prev.x - corner.x) / inLen) * r, y: corner.y + ((prev.y - corner.y) / inLen) * r };
    const b = { x: corner.x + ((next.x - corner.x) / outLen) * r, y: corner.y + ((next.y - corner.y) / outLen) * r };
    for (let s = 0; s <= 6; s += 1) {
      const t = s / 6;
      const u = 1 - t;
      out.push({ x: u * u * a.x + 2 * u * t * corner.x + t * t * b.x, y: u * u * a.y + 2 * u * t * corner.y + t * t * b.y });
    }
  }
  out.push({ ...route[route.length - 1] });
  return out;
}

/**
 * A curve over an elbow route that stays out of `boxes`.
 *
 * `boxes` are the obstacles' own boxes grown by the clearance the curve must
 * keep (not the router's full margin, which the elbow route already keeps).
 */
export function fitCurve(route: readonly Pt[], boxes: readonly Rect[] = []): Pt[] {
  if (route.length < 3) return route.map((p) => ({ ...p }));
  if (route.length === 3) {
    // One corner and no stubs to fit through: a quadratic through it.
    return roundedElbows(route, Infinity);
  }
  const pinned = new Set<number>();
  for (let attempt = 0; attempt <= MAX_REFITS; attempt += 1) {
    const samples = sampleSpline(controlsFor(route, pinned));
    const hit = intrusion(samples, boxes);
    if (hit < 0) return samples;
    // Pin the unpinned interior corner nearest to the intrusion.
    let best = -1;
    let bestDist = Infinity;
    for (let i = 2; i <= route.length - 3; i += 1) {
      if (pinned.has(i)) continue;
      const d = Math.hypot(route[i].x - samples[hit].x, route[i].y - samples[hit].y);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    if (best < 0) break;
    pinned.add(best);
  }
  // Every corner is pinned and the curve still clips something: the elbow
  // route itself, softened, is clear by construction.
  return roundedElbows(route, 24);
}
