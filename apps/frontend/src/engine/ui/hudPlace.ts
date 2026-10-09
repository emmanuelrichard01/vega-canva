/**
 * Where a heads-up pill sits on screen.
 *
 * Pure screen-space arithmetic, separate from the layer that draws, so the
 * rules that matter can be tested without a DOM:
 *
 * - **below** (anything with a box): centred under the box, clear of its
 *   bottom handles, as Figma's dimension pill is. Near the bottom edge it
 *   flips above the box, never onto it, since the box is what is being read.
 * - **pointer** (a run being drawn, a point being placed): beside and below
 *   the pointer, flipping left and up near the right and bottom edges, so the
 *   hand never sits on the number.
 *
 * Either way the pill is kept inside the viewport by `margin`.
 */

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface ScreenBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type HudPlacement = 'below' | 'pointer';

export interface PlaceInput {
  /** The point the reading belongs to. With `box`, ignored for `below`. */
  anchor: ScreenPoint;
  /** The thing being measured, when there is one. */
  box?: ScreenBox | null;
  /** The pill's own size. */
  size: { width: number; height: number };
  viewport: { width: number; height: number };
  placement: HudPlacement;
}

export interface Placed {
  x: number;
  y: number;
  /** Which side of its anchor it ended up on, for the pulse's origin and for tests. */
  side: 'below' | 'above' | 'inside';
  /** Whether it went left of the pointer (`pointer` placement only). */
  flippedX: boolean;
}

/** Clear of the selection's bottom handles and their padding. */
export const HUD_BOX_GAP = 14;
/** Beside the pointer: past the arrow's tip and the crosshair arms. */
export const HUD_POINTER_OFFSET = 16;
/** How close to the viewport edge a pill may sit. */
export const HUD_EDGE_MARGIN = 8;

const clamp = (value: number, min: number, max: number) => (max < min ? min : Math.min(max, Math.max(min, value)));

export function placeHudPill(input: PlaceInput): Placed {
  const { anchor, box, size, viewport, placement } = input;
  const minX = HUD_EDGE_MARGIN;
  const maxX = viewport.width - HUD_EDGE_MARGIN - size.width;
  const minY = HUD_EDGE_MARGIN;
  const maxY = viewport.height - HUD_EDGE_MARGIN - size.height;

  if (placement === 'pointer') {
    let x = anchor.x + HUD_POINTER_OFFSET;
    let flippedX = false;
    if (x > maxX) {
      x = anchor.x - HUD_POINTER_OFFSET - size.width;
      flippedX = true;
    }
    let y = anchor.y + HUD_POINTER_OFFSET;
    let side: Placed['side'] = 'below';
    if (y > maxY) {
      y = anchor.y - HUD_POINTER_OFFSET - size.height;
      side = 'above';
    }
    return { x: clamp(x, minX, maxX), y: clamp(y, minY, maxY), side, flippedX };
  }

  const top = box ? box.y : anchor.y;
  const bottom = box ? box.y + box.height : anchor.y;
  const centre = box ? box.x + box.width / 2 : anchor.x;
  const x = clamp(centre - size.width / 2, minX, maxX);

  const below = bottom + HUD_BOX_GAP;
  if (below <= maxY) return { x, y: Math.max(minY, below), side: 'below', flippedX: false };

  const above = top - HUD_BOX_GAP - size.height;
  if (above >= minY) return { x, y: above, side: 'above', flippedX: false };

  // The box fills the viewport top to bottom: the only clear place left is
  // inside it, pinned to the bottom edge where the eye already expects it.
  return { x, y: clamp(maxY, minY, maxY), side: 'inside', flippedX: false };
}

/** A world box on screen, given the camera (stage-relative coordinates). */
export function worldBoxToScreen(
  box: ScreenBox,
  camera: { x: number; y: number; zoom: number }
): ScreenBox {
  return {
    x: box.x * camera.zoom + camera.x,
    y: box.y * camera.zoom + camera.y,
    width: box.width * camera.zoom,
    height: box.height * camera.zoom,
  };
}

export function worldPointToScreen(point: ScreenPoint, camera: { x: number; y: number; zoom: number }): ScreenPoint {
  return { x: point.x * camera.zoom + camera.x, y: point.y * camera.zoom + camera.y };
}

/**
 * The axis-aligned bounds of a box turned `deg` about its centre.
 *
 * A pill placed under a rotated object goes under what is actually drawn, not
 * under the unrotated box, which a turned shape's corner can hang below.
 */
export function rotatedBounds(box: ScreenBox, deg: number): ScreenBox {
  if (!deg || !Number.isFinite(deg)) return { ...box };
  const rad = (deg * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const width = box.width * cos + box.height * sin;
  const height = box.width * sin + box.height * cos;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  return { x: cx - width / 2, y: cy - height / 2, width, height };
}
