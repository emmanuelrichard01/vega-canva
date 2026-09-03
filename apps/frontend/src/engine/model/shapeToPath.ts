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
import { cornerRadiiOf, fitRadii, type CornerRadii } from './cornerRadii';

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

/**
 * A rectangle, with each corner drawn at its own radius.
 *
 * ## Why this takes four numbers
 *
 * It took one, from `shapeOutline.radius` — which is the **largest** of the
 * four, because that module describes a shape as a *kind* and its vocabulary
 * has one number in it. That collapse is right for a clip or a hit region,
 * which is what everything else downstream of `shapeOutline` is, and it is
 * exactly wrong here: this function is the one that produces the *real*
 * outline, and `shapeOutline`'s own docstring says so.
 *
 * So a rectangle with `[30, 0, 0, 0]` came through as a rectangle with four
 * 30-unit corners. That reached everything built on the real outline —
 * flatten-to-path, the boolean operations, and most visibly the **sketch**,
 * which flattens this path to draw a hand-drawn rounded box. Setting one
 * corner of a sketched rectangle rounded all four, and setting three of them
 * to zero did nothing at all.
 *
 * ## Two anchors per rounded corner, one per square one
 *
 * Each rounded corner is where the straight edge stops and where the next one
 * starts, and each of those carries exactly one handle — the one pointing at
 * the corner it is rounding. The other side of every anchor is a straight edge
 * and has no handle, which is what keeps the edges straight.
 *
 * A square corner is a single plain anchor. Emitting the pair for it would put
 * two coincident anchors with two zero-length handles at the same point: a
 * degenerate curve that renders as a corner, edits as a trap in the path
 * editor, and doubles the anchor count of a plain rectangle for nothing.
 *
 * Clockwise from the end of the top-left corner, so the last anchor's outgoing
 * handle and the first's incoming one are the two controls of the closing
 * curve — which is the top-left corner itself.
 */
function rectPath(x: number, y: number, w: number, h: number, radii: CornerRadii): BezierGeometry {
  // Fitted before it is drawn, per *shared edge* rather than per corner: a
  // 200x40 box carries a 40-unit top-left corner as long as its top-right
  // neighbour is small, and capping each corner on its own gives a shape whose
  // corners are individually legal and whose edges have negative length.
  const [tl, tr, br, bl] = fitRadii(radii, w, h);
  const x1 = x + w;
  const y1 = y + h;

  if (tl <= 0 && tr <= 0 && br <= 0 && bl <= 0) {
    return polygonPath(
      [
        { x, y },
        { x: x1, y },
        { x: x1, y: y1 },
        { x, y: y1 },
      ],
      true
    );
  }

  const k = (r: number) => r * KAPPA;
  const anchors: Anchor[] = [];

  // Top-left: the end of its arc, or the corner itself.
  if (tl > 0) anchors.push({ x: x + tl, y, inX: x + tl - k(tl), inY: y });
  else anchors.push({ x, y });

  if (tr > 0) {
    anchors.push({ x: x1 - tr, y, outX: x1 - tr + k(tr), outY: y });
    anchors.push({ x: x1, y: y + tr, inX: x1, inY: y + tr - k(tr) });
  } else {
    anchors.push({ x: x1, y });
  }

  if (br > 0) {
    anchors.push({ x: x1, y: y1 - br, outX: x1, outY: y1 - br + k(br) });
    anchors.push({ x: x1 - br, y: y1, inX: x1 - br + k(br), inY: y1 });
  } else {
    anchors.push({ x: x1, y: y1 });
  }

  if (bl > 0) {
    anchors.push({ x: x + bl, y: y1, outX: x + bl - k(bl), outY: y1 });
    anchors.push({ x, y: y1 - bl, inX: x, inY: y1 - bl + k(bl) });
  } else {
    anchors.push({ x, y: y1 });
  }

  // The start of the top-left arc, whose curve back to the first anchor closes
  // the path. A square top-left needs nothing: the first anchor is the corner,
  // and the closing segment is the straight left edge.
  if (tl > 0) anchors.push({ x, y: y + tl, outX: x, outY: y + tl - k(tl) });

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
      /**
       * The four radii come from the node, not from the outline.
       *
       * `shapeOutline.radius` is the largest of the four — the one number its
       * vocabulary can hold — and that is the right answer for the clips and
       * hit regions it feeds. This is the real outline, so it reads the stored
       * value directly.
       */
      return rectPath(
        outline.x,
        outline.y,
        outline.width,
        outline.height,
        cornerRadiiOf(node.appearance?.cornerRadius)
      );
    case 'ellipse':
      return ellipsePath(outline.cx, outline.cy, outline.rx, outline.ry);
    case 'polygon':
      return polygonPath(outline.points, true);
    case 'bezier':
      // Already the thing this function exists to produce.
      return outline.geometry;
    case 'open':
      // A line has no interior, so it converts to an open path — closing it
      // would invent an area the shape never had, and give a fill somewhere to
      // land that was previously nowhere.
      return polygonPath(outline.points, false);
  }
}
