import { SHAPE_SPECS, type MermaidShape } from './mermaid';
import { shapeToPath } from '../model/shapeToPath';
import { shapeFeaturePaths } from '../model/shapes/features';
import { subpathsOf, pathData } from '../model/pathGeometry';
import type { ShapeNode } from '../model/schema';

/**
 * What a mermaid shape looks like — asked of the thing that actually draws it.
 *
 * ## The bug class this closes for good
 *
 * A mermaid shape used to be described twice: `build.ts` turned it into a
 * canvas node, and `MermaidModal` drew its own SVG for the preview. The two
 * descriptions were written by hand, from the same table, and they disagreed —
 * first for three shapes that fell through a `switch`, and then, more quietly,
 * for every shape whose canvas geometry carried detail the preview's
 * vocabulary could not spell. The preview drew a rounded rectangle where the
 * board drew a cylinder, because "rounded rectangle" was the closest thing the
 * preview knew how to say.
 *
 * The durable fix is not a third table or a test that watches two tables
 * drift. It is to stop having a second description at all. This builds the
 * *same node* `build.ts` will build and asks `shapeToPath` — the function the
 * canvas renderer, the SVG exporter and the effect layers all use — what
 * outline that node has. The preview can now only be wrong in the way the
 * board is wrong, which is the only guarantee worth having.
 *
 * ## Interior detail comes from the same place
 *
 * The bars down a subroutine, the rims on a cylinder and the rule across an
 * internal-storage box are not ornament the preview invents any more; they are
 * `shapeFeatureContours`, the canvas's own answer, asked for the same node.
 * That is why the preview's cylinder now has the right number of rims: it is
 * not drawing a cylinder, it is drawing *this* cylinder.
 */

/** A mermaid shape's drawing, in a box at the origin. */
export interface Silhouette {
  /** The outline, as SVG path data. Everything is a path here — see above. */
  d: string;
  /** Interior lines, drawn stroked and unfilled over the outline. */
  features: string[];
  /**
   * A second outline drawn inside the first, as a fraction of the box inset.
   *
   * The one piece of mermaid vocabulary the canvas genuinely has no kind for:
   * `(((double circle)))` marks a terminal state with a ring inside the
   * circle, and no single canvas shape draws that. `build.ts` emits the outer
   * circle alone, so the preview shows the ring only where the board can
   * honour it — which today is nowhere, and this stays `undefined`.
   *
   * Kept as a field rather than deleted because the alternative is the
   * preview quietly drawing something the insert will not, which is the exact
   * failure this module exists to prevent.
   */
  inset?: number;
}

/**
 * The node `build.ts` would create for this shape at this size.
 *
 * Only the three fields `shapeToPath` and `shapeFeatureContours` read, so this
 * is a real answer rather than a resemblance: if `build.ts` and this ever
 * disagreed about a shape's geometry, `silhouette.test.ts` would catch it,
 * because both derive the geometry from `SHAPE_SPECS` by the same rule.
 */
export function nodeForShape(
  shape: MermaidShape,
  width: number,
  height: number
): Pick<ShapeNode, 'geometry' | 'width' | 'height' | 'appearance'> {
  const spec = SHAPE_SPECS[shape] ?? { kind: 'rect' as const };
  return {
    width,
    height,
    geometry: {
      kind: spec.kind,
      ...(spec.points !== undefined ? { points: spec.points } : {}),
      ...(spec.params ?? {}),
    },
    appearance: spec.cornerRadius !== undefined ? { cornerRadius: spec.cornerRadius } : {},
  };
}

/** Every subpath of a contour as one `d` string, so a compound shape draws whole. */
function wholePath(geo: ReturnType<typeof shapeToPath>): string {
  return subpathsOf(geo).map(pathData).join(' ');
}

export function silhouetteFor(shape: MermaidShape, width: number, height: number): Silhouette {
  const node = nodeForShape(shape, width, height);
  return {
    d: wholePath(shapeToPath(node)),
    features: shapeFeaturePaths(node),
  };
}

/** The drawn radius, once the box is known. */
export function clampRadius(cornerRadius: number, width: number, height: number): number {
  return Math.min(cornerRadius, Math.min(width, height) / 2);
}
