/**
 * Changing a shape's form without carrying the last form's fields along.
 *
 * ## What was wrong with spreading the old geometry
 *
 * Both places that swap a shape's kind did the obvious thing:
 *
 * ```ts
 * { ...node.geometry, kind }
 * ```
 *
 * Which keeps everything, including the fields the new kind has no use for. A
 * rectangle made from a wavy arrow carried `lineProfile`, `endEnd`, `endScale`,
 * `endAlign` and both endpoints; a triangle made from a star kept its
 * `innerRatio`. None of it renders, so it looks harmless — and it is not, for
 * two reasons.
 *
 * The first is that it comes back. Swap the rectangle to a line again and the
 * old endpoints are still there, still local to a box that has since been
 * resized — so the line reappears somewhere it has never been, at a length
 * nobody chose. That was already reachable with the two-point form and became
 * far more visible once a line could store a whole run of corners.
 *
 * The second is that dead fields are how a reader stops being able to tell what
 * a node means. A rectangle with `endStart: 'diamond'` in its geometry is a
 * question every future maintainer has to answer before they can change
 * anything near it.
 *
 * So a swap says explicitly what the new kind keeps. Pure, tested, and shared
 * by the two callers — the rail's shape picker and the context menu's — because
 * two implementations of "what survives a swap" is exactly the kind of pair
 * that drifts.
 */

import { DEFAULT_STAR_RATIO, isOpenShape, type ShapeGeometry, type ShapeKind } from './schema';
import { clampParam, shapeParams } from './shapeParams';

/**
 * The geometry for `kind`, carrying over only what that kind can express.
 *
 * @param points a side or point count from the caller, for the kinds that have
 *   one. Passed rather than inferred because the picker offers named counts —
 *   "pentagon" — and the model stores one `polygon` with a number.
 */
export function swapShapeKind(
  geometry: ShapeGeometry,
  kind: ShapeKind,
  points?: number
): ShapeGeometry {
  const next: ShapeGeometry = { kind };

  /**
   * How many sides or points, for the kinds that have a count.
   */
  if (kind === 'polygon' || kind === 'star' || kind === 'badge') {
    const carried = points ?? geometry.points;
    if (carried !== undefined) next.points = carried;
  }
  // A star has a depth that is not a dial in `SHAPE_PARAMS` — the panel gives
  // it a control of its own, bounded by the schema — so it is carried here.
  if (kind === 'star') next.innerRatio = geometry.innerRatio ?? DEFAULT_STAR_RATIO;

  /**
   * Every parametric dial the new kind has, carried across or seeded.
   *
   * This was two dozen hand-written lines, one per field, each with its own
   * `?? default` — a fourth copy of numbers that `SHAPE_PARAMS` already held,
   * and one of them had already drifted: a chip made by *swapping* got six
   * pins, while a chip made by *drawing* got three, because the swapper's
   * literal and the table's fallback were different numbers.
   *
   * Reading the table also means a new parametric shape needs no edit here at
   * all. Three of the kinds added in the same change as this comment —
   * preparation, block arrow, ribbon — would otherwise each have needed a line,
   * and a shape that swaps into a state its own panel cannot describe is the
   * failure that line exists to prevent.
   */
  for (const dial of shapeParams(kind)) {
    if (dial.field === 'points' || dial.field === 'innerRatio') {
      // Both are already handled above, where the counts a preset carries are
      // negotiated with the ones the old shape had.
      if (next[dial.field] === undefined) {
        next[dial.field] = clampParam(dial, geometry[dial.field] ?? dial.fallback);
      }
      continue;
    }
    next[dial.field] = clampParam(dial, geometry[dial.field] ?? dial.fallback);
  }

  if (kind === 'callout') {
    next.tailPosition = geometry.tailPosition ?? 'bottom-left';
  }
  // A gear's teeth and a polygon's sides are both "how many points around", so
  // a hexagon swapped to a gear keeps its six rather than jumping to the
  // default. The clamp is the table's, so a 60-sided polygon lands on the most
  // teeth a gear can draw rather than on an illegal value.
  if (kind === 'gear' && geometry.teeth === undefined && geometry.points !== undefined) {
    const teeth = shapeParams('gear').find((p) => p.field === 'teeth');
    if (teeth) next.teeth = clampParam(teeth, geometry.points);
  }

  if (isOpenShape(kind)) {
    /**
     * A run keeps its run.
     *
     * Line and arrow differ only in which cap they default to, so swapping
     * between them must not disturb the shape — that is the whole reason they
     * are one kind with a cap setting rather than two geometries.
     */
    if (isOpenShape(geometry.kind)) {
      if (geometry.a) next.a = { ...geometry.a };
      if (geometry.b) next.b = { ...geometry.b };
      if (geometry.vertices) next.vertices = geometry.vertices.map((p) => ({ ...p }));
      if (geometry.bends) next.bends = geometry.bends.map((bend) => (bend ? { ...bend } : null));
      if (geometry.smooth) next.smooth = true;
      if (geometry.lineProfile) next.lineProfile = geometry.lineProfile;
      if (geometry.lineWaves !== undefined) next.lineWaves = geometry.lineWaves;
      if (geometry.lineAmplitude !== undefined) next.lineAmplitude = geometry.lineAmplitude;
      if (geometry.endAlign) next.endAlign = geometry.endAlign;
      if (geometry.endStart) next.endStart = geometry.endStart;
      if (geometry.endEnd) next.endEnd = geometry.endEnd;
      if (geometry.endScale !== undefined) next.endScale = geometry.endScale;
    }

    /**
     * An arrow gets a head if it has none.
     *
     * Picking "arrow" and getting a line with no head would make the control
     * look broken. The reverse is deliberately *not* done: picking "line" does
     * not strip a cap, because caps are independently editable and silently
     * throwing away a chosen diamond terminator is a bigger surprise than a
     * line that happens to have one.
     */
    if (kind === 'arrow' && (next.endEnd ?? 'none') === 'none') next.endEnd = 'arrow';
    return next;
  }

  /**
   * A closed shape keeps nothing from the run.
   *
   * Its box is already the extent of what the line drew, which is the right
   * size for the rectangle that replaces it — so there is nothing left for the
   * endpoints, the profile or the caps to contribute, and everything for them
   * to confuse.
   */
  return next;
}
