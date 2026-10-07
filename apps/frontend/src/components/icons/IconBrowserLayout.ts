/**
 * How the icon library lays its tiles across the list.
 *
 * The grid is centred in the list's content box, so the space left of the
 * first column always equals the space right of the last, whatever the panel
 * width and whether or not a scrollbar takes a gutter (the list reserves one
 * on both sides, see `.icb__list`). A grid pinned to the left edge left the
 * remainder of the division as a strip of empty space on the right.
 */
export const ICON_TILE_W = 84;
export const ICON_GAP = 4;
/** The least space kept between the list's edge and the grid. */
export const ICON_MIN_INSET = 8;

export interface IconGrid {
  cols: number;
  /** The grid's own width. */
  width: number;
  /** The left offset of the grid, and the space after its last column. */
  inset: number;
}

export function iconGrid(viewW: number): IconGrid {
  const usable = Math.max(0, viewW - 2 * ICON_MIN_INSET);
  const cols = Math.max(1, Math.floor((usable + ICON_GAP) / (ICON_TILE_W + ICON_GAP)));
  const width = cols * ICON_TILE_W + (cols - 1) * ICON_GAP;
  const inset = Math.max(0, Math.floor((viewW - width) / 2));
  return { cols, width, inset };
}
