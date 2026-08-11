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

import type { Point, ShapeNode } from './schema';

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
  /** An open run, corner to corner of the box. A line or an arrow. */
  | { kind: 'open'; points: Point[] };

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

  if (node.geometry.kind === 'star') {
    return {
      kind: 'polygon',
      points: starPoints(cx, cy, node.geometry.points ?? 5, node.geometry.innerRatio ?? 0.5, w / 2, h / 2),
    };
  }

  if (node.geometry.kind === 'line' || node.geometry.kind === 'arrow') {
    // Corner to corner. The other diagonal is reached by flipping the node,
    // which `scaleX`/`scaleY` already express — so a line needs no direction
    // of its own, and `width`/`height` stay the only record of its extent.
    return { kind: 'open', points: [{ x: 0, y: 0 }, { x: w, y: h }] };
  }

  return {
    kind: 'polygon',
    points: regularPolygonPoints(cx, cy, node.geometry.points ?? 3, w / 2, h / 2),
  };
}

/** `x,y x,y ...`, the form an SVG `<polygon points>` attribute wants. */
export function pointsAttribute(points: Point[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(' ');
}
