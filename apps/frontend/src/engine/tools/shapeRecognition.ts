import type { Point } from '../model/schema';

/**
 * Hold-to-snap shape recognition for freehand strokes.
 *
 * Draw a rough circle, box, triangle, diamond, line or arrow, keep the pen
 * still at the end, and the stroke is replaced by a clean version of the
 * shape it was trying to be — drawn with the same brush, so it still looks
 * like ink rather than a stamped diagram shape.
 *
 * Everything here is pure geometry on world points. The tool decides *when*
 * to ask (a held pause); this decides *what* was drawn, or says nothing.
 * Refusing is the important half: a scribble that snapped to a circle would
 * make the pen unusable for writing, so each test demands a close fit and
 * anything ambiguous stays freehand.
 */

export type RecognizedKind =
  | 'line'
  | 'arrow'
  | 'circle'
  | 'ellipse'
  | 'square'
  | 'rectangle'
  | 'diamond'
  | 'triangle'
  | 'polygon';

export interface Recognized {
  kind: RecognizedKind;
  /** The clean centreline, in the same space as the input. */
  points: Point[];
  closed: boolean;
}

const RESAMPLE = 96;
const KAPPA_SEGMENTS = 72;

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pathLength(pts: readonly Point[]): number {
  let total = 0;
  for (let i = 1; i < pts.length; i += 1) total += dist(pts[i - 1], pts[i]);
  return total;
}

/** `n` points evenly spaced along the polyline. */
export function resample(pts: readonly Point[], n: number): Point[] {
  if (pts.length === 0) return [];
  const total = pathLength(pts);
  if (total === 0) return Array.from({ length: n }, () => ({ ...pts[0] }));
  const step = total / (n - 1);
  const out: Point[] = [{ ...pts[0] }];
  let carried = 0;
  for (let i = 1; i < pts.length && out.length < n; i += 1) {
    let a = pts[i - 1];
    const b = pts[i];
    let seg = dist(a, b);
    while (carried + seg >= step && out.length < n) {
      const t = (step - carried) / seg;
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      out.push(p);
      a = p;
      seg = dist(a, b);
      carried = 0;
    }
    carried += seg;
  }
  while (out.length < n) out.push({ ...pts[pts.length - 1] });
  return out;
}

function perpDistance(p: Point, a: Point, b: Point): number {
  const len = dist(a, b);
  if (len === 0) return dist(p, a);
  return Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / len;
}

function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

/** Douglas–Peucker on an open polyline, keeping both ends. */
export function simplifyDP(pts: readonly Point[], tolerance: number): Point[] {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = -1;
    let index = -1;
    for (let i = s + 1; i < e; i += 1) {
      const d = perpDistance(pts[i], pts[s], pts[e]);
      if (d > maxD) {
        maxD = d;
        index = i;
      }
    }
    if (maxD > tolerance && index > 0) {
      keep[index] = 1;
      stack.push([s, index], [index, e]);
    }
  }
  return pts.filter((_, i) => keep[i] === 1);
}

function bbox(pts: readonly Point[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

/** The turn at `b`, in degrees: 0 is straight on, 180 is doubling back. */
function turnAngle(a: Point, b: Point, c: Point): number {
  const ux = b.x - a.x, uy = b.y - a.y;
  const vx = c.x - b.x, vy = c.y - b.y;
  const lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
  if (lu === 0 || lv === 0) return 0;
  const cos = Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (lu * lv)));
  return (Math.acos(cos) * 180) / Math.PI;
}

/** Snap a direction to the nearest 45° when it is within `tolerance` degrees of it. */
function snapDirection(from: Point, to: Point, toleranceDeg: number): Point {
  const len = dist(from, to);
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const step = Math.PI / 4;
  const snapped = Math.round(angle / step) * step;
  if (Math.abs(snapped - angle) * (180 / Math.PI) > toleranceDeg) return to;
  return { x: from.x + Math.cos(snapped) * len, y: from.y + Math.sin(snapped) * len };
}

/** A clean polyline sampled every `spacing` units along each edge. */
function densify(vertices: readonly Point[], closed: boolean, spacing: number): Point[] {
  const ring = closed ? [...vertices, vertices[0]] : vertices.slice();
  const out: Point[] = [];
  for (let i = 1; i < ring.length; i += 1) {
    const a = ring[i - 1];
    const b = ring[i];
    const steps = Math.max(1, Math.ceil(dist(a, b) / spacing));
    for (let s = 0; s < steps; s += 1) {
      const t = s / steps;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  out.push({ ...ring[ring.length - 1] });
  return out;
}

function ellipsePoints(cx: number, cy: number, rx: number, ry: number, theta: number): Point[] {
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const out: Point[] = [];
  for (let i = 0; i <= KAPPA_SEGMENTS; i += 1) {
    const t = (i / KAPPA_SEGMENTS) * Math.PI * 2;
    const ux = Math.cos(t) * rx;
    const uy = Math.sin(t) * ry;
    out.push({ x: cx + ux * cos - uy * sin, y: cy + ux * sin + uy * cos });
  }
  return out;
}

interface EllipseFit {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  theta: number;
  error: number;
}

/** Principal-axis ellipse fit, with the mean relative radial error. */
export function fitEllipse(pts: readonly Point[]): EllipseFit {
  const n = pts.length;
  let mx = 0, my = 0;
  for (const p of pts) {
    mx += p.x;
    my += p.y;
  }
  mx /= n;
  my /= n;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of pts) {
    const dx = p.x - mx, dy = p.y - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const cos = Math.cos(theta), sin = Math.sin(theta);
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  const local = pts.map((p) => {
    const dx = p.x - mx, dy = p.y - my;
    const u = dx * cos + dy * sin;
    const v = -dx * sin + dy * cos;
    if (u < minU) minU = u;
    if (u > maxU) maxU = u;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
    return { u, v };
  });
  const rx = (maxU - minU) / 2;
  const ry = (maxV - minV) / 2;
  const cu = (maxU + minU) / 2;
  const cv = (maxV + minV) / 2;
  let error = 0;
  for (const { u, v } of local) {
    const r = Math.hypot((u - cu) / (rx || 1), (v - cv) / (ry || 1));
    error += Math.abs(r - 1);
  }
  error /= n;
  return {
    cx: mx + cu * cos - cv * sin,
    cy: my + cu * sin + cv * cos,
    rx,
    ry,
    theta,
    error,
  };
}

/** Mean distance from each point to the nearest edge of a closed polygon. */
function polygonError(pts: readonly Point[], poly: readonly Point[]): number {
  let total = 0;
  for (const p of pts) {
    let best = Infinity;
    for (let i = 0; i < poly.length; i += 1) {
      const d = segmentDistance(p, poly[i], poly[(i + 1) % poly.length]);
      if (d < best) best = d;
    }
    total += best;
  }
  return total / pts.length;
}

/** Corners of a closed stroke: simplified, with the seam and near-straight joints removed. */
function corners(ring: readonly Point[], tolerance: number): Point[] {
  // Rotate the start to the point furthest from the centroid, which is almost
  // always a corner, so the seam where the pen started is not mistaken for one.
  let cx = 0, cy = 0;
  for (const p of ring) {
    cx += p.x;
    cy += p.y;
  }
  cx /= ring.length;
  cy /= ring.length;
  let start = 0;
  let far = -1;
  ring.forEach((p, i) => {
    const d = Math.hypot(p.x - cx, p.y - cy);
    if (d > far) {
      far = d;
      start = i;
    }
  });
  const rotated = [...ring.slice(start), ...ring.slice(0, start), ring[start]];
  let simplified = simplifyDP(rotated, tolerance);
  simplified = simplified.slice(0, -1);
  // Drop joints that barely turn.
  let changed = true;
  while (changed && simplified.length > 3) {
    changed = false;
    for (let i = 0; i < simplified.length; i += 1) {
      const a = simplified[(i - 1 + simplified.length) % simplified.length];
      const b = simplified[i];
      const c = simplified[(i + 1) % simplified.length];
      if (turnAngle(a, b, c) < 30) {
        simplified.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return simplified;
}

function recognizeOpen(pts: readonly Point[], diag: number, spacing: number): Recognized | null {
  const first = pts[0];
  const last = pts[pts.length - 1];
  const chord = dist(first, last);
  const length = pathLength(pts);

  // A straight run: every point close to the chord, and little travel beyond it.
  let maxDev = 0;
  for (const p of pts) maxDev = Math.max(maxDev, perpDistance(p, first, last));
  if (chord > 0 && maxDev / chord < 0.045 && length / chord < 1.08) {
    const end = snapDirection(first, last, 6);
    return { kind: 'line', points: densify([first, end], false, spacing), closed: false };
  }

  // An arrow: a long shaft ending in a short barb that doubles back.
  const v = simplifyDP(pts, diag * 0.06);
  const head = (shaftEnd: Point, tail: Point, barbs: Point[]): Recognized | null => {
    const shaft = dist(tail, shaftEnd);
    if (shaft < diag * 0.55) return null;
    const barbLength = barbs.reduce((s, b) => s + dist(shaftEnd, b), 0) / barbs.length;
    if (barbLength > shaft * 0.5 || barbLength < shaft * 0.08) return null;
    const angle = Math.atan2(shaftEnd.y - tail.y, shaftEnd.x - tail.x);
    const tip = snapDirection(tail, shaftEnd, 6);
    const spread = (28 * Math.PI) / 180;
    const len = Math.min(barbLength, shaft * 0.35);
    const back = angle + Math.PI;
    const h1 = { x: tip.x + Math.cos(back - spread) * len, y: tip.y + Math.sin(back - spread) * len };
    const h2 = { x: tip.x + Math.cos(back + spread) * len, y: tip.y + Math.sin(back + spread) * len };
    return { kind: 'arrow', points: densify([tail, tip, h1, tip, h2], false, spacing), closed: false };
  };
  if (v.length === 3 && turnAngle(v[0], v[1], v[2]) > 115) {
    return head(v[1], v[0], [v[2]]);
  }
  if (v.length === 5 && dist(v[1], v[3]) < dist(v[0], v[1]) * 0.2) {
    if (turnAngle(v[0], v[1], v[2]) > 115 && turnAngle(v[2], v[3], v[4]) > 100) {
      return head(v[1], v[0], [v[2], v[4]]);
    }
  }
  return null;
}

function recognizeClosed(ring: readonly Point[], diag: number, spacing: number): Recognized | null {
  const ellipse = fitEllipse(ring);
  const poly = corners(ring, diag * 0.06);
  const polyErr = poly.length >= 3 ? polygonError(ring, poly) / diag : Infinity;

  const sharp =
    poly.length >= 3 &&
    poly.length <= 6 &&
    poly.every((b, i) => turnAngle(poly[(i - 1 + poly.length) % poly.length], b, poly[(i + 1) % poly.length]) > 50);

  if (sharp && polyErr < 0.03 && polyErr < ellipse.error * 0.5) {
    return polygonShape(poly, spacing);
  }

  if (ellipse.error < 0.085 && ellipse.rx > 0 && ellipse.ry > 0) {
    let { rx, ry, theta } = ellipse;
    const ratio = Math.min(rx, ry) / Math.max(rx, ry);
    const circle = ratio > 0.86;
    if (circle) rx = ry = (rx + ry) / 2;
    // Snap a nearly axis-aligned ellipse to the axes.
    const quarter = Math.PI / 2;
    const snapped = Math.round(theta / quarter) * quarter;
    if (Math.abs(snapped - theta) < (10 * Math.PI) / 180) theta = snapped;
    return {
      kind: circle ? 'circle' : 'ellipse',
      points: ellipsePoints(ellipse.cx, ellipse.cy, rx, ry, theta),
      closed: true,
    };
  }

  if (sharp && polyErr < 0.045) return polygonShape(poly, spacing);
  return null;
}

function polygonShape(poly: Point[], spacing: number): Recognized {
  if (poly.length === 4) {
    const angles = poly.map((b, i) => turnAngle(poly[(i - 1 + 4) % 4], b, poly[(i + 1) % 4]));
    const rightAngled = angles.every((a) => Math.abs(a - 90) < 22);
    if (rightAngled) {
      // A box: fit it to its principal axes, snapping to the board axes when close.
      // The box's angle from its edges: a circular mean of the edge directions
      // taken at four times the angle, so edges 90° apart agree. A principal-
      // axis fit cannot do this for a square, whose spread is the same in
      // every direction.
      let sx = 0, sy = 0;
      for (let i = 0; i < 4; i += 1) {
        const a = poly[i], b = poly[(i + 1) % 4];
        const angle = Math.atan2(b.y - a.y, b.x - a.x);
        const weight = dist(a, b);
        sx += Math.cos(angle * 4) * weight;
        sy += Math.sin(angle * 4) * weight;
      }
      let theta = Math.atan2(sy, sx) / 4;
      // A box standing on a corner is a diamond, the flowchart decision shape,
      // not a tilted square.
      const tilt = ((((theta * 180) / Math.PI) % 90) + 90) % 90;
      if (Math.abs(tilt - 45) < 14) {
        const box = bbox(poly);
        const midX = box.minX + box.w / 2;
        const midY = box.minY + box.h / 2;
        const diamond = [
          { x: midX, y: box.minY },
          { x: box.maxX, y: midY },
          { x: midX, y: box.maxY },
          { x: box.minX, y: midY },
        ];
        return { kind: 'diamond', points: densify(diamond, true, spacing), closed: true };
      }
      const quarter = Math.PI / 2;
      const snapped = Math.round(theta / quarter) * quarter;
      if (Math.abs(snapped - theta) < (9 * Math.PI) / 180) theta = snapped;
      const cos = Math.cos(theta), sin = Math.sin(theta);
      let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
      for (const p of poly) {
        const u = p.x * cos + p.y * sin;
        const v = -p.x * sin + p.y * cos;
        minU = Math.min(minU, u);
        maxU = Math.max(maxU, u);
        minV = Math.min(minV, v);
        maxV = Math.max(maxV, v);
      }
      let w = maxU - minU;
      let h = maxV - minV;
      const cu = (maxU + minU) / 2;
      const cv = (maxV + minV) / 2;
      const square = Math.min(w, h) / Math.max(w, h) > 0.88;
      if (square) w = h = (w + h) / 2;
      const local = [
        { u: cu - w / 2, v: cv - h / 2 },
        { u: cu + w / 2, v: cv - h / 2 },
        { u: cu + w / 2, v: cv + h / 2 },
        { u: cu - w / 2, v: cv + h / 2 },
      ];
      const pts = local.map(({ u, v }) => ({ x: u * cos - v * sin, y: u * sin + v * cos }));
      return { kind: square ? 'square' : 'rectangle', points: densify(pts, true, spacing), closed: true };
    }
    // A diamond: corners near the midpoints of the box's sides.
    const box = bbox(poly);
    const midX = box.minX + box.w / 2;
    const midY = box.minY + box.h / 2;
    const targets = [
      { x: midX, y: box.minY },
      { x: box.maxX, y: midY },
      { x: midX, y: box.maxY },
      { x: box.minX, y: midY },
    ];
    const tol = Math.max(box.w, box.h) * 0.18;
    const matched = targets.every((t) => poly.some((p) => dist(p, t) < tol));
    if (matched) return { kind: 'diamond', points: densify(targets, true, spacing), closed: true };
  }
  return {
    kind: poly.length === 3 ? 'triangle' : 'polygon',
    points: densify(poly, true, spacing),
    closed: true,
  };
}

/**
 * What the stroke was trying to be, or null when it is honestly freehand.
 *
 * `minSize` is the smallest stroke, in the input's units, worth recognising:
 * a tick or a dot is never a shape.
 */
export function recognizeShape(input: readonly Point[], minSize: number): Recognized | null {
  if (input.length < 4) return null;
  const box = bbox(input);
  const diag = Math.hypot(box.w, box.h);
  if (diag < minSize) return null;

  const pts = resample(input, RESAMPLE);
  const length = pathLength(pts);
  const gap = dist(pts[0], pts[pts.length - 1]);
  const spacing = Math.max(1, diag / 120);

  // Closed: the stroke came back near its start, relative to how far it went.
  if (gap < Math.max(diag * 0.22, length * 0.08)) {
    // Close the ring and drop the overlap past the start.
    return recognizeClosed(pts, diag, spacing);
  }
  return recognizeOpen(pts, diag, spacing);
}

/** A short human label for the snapped shape, for the hint near the pointer. */
export const RECOGNIZED_LABEL: Record<RecognizedKind, string> = {
  line: 'Line',
  arrow: 'Arrow',
  circle: 'Circle',
  ellipse: 'Ellipse',
  square: 'Square',
  rectangle: 'Rectangle',
  diamond: 'Diamond',
  triangle: 'Triangle',
  polygon: 'Polygon',
};
