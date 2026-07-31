/**
 * Image cropping.
 *
 * `ImageNode.crop` has been on the schema for the project's whole life and
 * `ImageRenderer` never read it, so a stored crop was silently ignored. Fifth
 * of the seven dead items.
 *
 * ## Two coordinate spaces, and the rule that keeps them straight
 *
 * - **Natural pixels** — the source bitmap's own grid. `crop` lives here,
 *   because that is what Canvas2D's `drawImage` and Konva's `crop` attribute
 *   take, and because it is the only space that does not change when the
 *   object is resized on the board.
 * - **World units** — the node's box on the canvas. `x`/`y`/`width`/`height`
 *   live here.
 *
 * The link between them is the scale: `width / crop.width` world units per
 * natural pixel. Every operation below **clamps in natural space and derives
 * the node box from the result**, never the other way round. Clamping the node
 * box first and converting afterwards lets rounding push the crop a fraction
 * outside the bitmap, and Canvas2D silently draws a transparent edge for the
 * part that is off the source — a one-pixel transparent seam that appears only
 * at certain sizes, which is a genuinely horrible bug to chase.
 *
 * ## What dragging a handle means
 *
 * The content stays where it is and the window over it changes — the node's
 * box moves with the handle. This is what cropping means everywhere else
 * (Figma, Illustrator, Canva): you are trimming the frame, not rescaling the
 * picture. Re-fitting the remaining source into the original box would instead
 * make the image appear to zoom whenever you trimmed an edge.
 */

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The two rectangles that describe a cropped image, kept in step. */
export interface CropState {
  /** The node's box, in world units. */
  node: Rect;
  /** The window onto the source, in natural pixels. */
  crop: Rect;
}

export type CropHandle = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';

export const CROP_HANDLES: CropHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/**
 * The smallest crop window, in natural pixels.
 *
 * Small enough not to get in the way, large enough that the window cannot be
 * driven to zero — a zero-width crop makes `drawImage` throw on some browsers
 * and draw nothing on others, and there is no gesture that recovers from it.
 */
export const MIN_CROP_PX = 8;

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** Whether a value is a usable positive dimension. */
const usable = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

/** The whole image: what an uncropped node is showing. */
export function fullCrop(natural: Size): Rect {
  return { x: 0, y: 0, width: natural.width, height: natural.height };
}

/**
 * Read a stored crop, or fall back to the whole image.
 *
 * A crop that does not fit its bitmap is discarded rather than clamped. It
 * means the stored crop belongs to a different image — the node's `src` was
 * replaced, which is exactly what an upload completing does — and a clamped
 * leftover would show an arbitrary corner of the new picture with no
 * indication why.
 */
export function readCrop(raw: unknown, natural: Size): Rect {
  if (!usable(natural.width) || !usable(natural.height)) return { x: 0, y: 0, width: 0, height: 0 };
  const c = raw as Partial<Rect> | undefined | null;
  if (
    !c ||
    !usable(c.width) ||
    !usable(c.height) ||
    typeof c.x !== 'number' ||
    typeof c.y !== 'number' ||
    !Number.isFinite(c.x) ||
    !Number.isFinite(c.y)
  ) {
    return fullCrop(natural);
  }
  const fits =
    c.x >= -0.5 &&
    c.y >= -0.5 &&
    c.x + c.width <= natural.width + 0.5 &&
    c.y + c.height <= natural.height + 0.5;
  return fits ? { x: c.x, y: c.y, width: c.width, height: c.height } : fullCrop(natural);
}

/** Whether this crop actually hides anything. */
export function isCropped(crop: Rect, natural: Size): boolean {
  return (
    crop.x > 0.5 ||
    crop.y > 0.5 ||
    crop.width < natural.width - 0.5 ||
    crop.height < natural.height - 0.5
  );
}

/**
 * Store the crop, or `undefined` when the whole image is showing.
 *
 * Same reasoning as `packAdjustments`: an uncropped image should not carry a
 * crop rectangle that merely happens to equal its own bounds, or "is this
 * cropped" stops being answerable by the presence of the key and starts
 * needing a comparison every reader has to remember to make.
 */
export function packCrop(crop: Rect, natural: Size): Rect | undefined {
  return isCropped(crop, natural) ? crop : undefined;
}

/**
 * World units per natural pixel, on each axis.
 *
 * Falls back to 1 for a degenerate state so that *drawing* code cannot produce
 * `NaN` geometry. Callers that are about to **write** must not lean on that
 * fallback to decide whether the state is sane — it manufactures a plausible
 * number out of nonsense, which is how a zero-sized crop got through a scale
 * check and came out as a 10-unit one. Use `canCrop` for that.
 */
export function cropScale(state: CropState): { x: number; y: number } {
  return {
    x: state.crop.width > 0 ? state.node.width / state.crop.width : 1,
    y: state.crop.height > 0 ? state.node.height / state.crop.height : 1,
  };
}

/**
 * Whether this state can be cropped at all.
 *
 * Checks the inputs rather than anything derived from them. An image whose
 * bitmap has not loaded has no natural size, and a node collapsed to nothing
 * has no scale — in both cases every gesture below must be a no-op rather than
 * an operation on invented numbers.
 */
export function canCrop(state: CropState, natural: Size): boolean {
  return (
    usable(natural.width) &&
    usable(natural.height) &&
    usable(state.crop.width) &&
    usable(state.crop.height) &&
    usable(state.node.width) &&
    usable(state.node.height)
  );
}

/**
 * Drag a crop handle by a world-space delta.
 *
 * The moving edges are resolved in natural space and clamped there — against
 * the bitmap on the outside and against `MIN_CROP_PX` on the inside — and the
 * node box is then derived from the result. So a handle dragged past the edge
 * of the source simply stops, and the node's box stops with it, instead of the
 * two drifting apart by the overshoot.
 */
export function dragCropHandle(
  state: CropState,
  natural: Size,
  handle: CropHandle,
  deltaWorld: { x: number; y: number }
): CropState {
  if (!canCrop(state, natural)) return state;
  const scale = cropScale(state);

  const dxNatural = deltaWorld.x / scale.x;
  const dyNatural = deltaWorld.y / scale.y;

  // The crop's edges, which is the form the clamping is expressible in.
  let left = state.crop.x;
  let top = state.crop.y;
  let right = state.crop.x + state.crop.width;
  let bottom = state.crop.y + state.crop.height;

  if (handle.includes('w')) left = clamp(left + dxNatural, 0, right - MIN_CROP_PX);
  if (handle.includes('e')) right = clamp(right + dxNatural, left + MIN_CROP_PX, natural.width);
  if (handle.includes('n')) top = clamp(top + dyNatural, 0, bottom - MIN_CROP_PX);
  if (handle.includes('s')) bottom = clamp(bottom + dyNatural, top + MIN_CROP_PX, natural.height);

  const crop: Rect = { x: left, y: top, width: right - left, height: bottom - top };

  // Derived, so the two rectangles cannot disagree after a clamp. The node's
  // top-left moves only by however much the crop's top-left actually moved.
  const node: Rect = {
    x: state.node.x + (crop.x - state.crop.x) * scale.x,
    y: state.node.y + (crop.y - state.crop.y) * scale.y,
    width: crop.width * scale.x,
    height: crop.height * scale.y,
  };

  return { node, crop };
}

/**
 * Slide the picture underneath a fixed window.
 *
 * Dragging the image right must reveal what is to its left, so the window
 * moves the *opposite* way to the pointer. The node's box does not move at
 * all: this is the one crop gesture that changes what is shown without
 * changing where the object sits on the board.
 */
export function panCropWindow(
  state: CropState,
  natural: Size,
  deltaWorld: { x: number; y: number }
): CropState {
  if (!canCrop(state, natural)) return state;
  const scale = cropScale(state);

  return {
    node: state.node,
    crop: {
      ...state.crop,
      x: clamp(state.crop.x - deltaWorld.x / scale.x, 0, Math.max(0, natural.width - state.crop.width)),
      y: clamp(state.crop.y - deltaWorld.y / scale.y, 0, Math.max(0, natural.height - state.crop.height)),
    },
  };
}

/**
 * Where the whole source sits, in world units, given the current window.
 *
 * This is what the dimmed "what you are cutting off" layer is drawn with:
 * the same picture at the same scale, positioned so the visible window lands
 * exactly over the node's box.
 */
export function sourceBoxInWorld(state: CropState, natural: Size): Rect {
  const scale = cropScale(state);
  return {
    x: state.node.x - state.crop.x * scale.x,
    y: state.node.y - state.crop.y * scale.y,
    width: natural.width * scale.x,
    height: natural.height * scale.y,
  };
}
