/**
 * What a browser will actually let us rasterise.
 *
 * Kept apart from `raster.ts` because that module has to reach the document
 * store and therefore the `window` the store reads at import time. This is
 * arithmetic, it decides whether an export succeeds or comes back blank, and it
 * runs in Node.
 */

/**
 * Browsers cap canvas dimensions. Exceeding the cap yields a blank image
 * rather than an error, so the scale is reduced to fit instead.
 */
export const MAX_CANVAS_EDGE = 8192;

/**
 * And they cap total **area** separately, which is the one that actually bites.
 *
 * `raster.ts` has said "and total area" in its own comment since the cap was
 * introduced, while the code clamped each edge alone — so an 8192 × 8192 export
 * passed both edge checks at 67 megapixels and came back **blank** on any engine
 * holding the common 16,777,216 px (4096²) ceiling, which is every Safari and
 * every browser on iOS. A blank PNG with no error is the worst failure shape
 * available: the download succeeds, the file is the right size on disk, and it
 * is empty.
 *
 * 16 megapixels is the conservative floor across engines rather than Chrome's
 * much larger allowance, because the export that silently fails is the one
 * taken on somebody else's machine.
 */
export const MAX_CANVAS_AREA = 16_777_216;

/**
 * The largest scale this browser can actually render these bounds at.
 *
 * Exported so the dialog can say *before* the export that 4× is not going to
 * happen, rather than handing back a quietly downscaled file. One function, so
 * the warning and the capture cannot disagree.
 */
export function fitScale(width: number, height: number, requested: number): number {
  const w = Math.max(width, 1);
  const h = Math.max(height, 1);
  const byEdge = Math.min(MAX_CANVAS_EDGE / w, MAX_CANVAS_EDGE / h);
  // sqrt, because area grows with the square of the scale.
  const byArea = Math.sqrt(MAX_CANVAS_AREA / (w * h));
  const fitted = Math.min(requested, byEdge, byArea);
  /**
   * Never reduced below 1:1 by the caps.
   *
   * A board already larger than the ceiling at its own size would otherwise be
   * shrunk below full size, which trades a blank image for an illegible one.
   * Clamped at 1× the browser may still refuse, but the alternative silently
   * destroys detail on the documents most likely to be worth exporting.
   * A caller asking for less than 1× is honoured — that is a deliberate choice,
   * not the cap talking.
   */
  return Math.max(fitted, Math.min(requested, 1));
}
