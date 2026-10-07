import { fullCrop, packCrop, readCrop, type Rect, type Size } from '../model/imageCrop';

/**
 * How a picture sits in its box: fit, fill, aspect presets, quarter turns.
 *
 * Pure geometry over the two rectangles `imageCrop.ts` describes — the node's
 * box in world units and the crop window in natural pixels — so every rule
 * here can be tested without a canvas. The callers write the result.
 *
 * ## Fit and fill, without a mode field
 *
 * Figma stores a scale mode on the image fill. This board stores the crop
 * window instead, which is enough to express both outcomes directly:
 *
 * - **Fit** shows the whole picture. The crop is cleared and the box takes the
 *   picture's proportions, inside the box it had.
 * - **Fill** keeps the box and fills it. The crop becomes the largest window of
 *   the box's proportions, centred where the picture was centred.
 *
 * A box whose proportions differ from its crop window is a *stretched*
 * picture. That is never chosen on purpose — it is what a free resize does —
 * so it is reported as its own state, and either button repairs it.
 */

export interface ImageBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type FrameMode = 'fit' | 'fill' | 'stretched';

/** Aspect presets offered for cropping, width over height. `null` is the picture's own. */
export interface AspectPreset {
  id: string;
  label: string;
  ratio: number | null;
}

export const ASPECT_PRESETS: readonly AspectPreset[] = [
  { id: 'original', label: 'Original', ratio: null },
  { id: '1:1', label: '1:1', ratio: 1 },
  { id: '4:5', label: '4:5', ratio: 4 / 5 },
  { id: '4:3', label: '4:3', ratio: 4 / 3 },
  { id: '3:2', label: '3:2', ratio: 3 / 2 },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
  { id: '9:16', label: '9:16', ratio: 9 / 16 },
];

/** How far two aspect ratios may differ, relatively, and still count as equal. */
const ASPECT_TOLERANCE = 0.01;

const usable = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
const round2 = (n: number) => Math.round(n * 100) / 100;

export function sameAspect(a: number, b: number): boolean {
  if (!usable(a) || !usable(b)) return false;
  return Math.abs(a / b - 1) <= ASPECT_TOLERANCE;
}

/**
 * The largest window of `ratio` inside the picture, centred on `centre`
 * (natural pixels) and pushed back inside the bitmap where it would overhang.
 */
export function windowOfAspect(natural: Size, ratio: number, centre?: { x: number; y: number }): Rect {
  if (!usable(natural.width) || !usable(natural.height) || !usable(ratio)) return fullCrop(natural);
  let width = natural.width;
  let height = width / ratio;
  if (height > natural.height) {
    height = natural.height;
    width = height * ratio;
  }
  const cx = centre?.x ?? natural.width / 2;
  const cy = centre?.y ?? natural.height / 2;
  const x = Math.min(natural.width - width, Math.max(0, cx - width / 2));
  const y = Math.min(natural.height - height, Math.max(0, cy - height / 2));
  return { x: round2(x), y: round2(y), width: round2(width), height: round2(height) };
}

const centreOf = (r: Rect) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

/** Which of fit, fill or stretched the picture is in now. */
export function frameModeOf(box: ImageBox, natural: Size, rawCrop: unknown): FrameMode | null {
  if (!usable(natural.width) || !usable(natural.height) || !usable(box.width) || !usable(box.height)) return null;
  const crop = readCrop(rawCrop, natural);
  if (!sameAspect(box.width / box.height, crop.width / crop.height)) return 'stretched';
  return packCrop(crop, natural) ? 'fill' : 'fit';
}

/**
 * Fit: the whole picture, at its own proportions, inside the box it had.
 * Centred on the old box, so the picture does not jump.
 */
export function fitImage(box: ImageBox, natural: Size): { box: ImageBox; crop: undefined } | null {
  if (!usable(natural.width) || !usable(natural.height) || !usable(box.width) || !usable(box.height)) return null;
  const ratio = natural.width / natural.height;
  let width = box.width;
  let height = width / ratio;
  if (height > box.height) {
    height = box.height;
    width = height * ratio;
  }
  return {
    box: {
      x: round2(box.x + (box.width - width) / 2),
      y: round2(box.y + (box.height - height) / 2),
      width: round2(width),
      height: round2(height),
    },
    crop: undefined,
  };
}

/**
 * Fill: the box stays put and the picture covers it, cropped at its edges.
 * Centred where the current window is centred, so a picture someone already
 * framed on a face keeps the face.
 */
export function fillImage(box: ImageBox, natural: Size, rawCrop: unknown): Rect | undefined | null {
  if (!usable(natural.width) || !usable(natural.height) || !usable(box.width) || !usable(box.height)) return null;
  const current = readCrop(rawCrop, natural);
  const crop = windowOfAspect(natural, box.width / box.height, centreOf(current));
  return packCrop(crop, natural);
}

/**
 * Crop to a preset's proportions, keeping the picture's scale on the board.
 *
 * The box changes shape around its own centre and the window over the picture
 * changes with it — the same thing dragging the crop handles does, so a preset
 * is a shortcut to a crop rather than a different kind of edit. `null` restores
 * the whole picture at its own proportions.
 */
export function cropToAspect(
  box: ImageBox,
  natural: Size,
  rawCrop: unknown,
  ratio: number | null
): { box: ImageBox; crop: Rect | undefined } | null {
  if (!usable(natural.width) || !usable(natural.height) || !usable(box.width) || !usable(box.height)) return null;
  const current = readCrop(rawCrop, natural);
  // World units per natural pixel along the width, which a crop preserves.
  const scale = box.width / current.width;
  const crop = ratio === null ? fullCrop(natural) : windowOfAspect(natural, ratio, centreOf(current));
  const width = crop.width * scale;
  const height = crop.height * scale;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  return {
    box: { x: round2(cx - width / 2), y: round2(cy - height / 2), width: round2(width), height: round2(height) },
    crop: packCrop(crop, natural),
  };
}

/** Which preset the current window matches, if any. */
export function matchingPreset(natural: Size, rawCrop: unknown): string | null {
  if (!usable(natural.width) || !usable(natural.height)) return null;
  const crop = readCrop(rawCrop, natural);
  if (!packCrop(crop, natural)) return 'original';
  const ratio = crop.width / crop.height;
  return ASPECT_PRESETS.find((p) => p.ratio !== null && sameAspect(p.ratio, ratio))?.id ?? null;
}

/** A quarter turn either way, kept in 0..360 so the panel never shows -90 or 450. */
export function quarterTurn(rotation: number, direction: 1 | -1): number {
  const base = Number.isFinite(rotation) ? rotation : 0;
  const snapped = Math.round(base / 90) * 90;
  // A picture already square turns a full quarter. One tilted off square
  // turns to the next quarter in that direction, so a 3° tilt lands at 90°
  // rather than 93°.
  const next =
    Math.abs(snapped - base) <= 0.5
      ? snapped + 90 * direction
      : (direction > 0 ? Math.ceil(base / 90) : Math.floor(base / 90)) * 90;
  return ((next % 360) + 360) % 360;
}

/**
 * The window a replacement picture opens with, so the frame does not change.
 *
 * Replace keeps the box; a new picture of different proportions would
 * otherwise be squashed into it. This is the fill window, centred.
 */
export function replacementCrop(box: Pick<ImageBox, 'width' | 'height'>, natural: Size): Rect | undefined {
  if (!usable(natural.width) || !usable(natural.height) || !usable(box.width) || !usable(box.height)) return undefined;
  return packCrop(windowOfAspect(natural, box.width / box.height), natural);
}

/** The size a picture is first placed at: its own, scaled down to fit `max` on its longer side. */
export function placementSize(natural: Size, max = 800): { width: number; height: number } {
  if (!usable(natural.width) || !usable(natural.height)) return { width: 300, height: 300 };
  const fit = Math.min(max / natural.width, max / natural.height, 1);
  return { width: Math.max(1, Math.round(natural.width * fit)), height: Math.max(1, Math.round(natural.height * fit)) };
}
