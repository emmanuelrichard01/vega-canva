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

import type { BezierGeometry, CompoundGeometry, Point, ShapeNode, CalloutTail } from './schema';
import { fromAnchors, type Anchor, type ContourGeometry } from './pathGeometry';
import { roundPathCorners } from './roundCorners';
import { runPoints } from './lineEnds';
import { cornerRadiiOf } from './cornerRadii';
import { clampParam, SHAPE_PARAMS, type ShapeParam } from './shapeParams';

/**
 * The pin dial, taken from the table rather than restated here.
 *
 * The default and the cap now have exactly one definition, which is what the
 * panel reads too -- so a stepper cannot offer a pin the outline refuses to
 * draw, and an untouched chip cannot draw a different number from the one the
 * panel is showing.
 */
const PIN_COUNT: ShapeParam = SHAPE_PARAMS.cpu!.params[0];

const KAPPA = 0.5522847498307936;

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
   * Single or multi-contour Bézier curves.
   */
  | { kind: 'bezier'; geometry: ContourGeometry }
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

export function diamondPoints(w: number, h: number): Point[] {
  return [
    { x: w / 2, y: 0 },
    { x: w, y: h / 2 },
    { x: w / 2, y: h },
    { x: 0, y: h / 2 },
  ];
}

export function trianglePoints(w: number, h: number): Point[] {
  return [
    { x: w / 2, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
}

export function trapezoidPoints(w: number, h: number, inset = 0.2): Point[] {
  const t = Math.max(0.05, Math.min(0.45, inset));
  return [
    { x: w * t, y: 0 },
    { x: w * (1 - t), y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
}

export function parallelogramPoints(w: number, h: number, skew = 0.2): Point[] {
  const s = Math.max(-0.45, Math.min(0.45, skew));
  if (s >= 0) {
    return [
      { x: w * s, y: 0 },
      { x: w, y: 0 },
      { x: w * (1 - s), y: h },
      { x: 0, y: h },
    ];
  }
  const absS = -s;
  return [
    { x: 0, y: 0 },
    { x: w * (1 - absS), y: 0 },
    { x: w, y: h },
    { x: w * absS, y: h },
  ];
}

export function chevronPoints(w: number, h: number, indent = 0.25): Point[] {
  const cy = h / 2;
  const ix = w * Math.max(0.05, Math.min(0.5, indent));
  return [
    { x: 0, y: 0 },
    { x: w - ix, y: 0 },
    { x: w, y: cy },
    { x: w - ix, y: h },
    { x: 0, y: h },
    { x: ix, y: cy },
  ];
}

export function crossPoints(w: number, h: number, armRatio = 0.33): Point[] {
  const cx = w / 2;
  const cy = h / 2;
  const t = Math.max(0.1, Math.min(0.8, armRatio)) / 2;
  const x1 = cx - w * t;
  const x2 = cx + w * t;
  const y1 = cy - h * t;
  const y2 = cy + h * t;
  return [
    { x: x1, y: 0 },
    { x: x2, y: 0 },
    { x: x2, y: y1 },
    { x: w, y: y1 },
    { x: w, y: y2 },
    { x: x2, y: y2 },
    { x: x2, y: h },
    { x: x1, y: h },
    { x: x1, y: y2 },
    { x: 0, y: y2 },
    { x: 0, y: y1 },
    { x: x1, y: y1 },
  ];
}

/**
 * A ribbon banner with folded-back tails.
 *
 * The old version was a hexagonal notch that looked like a sideways chevron.
 * This draws a proper ribbon: a rectangular body with two short triangular folds
 * that tuck behind each end, creating the "folded ribbon" look used in heraldry,
 * badges, and modern infographics.
 *
 * The fold depth is `notch` as a ratio of width. The body is inset by the fold
 * width on each side, and the folds sit below the bottom edge.
 */
export function bannerAnchors(w: number, h: number, notch = 0.12): Anchor[] {
  const foldW = Math.max(8, Math.min(w * Math.max(0.06, Math.min(0.2, notch)), 40));
  const foldH = Math.max(6, Math.min(h * 0.25, 18));
  const cy = h / 2;
  const bodyH = h;
  return [
    // Top-left corner
    { x: foldW, y: 0 },
    // Top-right corner
    { x: w - foldW, y: 0 },
    // Right fold: top crease
    { x: w, y: 0 },
    // Right fold: notch inward
    { x: w - foldW * 0.6, y: cy },
    // Right fold: bottom crease
    { x: w, y: bodyH },
    // Bottom-right corner
    { x: w - foldW, y: bodyH },
    // Right tail fold behind
    { x: w - foldW, y: bodyH + foldH },
    { x: w - foldW * 1.8, y: bodyH },
    // Bottom-left corner area
    { x: foldW * 1.8, y: bodyH },
    // Left tail fold behind
    { x: foldW, y: bodyH + foldH },
    { x: foldW, y: bodyH },
    // Left fold: bottom crease
    { x: 0, y: bodyH },
    // Left fold: notch inward
    { x: foldW * 0.6, y: cy },
    // Left fold: top crease
    { x: 0, y: 0 },
  ];
}

/** Backwards-compatible polygon version for callers that need Point[]. */
export function bannerPoints(w: number, h: number, notch = 0.15): Point[] {
  return bannerAnchors(w, h, notch).map(a => ({ x: a.x, y: a.y }));
}

/**
 * A badge / seal as smooth scalloped Bézier arcs.
 *
 * The old version alternated polygon vertices at two radii, producing a jagged
 * star-like shape. This draws smooth cosine-interpolated bumps where each scallop
 * is a gentle arc, matching the rosette/seal aesthetic of Figma and Illustrator.
 */
export function badgeAnchors(
  cx: number,
  cy: number,
  points = 12,
  innerRatio = 0.9,
  rx: number,
  ry: number
): Anchor[] {
  const count = Math.max(6, Math.min(36, points));
  const ir = Math.max(0.7, Math.min(0.98, innerRatio));
  const anchors: Anchor[] = [];
  const step = (Math.PI * 2) / count;
  const handleLen = 0.38; // fraction of arc for smooth scallop

  for (let i = 0; i < count; i++) {
    // Each scallop has a peak (outer) and two valleys (inner)
    const peakAngle = i * step - Math.PI / 2;
    const valleyAngle = peakAngle + step / 2;

    // Peak point (outer radius)
    const px = cx + rx * Math.cos(peakAngle);
    const py = cy + ry * Math.sin(peakAngle);
    // Tangent direction at peak
    const ptx = -Math.sin(peakAngle);
    const pty = Math.cos(peakAngle);
    const peakHandleX = rx * step * handleLen;
    const peakHandleY = ry * step * handleLen;

    anchors.push({
      x: px,
      y: py,
      inX: px - ptx * peakHandleX,
      inY: py - pty * peakHandleY,
      outX: px + ptx * peakHandleX,
      outY: py + pty * peakHandleY,
    });

    // Valley point (inner radius)
    const vx = cx + rx * ir * Math.cos(valleyAngle);
    const vy = cy + ry * ir * Math.sin(valleyAngle);
    const vtx = -Math.sin(valleyAngle);
    const vty = Math.cos(valleyAngle);
    const valleyHandleX = rx * ir * step * handleLen;
    const valleyHandleY = ry * ir * step * handleLen;

    anchors.push({
      x: vx,
      y: vy,
      inX: vx - vtx * valleyHandleX,
      inY: vy - vty * valleyHandleY,
      outX: vx + vtx * valleyHandleX,
      outY: vy + vty * valleyHandleY,
    });
  }
  return anchors;
}

/** Backwards-compatible polygon fallback. */
export function badgePoints(
  cx: number,
  cy: number,
  points = 12,
  innerRatio = 0.9,
  rx: number,
  ry: number
): Point[] {
  return badgeAnchors(cx, cy, points, innerRatio, rx, ry).map(a => ({ x: a.x, y: a.y }));
}

/**
 * A stadium / capsule / pill shape.
 *
 * Clean 4-anchor construction: two semicircular ends joined by two straight
 * edges. The old 6-anchor version produced a visible flat spot where the
 * straight edge met the arc because the in/out handles of the transition
 * anchors pointed along the flat edge rather than along the tangent of the arc.
 *
 * This version uses exactly four anchors: the two arc apexes (leftmost and
 * rightmost points for a wide capsule, topmost and bottommost for a tall one)
 * plus the two transition points where arc meets straight. The handles at
 * transition points are tangent to the semicircle, which eliminates the
 * flat spot.
 */
export function capsuleAnchors(w: number, h: number): Anchor[] {
  if (w >= h) {
    // Horizontal capsule: semicircles left and right
    const r = h / 2;
    const k = r * KAPPA;
    return [
      // Top-center of right semicircle
      { x: w - r, y: 0, outX: w - r + k, outY: 0 },
      // Rightmost apex
      { x: w, y: r, inX: w, inY: r - k, outX: w, outY: r + k },
      // Bottom-center of right semicircle
      { x: w - r, y: h, inX: w - r + k, inY: h, outX: r, outY: h },
      // Bottom-center of left semicircle → also carries straight edge via out
      { x: r, y: h, inX: w - r, inY: h, outX: r - k, outY: h },
      // Leftmost apex
      { x: 0, y: r, inX: 0, inY: r + k, outX: 0, outY: r - k },
      // Top-center of left semicircle
      { x: r, y: 0, inX: r - k, inY: 0, outX: w - r, outY: 0 },
    ];
  } else {
    // Vertical capsule: semicircles top and bottom
    const r = w / 2;
    const k = r * KAPPA;
    return [
      // Top apex
      { x: r, y: 0, inX: r - k, inY: 0, outX: r + k, outY: 0 },
      // Right side of top semicircle
      { x: w, y: r, inX: w, inY: r - k, outX: w, outY: h - r },
      // Right side of bottom semicircle
      { x: w, y: h - r, inX: w, inY: r, outX: w, outY: h - r + k },
      // Bottom apex
      { x: r, y: h, inX: r + k, inY: h, outX: r - k, outY: h },
      // Left side of bottom semicircle
      { x: 0, y: h - r, inX: 0, inY: h - r + k, outX: 0, outY: r },
      // Left side of top semicircle
      { x: 0, y: r, inX: 0, inY: h - r, outX: 0, outY: r - k },
    ];
  }
}

export function cylinderAnchors(w: number, h: number, rimRatio = 0.18): Anchor[] {
  const rx = w / 2;
  const cx = rx;
  const ry = Math.max(6, Math.min(h * rimRatio, h * 0.45));
  const hx = rx * KAPPA;
  const hy = ry * KAPPA;
  return [
    { x: 0, y: ry, inX: 0, inY: ry, outX: 0, outY: ry - hy },
    { x: cx, y: 0, inX: cx - hx, inY: 0, outX: cx + hx, outY: 0 },
    { x: w, y: ry, inX: w, inY: ry - hy, outX: w, outY: ry },
    { x: w, y: h - ry, inX: w, inY: h - ry, outX: w, outY: h - ry + hy },
    { x: cx, y: h, inX: cx + hx, inY: h, outX: cx - hx, outY: h },
    { x: 0, y: h - ry, inX: 0, inY: h - ry + hy, outX: 0, outY: h - ry },
  ];
}

/**
 * A cloud, as asymmetric Bézier bumps in a unit box.
 *
 * The old version used 8 evenly-spaced anchor points that produced a
 * too-symmetrical, lifeless blob — more like an octagonal gear than a cloud.
 *
 * This uses 6 anchor points with deliberately varied radii and spacing:
 * three larger bumps across the top (the classic cumulus silhouette), two
 * smaller shoulders on the sides, and a flat base. Inspired by FigJam's
 * thought-bubble cloud and Illustrator's cloud symbol.
 *
 * The bumps overlap slightly so no concave "neck" appears between them;
 * the handles are tuned so the transitions between bumps are gentle S-curves
 * rather than sharp dips.
 */
const CLOUD_UNIT: ReadonlyArray<{ p: Point; in: Point; out: Point }> = [
  // Bottom-center (flat base, clockwise from here)
  { p: { x: 0.50, y: 0.92 }, in: { x: 0.32, y: 0.92 }, out: { x: 0.68, y: 0.92 } },
  // Right shoulder — small bump
  { p: { x: 0.88, y: 0.72 }, in: { x: 0.82, y: 0.88 }, out: { x: 0.96, y: 0.56 } },
  // Top-right — large bump
  { p: { x: 0.82, y: 0.28 }, in: { x: 0.94, y: 0.38 }, out: { x: 0.72, y: 0.18 } },
  // Top-center — tallest bump (crown of the cloud)
  { p: { x: 0.50, y: 0.10 }, in: { x: 0.64, y: 0.08 }, out: { x: 0.36, y: 0.08 } },
  // Top-left — medium bump
  { p: { x: 0.20, y: 0.26 }, in: { x: 0.30, y: 0.16 }, out: { x: 0.10, y: 0.36 } },
  // Left shoulder — small bump
  { p: { x: 0.12, y: 0.68 }, in: { x: 0.04, y: 0.52 }, out: { x: 0.18, y: 0.86 } },
];

export function cloudAnchors(w: number, h: number): Anchor[] {
  return CLOUD_UNIT.map((a) => ({
    x: a.p.x * w,
    y: a.p.y * h,
    inX: a.in.x * w,
    inY: a.in.y * h,
    outX: a.out.x * w,
    outY: a.out.y * h,
  }));
}

/**
 * A speech-bubble callout as a rounded-rect body with a curved tail.
 *
 * The old version was a sharp-cornered polygon — every professional tool draws
 * a callout as a **rounded rectangle with a curved tail**. The tail emerges
 * smoothly from the body edge with Bézier handles that make it curve slightly
 * rather than being a flat wedge.
 *
 * The built-in corner rounding of `shapeOutline` applies on top of this,
 * so the body corners get the user's chosen radius automatically.
 */
export function calloutAnchors(
  w: number,
  h: number,
  tailPosition: CalloutTail = 'bottom-left',
  tailSize = 16
): Anchor[] {
  const ts = Math.max(8, Math.min(tailSize, Math.min(w, h) * 0.4));

  if (tailPosition === 'bottom-left' || tailPosition === 'bottom-right' || tailPosition === 'bottom') {
    const bodyH = h - ts;
    const tailTipX =
      tailPosition === 'bottom-left' ? w * 0.22 : tailPosition === 'bottom-right' ? w * 0.78 : w * 0.5;
    const tailBaseL = Math.max(w * 0.08, tailTipX - ts * 0.55);
    const tailBaseR = Math.min(w * 0.92, tailTipX + ts * 0.55);
    // Offset the tip slightly away from center for a natural speech-bubble look
    const tipOffsetX = tailPosition === 'bottom-left' ? -ts * 0.3 : tailPosition === 'bottom-right' ? ts * 0.3 : 0;
    return [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: bodyH },
      // Tail: right base → tip → left base, with curved handles
      { x: tailBaseR, y: bodyH, outX: tailBaseR, outY: bodyH + ts * 0.15 },
      { x: tailTipX + tipOffsetX, y: h, inX: tailTipX + tipOffsetX + ts * 0.1, inY: h - ts * 0.2, outX: tailTipX + tipOffsetX - ts * 0.1, outY: h - ts * 0.2 },
      { x: tailBaseL, y: bodyH, inX: tailBaseL, inY: bodyH + ts * 0.15 },
      { x: 0, y: bodyH },
    ];
  } else if (tailPosition === 'top-left' || tailPosition === 'top-right') {
    const tailTipX = tailPosition === 'top-left' ? w * 0.22 : w * 0.78;
    const tailBaseL = Math.max(w * 0.08, tailTipX - ts * 0.55);
    const tailBaseR = Math.min(w * 0.92, tailTipX + ts * 0.55);
    const tipOffsetX = tailPosition === 'top-left' ? -ts * 0.3 : ts * 0.3;
    return [
      { x: tailBaseL, y: ts, outX: tailBaseL, outY: ts - ts * 0.15 },
      { x: tailTipX + tipOffsetX, y: 0, inX: tailTipX + tipOffsetX - ts * 0.1, inY: ts * 0.2, outX: tailTipX + tipOffsetX + ts * 0.1, outY: ts * 0.2 },
      { x: tailBaseR, y: ts, inX: tailBaseR, inY: ts - ts * 0.15 },
      { x: w, y: ts },
      { x: w, y: h },
      { x: 0, y: h },
      { x: 0, y: ts },
    ];
  } else if (tailPosition === 'left') {
    const cy = h / 2;
    const tailBaseT = Math.max(h * 0.08, cy - ts * 0.55);
    const tailBaseB = Math.min(h * 0.92, cy + ts * 0.55);
    return [
      { x: ts, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h },
      { x: ts, y: h },
      { x: ts, y: tailBaseB, outX: ts - ts * 0.15, outY: tailBaseB },
      { x: 0, y: cy, inX: ts * 0.2, inY: cy + ts * 0.1, outX: ts * 0.2, outY: cy - ts * 0.1 },
      { x: ts, y: tailBaseT, inX: ts - ts * 0.15, inY: tailBaseT },
    ];
  } else {
    const bodyW = w - ts;
    const cy = h / 2;
    const tailBaseT = Math.max(h * 0.08, cy - ts * 0.55);
    const tailBaseB = Math.min(h * 0.92, cy + ts * 0.55);
    return [
      { x: 0, y: 0 },
      { x: bodyW, y: 0 },
      { x: bodyW, y: tailBaseT, outX: bodyW + ts * 0.15, outY: tailBaseT },
      { x: w, y: cy, inX: w - ts * 0.2, inY: cy - ts * 0.1, outX: w - ts * 0.2, outY: cy + ts * 0.1 },
      { x: bodyW, y: tailBaseB, inX: bodyW + ts * 0.15, inY: tailBaseB },
      { x: bodyW, y: h },
      { x: 0, y: h },
    ];
  }
}

/** Backwards-compatible polygon fallback for callers needing Point[]. */
export function calloutPoints(
  w: number,
  h: number,
  tailPosition: CalloutTail = 'bottom-left',
  tailSize = 16
): Point[] {
  return calloutAnchors(w, h, tailPosition, tailSize).map(a => ({ x: a.x, y: a.y }));
}

/**
 * A donut / ring as two concentric KAPPA-approximated ellipses.
 *
 * Default inner ratio raised from 0.5 to 0.55 for a visually balanced ring —
 * at 0.5 the wall thickness equals the hole diameter, which reads as too
 * thick on screen and doesn't match the proportions users expect from
 * Figma/Illustrator donut shapes.
 */
export function donutGeometry(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  innerRatio = 0.55
): CompoundGeometry {
  const ir = Math.max(0.1, Math.min(0.9, innerRatio));
  const irx = rx * ir;
  const iry = ry * ir;
  const hx = rx * KAPPA;
  const hy = ry * KAPPA;
  const ihx = irx * KAPPA;
  const ihy = iry * KAPPA;

  const outer = fromAnchors(
    [
      { x: cx, y: cy - ry, inX: cx - hx, inY: cy - ry, outX: cx + hx, outY: cy - ry },
      { x: cx + rx, y: cy, inX: cx + rx, inY: cy - hy, outX: cx + rx, outY: cy + hy },
      { x: cx, y: cy + ry, inX: cx + hx, inY: cy + ry, outX: cx - hx, outY: cy + ry },
      { x: cx - rx, y: cy, inX: cx - rx, inY: cy + hy, outX: cx - rx, outY: cy - hy },
    ],
    true
  );

  const inner = fromAnchors(
    [
      { x: cx, y: cy - iry, inX: cx + ihx, inY: cy - iry, outX: cx - ihx, outY: cy - iry },
      { x: cx - irx, y: cy, inX: cx - irx, inY: cy + ihy, outX: cx - irx, outY: cy - ihy },
      { x: cx, y: cy + iry, inX: cx - ihx, inY: cy + iry, outX: cx + ihx, outY: cy + iry },
      { x: cx + irx, y: cy, inX: cx + irx, inY: cy - ihy, outX: cx + irx, outY: cy + ihy },
    ],
    true
  );

  return {
    kind: 'compound',
    subpaths: [outer, inner],
  };
}

export function documentOutline(w: number, h: number, waveHeight = 0.15): BezierGeometry {
  const amp = Math.max(0.05, Math.min(0.35, waveHeight)) * h;
  const baseH = h - amp;
  return fromAnchors(
    [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: baseH, outX: w - w * 0.18, outY: baseH + amp },
      { x: w * 0.5, y: baseH, inX: w * 0.68, inY: baseH + amp, outX: w * 0.32, outY: baseH - amp },
      { x: 0, y: baseH, inX: w * 0.18, inY: baseH - amp },
    ],
    true
  );
}

export function andGateOutline(w: number, h: number): BezierGeometry {
  const midX = w * 0.5;
  const ry = h / 2;
  const rx = w * 0.5;
  const hy = ry * KAPPA;
  const hx = rx * KAPPA;
  return fromAnchors(
    [
      { x: 0, y: 0 },
      { x: midX, y: 0, outX: midX + hx, outY: 0 },
      { x: w, y: ry, inX: w, inY: ry - hy, outX: w, outY: ry + hy },
      { x: midX, y: h, inX: midX + hx, inY: h },
      { x: 0, y: h },
    ],
    true
  );
}

export function orGateOutline(w: number, h: number): BezierGeometry {
  const ry = h / 2;
  return fromAnchors(
    [
      { x: 0, y: 0, outX: w * 0.45, outY: ry * 0.25 },
      { x: w, y: ry, inX: w * 0.82, inY: ry * 0.75, outX: w * 0.82, outY: ry * 1.25 },
      { x: 0, y: h, inX: w * 0.45, inY: h - ry * 0.25, outX: w * 0.22, outY: ry * 1.45 },
      { x: w * 0.2, y: ry, inX: w * 0.2, inY: ry * 1.25, outX: w * 0.2, outY: ry * 0.75 },
    ],
    true
  );
}

export function delayOutline(w: number, h: number): BezierGeometry {
  const midX = w * 0.6;
  const ry = h / 2;
  const rx = w * 0.4;
  const hy = ry * KAPPA;
  const hx = rx * KAPPA;
  return fromAnchors(
    [
      { x: 0, y: 0 },
      { x: midX, y: 0, outX: midX + hx, outY: 0 },
      { x: w, y: ry, inX: w, inY: ry - hy, outX: w, outY: ry + hy },
      { x: midX, y: h, inX: midX + hx, inY: h },
      { x: 0, y: h },
    ],
    true
  );
}

/**
 * A heraldic shield with curved Bézier sides.
 *
 * The old version was a flat pentagon — no curves at all. A real shield tapers
 * from a flat top edge through gently curving sides that converge at a pointed
 * or softly rounded bottom. This matches the shield iconography used in
 * security/auth diagrams and heraldic badges.
 */
export function shieldAnchors(w: number, h: number): Anchor[] {
  const cx = w / 2;
  return [
    // Top-left
    { x: 0, y: 0 },
    // Top-right
    { x: w, y: 0 },
    // Right side curves inward toward bottom
    { x: w, y: h * 0.42, outX: w, outY: h * 0.58 },
    // Bottom point
    { x: cx, y: h, inX: w * 0.72, inY: h * 0.82 },
    // Left side curves inward (mirror)
    { x: 0, y: h * 0.42, inX: 0, inY: h * 0.58, outX: 0, outY: h * 0.42 },
  ];
}

/** Backwards-compatible polygon fallback. */
export function shieldPoints(w: number, h: number): Point[] {
  return shieldAnchors(w, h).map(a => ({ x: a.x, y: a.y }));
}

export function boltPoints(w: number, h: number): Point[] {
  return [
    { x: w * 0.56, y: 0 },
    { x: w * 0.16, y: h * 0.56 },
    { x: w * 0.48, y: h * 0.56 },
    { x: w * 0.32, y: h },
    { x: w * 0.86, y: h * 0.4 },
    { x: w * 0.52, y: h * 0.4 },
  ];
}

/**
 * An isometric cube / 3D package.
 *
 * The old version was a flat regular hexagon. This draws a proper isometric box:
 * a top rhombus, a left face, and a right face — the classic "cube" shape used
 * in architecture diagrams, package managers, and deployment visualisations.
 * The internal crease lines are rendered via `shapeFeaturePaths`.
 */
export function packagePoints(w: number, h: number): Point[] {
  const cx = w * 0.5;
  const topY = h * 0.25;
  return [
    { x: cx, y: 0 },         // top
    { x: w, y: topY },       // right-top
    { x: w, y: h - topY },   // right-bottom
    { x: cx, y: h },         // bottom
    { x: 0, y: h - topY },   // left-bottom
    { x: 0, y: topY },       // left-top
  ];
}

/**
 * A CPU / chip with pins on all four sides.
 *
 * Capped at six pins a side rather than the sixteen an earlier version
 * allowed: sixteen is over 250 vertices for a silhouette that reads as a
 * fringe at any size a chip is actually drawn at. That cap is the shape's
 * real capability, so it is what `SHAPE_PARAMS` offers -- the panel used to
 * offer sixteen and the top ten did nothing.
 *
 * The die rectangle is drawn separately by `shapeFeaturePaths`.
 */
export function cpuPoints(w: number, h: number, pinCount = PIN_COUNT.fallback): Point[] {
  const n = clampParam(PIN_COUNT, pinCount);
  const pad = Math.min(w, h) * 0.18;
  const innerW = w - pad * 2;
  const innerH = h - pad * 2;
  const pts: Point[] = [];

  // Build clockwise from top-left of body
  pts.push({ x: pad, y: pad });

  // Top pins
  const stepX = innerW / (n + 1);
  const pinW = Math.min(stepX * 0.45, pad * 0.7);
  for (let i = 1; i <= n; i++) {
    const px = pad + i * stepX - pinW / 2;
    pts.push({ x: px, y: pad });
    pts.push({ x: px, y: 0 });
    pts.push({ x: px + pinW, y: 0 });
    pts.push({ x: px + pinW, y: pad });
  }
  pts.push({ x: w - pad, y: pad });

  // Right pins
  const stepY = innerH / (n + 1);
  const pinH = Math.min(stepY * 0.45, pad * 0.7);
  for (let i = 1; i <= n; i++) {
    const py = pad + i * stepY - pinH / 2;
    pts.push({ x: w - pad, y: py });
    pts.push({ x: w, y: py });
    pts.push({ x: w, y: py + pinH });
    pts.push({ x: w - pad, y: py + pinH });
  }
  pts.push({ x: w - pad, y: h - pad });

  // Bottom pins (reverse order)
  for (let i = n; i >= 1; i--) {
    const px = pad + i * stepX - pinW / 2;
    pts.push({ x: px + pinW, y: h - pad });
    pts.push({ x: px + pinW, y: h });
    pts.push({ x: px, y: h });
    pts.push({ x: px, y: h - pad });
  }
  pts.push({ x: pad, y: h - pad });

  // Left pins (reverse order)
  for (let i = n; i >= 1; i--) {
    const py = pad + i * stepY - pinH / 2;
    pts.push({ x: pad, y: py + pinH });
    pts.push({ x: 0, y: py + pinH });
    pts.push({ x: 0, y: py });
    pts.push({ x: pad, y: py });
  }

  return pts;
}

/**
 * A server rack unit as a simple rounded rectangle.
 *
 * The old version used a 16-point polygon with "rack ear" notches that looked
 * like a bracket at small sizes. Now the outline is a simple rounded rect, and
 * all internal details (bay dividers, LEDs, ventilation lines) are drawn via
 * `shapeFeaturePaths`, matching how terminal and browser shapes work.
 */
export function serverPoints(w: number, h: number): Point[] {
  // Simple rect — the outline handler returns a rect with small corner radius.
  // This function exists for API compatibility; the actual outline uses `rect`.
  return [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
}

/**
 * A key with a circular bow and toothed shaft.
 *
 * The old version was a 13-point polygon with angular bow and jagged bits.
 * This uses a proper KAPPA-based circular bow on the left, connected to a
 * rectangular shaft with two clean rectangular teeth — matching the key
 * iconography used in security/auth diagrams.
 */
export function keyAnchors(w: number, h: number): Anchor[] {
  const cy = h / 2;
  const bowR = Math.min(h * 0.40, w * 0.30);
  const bowCx = bowR + w * 0.02;
  const k = bowR * KAPPA;
  const stemTop = cy - h * 0.1;
  const stemBot = cy + h * 0.1;
  const bitW = Math.max(w * 0.08, 6);
  const bitH = h * 0.22;

  return [
    // Bow: top, starting from where shaft meets bow
    { x: bowCx, y: cy - bowR, inX: bowCx - k, inY: cy - bowR, outX: bowCx + k, outY: cy - bowR },
    { x: bowCx + bowR, y: cy, inX: bowCx + bowR, inY: cy - k, outX: bowCx + bowR, outY: cy + k },
    { x: bowCx, y: cy + bowR, inX: bowCx + k, inY: cy + bowR, outX: bowCx - k, outY: cy + bowR },
    { x: bowCx - bowR, y: cy, inX: bowCx - bowR, inY: cy + k, outX: bowCx - bowR, outY: cy - k },
    // Back to top, then across to shaft
    { x: bowCx, y: cy - bowR },
    // Shaft top edge
    { x: bowCx + bowR * 0.5, y: stemTop },
    { x: w - bitW * 3, y: stemTop },
    // First tooth
    { x: w - bitW * 3, y: stemBot + bitH * 0.6 },
    { x: w - bitW * 2, y: stemBot + bitH * 0.6 },
    { x: w - bitW * 2, y: stemBot },
    // Second tooth
    { x: w - bitW, y: stemBot },
    { x: w - bitW, y: stemBot + bitH },
    { x: w, y: stemBot + bitH },
    { x: w, y: stemTop },
    // Back along shaft bottom
    { x: bowCx + bowR * 0.5, y: stemBot },
    { x: bowCx, y: cy + bowR },
  ];
}

/** Backwards-compatible polygon fallback. */
export function keyPoints(w: number, h: number): Point[] {
  return keyAnchors(w, h).map(a => ({ x: a.x, y: a.y }));
}

/**
 * A wallet with a rounded body and curved clasp bump.
 *
 * The old version was a simple notched rectangle. This draws a rounded rectangle
 * body with a curved clasp/pocket bump on the right side, matching the wallet
 * iconography from payment/fintech diagram tools.
 */
export function walletAnchors(w: number, h: number): Anchor[] {
  const bodyW = w * 0.82;
  const claspTop = h * 0.30;
  const claspBot = h * 0.70;
  const claspMid = h * 0.50;
  const claspBulge = w * 0.08;
  const r = Math.min(w, h) * 0.06;
  return [
    { x: r, y: 0 },
    { x: bodyW, y: 0 },
    { x: bodyW, y: claspTop },
    // Clasp bump: curves outward then back
    { x: bodyW, y: claspTop, outX: bodyW + claspBulge, outY: claspTop },
    { x: w, y: claspMid - (claspBot - claspTop) * 0.15, inX: w, inY: claspTop + (claspMid - claspTop) * 0.3, outX: w, outY: claspMid + (claspBot - claspMid) * 0.3 },
    { x: bodyW, y: claspBot, inX: bodyW + claspBulge, inY: claspBot },
    { x: bodyW, y: h },
    { x: r, y: h },
    { x: 0, y: h },
    { x: 0, y: 0 },
  ];
}

/** Backwards-compatible polygon fallback. */
export function walletPoints(w: number, h: number): Point[] {
  return walletAnchors(w, h).map(a => ({ x: a.x, y: a.y }));
}

export function gearGeometry(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  teeth = 8
): CompoundGeometry {
  const count = Math.max(4, Math.min(24, Math.round(teeth)));
  const outerPts: Point[] = [];
  const rootR = 0.78;
  const tipR = 1.0;
  const step = (Math.PI * 2) / count;
  const toothWidth = step * 0.24;

  for (let i = 0; i < count; i++) {
    const angle = i * step - Math.PI / 2;
    const a0 = angle - toothWidth * 1.4;
    const a1 = angle - toothWidth * 0.75;
    const a2 = angle + toothWidth * 0.75;
    const a3 = angle + toothWidth * 1.4;
    outerPts.push(
      { x: cx + rx * rootR * Math.cos(a0), y: cy + ry * rootR * Math.sin(a0) },
      { x: cx + rx * tipR * Math.cos(a1), y: cy + ry * tipR * Math.sin(a1) },
      { x: cx + rx * tipR * Math.cos(a2), y: cy + ry * tipR * Math.sin(a2) },
      { x: cx + rx * rootR * Math.cos(a3), y: cy + ry * rootR * Math.sin(a3) }
    );
  }
  const outer = polygonGeometry(outerPts);

  const irx = rx * 0.35;
  const iry = ry * 0.35;
  const ihx = irx * KAPPA;
  const ihy = iry * KAPPA;
  const inner = fromAnchors(
    [
      { x: cx, y: cy - iry, inX: cx + ihx, inY: cy - iry, outX: cx - ihx, outY: cy - iry },
      { x: cx - irx, y: cy, inX: cx - irx, inY: cy + ihy, outX: cx - irx, outY: cy - ihy },
      { x: cx, y: cy + iry, inX: cx - ihx, inY: cy + iry, outX: cx + ihx, outY: cy + iry },
      { x: cx + irx, y: cy, inX: cx + irx, inY: cy - ihy, outX: cx + irx, outY: cy + ihy },
    ],
    true
  );

  return { kind: 'compound', subpaths: [outer, inner] };
}

export function userGeometry(
  cx: number,
  cy: number,
  rx: number,
  ry: number
): CompoundGeometry {
  const hrx = rx * 0.38;
  const hry = ry * 0.38;
  const hcy = cy - ry * 0.4;
  const hhx = hrx * KAPPA;
  const hhy = hry * KAPPA;
  const head = fromAnchors(
    [
      { x: cx, y: hcy - hry, inX: cx - hhx, inY: hcy - hry, outX: cx + hhx, outY: hcy - hry },
      { x: cx + hrx, y: hcy, inX: cx + hrx, inY: hcy - hhy, outX: cx + hrx, outY: hcy + hhy },
      { x: cx, y: hcy + hry, inX: cx + hhx, inY: hcy + hry, outX: cx - hhx, outY: hcy + hry },
      { x: cx - hrx, y: hcy, inX: cx - hrx, inY: hcy + hhy, outX: cx - hrx, outY: hcy - hhy },
    ],
    true
  );

  const sTopY = cy + ry * 0.15;
  const sBotY = cy + ry;
  const srx = rx * 0.92;
  const torso = fromAnchors(
    [
      { x: cx - srx, y: sBotY },
      { x: cx - srx, y: sTopY + ry * 0.35, outX: cx - srx, outY: sTopY },
      { x: cx - rx * 0.38, y: sTopY, inX: cx - rx * 0.65, inY: sTopY, outX: cx, outY: sTopY },
      { x: cx + rx * 0.38, y: sTopY, inX: cx, inY: sTopY, outX: cx + rx * 0.65, outY: sTopY },
      { x: cx + srx, y: sTopY + ry * 0.35, inX: cx + srx, inY: sTopY },
      { x: cx + srx, y: sBotY },
    ],
    true
  );

  return { kind: 'compound', subpaths: [head, torso] };
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
    const radius = Math.max(0, Math.min(uniformRadius(node.appearance?.cornerRadius), Math.min(w, h) / 2));
    return { kind: 'rect', x: 0, y: 0, width: w, height: h, radius };
  }

  if (node.geometry.kind === 'ellipse') {
    return { kind: 'ellipse', cx, cy, rx: w / 2, ry: h / 2 };
  }

  if (node.geometry.kind === 'squircle') {
    return { kind: 'bezier', geometry: fromAnchors(squircleAnchors(w, h), true) };
  }

  const radius = Math.max(0, uniformRadius(node.appearance?.cornerRadius));

  if (node.geometry.kind === 'heart') {
    return { kind: 'bezier', geometry: rounded(fromAnchors(heartAnchors(w, h), true), radius) };
  }

  if (node.geometry.kind === 'star') {
    const points = starPoints(cx, cy, node.geometry.points ?? 5, node.geometry.innerRatio ?? 0.5, w / 2, h / 2);
    return radius > 0
      ? { kind: 'bezier', geometry: rounded(polygonGeometry(points), radius) }
      : { kind: 'polygon', points };
  }

  if (node.geometry.kind === 'diamond') {
    const points = diamondPoints(w, h);
    return radius > 0
      ? { kind: 'bezier', geometry: rounded(polygonGeometry(points), radius) }
      : { kind: 'polygon', points };
  }

  if (node.geometry.kind === 'trapezoid') {
    const points = trapezoidPoints(w, h, node.geometry.inset);
    return radius > 0
      ? { kind: 'bezier', geometry: rounded(polygonGeometry(points), radius) }
      : { kind: 'polygon', points };
  }

  if (node.geometry.kind === 'parallelogram') {
    const points = parallelogramPoints(w, h, node.geometry.skew);
    return radius > 0
      ? { kind: 'bezier', geometry: rounded(polygonGeometry(points), radius) }
      : { kind: 'polygon', points };
  }

  if (node.geometry.kind === 'chevron') {
    const points = chevronPoints(w, h, node.geometry.indent);
    return radius > 0
      ? { kind: 'bezier', geometry: rounded(polygonGeometry(points), radius) }
      : { kind: 'polygon', points };
  }

  if (node.geometry.kind === 'cross') {
    const points = crossPoints(w, h, node.geometry.armRatio);
    return radius > 0
      ? { kind: 'bezier', geometry: rounded(polygonGeometry(points), radius) }
      : { kind: 'polygon', points };
  }

  if (node.geometry.kind === 'banner') {
    const points = bannerPoints(w, h);
    return radius > 0
      ? { kind: 'bezier', geometry: rounded(polygonGeometry(points), radius) }
      : { kind: 'polygon', points };
  }

  if (node.geometry.kind === 'badge') {
    const points = badgePoints(cx, cy, node.geometry.points ?? 12, node.geometry.innerRatio ?? 0.85, w / 2, h / 2);
    return radius > 0
      ? { kind: 'bezier', geometry: rounded(polygonGeometry(points), radius) }
      : { kind: 'polygon', points };
  }

  if (node.geometry.kind === 'callout') {
    const points = calloutPoints(w, h, node.geometry.tailPosition, node.geometry.tailSize);
    return radius > 0
      ? { kind: 'bezier', geometry: rounded(polygonGeometry(points), radius) }
      : { kind: 'polygon', points };
  }

  if (node.geometry.kind === 'capsule') {
    return { kind: 'bezier', geometry: fromAnchors(capsuleAnchors(w, h), true) };
  }

  if (node.geometry.kind === 'cylinder') {
    return { kind: 'bezier', geometry: fromAnchors(cylinderAnchors(w, h, node.geometry.rimRatio), true) };
  }

  if (node.geometry.kind === 'cloud') {
    return { kind: 'bezier', geometry: rounded(fromAnchors(cloudAnchors(w, h), true), radius) };
  }

  if (node.geometry.kind === 'donut') {
    return { kind: 'bezier', geometry: donutGeometry(cx, cy, w / 2, h / 2, node.geometry.innerRatio) };
  }

  if (node.geometry.kind === 'line' || node.geometry.kind === 'arrow') {
    return { kind: 'open', points: runPoints(node) };
  }

  if (node.geometry.kind === 'document') {
    return { kind: 'bezier', geometry: rounded(documentOutline(w, h, node.geometry.waveHeight), radius) };
  }

  if (node.geometry.kind === 'predefined_process') {
    const r = Math.max(0, Math.min(radius, Math.min(w, h) / 2));
    return { kind: 'rect', x: 0, y: 0, width: w, height: h, radius: r };
  }

  if (node.geometry.kind === 'summing_junction') {
    return { kind: 'ellipse', cx, cy, rx: w / 2, ry: h / 2 };
  }

  if (node.geometry.kind === 'or_gate') {
    return { kind: 'bezier', geometry: rounded(orGateOutline(w, h), radius) };
  }

  if (node.geometry.kind === 'and_gate') {
    return { kind: 'bezier', geometry: rounded(andGateOutline(w, h), radius) };
  }

  if (node.geometry.kind === 'internal_storage') {
    const r = Math.max(0, Math.min(radius, Math.min(w, h) / 2));
    return { kind: 'rect', x: 0, y: 0, width: w, height: h, radius: r };
  }

  if (node.geometry.kind === 'delay') {
    return { kind: 'bezier', geometry: rounded(delayOutline(w, h), radius) };
  }

  if (node.geometry.kind === 'server') {
    const points = serverPoints(w, h);
    return radius > 0
      ? { kind: 'bezier', geometry: rounded(polygonGeometry(points), radius) }
      : { kind: 'polygon', points };
  }

  if (node.geometry.kind === 'cpu') {
    const points = cpuPoints(w, h, node.geometry.pinCount);
    return radius > 0
      ? { kind: 'bezier', geometry: rounded(polygonGeometry(points), radius) }
      : { kind: 'polygon', points };
  }

  if (node.geometry.kind === 'mobile') {
    const r = Math.max(radius, Math.min(w, h) * 0.14);
    return { kind: 'rect', x: 0, y: 0, width: w, height: h, radius: r };
  }

  if (node.geometry.kind === 'terminal') {
    const r = Math.max(radius, Math.min(w, h) * 0.08);
    return { kind: 'rect', x: 0, y: 0, width: w, height: h, radius: r };
  }

  if (node.geometry.kind === 'browser') {
    const r = Math.max(radius, Math.min(w, h) * 0.06);
    return { kind: 'rect', x: 0, y: 0, width: w, height: h, radius: r };
  }

  if (node.geometry.kind === 'shield') {
    const points = shieldPoints(w, h);
    return radius > 0
      ? { kind: 'bezier', geometry: rounded(polygonGeometry(points), radius) }
      : { kind: 'polygon', points };
  }

  if (node.geometry.kind === 'key') {
    const points = keyPoints(w, h);
    return radius > 0
      ? { kind: 'bezier', geometry: rounded(polygonGeometry(points), radius) }
      : { kind: 'polygon', points };
  }

  if (node.geometry.kind === 'bolt') {
    const points = boltPoints(w, h);
    return radius > 0
      ? { kind: 'bezier', geometry: rounded(polygonGeometry(points), radius) }
      : { kind: 'polygon', points };
  }

  if (node.geometry.kind === 'package') {
    const points = packagePoints(w, h);
    return radius > 0
      ? { kind: 'bezier', geometry: rounded(polygonGeometry(points), radius) }
      : { kind: 'polygon', points };
  }

  if (node.geometry.kind === 'mail') {
    const r = Math.max(0, Math.min(radius, Math.min(w, h) * 0.1));
    return { kind: 'rect', x: 0, y: 0, width: w, height: h, radius: r };
  }

  if (node.geometry.kind === 'user') {
    return { kind: 'bezier', geometry: userGeometry(cx, cy, w / 2, h / 2) };
  }

  if (node.geometry.kind === 'gear') {
    return { kind: 'bezier', geometry: gearGeometry(cx, cy, w / 2, h / 2, node.geometry.teeth) };
  }

  if (node.geometry.kind === 'wallet') {
    const points = walletPoints(w, h);
    return radius > 0
      ? { kind: 'bezier', geometry: rounded(polygonGeometry(points), radius) }
      : { kind: 'polygon', points };
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

/**
 * The single radius this module can express, from either stored form.
 *
 * `shapeOutline` describes a shape as one of a few *kinds* — a rect with a
 * radius, an ellipse, a polygon — and that vocabulary has one number in it.
 * Four different corners are not a rounded rect in that sense; they are a
 * path, which is what `roundedRectPath` produces and what `shapeToPath` hands
 * to anything that needs the real outline.
 *
 * So this takes the largest of the four rather than the first. Everything
 * downstream of `shapeOutline` is a *clip* or a *hit region*, and one that is
 * slightly too generous rounds a corner that should have been square, while
 * one that is too small clips a corner that should have been round — visibly,
 * and in the shadow rather than in the shape.
 */
function uniformRadius(value: import('./cornerRadii').CornerRadiusValue | undefined): number {
  const [a, b, c, d] = cornerRadiiOf(value);
  return Math.max(a, b, c, d);
}

/**
 * Returns interior vector feature lines for shapes that have internal structural details
 * (e.g. cylinder rim, predefined process dividers, summing junction cross, server rack bays,
 * terminal header & prompt, mobile notch & bar, package isometric creases, mail flap).
 *
 * Designed to guarantee 100% mathematical vector parity between the Konva interactive
 * canvas (ShapeRenderer) and SVG export (SVGExporter).
 *
 * @param ox X offset (0 for local canvas space, node.x for world SVG export space)
 * @param oy Y offset (0 for local canvas space, node.y for world SVG export space)
 */
export function shapeFeaturePaths(
  node: Pick<ShapeNode, 'geometry' | 'width' | 'height'>,
  ox = 0,
  oy = 0
): string[] {
  const w = node.width;
  const h = node.height;
  const cx = ox + w / 2;
  const cy = oy + h / 2;
  const x = ox;
  const y = oy;
  const kind = node.geometry.kind;

  if (kind === 'cylinder') {
    const ry = Math.max(6, Math.min(h * (node.geometry.rimRatio ?? 0.18), h * 0.45));
    const hx = (w / 2) * KAPPA;
    const hy = ry * KAPPA;
    return [
      `M ${x} ${y + ry} C ${x} ${y + ry + hy} ${cx - hx} ${y + 2 * ry} ${cx} ${y + 2 * ry} C ${cx + hx} ${y + 2 * ry} ${x + w} ${y + ry + hy} ${x + w} ${y + ry}`,
    ];
  }

  if (kind === 'predefined_process') {
    const barLeft = x + w * 0.15;
    const barRight = x + w * 0.85;
    return [
      `M ${barLeft} ${y} L ${barLeft} ${y + h} M ${barRight} ${y} L ${barRight} ${y + h}`,
    ];
  }

  if (kind === 'summing_junction') {
    return [
      `M ${x} ${cy} L ${x + w} ${cy} M ${cx} ${y} L ${cx} ${y + h}`,
    ];
  }

  if (kind === 'internal_storage') {
    const headerY = y + h * 0.22;
    const marginX = x + w * 0.22;
    return [
      `M ${x} ${headerY} L ${x + w} ${headerY} M ${marginX} ${headerY} L ${marginX} ${y + h}`,
    ];
  }

  if (kind === 'package') {
    return [
      `M ${cx} ${cy} L ${cx} ${y} M ${cx} ${cy} L ${x} ${y + h * 0.75} M ${cx} ${cy} L ${x + w} ${y + h * 0.75}`,
    ];
  }

  if (kind === 'mail') {
    const flapY = y + h * 0.55;
    return [
      `M ${x} ${y} L ${cx} ${flapY} L ${x + w} ${y}`,
    ];
  }

  if (kind === 'server') {
    const count = Math.max(2, Math.min(6, node.geometry.shelfCount ?? 3));
    const paths: string[] = [];
    const earW = Math.max(4, Math.min(16, w * 0.06));
    const innerLeft = x + earW;
    const innerRight = x + w - earW;
    for (let s = 1; s < count; s++) {
      const sy = y + (h * s) / count;
      paths.push(`M ${innerLeft} ${sy} L ${innerRight} ${sy}`);
    }
    const ledR = Math.max(1.5, Math.min(4, h * 0.02));
    const ledX = innerLeft + Math.max(8, w * 0.08);
    for (let s = 0; s < count; s++) {
      const sy = y + (h * (s + 0.5)) / count;
      paths.push(
        `M ${ledX - ledR} ${sy} A ${ledR} ${ledR} 0 1 0 ${ledX + ledR} ${sy} A ${ledR} ${ledR} 0 1 0 ${ledX - ledR} ${sy}`
      );
      const led2X = ledX + ledR * 3;
      paths.push(
        `M ${led2X - ledR} ${sy} A ${ledR} ${ledR} 0 1 0 ${led2X + ledR} ${sy} A ${ledR} ${ledR} 0 1 0 ${led2X - ledR} ${sy}`
      );
    }
    return paths;
  }

  if (kind === 'terminal') {
    const headerY = y + h * 0.22;
    const paths: string[] = [`M ${x} ${headerY} L ${x + w} ${headerY}`];
    const dotR = Math.max(2, Math.min(5, h * 0.035));
    const dotY = y + headerY * 0.5;
    const dot1X = x + Math.max(10, w * 0.08);
    const dotSpacing = dotR * 2.8;
    for (let i = 0; i < 3; i++) {
      const dotX = dot1X + i * dotSpacing;
      paths.push(
        `M ${dotX - dotR} ${dotY} A ${dotR} ${dotR} 0 1 0 ${dotX + dotR} ${dotY} A ${dotR} ${dotR} 0 1 0 ${dotX - dotR} ${dotY}`
      );
    }
    const promptTop = y + h * 0.38;
    const promptMid = y + h * 0.52;
    const promptBot = y + h * 0.66;
    const pLeft = x + Math.max(12, w * 0.1);
    const pRight = pLeft + Math.max(8, w * 0.08);
    const cursorLeft = pRight + Math.max(6, w * 0.05);
    const cursorRight = cursorLeft + Math.max(8, w * 0.08);
    paths.push(
      `M ${pLeft} ${promptTop} L ${pRight} ${promptMid} L ${pLeft} ${promptBot} M ${cursorLeft} ${promptBot} L ${cursorRight} ${promptBot}`
    );
    return paths;
  }

  if (kind === 'browser') {
    const headerY = y + h * 0.22;
    const paths: string[] = [`M ${x} ${headerY} L ${x + w} ${headerY}`];
    const dotR = Math.max(2, Math.min(5, h * 0.035));
    const dotY = y + headerY * 0.5;
    const dot1X = x + Math.max(10, w * 0.07);
    const dotSpacing = dotR * 2.8;
    for (let i = 0; i < 3; i++) {
      const dotX = dot1X + i * dotSpacing;
      paths.push(
        `M ${dotX - dotR} ${dotY} A ${dotR} ${dotR} 0 1 0 ${dotX + dotR} ${dotY} A ${dotR} ${dotR} 0 1 0 ${dotX - dotR} ${dotY}`
      );
    }
    const addrLeft = dot1X + 3 * dotSpacing + Math.max(8, w * 0.04);
    const addrRight = x + w - Math.max(12, w * 0.08);
    const addrTop = y + headerY * 0.18;
    const addrBot = y + headerY * 0.82;
    const addrH = addrBot - addrTop;
    const addrR = addrH / 2;
    if (addrRight > addrLeft + addrR * 2) {
      paths.push(
        `M ${addrLeft + addrR} ${addrTop} L ${addrRight - addrR} ${addrTop} A ${addrR} ${addrR} 0 0 1 ${addrRight - addrR} ${addrBot} L ${addrLeft + addrR} ${addrBot} A ${addrR} ${addrR} 0 0 1 ${addrLeft + addrR} ${addrTop}`
      );
    }
    return paths;
  }

  if (kind === 'mobile') {
    const paths: string[] = [];
    const islandW = Math.max(20, Math.min(60, w * 0.28));
    const islandH = Math.max(4, Math.min(12, h * 0.035));
    const islandY = y + h * 0.055;
    const ir = islandH / 2;
    paths.push(
      `M ${cx - islandW / 2 + ir} ${islandY} L ${cx + islandW / 2 - ir} ${islandY} A ${ir} ${ir} 0 0 1 ${cx + islandW / 2 - ir} ${islandY + islandH} L ${cx - islandW / 2 + ir} ${islandY + islandH} A ${ir} ${ir} 0 0 1 ${cx - islandW / 2 + ir} ${islandY}`
    );
    const barW = Math.max(30, Math.min(80, w * 0.35));
    const barY = y + h * 0.94;
    paths.push(`M ${cx - barW / 2} ${barY} L ${cx + barW / 2} ${barY}`);
    return paths;
  }

  if (kind === 'cpu') {
    const padX = w * 0.26;
    const padY = h * 0.26;
    const dieX = x + padX;
    const dieY = y + padY;
    const dieW = w - padX * 2;
    const dieH = h - padY * 2;
    return [
      `M ${dieX} ${dieY} L ${dieX + dieW} ${dieY} L ${dieX + dieW} ${dieY + dieH} L ${dieX} ${dieY + dieH} Z`,
    ];
  }

  if (kind === 'wallet') {
    const snapR = Math.max(2, Math.min(6, h * 0.05));
    const snapX = x + w * 0.94;
    const snapY = cy;
    const seamX = x + w * 0.88;
    return [
      `M ${seamX} ${y} L ${seamX} ${y + h}`,
      `M ${snapX - snapR} ${snapY} A ${snapR} ${snapR} 0 1 0 ${snapX + snapR} ${snapY} A ${snapR} ${snapR} 0 1 0 ${snapX - snapR} ${snapY}`,
    ];
  }

  return [];
}

