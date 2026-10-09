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
  | 'polygon'
  | 'pentagon'
  | 'hexagon'
  | 'star'
  | 'heart'
  | 'roundedRectangle'
  | 'doubleArrow'
  | 'arc'
  | 'check';

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

/** Mean nearest-point distance both ways between a stroke and a template, as a fraction of the stroke's diagonal. */
function chamfer(pts: readonly Point[], template: readonly Point[], diag: number): number {
  const nearest = (p: Point, path: readonly Point[]) => {
    let best = Infinity;
    for (let i = 1; i < path.length; i += 1) best = Math.min(best, segmentDistance(p, path[i - 1], path[i]));
    return best;
  };
  let a = 0;
  for (const p of pts) a += nearest(p, template);
  let b = 0;
  for (const p of template) b += nearest(p, pts);
  return (a / pts.length + b / template.length) / 2 / diag;
}

function meanOf(values: readonly number[]): number {
  return values.reduce((s, v) => s + v, 0) / (values.length || 1);
}

/** Coefficient of variation: spread relative to the mean. */
function spread(values: readonly number[]): number {
  const m = meanOf(values);
  if (m === 0) return Infinity;
  return Math.sqrt(meanOf(values.map((v) => (v - m) ** 2))) / Math.abs(m);
}

function centroidOf(pts: readonly Point[]): Point {
  return { x: meanOf(pts.map((p) => p.x)), y: meanOf(pts.map((p) => p.y)) };
}

/** Angle of a vertex about a centre, in radians. */
const angleAbout = (c: Point, p: Point) => Math.atan2(p.y - c.y, p.x - c.x);

/** Smallest signed difference between two angles. */
function angleDelta(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

const DEG = Math.PI / 180;

/** `phase` brought to the nearest rotation congruent to `target` modulo `period`, when within `tolerance`. */
function snapPhase(phase: number, target: number, period: number, tolerance: number): number {
  const turn = angleDelta(target, ((phase % period) + period) % period);
  const wrapped = ((turn % period) + period) % period;
  const signed = wrapped > period / 2 ? wrapped - period : wrapped;
  return Math.abs(signed) <= tolerance ? phase + signed : phase;
}

/** Vertices of a regular n-gon about `c`, the first at angle `phase`. */
function regularVertices(c: Point, radius: number, n: number, phase: number): Point[] {
  return Array.from({ length: n }, (_, i) => ({
    x: c.x + Math.cos(phase + (i * Math.PI * 2) / n) * radius,
    y: c.y + Math.sin(phase + (i * Math.PI * 2) / n) * radius,
  }));
}

/** A regular pentagon or hexagon, when the corners are evenly spread about their centre. */
function regularPolygon(poly: readonly Point[], spacing: number): Recognized | null {
  const n = poly.length;
  if (n !== 5 && n !== 6) return null;
  const c = centroidOf(poly);
  const radii = poly.map((p) => dist(p, c));
  if (spread(radii) > 0.14) return null;
  const sides = poly.map((p, i) => dist(p, poly[(i + 1) % n]));
  if (spread(sides) > 0.2) return null;
  // Each corner must sit near its own 360/n slot, going round one way.
  const base = angleAbout(c, poly[0]);
  const orientation = Math.sign(angleDelta(angleAbout(c, poly[1]), base)) || 1;
  const slot = (Math.PI * 2) / n;
  const offsets = poly.map((p, i) => angleDelta(angleAbout(c, p), base + orientation * i * slot));
  if (Math.max(...offsets.map(Math.abs)) > slot * 0.3) return null;
  const phase = base + meanOf(offsets);
  // A pentagon stands on its base; a hexagon is flat- or point-topped.
  const target = n === 5 ? -Math.PI / 2 : 0;
  const snapped = snapPhase(phase, target, slot, 10 * DEG);
  return {
    kind: n === 5 ? 'pentagon' : 'hexagon',
    points: densify(regularVertices(c, meanOf(radii), n, snapped), true, spacing),
    closed: true,
  };
}

/** A five-point star, centred and sized from the outer tips; `phase` is the first tip's angle. */
function starPoints(c: Point, outer: number, ratio: number, phase: number, spacing: number): Point[] {
  const vertices: Point[] = [];
  for (let i = 0; i < 10; i += 1) {
    const r = i % 2 === 0 ? outer : outer * ratio;
    const a = phase + (i * Math.PI) / 5;
    vertices.push({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r });
  }
  return densify(vertices, true, spacing);
}

const STAR_SLOT = (Math.PI * 2) / 5;

/**
 * A five-point star, drawn either as its outline (ten corners, tips and
 * notches alternating) or as the single self-crossing pentagram stroke.
 */
function recognizeStar(ring: readonly Point[], diag: number, spacing: number): Recognized | null {
  const outline = corners(ring, diag * 0.035);
  if (outline.length === 10) {
    const c = centroidOf(outline);
    const radii = outline.map((p) => dist(p, c));
    const even = meanOf(radii.filter((_, i) => i % 2 === 0));
    const odd = meanOf(radii.filter((_, i) => i % 2 === 1));
    const tipsAreEven = even > odd;
    const tips = outline.filter((_, i) => (i % 2 === 0) === tipsAreEven);
    const notches = outline.filter((_, i) => (i % 2 === 0) !== tipsAreEven);
    const tipR = tips.map((p) => dist(p, c));
    const notchR = notches.map((p) => dist(p, c));
    const ratio = meanOf(notchR) / meanOf(tipR);
    if (ratio < 0.3 || ratio > 0.72 || spread(tipR) > 0.2 || spread(notchR) > 0.3) return null;
    const first = angleAbout(c, tips[0]);
    const orientation = Math.sign(angleDelta(angleAbout(c, tips[1]), first)) || 1;
    const offsets = tips.map((p, i) => angleDelta(angleAbout(c, p), first + orientation * i * STAR_SLOT));
    if (Math.max(...offsets.map(Math.abs)) > 20 * DEG) return null;
    const phase = snapPhase(first + meanOf(offsets), -Math.PI / 2, STAR_SLOT, 12 * DEG);
    return { kind: 'star', points: starPoints(c, meanOf(tipR), Math.min(0.55, Math.max(0.38, ratio)), phase, spacing), closed: true };
  }

  // The pentagram: five long chords, every corner turning through ~144 degrees.
  const chords = corners(ring, diag * 0.06);
  if (chords.length === 5) {
    const turns = chords.map((b, i) => turnAngle(chords[(i + 4) % 5], b, chords[(i + 1) % 5]));
    if (turns.every((t) => t > 115)) {
      const c = centroidOf(chords);
      const radii = chords.map((p) => dist(p, c));
      if (spread(radii) > 0.12) return null;
      const phase = snapPhase(angleAbout(c, chords[0]), -Math.PI / 2, STAR_SLOT, 12 * DEG);
      return { kind: 'star', points: starPoints(c, meanOf(radii), 0.382, phase, spacing), closed: true };
    }
  }
  return null;
}

/** The classic parametric heart, mapped into a box. */
function heartTemplate(minX: number, minY: number, w: number, h: number): Point[] {
  const out: Point[] = [];
  for (let i = 0; i <= 96; i += 1) {
    const t = (i / 96) * Math.PI * 2;
    const x = 16 * Math.sin(t) ** 3;
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    out.push({ x: minX + ((x + 16) / 32) * w, y: minY + ((12 - y) / 29) * h });
  }
  return out;
}

function roundedRectTemplate(minX: number, minY: number, w: number, h: number, r: number): Point[] {
  const out: Point[] = [];
  const arc = (cx: number, cy: number, from: number) => {
    for (let i = 0; i <= 8; i += 1) {
      const a = from + (i / 8) * (Math.PI / 2);
      out.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    }
  };
  arc(minX + w - r, minY + r, -Math.PI / 2);
  arc(minX + w - r, minY + h - r, 0);
  arc(minX + r, minY + h - r, Math.PI / 2);
  arc(minX + r, minY + r, Math.PI);
  out.push({ ...out[0] });
  return out;
}

/**
 * A heart or a rounded rectangle, by template. Both are curves a corner
 * finder misreads, so they are matched as whole outlines and must beat the
 * plain ellipse fit by a clear margin before they are believed.
 */
function recognizeTemplated(ring: readonly Point[], ellipse: EllipseFit, diag: number): Recognized | null {
  const { minX, minY, w, h } = bbox(ring);
  if (w <= 0 || h <= 0) return null;
  const asEllipse = chamfer(ring, ellipsePoints(minX + w / 2, minY + h / 2, w / 2, h / 2, 0), diag);

  const aspect = w / h;
  if (aspect > 0.8 && aspect < 1.5) {
    const heart = heartTemplate(minX, minY, w, h);
    const err = chamfer(ring, heart, diag);
    if (err < HEART_MAX_ERROR && err < asEllipse * 0.6) return { kind: 'heart', points: heart, closed: true };
  }

  const side = Math.min(w, h);
  let best: { r: number; err: number } | null = null;
  for (const f of [0.12, 0.18, 0.25, 0.32]) {
    const err = chamfer(ring, roundedRectTemplate(minX, minY, w, h, side * f), diag);
    if (!best || err < best.err) best = { r: side * f, err };
  }
  if (best && best.err < ROUNDED_MAX_ERROR && best.err < asEllipse * 0.6 && best.err < ellipse.error) {
    // Square corners would sit on the box corners; a rounded stroke cuts well inside them.
    const boxCorners = [
      { x: minX, y: minY }, { x: minX + w, y: minY }, { x: minX + w, y: minY + h }, { x: minX, y: minY + h },
    ];
    const cut = meanOf(boxCorners.map((c) => Math.min(...ring.map((p) => dist(p, c))))) / side;
    if (cut > 0.07) {
      return { kind: 'roundedRectangle', points: roundedRectTemplate(minX, minY, w, h, best.r), closed: true };
    }
  }
  return null;
}

const HEART_MAX_ERROR = 0.03;
const ROUNDED_MAX_ERROR = 0.02;

/** A least-squares circle through the points (Kasa), or null when they are collinear. */
function fitCircle(pts: readonly Point[]): { cx: number; cy: number; r: number } | null {
  const c = centroidOf(pts);
  let suu = 0, suv = 0, svv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
  for (const p of pts) {
    const u = p.x - c.x, v = p.y - c.y;
    suu += u * u;
    suv += u * v;
    svv += v * v;
    suuu += u * u * u;
    svvv += v * v * v;
    suvv += u * v * v;
    svuu += v * u * u;
  }
  const det = suu * svv - suv * suv;
  if (Math.abs(det) < 1e-9) return null;
  const a = (suuu + suvv) / 2;
  const b = (svvv + svuu) / 2;
  const uc = (a * svv - b * suv) / det;
  const vc = (b * suu - a * suv) / det;
  const r = Math.sqrt(uc * uc + vc * vc + (suu + svv) / pts.length);
  return { cx: c.x + uc, cy: c.y + vc, r };
}

/** A clean circular arc, for a smooth curve that bends one way through a good part of a turn. */
function recognizeArc(pts: readonly Point[], diag: number): Recognized | null {
  const fit = fitCircle(pts);
  if (!fit || fit.r > diag * 3) return null;
  const centre = { x: fit.cx, y: fit.cy };
  const residual = meanOf(pts.map((p) => Math.abs(dist(p, centre) - fit.r))) / fit.r;
  if (residual > 0.035) return null;
  // Unwrapped sweep, which must be one-directional: a wiggle or an S is not an arc.
  let sweep = 0;
  let monotone = true;
  let sign = 0;
  for (let i = 1; i < pts.length; i += 1) {
    const d = angleDelta(angleAbout(centre, pts[i]), angleAbout(centre, pts[i - 1]));
    if (Math.abs(d) < 1e-4) continue;
    if (sign === 0) sign = Math.sign(d);
    else if (Math.sign(d) !== sign && Math.abs(d) > 4 * DEG) monotone = false;
    sweep += d;
  }
  const degrees = Math.abs(sweep) / DEG;
  if (!monotone || degrees < 70 || degrees > 320) return null;
  const start = angleAbout(centre, pts[0]);
  const out: Point[] = [];
  const steps = Math.max(8, Math.ceil(degrees / 4));
  for (let i = 0; i <= steps; i += 1) {
    const a = start + (sweep * i) / steps;
    out.push({ x: fit.cx + Math.cos(a) * fit.r, y: fit.cy + Math.sin(a) * fit.r });
  }
  return { kind: 'arc', points: out, closed: false };
}

/** A tick: a short stroke down and to the right, then a long one up and to the right. */
function recognizeCheck(v: readonly Point[], diag: number, spacing: number): Recognized | null {
  if (v.length !== 3) return null;
  const [a, b, c] = v;
  const short = dist(a, b);
  const long = dist(b, c);
  if (short < diag * 0.15 || long < short * 1.3 || long > short * 4.5) return null;
  if (!(b.x > a.x && b.y > a.y && c.x > b.x && c.y < b.y)) return null;
  const turn = turnAngle(a, b, c);
  if (turn < 60 || turn > 115) return null;
  // The short arm drops steeply, the long one climbs: neither may be near-flat.
  const down = Math.atan2(b.y - a.y, b.x - a.x) / DEG;
  const up = Math.atan2(b.y - c.y, c.x - b.x) / DEG;
  if (down < 25 || down > 85 || up < 20 || up > 80) return null;
  return { kind: 'check', points: densify([a, b, c], false, spacing), closed: false };
}

/**
 * An arrow with a head at each end: one long shaft, and a short doubled-back
 * barb or two past each of its ends.
 */
function recognizeDoubleArrow(v: readonly Point[], diag: number, spacing: number): Recognized | null {
  if (v.length < 5 || v.length > 10) return null;
  let k = 0;
  for (let i = 1; i < v.length - 1; i += 1) if (dist(v[i], v[i + 1]) > dist(v[k], v[k + 1])) k = i;
  const a = v[k];
  const b = v[k + 1];
  const shaft = dist(a, b);
  if (shaft < diag * 0.55) return null;
  // The tip is revisited between barbs; only the points off the tip are barbs.
  const before = v.slice(0, k).filter((p) => dist(p, a) > shaft * 0.06);
  const after = v.slice(k + 2).filter((p) => dist(p, b) > shaft * 0.06);
  if (before.length === 0 || after.length === 0) return null;
  const near = (tip: Point, barbs: readonly Point[]) =>
    barbs.every((p) => dist(p, tip) < shaft * 0.4);
  if (!near(a, before) || !near(b, after)) return null;
  if (turnAngle(a, b, after[0]) < 100) return null;
  if (turnAngle(b, a, before[before.length - 1]) < 100) return null;
  const tip = snapDirection(a, b, 6);
  const angle = Math.atan2(tip.y - a.y, tip.x - a.x);
  const barb = Math.min(shaft * 0.3, meanOf([...before.map((p) => dist(p, a)), ...after.map((p) => dist(p, b))]));
  const wing = (at: Point, direction: number, side: number): Point => ({
    x: at.x + Math.cos(direction + side * 28 * DEG) * barb,
    y: at.y + Math.sin(direction + side * 28 * DEG) * barb,
  });
  const back = angle + Math.PI;
  return {
    kind: 'doubleArrow',
    points: densify([wing(a, angle, -1), a, wing(a, angle, 1), a, tip, wing(tip, back, -1), tip, wing(tip, back, 1)], false, spacing),
    closed: false,
  };
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
  const double = recognizeDoubleArrow(simplifyDP(pts, diag * 0.045), diag, spacing);
  if (double) return double;
  const check = recognizeCheck(simplifyDP(pts, diag * 0.09), diag, spacing);
  if (check) return check;
  return recognizeArc(pts, diag);
}

function recognizeClosed(ring: readonly Point[], diag: number, spacing: number): Recognized | null {
  const ellipse = fitEllipse(ring);
  const star = recognizeStar(ring, diag, spacing);
  if (star) return star;
  const templated = recognizeTemplated(ring, ellipse, diag);
  if (templated) return templated;
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
  const regular = regularPolygon(poly, spacing);
  if (regular) return regular;
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
  pentagon: 'Pentagon',
  hexagon: 'Hexagon',
  star: 'Star',
  heart: 'Heart',
  roundedRectangle: 'Rounded rectangle',
  doubleArrow: 'Double arrow',
  arc: 'Arc',
  check: 'Check mark',
};
