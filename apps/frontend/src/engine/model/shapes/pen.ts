/**
 * The pen every shape is drawn with.
 *
 * ## Why a builder, and not more anchors
 *
 * The shapes in this product were authored as `Anchor[]` — a position plus the
 * control point of the curve *arriving* and the one *leaving*. That form is
 * right for an editor, which drags one anchor's two handles, and it is a trap
 * for an author, because every curve's two controls are written on two
 * different objects. Getting one of them onto the wrong side is invisible in
 * the source and obvious on the screen, and it had happened in the shipped set
 * more than once: the donut's hole and the gear's bore both carried a ring
 * whose handles were swapped end for end, and both drew a **diamond** where a
 * circle was meant.
 *
 * A pen has no sides to confuse. `curveTo` takes both controls of the one
 * curve it draws, in the order they are read, exactly as an SVG `C` command
 * does — so a curve is either right or wrong on the line that writes it, and
 * nothing about it can be right on one line and wrong three lines later.
 *
 * ## The closing curve
 *
 * `BezierGeometry` stores the curve arriving at anchor *i* on segment *i*,
 * which for a closed path means the run home from the last anchor is stored on
 * segment **0**. That is a real wrinkle and it is the reason this module
 * exists rather than a bare array literal: `close()` folds the final curve
 * into segment 0 for you, including the case where the path was drawn all the
 * way back to its starting point and the last anchor is a duplicate of the
 * first.
 *
 * Everything here is pure and unit-free. A shape is drawn in the node's own
 * box, top-left origin, and nothing in this file knows what a node is.
 */

import type { BezierGeometry, BezierSegment, CompoundGeometry, Point } from '../schema';
import { contourBounds, mapPath, type ContourGeometry } from '../pathGeometry';

/** `4/3 · (√2 − 1)` — the handle length that puts a cubic quarter-arc on the circle. */
export const KAPPA = 0.5522847498307936;

/** Two positions closer than this are the same point at any zoom this canvas offers. */
const EPS = 1e-9;

/**
 * A path under construction.
 *
 * Held as the stored form directly rather than converted at the end: there is
 * one representation in play, so there is nothing to keep in step.
 */
export class Pen {
  private segments: BezierSegment[] = [];

  /** Where the pen is, which is the anchor the next curve leaves from. */
  private get here(): Point {
    const last = this.segments[this.segments.length - 1];
    return last ? { x: last.x, y: last.y } : { x: 0, y: 0 };
  }

  moveTo(x: number, y: number): this {
    this.segments = [{ x, y }];
    return this;
  }

  lineTo(x: number, y: number): this {
    this.segments.push({ x, y });
    return this;
  }

  /** A cubic, written the way SVG writes one: both controls, then the endpoint. */
  curveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): this {
    this.segments.push({ x, y, cp1x: c1x, cp1y: c1y, cp2x: c2x, cp2y: c2y });
    return this;
  }

  /** A quadratic, raised to the cubic the stored form holds. */
  quadTo(cx: number, cy: number, x: number, y: number): this {
    const { x: x0, y: y0 } = this.here;
    return this.curveTo(
      x0 + (2 / 3) * (cx - x0),
      y0 + (2 / 3) * (cy - y0),
      x + (2 / 3) * (cx - x),
      y + (2 / 3) * (cy - y),
      x,
      y
    );
  }

  /**
   * An elliptical arc, swept from `a0` to `a1` about `(cx, cy)`.
   *
   * Angles are radians, measured the way `Math.cos`/`Math.sin` measure them,
   * so zero is three o'clock and a positive sweep runs clockwise on a screen
   * whose y axis points down. The sweep is cut into pieces of at most a
   * quarter turn, because the cubic approximation to an arc is only accurate
   * to a fifth of a pixel out to about that much and visibly loose past it.
   *
   * If the pen is not already at the arc's start the gap is closed with a
   * straight line, which is what makes `lineTo`/`arc` alternation read like
   * the drawing it produces.
   */
  arc(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number): this {
    const sweep = a1 - a0;
    if (Math.abs(sweep) < EPS) return this;

    const at = (a: number): Point => ({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
    const start = at(a0);
    if (this.segments.length === 0) this.moveTo(start.x, start.y);
    else if (Math.hypot(start.x - this.here.x, start.y - this.here.y) > EPS) {
      this.lineTo(start.x, start.y);
    }

    const pieces = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2)));
    const step = sweep / pieces;
    // The handle length for a cubic spanning `step` radians of a unit circle.
    // Reduces to KAPPA at a quarter turn, which is the identity worth knowing
    // when reading this: nothing here is a fitted constant.
    const k = (4 / 3) * Math.tan(step / 4);

    for (let i = 0; i < pieces; i++) {
      const from = a0 + step * i;
      const to = from + step;
      const p0 = at(from);
      const p1 = at(to);
      // The tangent of the ellipse at an angle, scaled by the handle length.
      const t0 = { x: -rx * Math.sin(from) * k, y: ry * Math.cos(from) * k };
      const t1 = { x: -rx * Math.sin(to) * k, y: ry * Math.cos(to) * k };
      this.curveTo(p0.x + t0.x, p0.y + t0.y, p1.x - t1.x, p1.y - t1.y, p1.x, p1.y);
    }
    return this;
  }

  /**
   * The path, closed.
   *
   * A path drawn back to its own starting point ends with a duplicate anchor;
   * that anchor is dropped and its curve becomes the closing one, so the join
   * at the start point is a single smooth curve rather than a zero-length
   * segment sitting on top of it. A path that stops short simply closes with a
   * straight run home, which is what leaving `segments[0]` without controls
   * means.
   */
  close(): BezierGeometry {
    const segs = this.segments;
    if (segs.length > 1) {
      const first = segs[0];
      const last = segs[segs.length - 1];
      if (Math.hypot(last.x - first.x, last.y - first.y) < EPS) {
        segs.pop();
        segs[0] = { ...first, cp1x: last.cp1x, cp1y: last.cp1y, cp2x: last.cp2x, cp2y: last.cp2y };
      }
    }
    return { kind: 'bezier', segments: segs, closed: true };
  }

  /** The path, left open. Only lines and arrows want this. */
  open(): BezierGeometry {
    return { kind: 'bezier', segments: this.segments, closed: false };
  }
}

export const pen = () => new Pen();

/**
 * A full ellipse as one closed contour, with the winding stated out loud.
 *
 * The single most useful function in this module, because a hole is not a
 * different shape from a disc — it is the same contour wound the other way,
 * and every hole in this product had been hand-written as its own set of
 * anchors. Two of them were written wrong. There is now one of these, it takes
 * a direction, and nothing else in the shape set draws a ring.
 *
 * `dir` is `'cw'` for an outer contour and `'ccw'` for a hole. Both fill rules
 * this app uses (`evenodd` on the canvas, `evenodd` in the export) are
 * indifferent to winding, so the direction is not what makes the hole a hole —
 * but a consistent one is what makes a boolean operation, a stroke outline and
 * a path editor agree about which side of the curve is inside.
 */
export function ellipseContour(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  dir: 'cw' | 'ccw' = 'cw'
): BezierGeometry {
  // From twelve o'clock, which is where the polygon and star primitives start
  // too, so a flattened circle and a flattened hexagon wind together.
  const from = -Math.PI / 2;
  const to = dir === 'cw' ? from + Math.PI * 2 : from - Math.PI * 2;
  return pen().arc(cx, cy, rx, ry, from, to).close();
}

/** A closed run of straight edges. */
export function polygonContour(points: readonly Point[]): BezierGeometry {
  return { kind: 'bezier', closed: true, segments: points.map((p) => ({ x: p.x, y: p.y })) };
}

/** Several contours as one shape — a disc with a hole, a gear with a bore. */
export function compound(...subpaths: BezierGeometry[]): CompoundGeometry {
  return { kind: 'compound', subpaths };
}

/**
 * A polygon with its corners cut to arcs.
 *
 * Distinct from `roundPathCorners`, which softens the corners of an arbitrary
 * outline after the fact and has to *find* them first. Here the corners are
 * known — they are the vertices — so each one is a tangent trim and a single
 * arc-accurate cubic, which is both exact and cheaper.
 *
 * The radius at a vertex is held to half the shorter of its two edges, so a
 * generous radius on a shape with one short edge rounds that edge away instead
 * of turning it inside out.
 */
export function roundedPolygonContour(
  points: readonly Point[],
  radius: number | readonly number[]
): BezierGeometry {
  const n = points.length;
  if (n < 3) return polygonContour(points);
  const radiusAt = (i: number) => (typeof radius === 'number' ? radius : (radius[i] ?? 0));
  if (points.every((_, i) => radiusAt(i) <= 0)) return polygonContour(points);

  const p = pen();
  let started = false;

  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n];
    const here = points[i];
    const next = points[(i + 1) % n];

    const inLen = Math.hypot(here.x - prev.x, here.y - prev.y);
    const outLen = Math.hypot(next.x - here.x, next.y - here.y);
    const r = Math.min(radiusAt(i), inLen / 2, outLen / 2);

    if (r <= EPS || inLen < EPS || outLen < EPS) {
      if (!started) { p.moveTo(here.x, here.y); started = true; } else p.lineTo(here.x, here.y);
      continue;
    }

    // Where the straight edges stop, and where they start again.
    const a = { x: here.x + ((prev.x - here.x) / inLen) * r, y: here.y + ((prev.y - here.y) / inLen) * r };
    const b = { x: here.x + ((next.x - here.x) / outLen) * r, y: here.y + ((next.y - here.y) / outLen) * r };

    if (!started) { p.moveTo(a.x, a.y); started = true; } else p.lineTo(a.x, a.y);
    // A quadratic through the vertex is the exact circular fillet for equal
    // trims to within a hair, and it is the construction every drawing program
    // uses for a mitre-to-round. Raised to a cubic by `quadTo`.
    p.quadTo(here.x, here.y, b.x, b.y);
  }

  return p.close();
}

/**
 * The points of a regular polygon, first vertex at twelve o'clock, clockwise.
 *
 * Inscribed in the ellipse `rx`/`ry` about `(cx, cy)`. Callers that want the
 * polygon to *fill* a box put the result through `fitToBox`.
 */
export function regularPolygonPoints(
  cx: number,
  cy: number,
  sides: number,
  rx: number,
  ry: number
): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i * 2 * Math.PI) / sides - Math.PI / 2;
    out.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
  }
  return out;
}

/** A star's tips and valleys, first tip at twelve o'clock, clockwise. */
export function starPoints(
  cx: number,
  cy: number,
  numPoints: number,
  innerRatio: number,
  rx: number,
  ry: number
): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < numPoints * 2; i++) {
    const scale = i % 2 === 0 ? 1 : innerRatio;
    const a = (i * Math.PI) / numPoints - Math.PI / 2;
    out.push({ x: cx + rx * scale * Math.cos(a), y: cy + ry * scale * Math.sin(a) });
  }
  return out;
}

/**
 * Stretch a point list so its bounds are exactly the given box.
 *
 * ## Why every polygon here goes through this
 *
 * A regular polygon inscribed in a circle does not fill its own square. A
 * pentagon reaches twelve o'clock and stops at 90% of the way down; a triangle
 * uses three quarters of its height and 87% of its width. So a triangle drawn
 * by dragging a 200×200 box was a triangle in a 173×150 box floating inside
 * it, with a band of empty air along the bottom that belonged to the object as
 * far as selection, snapping and connectors were concerned. An arrow pointed
 * at its left edge landed in that air.
 *
 * Filling the box is what every canvas tool does and what eight resize handles
 * imply. It costs one affine map, and it makes the silhouette and the bounds
 * the same statement — which is the whole reason `shapePerimeter` can project
 * a connector onto the outline at all.
 */
export function fitToBox(points: readonly Point[], w: number, h: number): Point[] {
  if (points.length === 0) return [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const sx = maxX - minX > EPS ? w / (maxX - minX) : 1;
  const sy = maxY - minY > EPS ? h / (maxY - minY) : 1;
  return points.map((p) => ({ x: (p.x - minX) * sx, y: (p.y - minY) * sy }));
}

/**
 * Stretch a whole contour so its bounds are exactly the given box.
 *
 * `fitToBox` does this for a point list; this does it for one that has curves
 * in it, and it exists for one specific reason: **rounding a corner moves it
 * inward**. A shield's bottom point and a package's six vertices all sit on
 * the box's edge, and softening them — which is what makes both read as
 * objects rather than as crystals — pulls the silhouette off the boundary by
 * the fillet's own sagitta. A couple of units on a 120px shape, invisible
 * alone, and a shape that no longer fills its own bounds.
 *
 * Measured from the flattened curve rather than the control points, so a curve
 * that bulges past its own handles is inside the box too.
 */
export function fitContour<T extends ContourGeometry>(geo: T, w: number, h: number): T {
  const b = contourBounds(geo);
  if (b.width < EPS || b.height < EPS) return geo;
  const sx = w / b.width;
  const sy = h / b.height;
  if (Math.abs(sx - 1) < 1e-9 && Math.abs(sy - 1) < 1e-9 && Math.abs(b.x) < 1e-9 && Math.abs(b.y) < 1e-9) {
    return geo;
  }
  return mapPath(geo, (p) => ({ x: (p.x - b.x) * sx, y: (p.y - b.y) * sy }));
}

/** Held between two bounds. Written out because it is used on nearly every line below. */
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * A length that is a share of the box but never smaller or larger than it reads.
 *
 * The detail sizes in this set — a rack's LED, a browser's dot, a chip's pin —
 * are all of this shape: proportional in the middle of the range, and pinned
 * at both ends so a 40px shape does not carry an invisible one-pixel dot and a
 * 2000px one does not carry a dinner plate.
 */
export const scaled = (share: number, lo: number, hi: number) => clamp(share, lo, hi);
