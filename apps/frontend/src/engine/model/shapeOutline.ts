/**
 * The outline of a shape, in the node's own local coordinates.
 *
 * Three parts of the app need to know what shape a hexagon is: the renderer,
 * the SVG exporter, and the effect layers — an inside stroke has to clip to the
 * shape, and an inner shadow has to fill everything that is *not* the shape.
 * Two copies had already drifted apart into different files before this
 * existed; a third would have been the one that finally disagreed.
 *
 * ## What this file is now
 *
 * A dispatcher, and nothing else. It maps a kind to the one function that
 * draws it and picks the cheapest description of the result. Every curve lives
 * in `shapes/contours.ts`, every interior line in `shapes/features.ts`, and
 * every default in `shapeParams.ts`.
 *
 * That is a change of shape, not only of size. What stood here was 1,400 lines
 * in which most shapes were written twice — once with curves and once as the
 * straight-sided fallback the dispatcher below actually called — so the seal
 * was a sunburst, the ribbon was a notched box, the speech bubble had a wedge
 * for a tail and the key's round bow drew as a **diamond**, while the toolbar
 * showed the curved version of each. There is one description per shape now,
 * and no branch that can pick the other one.
 *
 * ## Why the union still has a rectangle and an ellipse in it
 *
 * Approximating either as a path would put visible facets on a large circle
 * and cost the most common object on the board a cubic walk it does not need.
 * A rectangle *is* a rectangle, and Konva, the exporter and `Path2D` all have
 * one. Everything else is a Bézier contour, which is the form the vector
 * engine already speaks.
 */

import { DEFAULT_STAR_POINTS, DEFAULT_STAR_RATIO, type CompoundGeometry, type Point, type ShapeNode } from './schema';
import type { ContourGeometry } from './pathGeometry';
import { roundPathCorners } from './roundCorners';
import { runPoints } from './lineEnds';
import { cornerRadiiOf, fitRadii, type CornerRadii } from './cornerRadii';
import {
  archiveContour,
  arrowBlockContour,
  badgeContour,
  bannerContour,
  boltContour,
  calloutContour,
  capsuleContour,
  chevronContour,
  cloudContour,
  crossContour,
  cylinderContour,
  dContour,
  diamondContour,
  documentContour,
  folderContour,
  donutContour,
  gearContour,
  hopperContour,
  heartContour,
  keyContour,
  manualInputContour,
  noteContour,
  orGateContour,
  packageContour,
  pinContour,
  planeContour,
  parallelogramContour,
  polygonPoints,
  preparationContour,
  rightTriangleContour,
  semicircleContour,
  serverContour,
  shieldContour,
  squircleContour,
  starOutlinePoints,
  trapezoidContour,
  userContour,
} from './shapes/contours';
import { param } from './shapes/params';
import { polygonContour, regularPolygonPoints, starPoints } from './shapes/pen';

export { regularPolygonPoints, starPoints };
export { shapeFeaturePaths } from './shapes/features';

/**
 * What a shape's outline is, without saying how to draw it.
 *
 * A discriminated union rather than "always a point list", because a rectangle
 * has corner radii and an ellipse is a curve.
 */
export type ShapeOutline =
  | {
      kind: 'rect';
      x: number;
      y: number;
      width: number;
      height: number;
      /**
       * The four corners, already fitted to the box and already carrying any
       * radius the *kind* insists on.
       *
       * Both halves matter. A phone, a browser window and a chip are rounded
       * because of what they are, not because somebody set a radius — and
       * `shapeToPath` used to rebuild the four corners from the stored value
       * alone, so every one of those exported and flattened with square
       * corners while the canvas drew them round. The outline is the one place
       * that knows both facts, so it is the place that combines them.
       */
      radii: CornerRadii;
      /** The largest of the four. What a clip or a hit region can express. */
      radius: number;
    }
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number }
  | { kind: 'polygon'; points: Point[] }
  /** A curved outline that is neither. One contour, or several. */
  | { kind: 'bezier'; geometry: ContourGeometry }
  /** An open run. A line or an arrow. */
  | { kind: 'open'; points: Point[] };

/** `x,y x,y ...`, the form an SVG `<polygon points>` attribute wants. */
export function pointsAttribute(points: readonly Point[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(' ');
}

/**
 * The single radius this module can express, from either stored form.
 *
 * `shapeOutline` describes a shape as one of a few *kinds*, and that vocabulary
 * has one number in it. Four different corners are not a rounded rect in that
 * sense; they are a path, which is what `shapeToPath` produces.
 *
 * This takes the largest of the four rather than the first. Everything
 * downstream of `shapeOutline` is a *clip* or a *hit region*, and one that is
 * slightly too generous rounds a corner that should have been square, while one
 * that is too small clips a corner that should have been round — visibly, and
 * in the shadow rather than in the shape.
 */
function uniformRadius(value: import('./cornerRadii').CornerRadiusValue | undefined): number {
  const [a, b, c, d] = cornerRadiiOf(value);
  return Math.max(a, b, c, d);
}

/** Corner rounding, applied only where it would do something. */
function rounded(geo: ContourGeometry, radius: number): ContourGeometry {
  if (radius <= 0) return geo;
  if (geo.kind === 'compound') {
    return { ...geo, subpaths: geo.subpaths.map((s) => roundPathCorners(s, radius)) } as CompoundGeometry;
  }
  return roundPathCorners(geo, radius);
}

export function shapeOutline(
  node: Pick<ShapeNode, 'geometry' | 'width' | 'height' | 'appearance'>
): ShapeOutline {
  const w = node.width;
  const h = node.height;
  const cx = w / 2;
  const cy = h / 2;
  const g = node.geometry;
  const short = Math.min(w, h);

  /** The user's radius, held to something a box that size can carry. */
  const radius = Math.max(0, uniformRadius(node.appearance?.cornerRadius));

  /**
   * A rectangle, with a floor under its radius for the shapes whose roundness
   * is part of what they are.
   *
   * The floor is a *minimum*, not an override: a phone is round-cornered
   * whatever the document says, and a document that says rounder wins.
   */
  const box = (minRadius = 0, bx = 0, by = 0, bw = w, bh = h): ShapeOutline => {
    const asked = cornerRadiiOf(node.appearance?.cornerRadius);
    const radii = fitRadii(
      [
        Math.max(asked[0], minRadius),
        Math.max(asked[1], minRadius),
        Math.max(asked[2], minRadius),
        Math.max(asked[3], minRadius),
      ],
      bw,
      bh
    );
    return { kind: 'rect', x: bx, y: by, width: bw, height: bh, radii, radius: Math.max(...radii) };
  };

  /** A closed run of straight edges, rounded if the document asked. */
  const poly = (points: Point[]): ShapeOutline =>
    radius > 0
      ? { kind: 'bezier', geometry: rounded(polygonContour(points), radius) }
      : { kind: 'polygon', points };

  /** A curve. The user's corner radius applies to its corners, where it has any. */
  const curve = (geometry: ContourGeometry, applyRadius = true): ShapeOutline => ({
    kind: 'bezier',
    geometry: applyRadius ? rounded(geometry, radius) : geometry,
  });

  switch (g.kind) {
    // -- Boxes ------------------------------------------------------------
    case 'rect':
      return box();
    case 'predefined_process':
    case 'internal_storage':
      return box();
    case 'mail':
      return box(short * 0.08);
    case 'terminal':
      return box(short * 0.07);
    case 'browser':
      return box(short * 0.055);
    case 'wallet':
      // Softer than the other panels, matching the reference: a billfold is a
      // folded leather object and a tight corner reads as a card.
      return box(short * 0.14);
    case 'mobile':
      return box(short * 0.16);
    /**
     * A chip's body, not its box: the pins are strokes drawn out to the box's
     * edge by `shapeFeaturePaths`, exactly as every chip is drawn. Carving them
     * into the silhouette — which is what this used to do — put two hundred
     * vertices into a shape that reads as a fringe at any size, and let the
     * fill leak down every pin.
     */
    case 'cpu': {
      const pad = short * 0.16;
      return box(short * 0.03, pad, pad, w - pad * 2, h - pad * 2);
    }

    // -- Round ------------------------------------------------------------
    case 'ellipse':
    case 'summing_junction':
      return { kind: 'ellipse', cx, cy, rx: cx, ry: cy };
    case 'squircle':
      return curve(squircleContour(w, h), false);
    case 'capsule':
      return curve(capsuleContour(w, h), false);
    case 'semicircle':
      return curve(semicircleContour(w, h));
    case 'donut':
      return curve(donutContour(w, h, param(g, 'innerRatio')), false);

    // -- Straight-sided ---------------------------------------------------
    case 'polygon':
      return poly(polygonPoints(w, h, g.points ?? 3));
    case 'star':
      return poly(starOutlinePoints(w, h, g.points ?? DEFAULT_STAR_POINTS, g.innerRatio ?? DEFAULT_STAR_RATIO));
    case 'diamond':
      return poly(pointsOf(diamondContour(w, h)));
    case 'right_triangle':
      return poly(pointsOf(rightTriangleContour(w, h)));
    case 'trapezoid':
      return poly(pointsOf(trapezoidContour(w, h, param(g, 'inset'))));
    case 'parallelogram':
      return poly(pointsOf(parallelogramContour(w, h, param(g, 'skew'))));
    case 'chevron':
      return poly(pointsOf(chevronContour(w, h, param(g, 'indent'))));
    case 'preparation':
      return poly(pointsOf(preparationContour(w, h, param(g, 'indent'))));
    case 'arrow_block':
      return poly(pointsOf(arrowBlockContour(w, h, param(g, 'indent'))));
    case 'banner':
      return poly(pointsOf(bannerContour(w, h, param(g, 'indent'))));
    case 'cross':
      return poly(pointsOf(crossContour(w, h, param(g, 'armRatio'))));
    case 'note':
      return poly(pointsOf(noteContour(w, h)));
    case 'manual_input':
      return poly(pointsOf(manualInputContour(w, h, param(g, 'indent'))));
    case 'plane':
      return poly(pointsOf(planeContour(w, h)));
    case 'folder':
      return curve(folderContour(w, h), false);
    case 'pin':
      return curve(pinContour(w, h), false);
    /**
     * A monitor's screen, with its stand drawn out to the box by the features.
     *
     * The same division the chip makes: the silhouette is the part you would
     * fill and put a label in, and the parts that are lines in every drawing of
     * the object are lines here too.
     */
    case 'desktop':
      return box(short * 0.06, 0, 0, w, h * 0.76);
    /**
     * Through `curve`, not `poly`: the carton's corners are arcs now, and
     * `pointsOf` keeps anchor positions and throws curves away. Routing a
     * rounded shape through it is exactly the defect this rewrite removed —
     * it reappeared here the moment the box grew soft edges, which is worth
     * knowing before adding a curve to any other straight-sided shape below.
     */
    case 'package':
      return curve(packageContour(w, h), false);
    case 'bolt':
      return poly(pointsOf(boltContour(w, h) as import('./schema').BezierGeometry));

    // -- Curved ------------------------------------------------------------
    case 'heart':
      return curve(heartContour(w, h));
    case 'cloud':
      return curve(cloudContour(w, h));
    case 'shield':
      return curve(shieldContour(w, h), false);
    case 'server':
      return curve(serverContour(w, h, param(g, 'shelfCount')), false);
    case 'archive':
      return curve(archiveContour(w, h), false);
    case 'hopper':
      return curve(hopperContour(w, h), false);
    case 'globe':
      return { kind: 'ellipse', cx, cy, rx: cx, ry: cy };
    case 'activity':
      return box(short * 0.09);
    case 'callout':
      return curve(calloutContour(w, h, g.tailPosition ?? 'bottom-left', param(g, 'tailSize')), false);
    case 'badge':
      return curve(badgeContour(w, h, g.points ?? 12, param(g, 'innerRatio')), false);
    case 'cylinder':
      return curve(cylinderContour(w, h, param(g, 'rimRatio')), false);
    case 'database':
      return curve(cylinderContour(w, h, param(g, 'rimRatio')), false);
    case 'document':
      return curve(documentContour(w, h, param(g, 'waveHeight')));
    case 'delay':
    case 'and_gate':
      return curve(dContour(w, h));
    case 'or_gate':
      return curve(orGateContour(w, h));
    case 'key':
      return curve(keyContour(w, h), false);
    case 'gear':
      return curve(gearContour(w, h, param(g, 'teeth')), false);
    case 'user':
      return curve(userContour(w, h), false);

    // -- Open runs ---------------------------------------------------------
    case 'line':
    case 'arrow':
      return { kind: 'open', points: runPoints(node) };
  }

  /**
   * A kind this build does not know.
   *
   * Unreachable from a normalized document — `SHAPE_KIND_ALIASES` maps anything
   * unrecognised to `rect` at the CRDT boundary — and the switch above is
   * exhaustive, so TypeScript already refuses to let a *new* kind be forgotten
   * here. Both of those are compile-time and boundary guarantees, and neither
   * covers the one case that reaches this line: a node from a **newer build**
   * arriving over the wire, or a hand-built one in a test.
   *
   * The version this file replaces ended in a catch-all that drew a polygon,
   * so it had this by accident. Losing it turned an unknown kind from "draws a
   * triangle" into "returns undefined and takes the renderer down with it",
   * which on a shared board is one collaborator's upgrade blanking everybody
   * else's canvas.
   */
  return box();
}

/**
 * The anchors of a straight-sided contour, as a point list.
 *
 * The contour builders all return the same type, which keeps them uniform and
 * keeps `shapes/contours.ts` free of two return shapes. The ones that draw only
 * straight edges are unpacked here so the outline can stay a `polygon` — the
 * cheap description that `Path2D`, Konva and the exporter each have a direct
 * primitive for, and the one the corner rounder wants as its input.
 */
function pointsOf(geo: ContourGeometry): Point[] {
  if (geo.kind === 'compound') return geo.subpaths.flatMap((s) => s.segments.map((p) => ({ x: p.x, y: p.y })));
  return geo.segments.map((p) => ({ x: p.x, y: p.y }));
}
