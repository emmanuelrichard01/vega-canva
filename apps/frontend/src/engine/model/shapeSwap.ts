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

import { isOpenShape, type ShapeGeometry, type ShapeKind } from './schema';

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
  // Kinds that feature an interior ratio or depth
  if (kind === 'star' || kind === 'donut' || kind === 'badge') {
    next.innerRatio = geometry.innerRatio ?? (kind === 'badge' ? 0.85 : 0.5);
  }
  if (kind === 'parallelogram') next.skew = geometry.skew ?? 0.2;
  if (kind === 'trapezoid') next.inset = geometry.inset ?? 0.2;
  if (kind === 'chevron') next.indent = geometry.indent ?? 0.25;
  if (kind === 'cross') next.armRatio = geometry.armRatio ?? 0.33;
  if (kind === 'cylinder') next.rimRatio = geometry.rimRatio ?? 0.18;
  if (kind === 'callout') {
    next.tailPosition = geometry.tailPosition ?? 'bottom-left';
    next.tailSize = geometry.tailSize ?? 16;
  }
  if (kind === 'document') next.waveHeight = geometry.waveHeight ?? 0.15;
  if (kind === 'cpu') next.pinCount = geometry.pinCount ?? 6;
  if (kind === 'gear') {
    next.teeth = geometry.teeth ?? (geometry.points ? Math.max(4, Math.min(24, geometry.points)) : 8);
  }
  if (kind === 'server') next.shelfCount = geometry.shelfCount ?? 3;

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
