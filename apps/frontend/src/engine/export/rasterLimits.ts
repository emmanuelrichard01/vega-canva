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

/**
 * The long edge a copied image aims for.
 *
 * Roughly a full-width figure on a retina screen, and comfortably inside every
 * engine's canvas ceiling — so a pasted image is sharp where it lands without
 * putting a 60-megapixel bitmap on the clipboard.
 */
export const CLIPBOARD_TARGET_EDGE = 1600;

/**
 * How densely to rasterise something that is going on the clipboard.
 *
 * ## Why not just 2×
 *
 * Copy-to-clipboard used to take the exporter's default of 2× whatever the
 * subject was, and 2× is only ever right for one subject size. A 180-unit
 * sticky note arrived in a document as a **360px** image and went soft the
 * moment anyone dragged its corner out; a board four thousand units wide asked
 * for 8000px, hit the area cap, and came back at whatever `fitScale` allowed —
 * so the one number produced a thumbnail at one end and a clamp at the other.
 *
 * The thing being held constant should be the *result*, not the multiplier.
 * This aims the long edge at {@link CLIPBOARD_TARGET_EDGE} and clamps the
 * density to a sane band either side of it, so a small selection is copied at
 * high density and a large one at low, and both arrive at a usable size.
 *
 * The result still goes through `fitScale`, which is the browser's answer
 * rather than ours — this decides what to ask for, and that decides what is
 * possible.
 */
export function clipboardScale(
  width: number,
  height: number,
  /** Never below 1:1: a copy is not the place to throw detail away. */
  min = 1,
  /** Above 4× the file grows faster than the image improves. */
  max = 4
): number {
  const edge = Math.max(width, height, 1);
  const wanted = CLIPBOARD_TARGET_EDGE / edge;
  const banded = Math.min(max, Math.max(min, wanted));
  return fitScale(width, height, banded);
}
