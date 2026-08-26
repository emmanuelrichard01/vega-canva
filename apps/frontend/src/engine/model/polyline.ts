/**
 * A line with more than two ends.
 *
 * ## What this adds, and what it deliberately does not
 *
 * A line here has always been exactly two points with an optional *profile*
 * between them — wavy, zigzag, coil. That covers "an arrow from this box to
 * that one" and nothing else: the moment a line has to go around something, or
 * turn a corner, or trace a route, two points is not a limitation you work
 * around, it is a different tool. Every editor people arrive from — Excalidraw,
 * Figma, Illustrator — treats a line as a *run of vertices*, drawn by clicking
 * once per corner and reshaped afterwards by dragging those vertices.
 *
 * So a line gains `vertices` and, per segment, a `bend`. Two points remains
 * exactly what it was: `a`/`b` are still the storage for a two-point line, this
 * is the general form, and one reader — `localVertices` — answers both plus the
 * legacy corner-to-corner box. Three representations of "where does this line
 * go" would be two too many; three *storage* forms behind one reader is the
 * arrangement that already lets a line drawn last year still open.
 *
 * **Profiles stay a two-point feature.** A wave is defined along a run from A
 * to B, and a five-vertex line has four runs — so a "wavy multi-point line"
 * would have to mean either four independent waves whose crests do not meet at
 * the corners, or one wave along a path that bends underneath it. The first
 * looks broken and the second is a re-derivation of arc length this module has
 * no business owning. A multi-point line's shape is its vertices and its bends;
 * the profile control is *hidden* rather than ignored, because a control that
 * does nothing is the failure this codebase names most often.
 *
 * ## Why a bend is two numbers in the chord's own frame
 *
 * A bent segment is a quadratic Bézier, and the handle you drag is the point
 * the curve actually passes through at its middle — not the Bézier's control
 * point, which sits twice as far out and would therefore never be under your
 * pointer.
 *
 * That point is stored **relative to the chord**: `u` along it, `v` across it,
 * both as fractions of the chord's length. Absolute coordinates would be
 * simpler to compute and wrong to store, because dragging either endpoint of a
 * bent segment would leave the bend behind — the curve would slew sideways
 * instead of following the corner it belongs to. In chord space a bend is
 * invariant under moving, rotating, scaling or flipping the segment, which is
 * the same reason gradients here are stored in unit space.
 *
 * Absent is straight. Not `{ u: 0.5, v: 0 }` — that is a second way to write
 * the common case, and two spellings of "no bend" is one chance for a straight
 * segment to fail an equality check somewhere.
 *
 * Everything here is pure. Points in, points out.
 */

import type { Point } from './schema';

/**
 * Where a segment's curve handle sits, in the chord's own frame.
 *
 * `u` runs along the chord (0 at the start vertex, 1 at the end), `v` across it,
 * both as fractions of the chord's length. Across means along `(−dy, dx)`, the
 * chord's direction turned a quarter turn — which on a canvas, where `y` grows
 * downward, is the **right-hand** side of travel. Positive `v` on a
 * left-to-right segment bows it downward.
 */
export interface Bend {
  u: number;
  v: number;
}

/** The `bends` list: one slot per segment. `null` is a straight segment. */
export type Bends = Array<Bend | null>;

/** World units per sample along a bent segment. The same figure `linePath` uses. */
const UNITS_PER_SAMPLE = 6;
const MIN_STEPS = 8;
const MAX_STEPS = 96;

/** How far across its own chord a bend may be pulled. */
export const MAX_BEND = 4;

/** A line keeps at least this many vertices, or it is not a line. */
export const MIN_VERTICES = 2;

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/**
 * The chord's frame: its direction, its normal, and its length.
 *
 * `null` for a segment with no length. Not a defensive flourish — two clicks in
 * the same place produce one, and every ratio below divides by it.
 */
function frame(
  a: Point,
  b: Point
): { ux: number; uy: number; nx: number; ny: number; length: number } | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return null;
  const ux = dx / length;
  const uy = dy / length;
  return { ux, uy, nx: -uy, ny: ux, length };
}

/**
 * Where the curve handle for this segment is drawn.
 *
 * The chord's midpoint when the segment is straight, which is what makes the
 * handle discoverable: every segment has one, in the place anyone would reach
 * for it, and dragging it is what *creates* the bend rather than what reveals
 * an existing one.
 */
export function bendPoint(a: Point, b: Point, bend: Bend | null | undefined): Point {
  const f = frame(a, b);
  if (!f) return { x: a.x, y: a.y };
  const u = bend ? bend.u : 0.5;
  const v = bend ? bend.v : 0;
  return {
    x: a.x + f.ux * u * f.length + f.nx * v * f.length,
    y: a.y + f.uy * u * f.length + f.ny * v * f.length,
  };
}

/**
 * The bend a handle dragged to `p` describes.
 *
 * `null` when the result is close enough to the chord's midpoint to be
 * straight, so letting a handle go roughly where it started restores an exactly
 * straight segment rather than one bent by a thousandth. A curve nobody can see
 * but every export samples at ninety-six points is worse than no curve.
 */
export function bendFromPoint(a: Point, b: Point, p: Point): Bend | null {
  const f = frame(a, b);
  if (!f) return null;
  const dx = p.x - a.x;
  const dy = p.y - a.y;
  const u = (dx * f.ux + dy * f.uy) / f.length;
  const v = clamp((dx * f.nx + dy * f.ny) / f.length, -MAX_BEND, MAX_BEND);
  if (Math.abs(v) < 0.01 && Math.abs(u - 0.5) < 0.02) return null;
  return { u, v };
}

/**
 * The quadratic control point for a segment whose curve passes through its bend.
 *
 * A quadratic at `t = 0.5` is `(A + 2Q + B) / 4`, so the control that puts the
 * curve through a chosen midpoint is `2·mid − (A + B) / 2`. Written once
 * because the sampler, the splitter and the exporter all need it, and three
 * spellings of it is three chances for the drawn curve and the exported curve
 * to differ.
 */
export function controlPoint(a: Point, b: Point, bend: Bend | null | undefined): Point | null {
  if (!bend) return null;
  const mid = bendPoint(a, b, bend);
  return { x: 2 * mid.x - (a.x + b.x) / 2, y: 2 * mid.y - (a.y + b.y) / 2 };
}

/** One segment, sampled. A straight segment is its two endpoints, exactly. */
export function segmentPoints(a: Point, b: Point, bend: Bend | null | undefined): Point[] {
  const control = controlPoint(a, b, bend);
  if (!control) return [a, b];

  const f = frame(a, b);
  // Stepped by the chord rather than by the arc: close enough over the range a
  // bend can reach, and it does not need the arc length it is trying to sample.
  /**
   * Always an even number of steps, so `t = 0.5` is one of the samples.
   *
   * Which means the drawn polyline passes *exactly* through the handle rather
   * than within half a sample of it. Small, and it is the difference between a
   * handle that sits on its curve at every zoom and one that is visibly beside
   * it on a short segment, where the sample count is lowest.
   */
  const rough = clamp(Math.round((f?.length ?? 0) / UNITS_PER_SAMPLE), MIN_STEPS, MAX_STEPS);
  const steps = rough + (rough % 2);

  const out: Point[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const s = 1 - t;
    out.push({
      x: s * s * a.x + 2 * s * t * control.x + t * t * b.x,
      y: s * s * a.y + 2 * s * t * control.y + t * t * b.y,
    });
  }
  return out;
}

/**
 * The whole run, as drawn.
 *
 * Segments are joined without repeating the vertex between them, so the result
 * is a point list every consumer can treat as one polyline — which is what the
 * caps, the sketcher, the outline and the exporter already do for a profiled
 * line, and the reason none of them has to learn that bends exist.
 */
export function polylinePoints(vertices: readonly Point[], bends?: Bends | null): Point[] {
  if (vertices.length === 0) return [];
  if (vertices.length === 1) return [vertices[0]];

  const out: Point[] = [vertices[0]];
  for (let i = 0; i + 1 < vertices.length; i += 1) {
    const piece = segmentPoints(vertices[i], vertices[i + 1], bends?.[i] ?? null);
    // From 1: the segment's first point is the vertex already pushed.
    for (let j = 1; j < piece.length; j += 1) out.push(piece[j]);
  }
  return out;
}

/** Whether this line is more than the two-point case. */
export function isMultiPoint(vertices: readonly Point[] | undefined | null): boolean {
  return Boolean(vertices && vertices.length > 2);
}

/** Whether any segment is bent, which is the other reason a line is not straight. */
export function hasBend(bends: Bends | undefined | null): boolean {
  return Boolean(bends && bends.some((b) => b !== null && b !== undefined));
}

/**
 * Add a vertex on a segment, keeping the curve that segment already had.
 *
 * A bent segment is split with de Casteljau, which is exact: the two quadratics
 * that come out draw the same curve as the one that went in, so adding a point
 * in order to move it later does not move anything at the moment of adding.
 * Rounding the split into two straight halves would be far less code, and would
 * make the one gesture that means "I want more control here" destroy the shape
 * it was aimed at.
 */
export function insertVertex(
  vertices: readonly Point[],
  bends: Bends | undefined,
  segment: number,
  t: number
): { vertices: Point[]; bends: Bends } {
  const list = [...vertices];
  const slots = padBends(list.length, bends);

  if (segment < 0 || segment + 1 >= list.length) return { vertices: list, bends: slots };

  const a = list[segment];
  const b = list[segment + 1];
  const bend = slots[segment] ?? null;
  const at = clamp(t, 0.001, 0.999);
  const control = controlPoint(a, b, bend);

  if (!control) {
    list.splice(segment + 1, 0, { x: a.x + (b.x - a.x) * at, y: a.y + (b.y - a.y) * at });
    slots.splice(segment, 1, null, null);
    return { vertices: list, bends: slots };
  }

  // de Casteljau: two new controls, and the point on the curve between them.
  const left = { x: a.x + (control.x - a.x) * at, y: a.y + (control.y - a.y) * at };
  const right = { x: control.x + (b.x - control.x) * at, y: control.y + (b.y - control.y) * at };
  const split = { x: left.x + (right.x - left.x) * at, y: left.y + (right.y - left.y) * at };

  list.splice(segment + 1, 0, split);
  slots.splice(segment, 1, bendFromControl(a, split, left), bendFromControl(split, b, right));
  return { vertices: list, bends: slots };
}

/** The stored bend for a segment with a known quadratic control point. */
function bendFromControl(a: Point, b: Point, control: Point): Bend | null {
  // Converted through the point the curve passes through at its middle, which
  // is what is stored — `controlPoint` is this function's inverse.
  return bendFromPoint(a, b, {
    x: (a.x + 2 * control.x + b.x) / 4,
    y: (a.y + 2 * control.y + b.y) / 4,
  });
}

/**
 * Take a vertex out, joining its two neighbours with a straight segment.
 *
 * Straight, rather than an attempt to fit one curve through what two used to
 * describe: two quadratics generally have no single quadratic that matches
 * them, so any "preserved" curve would be an approximation that put the line
 * somewhere nobody had put it. Deleting a point is a request to simplify, and
 * answering it with a straight run is both what was asked for and what can be
 * predicted.
 *
 * Refuses below two vertices, because a line with one end is not a line.
 */
export function removeVertex(
  vertices: readonly Point[],
  bends: Bends | undefined,
  index: number
): { vertices: Point[]; bends: Bends } {
  const list = [...vertices];
  const slots = padBends(list.length, bends);

  if (list.length <= MIN_VERTICES || index < 0 || index >= list.length) {
    return { vertices: list, bends: slots };
  }

  list.splice(index, 1);
  if (index === 0) slots.splice(0, 1);
  else if (index === list.length) slots.splice(index - 1, 1);
  else slots.splice(index - 1, 2, null);
  return { vertices: list, bends: slots };
}

/** Move one vertex. Every bend follows its own chord, so nothing else moves. */
export function moveVertex(vertices: readonly Point[], index: number, to: Point): Point[] {
  if (index < 0 || index >= vertices.length) return [...vertices];
  const list = [...vertices];
  list[index] = { x: to.x, y: to.y };
  return list;
}

export interface SegmentHit {
  /** Which segment, named by its starting vertex. */
  index: number;
  /** How far along that segment, 0..1. */
  t: number;
  /** The point on the run itself. */
  point: Point;
  distance: number;
}

/**
 * The nearest point on the run to `p`, and which segment it is on.
 *
 * What Alt-clicking a line needs: a new vertex has to land *on* the line, and
 * on the segment the pointer was actually over, or the shape jumps at the
 * moment of adding. Bent segments are measured against their samples, so a
 * click on the outside of a curve finds the curve rather than its chord.
 */
export function nearestSegment(
  vertices: readonly Point[],
  bends: Bends | undefined,
  p: Point
): SegmentHit | null {
  if (vertices.length < 2) return null;

  let best: SegmentHit | null = null;
  for (let i = 0; i + 1 < vertices.length; i += 1) {
    const samples = segmentPoints(vertices[i], vertices[i + 1], bends?.[i] ?? null);
    const span = samples.length - 1;
    for (let j = 0; j < span; j += 1) {
      const hit = nearestOnSegment(samples[j], samples[j + 1], p);
      if (best && hit.distance >= best.distance) continue;
      // `t` along the whole segment, not along the sample, so inserting takes
      // the same parameter the splitter does.
      best = { index: i, t: (j + hit.t) / span, point: hit.point, distance: hit.distance };
    }
  }
  return best;
}

function nearestOnSegment(
  a: Point,
  b: Point,
  p: Point
): { t: number; point: Point; distance: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 1e-12) {
    return { t: 0, point: a, distance: Math.hypot(p.x - a.x, p.y - a.y) };
  }
  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared, 0, 1);
  const point = { x: a.x + dx * t, y: a.y + dy * t };
  return { t, point, distance: Math.hypot(p.x - point.x, p.y - point.y) };
}

/** A bends list the right length for these vertices, padded with straights. */
function padBends(vertexCount: number, bends: Bends | undefined): Bends {
  const out: Bends = [...(bends ?? [])];
  while (out.length < Math.max(0, vertexCount - 1)) out.push(null);
  out.length = Math.max(0, vertexCount - 1);
  return out;
}

/**
 * Whatever came out of the document, as a bends list this module can use.
 *
 * A stored array can be the wrong length after a vertex is added by one client
 * and removed by another — `geometry` is a plain value in the CRDT, so the
 * whole object is last-write-wins and a mismatched pair is reachable. A short
 * list pads with straights and a long one is cut; neither throws, because the
 * alternative to a slightly wrong curve is a line that does not render.
 */
export function normalizeBends(vertexCount: number, bends: unknown): Bends {
  const out: Bends = [];
  const source = Array.isArray(bends) ? bends : [];
  for (let i = 0; i < Math.max(0, vertexCount - 1); i += 1) {
    const raw = source[i] as { u?: unknown; v?: unknown } | null | undefined;
    if (
      raw &&
      typeof raw.u === 'number' &&
      typeof raw.v === 'number' &&
      Number.isFinite(raw.u) &&
      Number.isFinite(raw.v)
    ) {
      out.push({ u: raw.u, v: clamp(raw.v, -MAX_BEND, MAX_BEND) });
    } else {
      out.push(null);
    }
  }
  return out;
}

/** Points that survive being stored: finite, and at least two of them. */
export function normalizeVertices(raw: unknown): Point[] | null {
  if (!Array.isArray(raw)) return null;
  const out: Point[] = [];
  for (const item of raw) {
    const p = item as { x?: unknown; y?: unknown } | null;
    if (!p || typeof p.x !== 'number' || typeof p.y !== 'number') continue;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    out.push({ x: p.x, y: p.y });
  }
  return out.length >= MIN_VERTICES ? out : null;
}
