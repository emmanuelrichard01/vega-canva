/**
 * Where several dropped images land.
 *
 * One image is placed centred on the drop point. Several are laid out as a
 * justified photo grid: rows of equal height that each fill the same width,
 * every picture at its own aspect ratio, so a dropped folder arrives as a
 * tidy contact sheet instead of a diagonal stack to sort out by hand.
 *
 * The last row keeps the target height rather than stretching to the full
 * width, so one leftover picture is not blown up across the board.
 */

export interface DropSize {
  width: number;
  height: number;
}

export interface DropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DropLayoutOptions {
  /** Row height to aim for, in world units. */
  rowHeight?: number;
  /** Space between pictures, in world units. */
  gap?: number;
  /** Width every full row fills. Defaults to a width that keeps the sheet roughly 4:3. */
  rowWidth?: number;
}

const DEFAULT_ROW_HEIGHT = 240;
const DEFAULT_GAP = 16;

function aspectOf(size: DropSize): number {
  const w = size.width > 0 ? size.width : 1;
  const h = size.height > 0 ? size.height : 1;
  // Clamp extreme panoramas and slivers so one picture cannot take a row alone
  // at an unreadable height.
  return Math.min(4, Math.max(0.25, w / h));
}

/**
 * Rectangles for each size, in input order, centred on `center`.
 */
export function layoutDroppedImages(
  sizes: readonly DropSize[],
  center: { x: number; y: number },
  options: DropLayoutOptions = {}
): DropRect[] {
  if (sizes.length === 0) return [];
  const rowHeight = options.rowHeight ?? DEFAULT_ROW_HEIGHT;
  const gap = options.gap ?? DEFAULT_GAP;

  if (sizes.length === 1) {
    const { width, height } = sizes[0];
    return [{ x: center.x - width / 2, y: center.y - height / 2, width, height }];
  }

  const aspects = sizes.map(aspectOf);
  const totalArea = aspects.reduce((sum, a) => sum + a * rowHeight * rowHeight, 0);
  const rowWidth = options.rowWidth ?? Math.max(rowHeight * 2, Math.sqrt(totalArea * (4 / 3)));

  const rects: DropRect[] = [];
  let y = 0;
  let start = 0;

  while (start < aspects.length) {
    // Take pictures until the row, at the target height, reaches the width.
    let end = start;
    let sumAspect = 0;
    while (end < aspects.length) {
      sumAspect += aspects[end];
      end += 1;
      const naturalWidth = sumAspect * rowHeight + gap * (end - start - 1);
      if (naturalWidth >= rowWidth) break;
    }

    const count = end - start;
    const isLastRow = end >= aspects.length;
    const gaps = gap * (count - 1);
    const fillHeight = (rowWidth - gaps) / sumAspect;
    // A full row is scaled to fill the width exactly; the last one is not
    // enlarged past the target height.
    const height = isLastRow ? Math.min(rowHeight, fillHeight) : fillHeight;

    let x = 0;
    for (let i = start; i < end; i++) {
      const width = aspects[i] * height;
      rects.push({ x, y, width, height });
      x += width + gap;
    }
    y += height + gap;
    start = end;
  }

  const sheetHeight = y - gap;
  const sheetWidth = Math.max(...rects.map((r) => r.x + r.width));
  const ox = center.x - sheetWidth / 2;
  const oy = center.y - sheetHeight / 2;
  return rects.map((r) => ({
    x: Math.round(ox + r.x),
    y: Math.round(oy + r.y),
    width: Math.max(1, Math.round(r.width)),
    height: Math.max(1, Math.round(r.height)),
  }));
}
