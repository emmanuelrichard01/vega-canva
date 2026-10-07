import { readNode } from '../document/mutations';
import { normalizeTableSpec, type TableSpec } from '../table/tableTypes';
import { valueText } from '../table/tableModel';
import { lettersOf } from '../table/tableFormula';
import { parseChartGrid, parseNumber, type ParsedChartData } from './chartCsv';
import { createChart, CHART_DEFAULT_SIZE } from './chartApply';
import { defaultChartSpec, isPlot, type ChartKind, type ChartSpec, type ChartTableLink } from './chartTypes';

/**
 * Charts drawn from a range of a table on the same board.
 *
 * The link is resolved from the document every time the chart is drawn, so a
 * cell edit reaches the chart on every client in the same sync tick, with no
 * polling and no write of its own. The chart's stored `categories` and
 * `series` are the values as of the last link or unlink: what it draws if the
 * table is deleted, and what an unlink keeps.
 */

export interface TableRange {
  r0: number;
  c0: number;
  r1: number;
  c1: number;
}

/** The range's cells as text, formulas evaluated, clamped to the table. */
export function tableRangeGrid(table: TableSpec, range: TableRange): string[][] {
  const rows = table.cells.length;
  const cols = table.columns.length;
  const r1 = Math.min(range.r1, rows - 1);
  const c1 = Math.min(range.c1, cols - 1);
  const out: string[][] = [];
  for (let r = Math.max(0, range.r0); r <= r1; r += 1) {
    const row: string[] = [];
    for (let c = Math.max(0, range.c0); c <= c1; c += 1) row.push(valueText(table, r, c));
    out.push(row);
  }
  return out;
}

function transpose(grid: string[][]): string[][] {
  const width = Math.max(0, ...grid.map((r) => r.length));
  return Array.from({ length: width }, (_, c) => grid.map((r) => r[c] ?? ''));
}

/**
 * Categories and series for a link.
 *
 * Reading down the columns, the first column names the categories and each
 * later column is a series; reading across the rows swaps the two. The first
 * line is a header when the range starts on the table's header row, and is
 * otherwise detected the way a pasted table's is.
 */
export function resolveTableLink(
  table: TableSpec,
  link: TableRange & { seriesIn?: 'columns' | 'rows' }
): ParsedChartData {
  const grid = tableRangeGrid(table, link);
  // Across the rows, the range's first column holds the series names. A text
  // column is names for certain; anything else is detected once the grid is
  // turned. (Detection alone misses names like "Q1", which read as numbers.)
  if (link.seriesIn === 'rows') {
    return parseChartGrid(transpose(grid), table.columns[link.c0]?.type === 'text' ? true : undefined);
  }
  return parseChartGrid(grid, table.header && link.r0 === 0 ? true : undefined);
}

/** `A1:D9`, spreadsheet style: the header row is row 1. */
export function rangeLabel(range: TableRange): string {
  return `${lettersOf(range.c0)}${range.r0 + 1}:${lettersOf(range.c1)}${range.r1 + 1}`;
}

/** Parse `A1:D9` back into stored indices. Null when it does not read as a range. */
export function parseRangeLabel(text: string): TableRange | null {
  const m = /^\s*([A-Za-z]{1,3})(\d{1,6})\s*(?::\s*([A-Za-z]{1,3})(\d{1,6}))?\s*$/.exec(text);
  if (!m) return null;
  const col = (s: string) => {
    let n = 0;
    for (const ch of s.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  };
  const a = { r: Number(m[2]) - 1, c: col(m[1]) };
  const b = m[3] ? { r: Number(m[4]) - 1, c: col(m[3]) } : a;
  if (a.r < 0 || b.r < 0) return null;
  return { r0: Math.min(a.r, b.r), c0: Math.min(a.c, b.c), r1: Math.max(a.r, b.r), c1: Math.max(a.c, b.c) };
}

/** A spec with its linked values filled in, or the spec unchanged when nothing applies. */
export function resolveChartSpec(spec: ChartSpec, table: TableSpec | null | undefined): ChartSpec {
  if (!spec.link || !table || isPlot(spec.kind)) return spec;
  const data = resolveTableLink(table, spec.link);
  return withResolvedData(spec, data);
}

/**
 * New values under the series' own settings.
 *
 * Colour, visibility, mark and axis belong to the chart, not to the table, so
 * they stay with the series at the same position when the values change.
 */
export function withResolvedData(spec: ChartSpec, data: ParsedChartData): ChartSpec {
  return {
    ...spec,
    categories: data.categories,
    series: data.series.map((s, i) => {
      const own = spec.series[i];
      return {
        ...s,
        ...(own?.color ? { color: own.color } : {}),
        ...(own?.hidden ? { hidden: true } : {}),
        ...(own?.mark ? { mark: own.mark } : {}),
        ...(own?.axis ? { axis: own.axis } : {}),
      };
    }),
  };
}

const TIME_WORDS =
  /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|q[1-4]|mon|tue|wed|thu|fri|sat|sun|week|wk|day|fy|h[12])\b/i;

/**
 * The kind a range most likely wants.
 *
 * Categories that read as time (months, quarters, weekdays, years, dates)
 * want a line; most other categorical data wants bars, and a long run of
 * plain categories with one series reads better as horizontal bars, where
 * the names have room.
 */
export function recommendKind(data: ParsedChartData): ChartKind {
  const cats = data.categories;
  if (cats.length === 0) return 'bar';
  const timeLike = cats.filter((c) => {
    const t = c.trim();
    return TIME_WORDS.test(t) || /^(19|20)\d{2}$/.test(t) || (!Number.isNaN(Date.parse(t)) && /\d/.test(t));
  }).length;
  if (timeLike / cats.length >= 0.6 && cats.length >= 3) return 'line';
  const numericCats = cats.filter((c) => parseNumber(c) !== null).length;
  if (numericCats / cats.length >= 0.8 && cats.length >= 4) return 'line';
  const longest = Math.max(...cats.map((c) => c.length));
  if (data.series.length === 1 && (cats.length > 8 || longest > 14)) return 'barHorizontal';
  return 'bar';
}

interface TableNodeLike {
  x: number;
  y: number;
  width: number;
  height: number;
  title?: string;
  table: unknown;
}

/**
 * "Chart this": a chart beside the table, linked to the range.
 *
 * Returns the new chart's id, or null when the range holds no numbers to draw
 * (the caller says so rather than dropping an empty chart on the board).
 */
export function createChartFromTableRange(tableNodeId: string, range: TableRange): string | null {
  const raw = readNode(tableNodeId) as unknown as TableNodeLike | null;
  if (!raw || typeof raw !== 'object') return null;
  const table = normalizeTableSpec(raw.table);
  const link: ChartTableLink = { tableId: tableNodeId, ...range };
  const data = resolveTableLink(table, link);
  const hasNumbers = data.series.some((s) => s.values.some((v) => v !== null));
  if (!hasNumbers) return null;

  const kind = recommendKind(data);
  const base = defaultChartSpec(kind);
  const spec: ChartSpec = {
    kind,
    categories: data.categories,
    series: data.series,
    link,
    ...(typeof raw.title === 'string' && raw.title.trim() ? { title: raw.title.trim() } : {}),
    ...(base.sort && kind === 'barHorizontal' ? { sort: base.sort } : {}),
  };
  const gap = 48;
  return createChart(
    { x: raw.x + raw.width + gap, y: raw.y, width: CHART_DEFAULT_SIZE.width, height: CHART_DEFAULT_SIZE.height },
    spec
  );
}

/** Replace a link with its current values, so the chart keeps them and stops following the table. */
export function unlinkedSpec(spec: ChartSpec, table: TableSpec | null | undefined): ChartSpec {
  const resolved = resolveChartSpec(spec, table);
  const { link: _link, ...rest } = resolved;
  return rest;
}
