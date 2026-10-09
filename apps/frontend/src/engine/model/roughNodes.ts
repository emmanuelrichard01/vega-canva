/**
 * The sketched forms of the objects that are not shapes: a sticky's paper and
 * a pencil stroke.
 *
 * Here rather than in their renderers so the SVG exporter draws them through
 * the same functions, with the same seeds. A sketch is seeded, so two
 * implementations would not drift in style, they would draw two different
 * objects from one document.
 */

import { roughLoop, roughPolyline, roughSilhouette, seedFor, type SketchLevel } from './rough';
import { flapRing, foldedRing, foldSize } from './stickyFold';
import type { Appearance, Point } from './schema';

interface Seeded {
  id: string;
  appearance?: Pick<Appearance, 'sketchSeed'>;
}

/** The hairline a sticky's paper edge is drawn with; the sketcher scales its wander to it. */
export const STICKY_SKETCH_EDGE = 1.2;

export interface StickyPaper {
  /** The sheet's region, one closed wobbly contour, for the paper fill and grain. */
  silhouette: string;
  /** The edge drawn over it, one or two laps by level. */
  outline: string;
  /** The width the outline is stroked at. */
  edgeWidth: number;
  /**
   * The folded corner lying on the sheet, cut by the same hand: its region and
   * its edge. Empty strings when the note is too small to fold.
   */
  flap: { silhouette: string; outline: string };
}

/**
 * A sticky's sheet, cut by hand: a wobbly region and the pencil line round it,
 * with the bottom-right corner turned over as on the crisp paper (`stickyFold`).
 */
export function roughStickyPaper(
  node: Seeded & { width: number; height: number },
  level: SketchLevel
): StickyPaper {
  const fold = foldSize(node.width, node.height);
  const ring = foldedRing(node.width, node.height, fold);
  const flap = flapRing(node.width, node.height, fold);
  const seed = seedFor(node.id, node.appearance?.sketchSeed);
  // The flap's own seed, so its wobble is not the sheet's corner repeated.
  const flapSeed = (seed + 0x9e37) >>> 0;
  return {
    silhouette: roughSilhouette(ring, { seed, level, width: STICKY_SKETCH_EDGE }),
    outline: roughPolyline(ring, { seed, level, width: STICKY_SKETCH_EDGE }),
    edgeWidth: STICKY_SKETCH_EDGE,
    flap: {
      silhouette: flap.length ? roughSilhouette(flap, { seed: flapSeed, level, width: STICKY_SKETCH_EDGE }) : '',
      outline: flap.length ? roughPolyline(flap, { seed: flapSeed, level, width: STICKY_SKETCH_EDGE }) : '',
    },
  };
}

export interface PencilSketch {
  /** The run, as SVG path data in the node's local space. Empty for a dot. */
  d: string;
  /** The width it is stroked at. */
  nib: number;
}

/**
 * A pencil stroke, gone over by hand from its centreline.
 *
 * The stored stroke size is the width of perfect-freehand's outline, so the
 * sketched run is drawn at two thirds of it, which lands where the tapered
 * stroke looked. The wander is scaled to that nib, not to the outline weight.
 */
export function roughPencil(
  node: Seeded & { geometry: { points: readonly Point[]; strokeSize: number } },
  level: SketchLevel
): PencilSketch {
  const nib = Math.max(1, node.geometry.strokeSize * 0.66);
  if (node.geometry.points.length < 2) return { d: '', nib };
  return {
    d: roughLoop(node.geometry.points, {
      seed: seedFor(node.id, node.appearance?.sketchSeed),
      level,
      width: nib,
      closed: false,
    }),
    nib,
  };
}
