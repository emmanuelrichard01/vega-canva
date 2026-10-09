import { defaultStyle } from './gridStyle';
import { normalizeRecipe } from './gridNode';
import type { GridRecipe } from './gridBuild';

/**
 * Arrange in grid: turn a loose selection into a live layout.
 *
 * The rows and columns are read from where the objects already are, the way
 * Figma's Tidy up reads them, and the result is a guide-mode grid holding
 * every object in a module. From then on the selection *is* a layout: change
 * Columns from 3 to 4 and everything reflows; Break apart releases it.
 */

interface Item {
  id: string;
  cx: number;
  cy: number;
  width: number;
  height: number;
}

/**
 * Split sorted centres into clusters wherever the gap to the next centre is
 * more than half the typical object size. Returns, per input position, the
 * cluster it fell in.
 */
export function clusterAxis(centres: readonly number[], typicalSize: number): { of: number[]; count: number } {
  const order = centres.map((c, i) => ({ c, i })).sort((a, b) => a.c - b.c || a.i - b.i);
  const threshold = Math.max(1, typicalSize * 0.5);
  const of = new Array<number>(centres.length).fill(0);
  let cluster = 0;
  order.forEach((entry, k) => {
    if (k > 0 && entry.c - order[k - 1].c > threshold) cluster += 1;
    of[entry.i] = cluster;
  });
  return { of, count: centres.length === 0 ? 0 : cluster + 1 };
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** The space between neighbouring clusters, as the median of the observed gaps. */
function clusterGap(
  items: readonly Item[],
  of: readonly number[],
  count: number,
  axis: 'x' | 'y'
): number {
  if (count < 2) return 16;
  const lo = new Array<number>(count).fill(Infinity);
  const hi = new Array<number>(count).fill(-Infinity);
  items.forEach((item, i) => {
    const centre = axis === 'x' ? item.cx : item.cy;
    const half = (axis === 'x' ? item.width : item.height) / 2;
    lo[of[i]] = Math.min(lo[of[i]], centre - half);
    hi[of[i]] = Math.max(hi[of[i]], centre + half);
  });
  const gaps: number[] = [];
  for (let k = 0; k + 1 < count; k += 1) gaps.push(lo[k + 1] - hi[k]);
  const g = median(gaps);
  return Number.isFinite(g) && g > 0 ? Math.round(g) : 16;
}

export interface Arrangement {
  rows: number;
  columns: number;
  cellWidth: number;
  cellHeight: number;
  gutterX: number;
  gutterY: number;
  x: number;
  y: number;
  /** Module identity (row-major) for each object, by id. */
  cells: Record<string, number>;
}

/**
 * Where each object goes: rows and columns inferred from the centres, one
 * module per object. Two objects that land on the same module are resolved
 * by moving the later one (in reading order) to the nearest free module, and
 * a row is added when the grid is full. Pure, and independent of input order.
 */
export function planArrangement(items: readonly Item[]): Arrangement | null {
  if (items.length < 2) return null;
  const sorted = [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const typicalW = median(sorted.map((i) => i.width));
  const typicalH = median(sorted.map((i) => i.height));
  const cols = clusterAxis(sorted.map((i) => i.cx), typicalW);
  const rows = clusterAxis(sorted.map((i) => i.cy), typicalH);

  const columns = Math.max(1, cols.count);
  let nRows = Math.max(1, rows.count);
  const gutterX = clusterGap(sorted, cols.of, columns, 'x');
  const gutterY = clusterGap(sorted, rows.of, nRows, 'y');

  // Reading order decides who keeps a contested module.
  const reading = sorted
    .map((item, i) => ({ item, r: rows.of[i], c: cols.of[i] }))
    .sort((a, b) => a.r - b.r || a.c - b.c || a.item.cy - b.item.cy || a.item.cx - b.item.cx || (a.item.id < b.item.id ? -1 : 1));

  const taken = new Set<number>();
  const cells: Record<string, number> = {};
  const contested: typeof reading = [];
  for (const entry of reading) {
    const index = entry.r * columns + entry.c;
    if (taken.has(index)) contested.push(entry);
    else {
      taken.add(index);
      cells[entry.item.id] = index;
    }
  }
  for (const entry of contested) {
    while (taken.size >= nRows * columns) nRows += 1;
    let best = -1;
    let bestD = Infinity;
    for (let index = 0; index < nRows * columns; index += 1) {
      if (taken.has(index)) continue;
      const d = Math.abs(Math.floor(index / columns) - entry.r) + Math.abs((index % columns) - entry.c);
      if (d < bestD) {
        bestD = d;
        best = index;
      }
    }
    taken.add(best);
    cells[entry.item.id] = best;
  }

  const cellWidth = Math.max(...items.map((i) => i.width));
  const cellHeight = Math.max(...items.map((i) => i.height));
  const left = Math.min(...items.map((i) => i.cx - i.width / 2));
  const top = Math.min(...items.map((i) => i.cy - i.height / 2));
  return { rows: nRows, columns, cellWidth, cellHeight, gutterX, gutterY, x: left, y: top, cells };
}

/** The recipe an arrangement lays out as: a plain modular grid, used as a guide. */
export function arrangementRecipe(a: Arrangement): { box: { x: number; y: number; width: number; height: number }; recipe: GridRecipe } {
  const width = a.columns * a.cellWidth + a.gutterX * (a.columns - 1);
  const height = a.rows * a.cellHeight + a.gutterY * (a.rows - 1);
  const style = { ...defaultStyle(), mode: 'guide' as const };
  const recipe = normalizeRecipe(
    {
      spec: {
        kind: 'modular',
        rows: a.rows,
        columns: a.columns,
        gutterX: a.gutterX,
        gutterY: a.gutterY,
        margin: 0,
        variation: 0,
        seed: 1,
        // Objects keep their own sizes, centred in their modules.
        contentAlign: { x: 'center', y: 'center' },
      },
      style,
    },
    width,
    height
  );
  return { box: { x: a.x, y: a.y, width, height }, recipe };
}
