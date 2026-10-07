import type { TableSpec } from '../table/tableTypes';
import {
  looksLikeTime,
  recommendKind,
  resolveTableLink,
  rowFilled,
  type LinkedData,
  type TableRange,
} from './chartFromTable';
import type { ChartKind } from './chartTypes';

/**
 * "Chart this", decided before anything is drawn: which cells, which way the
 * series run, whether the first line names them, and the kind that suits
 * them, with one sentence saying why, for the preview to show.
 */

export interface ChartGuess {
  range: TableRange;
  seriesIn: 'columns' | 'rows';
  kind: ChartKind;
  data: LinkedData;
  /** One sentence for the preview: what was read and why this kind. */
  why: string;
}

const filled = (s: string | undefined) => typeof s === 'string' && s.trim() !== '';

function colFilled(table: TableSpec, c: number, r0: number, r1: number): boolean {
  for (let r = r0; r <= r1; r += 1) if (filled(table.cells[r]?.[c])) return true;
  return false;
}

/** A range shrunk to the cells that hold something. Null when none do. */
export function trimRange(table: TableSpec, range: TableRange): TableRange | null {
  let { r0, c0, r1, c1 } = range;
  r1 = Math.min(r1, table.cells.length - 1);
  c1 = Math.min(c1, table.columns.length - 1);
  while (r0 <= r1 && !rowFilled(table, r0, c0, c1)) r0 += 1;
  while (r1 >= r0 && !rowFilled(table, r1, c0, c1)) r1 -= 1;
  while (c0 <= c1 && !colFilled(table, c0, r0, r1)) c0 += 1;
  while (c1 >= c0 && !colFilled(table, c1, r0, r1)) c1 -= 1;
  return r0 <= r1 && c0 <= c1 ? { r0, c0, r1, c1 } : null;
}

/**
 * The block of filled cells around one cell, the way Sheets finds "the data"
 * from wherever the cursor is: grow while a neighbouring row or column holds
 * something along the block's edge.
 */
export function blockAround(table: TableSpec, r: number, c: number): TableRange {
  const rows = table.cells.length;
  const cols = table.columns.length;
  const box = { r0: r, c0: c, r1: r, c1: c };
  for (let grew = true; grew; ) {
    grew = false;
    if (box.r0 > 0 && rowFilled(table, box.r0 - 1, box.c0, box.c1)) (box.r0 -= 1), (grew = true);
    if (box.r1 < rows - 1 && rowFilled(table, box.r1 + 1, box.c0, box.c1)) (box.r1 += 1), (grew = true);
    if (box.c0 > 0 && colFilled(table, box.c0 - 1, box.r0, box.r1)) (box.c0 -= 1), (grew = true);
    if (box.c1 < cols - 1 && colFilled(table, box.c1 + 1, box.r0, box.r1)) (box.c1 += 1), (grew = true);
  }
  return box;
}

const share = (part: number, whole: number) => (whole > 0 ? part / whole : 0);

/** Parts of a whole: one series, a handful of non-negative readings, named or summing as shares. */
function isPartsOfWhole(data: LinkedData, table: TableSpec, line: number | undefined): boolean {
  if (data.series.length !== 1) return false;
  const values = data.series[0].values;
  if (values.length < 2 || values.length > 6 || values.some((v) => v === null || v < 0)) return false;
  const total = (values as number[]).reduce((a, b) => a + b, 0);
  const named = /share|split|mix|breakdown|percent|%/i.test(data.series[0].name);
  const percentColumn = line !== undefined && table.columns[line]?.type === 'percent';
  return named || percentColumn || Math.abs(total - 100) < 0.5 || Math.abs(total - 1) < 0.005;
}

const KIND_WHY: Partial<Record<ChartKind, string>> = {
  line: 'the categories read as time, so a line shows the trend',
  barHorizontal: 'the names are long or many, so horizontal bars give them room',
  donut: 'one series of parts makes a whole, so a donut',
  bar: 'separate categories, so bars compare them',
};

/**
 * The best chart for a range of a table, or for the whole table when no
 * range is given. A single cell stands for the block of data around it.
 * Null when there are no numbers to draw.
 */
export function guessChart(table: TableSpec, within?: TableRange): ChartGuess | null {
  const rows = table.cells.length;
  const cols = table.columns.length;
  if (rows === 0 || cols === 0) return null;
  const asked = within ?? { r0: 0, c0: 0, r1: rows - 1, c1: cols - 1 };
  const start = asked.r0 === asked.r1 && asked.c0 === asked.c1 ? blockAround(table, asked.r0, asked.c0) : asked;
  const range = trimRange(table, start);
  if (!range) return null;

  // Times across the top and not down the side: each row is a series, and
  // the categories are the times.
  const top = Array.from({ length: range.c1 - range.c0 }, (_, i) => table.cells[range.r0]?.[range.c0 + 1 + i] ?? '').filter(filled);
  const side = Array.from({ length: range.r1 - range.r0 }, (_, i) => table.cells[range.r0 + 1 + i]?.[range.c0] ?? '').filter(filled);
  const timeTop = top.length >= 2 && share(top.filter(looksLikeTime).length, top.length) >= 0.6;
  const timeSide = side.length >= 2 && share(side.filter(looksLikeTime).length, side.length) >= 0.6;
  let seriesIn: 'columns' | 'rows' = timeTop && !timeSide ? 'rows' : 'columns';

  const numbers = (d: LinkedData) => d.series.reduce((n, s) => n + s.values.filter((v) => v !== null).length, 0);
  let data = resolveTableLink(table, { ...range, ...(seriesIn === 'rows' ? { seriesIn } : {}) });
  if (numbers(data) === 0 && seriesIn === 'columns') {
    const across = resolveTableLink(table, { ...range, seriesIn: 'rows' });
    if (numbers(across) > 0) {
      seriesIn = 'rows';
      data = across;
    }
  }
  if (numbers(data) === 0) return null;

  const kind: ChartKind = isPartsOfWhole(data, table, data.lines[0]) ? 'donut' : recommendKind(data);
  const cats = data.categories.length;
  const what = `${cats} ${cats === 1 ? 'category' : 'categories'} × ${data.series.length} ${data.series.length === 1 ? 'series' : 'series'}`;
  const way = seriesIn === 'rows' ? 'each row is a series' : 'each column is a series';
  const why = `${what}; ${way}, and ${KIND_WHY[kind] ?? KIND_WHY.bar}.`;
  return { range, seriesIn, kind, data, why };
}
