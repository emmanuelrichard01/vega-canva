/**
 * The bridge from a shape node to its sketched form.
 *
 * One function, used by the canvas renderer and the SVG exporter both. That is
 * the whole reason it exists as its own module: a sketch is *seeded*, so two
 * implementations would not merely drift in style, they would draw two
 * genuinely different objects from the same document — the shape in the file
 * would not be the shape on the screen, and nobody looking at either would be
 * able to tell which was wrong.
 *
 * It is also where the corner/curve split is decided. `rough.ts` offers two
 * constructions because they answer different questions, and picking between
 * them is a property of the *shape*, not of the drawing — so it happens once,
 * here, rather than in each caller.
 */

import { ellipseRing, rectRing, roughEllipse, roughPolyline, roughSilhouette, seedFrom, shapeFill } from './rough';
import { shapeOutline } from './shapeOutline';
import { flattenPath } from './pathGeometry';
import type { Point, ShapeNode } from './schema';

export interface RoughShape {
  /** The sketched outline, as SVG path data. Empty when nothing is drawn. */
  outline: string;
  /** Hachure or cross-hatch strokes, or empty for a solid (or absent) fill. */
  fill: string;
  /**
   * The smooth silhouette, as a closed SVG path.
   *
   * What a **solid** fill paints. It cannot reuse `outline`: those strokes are
   * deliberately disjoint — each edge is its own subpath so the passes do not
   * weld — and filling a set of disconnected arcs produces a shape with bites
   * taken out of it wherever two strokes failed to meet. The silhouette is the
   * true shape; the sketch is what is drawn *on* it.
   */
  silhouette: string;
}



/**
 * A shape node as a sketch.
 *
 * `id` seeds it, so the same object is drawn the same way for its whole life
 * and for everybody in the room. `wantsFill` is passed rather than read off the
 * appearance because the two callers decide differently what counts as a fill
 * worth hachuring — a gradient, for instance, keeps the ordinary fill path and
 * only its outline is sketched.
 */
export function roughShape(
  node: Pick<ShapeNode, 'geometry' | 'width' | 'height' | 'appearance'> & { id: string },
  wantsFill: boolean
): RoughShape {
  if (!node.appearance?.sketch) return { outline: '', fill: '', silhouette: '' };

  const level = node.appearance.sketch;
  const style = node.appearance.fillStyle ?? 'solid';
  const seed = seedFrom(node.id);
  const outline = shapeOutline(node);

  // The silhouette the shading is clipped against. Always a polygon, even for
  // an ellipse, because the scanline needs edges to cross — and sampled finely
  // there, so the hachure reaches the drawn edge instead of stopping short of
  // it on a coarse ring.
  let ring: Point[];
  let sketched: string;

  switch (outline.kind) {
    case 'ellipse':
      // A curve has no corners to overshoot, so it is one continuous wandering
      // loop rather than a run of bowed chords. Drawing it the other way is
      // what made a circle come out as a broken, spiky ring.
      sketched = roughEllipse(outline.cx, outline.cy, outline.rx, outline.ry, { seed, level });
      ring = ellipseRing(outline.cx, outline.cy, outline.rx, outline.ry);
      break;

    case 'rect':
      // The corner radius is deliberately ignored: a hand-drawn rounded
      // rectangle is drawn as a rectangle, and the overshoot at each corner
      // already softens it further than a radius would.
      ring = rectRing(outline.width, outline.height);
      sketched = roughPolyline(ring, { seed, level });
      break;

    case 'polygon':
      ring = outline.points;
      sketched = roughPolyline(ring, { seed, level });
      break;

    case 'bezier':
      // Flattened first, because the sketcher works on runs of points — it is
      // what puts the wobble in. The tolerance is the same one the vector
      // engine flattens with, so a hand-drawn heart wanders around exactly the
      // curve a crisp one draws.
      ring = flattenPath(outline.geometry);
      sketched = roughPolyline(ring, { seed, level });
      break;

    case 'open':
      // A line has no interior, so it is drawn as an open run and never
      // hachured — shading the inside of something with no inside is exactly
      // what a shared code path gets wrong if it does not ask.
      ring = outline.points;
      sketched = roughPolyline(ring, { seed, closed: false, level });
      return { outline: sketched, fill: '', silhouette: '' };
  }

  return {
    outline: sketched,
    fill: wantsFill ? shapeFill(ring, { seed, style, level }) : '',
    silhouette: wantsFill && style === 'solid' ? roughSilhouette(ring, { seed, level }) : '',
  };
}
