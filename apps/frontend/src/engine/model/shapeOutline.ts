/**
 * The outline of a shape, as points.
 *
 * Three parts of the app need to know what shape a hexagon is: the renderer
 * (which asks Konva's primitives), the SVG exporter (which had its own copy of
 * the trigonometry), and now the effect layers — an inside stroke has to clip
 * to the shape, and an inner shadow has to fill everything that is *not* the
 * shape. Two copies had already drifted apart into different files; a third
 * would be the one that finally disagreed.
 *
 * So the outline is described once, here, in terms of the node's own box. The
 * exporter turns it into an SVG `points` attribute and the effect layers turn
 * it into a `Path2D`; neither of them does any trigonometry of its own.
 *
 * ## The angles match Konva, deliberately
 *
 * `RegularPolygon` and `Star` both start their first vertex at twelve o'clock
 * and run clockwise. A description that started anywhere else would draw a
 * hexagon rotated by half a face relative to the one Konva paints, and the
 * effect layers would clip a *different* hexagon from the one on screen — a
 * discrepancy that shows up as a stroke sliding out from under its own shape.
 *
 * ## Radii are per-axis
 *
 * Konva's polygon primitives take one radius, so the renderer builds them on a
 * square and stretches the node to the box. That stretch is baked in here as
 * separate `rx`/`ry` instead, which produces identical geometry and spares
 * every consumer from having to know about the intermediate square.
 */

import type { BezierGeometry, Point, ShapeNode } from './schema';
import { fromAnchors, type Anchor } from './pathGeometry';
import { roundPathCorners } from './roundCorners';
import { runPoints } from './lineEnds';

export function regularPolygonPoints(
  cx: number,
  cy: number,
  sides: number,
  rx: number,
  ry: number
): Point[] {
  const points: Point[] = [];
  for (let i = 0; i < sides; i++) {
    const angle = (i * 2 * Math.PI) / sides - Math.PI / 2;
    points.push({ x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) });
  }
  return points;
}

export function starPoints(
  cx: number,
  cy: number,
  numPoints: number,
  innerRatio: number,
  rx: number,
  ry: number
): Point[] {
  const points: Point[] = [];
  for (let i = 0; i < numPoints * 2; i++) {
    // Even indices are the star's tips, odd ones the valleys between them.
    const scale = i % 2 === 0 ? 1 : innerRatio;
    const angle = (i * Math.PI) / numPoints - Math.PI / 2;
    points.push({ x: cx + rx * scale * Math.cos(angle), y: cy + ry * scale * Math.sin(angle) });
  }
  return points;
}

/**
 * What a shape's outline is, without saying how to draw it.
 *
 * A discriminated union rather than "always a point list", because a rectangle
 * has corner radii and an ellipse is a curve — approximating either as a
 * polygon would put visible facets on a large circle and square off every
 * rounded corner in an inside stroke.
 */
export type ShapeOutline =
  | { kind: 'rect'; x: number; y: number; width: number; height: number; radius: number }
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number }
  | { kind: 'polygon'; points: Point[] }
  /**
   * A curved outline that is neither a rectangle nor an ellipse.
   *
   * The heart is the first, and the reason this exists rather than a dense
   * polygon: a shape sampled into line segments is smooth at the size you
   * chose the sample count for and faceted at every other, and a canvas whose
   * whole premise is infinite zoom has no such size. Every consumer already
   * had to branch on `rect` and `ellipse` for exactly this reason; one more
   * branch buys real curves for every curved shape added after this.
   */
  | { kind: 'bezier'; geometry: BezierGeometry }
  /** An open run, corner to corner of the box. A line or an arrow. */
  | { kind: 'open'; points: Point[] };

/**
 * A heart, as six cubic segments in a unit box.
 *
 * Written as ratios so it stretches with the node the way every other shape
 * here does — a heart drawn in a wide box should be a wide heart, not a square
 * one floating in the middle.
 *
 * The two lobes are deliberately *not* mirror images produced by reflecting
 * three segments: the cusp between them needs its own two handles to meet
 * cleanly, and a reflection has to special-case that anyway. Six segments
 * written out is shorter than the code that would avoid writing them.
 */
const HEART_UNIT: ReadonlyArray<{ p: Point; in: Point; out: Point }> = [
  // The tip, where both sides meet.
  { p: { x: 0.5, y: 0.94 }, in: { x: 0.5, y: 0.94 }, out: { x: 0.5, y: 0.94 } },
  // Down the left side to the widest point.
  { p: { x: 0.04, y: 0.34 }, in: { x: 0.04, y: 0.63 }, out: { x: 0.04, y: 0.14 } },
  // Over the top of the left lobe.
  { p: { x: 0.27, y: 0.05 }, in: { x: 0.13, y: 0.05 }, out: { x: 0.41, y: 0.05 } },
  // The cusp between the lobes.
  { p: { x: 0.5, y: 0.24 }, in: { x: 0.46, y: 0.13 }, out: { x: 0.54, y: 0.13 } },
  // Over the top of the right lobe.
  { p: { x: 0.73, y: 0.05 }, in: { x: 0.59, y: 0.05 }, out: { x: 0.87, y: 0.05 } },
  // Down the right side and back to the tip.
  { p: { x: 0.96, y: 0.34 }, in: { x: 0.96, y: 0.14 }, out: { x: 0.96, y: 0.63 } },
];

/** The heart scaled into a `w` by `h` box, as anchors. */
export function heartAnchors(w: number, h: number): Anchor[] {
  return HEART_UNIT.map((a) => ({
    x: a.p.x * w,
    y: a.p.y * h,
    inX: a.in.x * w,
    inY: a.in.y * h,
    outX: a.out.x * w,
    outY: a.out.y * h,
  }));
}

/**
 * A squircle (superellipse / continuous-curvature rectangle) scaled into a
 * `w` by `h` box as four cubic bezier anchors, oriented clockwise from 12 o'clock.
 *
 * For a standard circle, the handle length ratio is KAPPA ≈ 0.5523.
 * For a squircle, the handle ratio ≈ 0.8604 produces the signature continuous-curvature
 * Apple-grade superellipse with zero abrupt inflection points.
 */
export function squircleAnchors(w: number, h: number, curvature = 0.8604): Anchor[] {
  const rx = w / 2;
  const ry = h / 2;
  const cx = rx;
  const cy = ry;
  const hx = rx * curvature;
  const hy = ry * curvature;

  return [
    { x: cx, y: cy - ry, inX: cx - hx, inY: cy - ry, outX: cx + hx, outY: cy - ry },
    { x: cx + rx, y: cy, inX: cx + rx, inY: cy - hy, outX: cx + rx, outY: cy + hy },
    { x: cx, y: cy + ry, inX: cx + hx, inY: cy + ry, outX: cx - hx, outY: cy + ry },
    { x: cx - rx, y: cy, inX: cx - rx, inY: cy + hy, outX: cx - rx, outY: cy - hy },
  ];
}

/**
 * The outline of a shape node, in the node's own local coordinates.
 *
 * Local, not world: everything that consumes this is drawing inside the node's
 * own Konva group, whose origin is already the node's top-left. The SVG
 * exporter, which does work in world coordinates, translates the result.
 */
export function shapeOutline(node: Pick<ShapeNode, 'geometry' | 'width' | 'height' | 'appearance'>): ShapeOutline {
  const w = node.width;
  const h = node.height;
  const cx = w / 2;
  const cy = h / 2;

  if (node.geometry.kind === 'rect') {
    // Clamped to half the shorter side. A radius larger than that draws a
    // rectangle with corners that overlap each other, which Canvas2D renders
    // as a shape turned inside out at the joins.
    const radius = Math.max(0, Math.min(node.appearance?.cornerRadius ?? 0, Math.min(w, h) / 2));
    return { kind: 'rect', x: 0, y: 0, width: w, height: h, radius };
  }

  if (node.geometry.kind === 'ellipse') {
    return { kind: 'ellipse', cx, cy, rx: w / 2, ry: h / 2 };
  }

  if (node.geometry.kind === 'squircle') {
    return { kind: 'bezier', geometry: fromAnchors(squircleAnchors(w, h), true) };
  }

  const radius = Math.max(0, node.appearance?.cornerRadius ?? 0);

  if (node.geometry.kind === 'heart') {
    return { kind: 'bezier', geometry: rounded(fromAnchors(heartAnchors(w, h), true), radius) };
  }

  if (node.geometry.kind === 'star') {
    const points = starPoints(cx, cy, node.geometry.points ?? 5, node.geometry.innerRatio ?? 0.5, w / 2, h / 2);
    return radius > 0
      ? { kind: 'bezier', geometry: rounded(polygonGeometry(points), radius) }
      : { kind: 'polygon', points };
  }

  if (node.geometry.kind === 'line' || node.geometry.kind === 'arrow') {
    // Corner to corner. The other diagonal is reached by flipping the node,
    // which `scaleX`/`scaleY` already express — so a line needs no direction
    // of its own, and `width`/`height` stay the only record of its extent.
    //
    // The *profile* decides what happens between those two corners. Straight
    // returns exactly the two points, so nothing already on a board moves.
    // Between the *stored* endpoints, which for a legacy line are still the
    // box corners — `localRunEnds` answers both forms, so nothing here has to
    // know which one it is looking at.
    // `runPoints` answers every storage form -- a run of vertices with bends,
    // the two-point pair, and the legacy box -- so the marquee, the hit test
    // and the exporter frame the shape that is actually drawn.
    return { kind: 'open', points: runPoints(node) };
  }

  const points = regularPolygonPoints(cx, cy, node.geometry.points ?? 3, w / 2, h / 2);
  return radius > 0
    ? { kind: 'bezier', geometry: rounded(polygonGeometry(points), radius) }
    : { kind: 'polygon', points };
}

/** A straight-sided closed path, as the bezier form the rounder works on. */
function polygonGeometry(points: Point[]): BezierGeometry {
  return { kind: 'bezier', closed: true, segments: points.map((p) => ({ x: p.x, y: p.y })) };
}

/**
 * Corner rounding, applied only where it would do something.
 *
 * Returning the geometry untouched at zero keeps the common case free of the
 * whole cubic walk — and keeps a shape with no radius on the exact same points
 * it has always had, so nothing shifts by a rounding error the first time this
 * function is introduced.
 */
function rounded(geo: BezierGeometry, radius: number): BezierGeometry {
  return radius > 0 ? roundPathCorners(geo, radius) : geo;
}

/** `x,y x,y ...`, the form an SVG `<polygon points>` attribute wants. */
export function pointsAttribute(points: Point[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(' ');
}
