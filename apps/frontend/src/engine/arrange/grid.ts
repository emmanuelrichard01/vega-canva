import { clusterAxis } from '../grid/arrangeInGrid';
import type { Box } from '../model/selection';

/**
 * The live grid: a loose selection laid out in rows and columns that stay
 * adjustable until the person is done with them.
 *
 * Tracks are sized like CSS grid `auto` tracks: each column is as wide as its
 * widest item and each row as tall as its tallest, so a mix of sizes packs
 * without the empty slabs a uniform cell leaves. Items fill in reading order,
 * and each one sits inside its cell by `alignX` / `alignY`.
 *
 * Pure: the session (`./session`) holds the state, this only answers "where".
 */

export type CellAlign = 'start' | 'center' | 'end';

export interface GridSpec {
  columns: number;
  colGap: number;
  rowGap: number;
  alignX: CellAlign;
  alignY: CellAlign;
}

export interface GridItem {
  key: string;
  width: number;
  height: number;
}

export interface GridCell {
  key: string;
  index: number;
  row: number;
  column: number;
  /** The cell's own box (track extents). */
  cell: Box;
  /** Where the item's box lands inside the cell. */
  place: Box;
}

export interface GridLayout {
  columns: number;
  rows: number;
  origin: { x: number; y: number };
  /** Left edge of each column and top edge of each row, in world units. */
  colX: number[];
  rowY: number[];
  colWidths: number[];
  rowHeights: number[];
  width: number;
  height: number;
  cells: GridCell[];
}

export const MAX_COLUMNS = 24;
export const MAX_GAP = 400;
export const DEFAULT_GAP = 24;

const clampInt = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v)));

/** A spec made safe: whole columns between 1 and the item count, gaps within range. */
export function normaliseSpec(spec: GridSpec, count: number): GridSpec {
  return {
    ...spec,
    columns: clampInt(Number.isFinite(spec.columns) ? spec.columns : 1, 1, Math.max(1, Math.min(MAX_COLUMNS, count))),
    colGap: clampInt(Number.isFinite(spec.colGap) ? spec.colGap : DEFAULT_GAP, 0, MAX_GAP),
    rowGap: clampInt(Number.isFinite(spec.rowGap) ? spec.rowGap : DEFAULT_GAP, 0, MAX_GAP),
  };
}

const offset = (align: CellAlign, room: number) => (align === 'start' ? 0 : align === 'center' ? room / 2 : room);

/** Lay `items`, in order, into the grid `spec` describes, starting at `origin`. */
export function layoutGrid(items: readonly GridItem[], specIn: GridSpec, origin: { x: number; y: number }): GridLayout {
  const spec = normaliseSpec(specIn, items.length);
  const columns = spec.columns;
  const rows = Math.max(1, Math.ceil(items.length / columns));
  const colWidths = new Array<number>(columns).fill(0);
  const rowHeights = new Array<number>(rows).fill(0);
  items.forEach((item, i) => {
    const r = Math.floor(i / columns);
    const c = i % columns;
    colWidths[c] = Math.max(colWidths[c], item.width);
    rowHeights[r] = Math.max(rowHeights[r], item.height);
  });

  const colX: number[] = [];
  let x = origin.x;
  for (let c = 0; c < columns; c++) {
    colX.push(x);
    x += colWidths[c] + spec.colGap;
  }
  const rowY: number[] = [];
  let y = origin.y;
  for (let r = 0; r < rows; r++) {
    rowY.push(y);
    y += rowHeights[r] + spec.rowGap;
  }

  const cells: GridCell[] = items.map((item, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const cell = { x: colX[column], y: rowY[row], width: colWidths[column], height: rowHeights[row] };
    const place = {
      x: cell.x + offset(spec.alignX, cell.width - item.width),
      y: cell.y + offset(spec.alignY, cell.height - item.height),
      width: item.width,
      height: item.height,
    };
    return { key: item.key, index, row, column, cell, place };
  });

  const width = colWidths.reduce((s, w) => s + w, 0) + spec.colGap * (columns - 1);
  const height = rowHeights.reduce((s, h) => s + h, 0) + spec.rowGap * (rows - 1);
  return { columns, rows, origin, colX, rowY, colWidths, rowHeights, width, height, cells };
}

const median = (values: readonly number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

export interface GridGuess {
  spec: GridSpec;
  /** Keys in reading order: the order the grid fills in. */
  order: string[];
  /** The top-left the grid grows from. */
  origin: { x: number; y: number };
}

/**
 * The grid a selection is already trying to be.
 *
 * Columns and rows come from clustering the centres (the same reading
 * `arrangeInGrid` uses), the order is reading order through those clusters,
 * and the gaps are the median space people already left between neighbours.
 * A pile with no readable structure (everything overlapping in one cluster)
 * gets the squarest grid that holds it.
 */
export function guessGrid(boxes: ReadonlyArray<{ key: string; box: Box }>): GridGuess {
  const n = boxes.length;
  const origin = {
    x: Math.min(...boxes.map((b) => b.box.x)),
    y: Math.min(...boxes.map((b) => b.box.y)),
  };
  const cx = boxes.map((b) => b.box.x + b.box.width / 2);
  const cy = boxes.map((b) => b.box.y + b.box.height / 2);
  const typicalW = median(boxes.map((b) => b.box.width)) ?? 1;
  const typicalH = median(boxes.map((b) => b.box.height)) ?? 1;
  const cols = clusterAxis(cx, typicalW);
  const rows = clusterAxis(cy, typicalH);

  let columns: number;
  if (cols.count <= 1 && rows.count <= 1) columns = Math.ceil(Math.sqrt(n));
  else if (rows.count <= 1) columns = n;
  else columns = Math.max(1, cols.count);

  const order = boxes
    .map((b, i) => ({ key: b.key, r: rows.count <= 1 ? 0 : rows.of[i], x: cx[i], y: cy[i] }))
    .sort((a, b) => a.r - b.r || a.x - b.x || a.y - b.y || (a.key < b.key ? -1 : 1))
    .map((e) => e.key);

  /** For each box, the space to its nearest neighbour further along `axis` that shares the other axis. */
  const gaps = (axis: 'x' | 'y') => {
    const found: number[] = [];
    const sizeKey = axis === 'x' ? 'width' : 'height';
    const cross = axis === 'x' ? 'y' : 'x';
    const crossSize = axis === 'x' ? 'height' : 'width';
    for (const { box: a } of boxes) {
      let nearest = Infinity;
      for (const { box: b } of boxes) {
        if (b === a || b[axis] <= a[axis]) continue;
        const overlap = Math.min(a[cross] + a[crossSize], b[cross] + b[crossSize]) - Math.max(a[cross], b[cross]);
        if (overlap <= 0) continue;
        const g = b[axis] - (a[axis] + a[sizeKey]);
        if (g > 0 && g < nearest) nearest = g;
      }
      if (Number.isFinite(nearest)) found.push(nearest);
    }
    const m = median(found);
    return m === null ? DEFAULT_GAP : clampInt(m, 0, MAX_GAP);
  };

  const colGap = gaps('x');
  const rowGap = rows.count > 1 ? gaps('y') : colGap;
  return {
    spec: normaliseSpec({ columns, colGap, rowGap, alignX: 'start', alignY: 'start' }, n),
    order,
    origin,
  };
}

/** Move one key to a new index in the order, the rest closing up behind it. */
export function moveInOrder(order: readonly string[], key: string, to: number): string[] {
  const from = order.indexOf(key);
  if (from < 0) return [...order];
  const next = order.filter((k) => k !== key);
  next.splice(Math.max(0, Math.min(next.length, to)), 0, key);
  return next;
}

/**
 * Which slot a point is over, for dropping a dragged item: the cell whose box
 * holds it, or else the nearest cell centre. Gaps count toward the nearer side.
 */
export function slotAt(layout: GridLayout, point: { x: number; y: number }): number {
  let best = 0;
  let bestD = Infinity;
  for (const c of layout.cells) {
    const inside =
      point.x >= c.cell.x && point.x <= c.cell.x + c.cell.width && point.y >= c.cell.y && point.y <= c.cell.y + c.cell.height;
    if (inside) return c.index;
    const dx = point.x - (c.cell.x + c.cell.width / 2);
    const dy = point.y - (c.cell.y + c.cell.height / 2);
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = c.index;
    }
  }
  return best;
}
