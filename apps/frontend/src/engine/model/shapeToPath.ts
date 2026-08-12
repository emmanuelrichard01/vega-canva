/**
 * Turning a shape into a path.
 *
 * "Flatten" in the toolbar; the precondition for half of Phase 4 in practice.
 * Booleans, anchor editing and stroke outlining all operate on anchors and
 * handles, and a rectangle has neither — it has a width, a height and a corner
 * radius. Rather than teach each of those operations about every primitive,
 * each primitive is converted once, here, into the one representation they all
 * understand.
 *
 * The conversion is exact for everything except the ellipse and the rounded
 * corner, where it is the standard four-arc cubic approximation — accurate to
 * about one part in ten thousand of the radius, which is a fifth of a pixel on
 * a circle the height of a 4K screen.
 */

import { shapeOutline } from './shapeOutline';
import type { BezierGeometry, BezierSegment, Point, ShapeNode } from './schema';
import { fromAnchors, type Anchor } from './pathGeometry';

/**
 * The magic number that makes four cubics look like a circle.
 *
 * `4/3 * (sqrt(2) - 1)`. It is the handle length, as a fraction of the radius,
 * that puts the midpoint of each quarter-arc exactly on the circle. Written
 * out rather than computed so it reads as the constant it is.
 */
export const KAPPA = 0.5522847498307936;

/** A closed run of straight anchors. Polygons and stars are nothing more than this. */
function polygonPath(points: readonly Point[], closed: boolean): BezierGeometry {
  const segments: BezierSegment[] = points.map((p) => ({ x: p.x, y: p.y }));
  return { kind: 'bezier', segments, closed };
}

/** An ellipse as four cubic quarters, starting at twelve o'clock to match the primitives. */
function ellipsePath(cx: number, cy: number, rx: number, ry: number): BezierGeometry {
  const hx = rx * KAPPA;
  const hy = ry * KAPPA;
  // Twelve, three, six, nine — clockwise, the direction Konva's `RegularPolygon`
  // and `Star` also run, so a flattened ellipse winds the same way as a
  // flattened hexagon and a boolean between them needs no special case.
  const anchors: Anchor[] = [
    { x: cx, y: cy - ry, inX: cx - hx, inY: cy - ry, outX: cx + hx, outY: cy - ry },
    { x: cx + rx, y: cy, inX: cx + rx, inY: cy - hy, outX: cx + rx, outY: cy + hy },
    { x: cx, y: cy + ry, inX: cx + hx, inY: cy + ry, outX: cx - hx, outY: cy + ry },
    { x: cx - rx, y: cy, inX: cx - rx, inY: cy + hy, outX: cx - rx, outY: cy - hy },
  ];
  return fromAnchors(anchors, true);
}

/** A rectangle, with the corner radius drawn as four quarter-arcs when there is one. */
function rectPath(x: number, y: number, w: number, h: number, r: number): BezierGeometry {
  if (r <= 0) {
    return polygonPath(
      [
        { x, y },
        { x: x + w, y },
        { x: x + w, y: y + h },
        { x, y: y + h },
      ],
      true
    );
  }

  const k = r * KAPPA;
  const x1 = x + w;
  const y1 = y + h;
  // Two anchors per corner: where the straight edge stops, and where the next
  // one starts. Each carries exactly one handle — the one pointing at the
  // corner it is rounding. The other side of every anchor is a straight edge
  // and has no handle at all, which is what keeps the edges straight.
  //
  // Clockwise from the end of the top-left corner. The last anchor's outgoing
  // handle and the first's incoming one are the two controls of the closing
  // curve, which is the top-left corner itself.
  const anchors: Anchor[] = [
    { x: x + r, y, inX: x + r - k, inY: y },
    { x: x1 - r, y, outX: x1 - r + k, outY: y },
    { x: x1, y: y + r, inX: x1, inY: y + r - k },
    { x: x1, y: y1 - r, outX: x1, outY: y1 - r + k },
    { x: x1 - r, y: y1, inX: x1 - r + k, inY: y1 },
    { x: x + r, y: y1, outX: x + r - k, outY: y1 },
    { x, y: y1 - r, inX: x, inY: y1 - r + k },
    { x, y: y + r, outX: x, outY: y + r - k },
  ];
  return fromAnchors(anchors, true);
}

/**
 * A shape's outline as a path, in the shape's own local coordinates.
 *
 * Local, like `shapeOutline` itself: the caller knows where the node is, and
 * a path node stores its geometry relative to its own origin anyway.
 */
export function shapeToPath(
  node: Pick<ShapeNode, 'geometry' | 'width' | 'height' | 'appearance'>
): BezierGeometry {
  const outline = shapeOutline(node);
  switch (outline.kind) {
    case 'rect':
      return rectPath(outline.x, outline.y, outline.width, outline.height, outline.radius);
    case 'ellipse':
      return ellipsePath(outline.cx, outline.cy, outline.rx, outline.ry);
    case 'polygon':
      return polygonPath(outline.points, true);
    case 'open':
      // A line has no interior, so it converts to an open path — closing it
      // would invent an area the shape never had, and give a fill somewhere to
      // land that was previously nowhere.
      return polygonPath(outline.points, false);
  }
}
