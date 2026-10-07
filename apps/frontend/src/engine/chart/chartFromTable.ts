import { readNode } from '../document/mutations';
import { normalizeTableSpec, type TableSpec } from '../table/tableTypes';
import { valueText } from '../table/tableModel';
import { isFormula, lettersOf } from '../table/tableFormula';
import { parseNumber, type ParsedChartData } from './chartCsv';
import { createChart, CHART_DEFAULT_SIZE } from './chartApply';
import {
  defaultChartSpec,
  isPlot,
  type ChartKind,
  type ChartSpec,
  type ChartTableLink,
  type LinkAggregate,
  type LinkFilter,
} from './chartTypes';

/**
 * Charts drawn from a range of a table on the same board.
 *
 * The link is resolved from the document every time the chart is drawn, so a
 * cell edit reaches the chart on every client in the same sync tick, with no
 * polling and no write of its own. The chart's stored `categories` and
 * `series` are the values as of the last link or unlink: what it draws if the
 * table is deleted, and what an unlink keeps.
 *
 * A link names its corners by row and column id, so it follows rows inserted
 * inside it and corners moved by anyone. A growing link also takes rows
 * filled in directly under it. Reading then runs in four steps, each optional:
 * map the lines (which is the category, which are series), filter the
 * readings, combine readings that share a category, and keep where every
 * value came from so a change on the chart can be written back to its cell.
 */

export interface TableRange {
  r0: number;
  c0: number;
  r1: number;
  c1: number;
}

/** How a link reads its range: everything but which table. */
export type LinkReading = Omit<ChartTableLink, 'tableId'> & { tableId?: string };

const filled = (s: string | undefined) => typeof s === 'string' && s.trim() !== '';

/** Whether stored row `r` holds anything between columns `c0` and `c1`. */
export function rowFilled(table: TableSpec, r: number, c0: number, c1: number): boolean {
  const row = table.cells[r];
  if (!row) return false;
  for (let c = c0; c <= c1; c += 1) if (filled(row[c])) return true;
  return false;
}

/** The last stored row holding anything, or -1 for an empty table. */
export function lastFilledRow(table: TableSpec): number {
  for (let r = table.cells.length - 1; r >= 0; r -= 1) if (rowFilled(table, r, 0, table.columns.length - 1)) return r;
  return -1;
}

/**
 * A link's range in the table as it stands now, or null when the table has
 * nothing left to read.
 *
 * Corners are found by id; one that is gone (its row deleted) falls back to
 * the stored index, clamped to the table. A growing range then takes every
 * filled row directly under it.
 */
export function currentRange(table: TableSpec, link: LinkReading): TableRange | null {
  const rows = table.cells.length;
  const cols = table.columns.length;
  if (rows === 0 || cols === 0) return null;
  const find = (ids: string[] | undefined, id: string | undefined, fallback: number, n: number) => {
    const i = id && ids ? ids.indexOf(id) : -1;
    return i >= 0 ? i : Math.max(0, Math.min(fallback, n - 1));
  };
  let r0 = find(table.rowIds, link.ids?.r0, link.r0, rows);
  let r1 = find(table.rowIds, link.ids?.r1, link.r1, rows);
  let c0 = find(table.colIds, link.ids?.c0, link.c0, cols);
  let c1 = find(table.colIds, link.ids?.c1, link.c1, cols);
  // A corner moved past the other: the range is still between the two.
  if (r0 > r1) [r0, r1] = [r1, r0];
  if (c0 > c1) [c0, c1] = [c1, c0];
  if (link.grow) while (r1 + 1 < rows && rowFilled(table, r1 + 1, c0, c1)) r1 += 1;
  return { r0, c0, r1, c1 };
}

/** The ids at a range's corners, when the table carries ids. */
export function cornerIds(table: TableSpec, range: TableRange): ChartTableLink['ids'] {
  const r0 = table.rowIds?.[range.r0];
  const r1 = table.rowIds?.[range.r1];
  const c0 = table.colIds?.[range.c0];
  const c1 = table.colIds?.[range.c1];
  return r0 && r1 && c0 && c1 ? { r0, r1, c0, c1 } : undefined;
}

/**
 * A link to `range`, anchored to its corners. It grows when it reaches the
 * table's last filled row: a range that stops short was chosen to stop short.
 */
export function anchoredLink(
  table: TableSpec,
  tableId: string,
  range: TableRange,
  reading: Omit<LinkReading, 'r0' | 'c0' | 'r1' | 'c1' | 'ids' | 'grow' | 'tableId'> = {}
): ChartTableLink {
  const ids = cornerIds(table, range);
  return {
    ...reading,
    tableId,
    ...range,
    ...(ids ? { ids } : {}),
    ...(range.r1 >= lastFilledRow(table) ? { grow: true } : {}),
  };
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

/** One line of the range: a column when the series run down, a row when they run across. */
export interface RangeLine {
  /** The row or column id. */
  id: string;
  /** Its stored index in the table. */
  index: number;
  /** What it is called: its header text, or its letter or number. */
  label: string;
}

/**
 * The range turned so that each reading is a record and each line a field:
 * rows and columns when the series run down, the other way round across.
 */
interface Oriented {
  grid: string[][];
  /** The stored row (down) or column (across) each record was read from. */
  recordAt: number[];
  lines: RangeLine[];
  header: boolean;
}

function orient(table: TableSpec, range: TableRange, link: LinkReading): Oriented {
  const across = link.seriesIn === 'rows';
  const raw = tableRangeGrid(table, range);
  const rowCount = raw.length;
  const colCount = raw[0]?.length ?? 0;
  const records = across ? colCount : rowCount;
  const width = across ? rowCount : colCount;
  const cell = (rec: number, line: number) => (across ? raw[line]?.[rec] : raw[rec]?.[line]) ?? '';

  let grid: string[][] = [];
  let recordAt: number[] = [];
  for (let k = 0; k < records; k += 1) {
    const rec = Array.from({ length: width }, (_, j) => cell(k, j));
    // An empty reading is not a reading.
    if (!rec.some(filled)) continue;
    grid.push(rec);
    recordAt.push((across ? range.c0 : range.r0) + k);
  }

  // Down the columns, the header is certain when the range starts on the
  // table's header row. Across, a text first column holds the series names
  // for certain (detection misses names like "Q1", which read as numbers).
  const certain = across ? (table.columns[range.c0]?.type === 'text' ? true : undefined) : table.header && range.r0 === 0 ? true : undefined;
  const first = grid[0] ?? [];
  const detected = width > 1 && first.slice(1).some((c) => filled(c) && parseNumber(c) === null);
  const header = grid.length > 0 && (link.header ?? certain ?? detected);

  const lines: RangeLine[] = Array.from({ length: width }, (_, j) => {
    const index = (across ? range.r0 : range.c0) + j;
    const id = (across ? table.rowIds?.[index] : table.colIds?.[index]) ?? `#${index}`;
    const named = header ? first[j]?.trim() : '';
    return { id, index, label: named || (across ? `Row ${index + 1}` : `Column ${lettersOf(index)}`) };
  });
  if (header) {
    grid = grid.slice(1);
    recordAt = recordAt.slice(1);
  }
  return { grid, recordAt, lines, header };
}

/** The lines of a link's range, for choosing categories and series. */
export function rangeLines(table: TableSpec, link: LinkReading): RangeLine[] {
  const range = currentRange(table, link);
  return range ? orient(table, range, link).lines : [];
}

function passes(text: string, f: LinkFilter): boolean {
  const t = text.trim();
  const v = f.value.trim();
  const tn = parseNumber(t);
  const vn = parseNumber(v);
  const equal = tn !== null && vn !== null ? tn === vn : t.toLowerCase() === v.toLowerCase();
  switch (f.op) {
    case 'eq':
      return equal;
    case 'ne':
      return !equal;
    case 'gt':
      return tn !== null && vn !== null && tn > vn;
    case 'lt':
      return tn !== null && vn !== null && tn < vn;
    case 'contains':
      return t.toLowerCase().includes(v.toLowerCase());
    case 'filled':
      return t !== '';
  }
}

function combine(values: Array<number | null>, texts: string[], how: LinkAggregate): number | null {
  if (how === 'count') return texts.filter(filled).length;
  const nums = values.filter((v): v is number => v !== null);
  if (nums.length === 0) return null;
  switch (how) {
    case 'sum':
      return nums.reduce((a, b) => a + b, 0);
    case 'avg':
      return nums.reduce((a, b) => a + b, 0) / nums.length;
    case 'min':
      return Math.min(...nums);
    case 'max':
      return Math.max(...nums);
  }
}

/** What a link reads, and where each value came from. */
export interface LinkedData extends ParsedChartData {
  /** Per category: the stored row (down) or column (across) it was read from; null when combined from several. */
  sources: Array<number | null>;
  /** Per series: the stored column (down) or row (across) it was read from. */
  lines: number[];
  /** How many readings each category combines. */
  counts: number[];
  /** Whether the first line was read as the series' names. */
  header: boolean;
}

const EMPTY: LinkedData = { categories: [], series: [], sources: [], lines: [], counts: [], header: false };

/**
 * Categories and series for a link.
 *
 * Reading down the columns, the first column names the categories and each
 * later column is a series; reading across the rows swaps the two. The first
 * line is a header when the range starts on the table's header row, and is
 * otherwise detected the way a pasted table's is. A link's own mapping,
 * filters and aggregation apply on top.
 */
export function resolveTableLink(table: TableSpec, link: LinkReading): LinkedData {
  const range = currentRange(table, link);
  if (!range) return EMPTY;
  const { grid, recordAt, lines, header } = orient(table, range, link);
  if (lines.length === 0) return EMPTY;
  const at = (id: string | undefined) => (id ? lines.findIndex((l) => l.id === id) : -1);

  // A single line is the series itself, its readings numbered.
  const single = lines.length === 1;
  const cat = single ? -1 : Math.max(0, at(link.categoryLine));
  const seriesIdx = single
    ? [0]
    : link.seriesLines
      ? link.seriesLines.map(at).filter((j, k, all) => j >= 0 && j !== cat && all.indexOf(j) === k)
      : lines.map((_, j) => j).filter((j) => j !== cat);

  const filters = (link.filters ?? []).map((f) => ({ f, j: at(f.line) })).filter((x) => x.j >= 0);
  const kept: number[] = [];
  grid.forEach((rec, k) => {
    if (filters.every(({ f, j }) => passes(rec[j] ?? '', f))) kept.push(k);
  });

  const name = (k: number, n: number) => (cat >= 0 ? grid[k][cat]?.trim() : '') || `Item ${n + 1}`;
  const seriesName = (j: number, s: number) => (header ? lines[j].label : '') || `Series ${s + 1}`;

  if (!link.aggregate) {
    return {
      categories: kept.map((k, n) => name(k, n)),
      series: seriesIdx.map((j, s) => ({ name: seriesName(j, s), values: kept.map((k) => parseNumber(grid[k][j] ?? '')) })),
      sources: kept.map((k) => recordAt[k]),
      lines: seriesIdx.map((j) => lines[j].index),
      counts: kept.map(() => 1),
      header,
    };
  }

  // Readings sharing a category, in the order each category first appears.
  const groups = new Map<string, { label: string; members: number[] }>();
  kept.forEach((k, n) => {
    const label = name(k, n);
    const key = label.toLowerCase();
    const g = groups.get(key);
    if (g) g.members.push(k);
    else groups.set(key, { label, members: [k] });
  });
  const list = [...groups.values()];
  const how = link.aggregate;
  return {
    categories: list.map((g) => g.label),
    series: seriesIdx.map((j, s) => ({
      name: seriesName(j, s),
      values: list.map((g) => {
        const texts = g.members.map((k) => grid[k][j] ?? '');
        return combine(texts.map(parseNumber), texts, how);
      }),
    })),
    sources: list.map((g) => (g.members.length === 1 ? recordAt[g.members[0]] : null)),
    lines: seriesIdx.map((j) => lines[j].index),
    counts: list.map((g) => g.members.length),
    header,
  };
}

/** `A1:D9`, spreadsheet style: the header row is row 1. */
export function rangeLabel(range: TableRange): string {
  return `${lettersOf(range.c0)}${range.r0 + 1}:${lettersOf(range.c1)}${range.r1 + 1}`;
}

/** `B3`: one stored cell, spreadsheet style. */
export const cellLabel = (r: number, c: number) => `${lettersOf(c)}${r + 1}`;

/** The label of a link's range as the table stands now. */
export function linkRangeLabel(table: TableSpec | null | undefined, link: ChartTableLink): string {
  return rangeLabel((table && currentRange(table, link)) || link);
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
        name: s.name,
        values: s.values,
        ...(own?.color ? { color: own.color } : {}),
        ...(own?.hidden ? { hidden: true } : {}),
        ...(own?.mark ? { mark: own.mark } : {}),
        ...(own?.axis ? { axis: own.axis } : {}),
      };
    }),
  };
}

/** A link re-read: the spec with `link` replaced and its values resolved from `table`. */
export function relinkedSpec(spec: ChartSpec, table: TableSpec, link: ChartTableLink): ChartSpec {
  return { ...withResolvedData(spec, resolveTableLink(table, link)), link };
}

/**
 * A month, weekday or period on its own, optionally with a year: "Jan",
 * "March 2024", "Q3", "Q3 FY24", "Wk 12", "H1". A word that only starts like
 * one ("Q3 revenue", "Marketing") is a name, not a time.
 */
const TIME_TOKEN =
  /^(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?|mon(day)?|tue(s(day)?)?|wed(nesday)?|thu(r(s(day)?)?)?|fri(day)?|sat(urday)?|sun(day)?|q[1-4]|h[12]|fy\s*'?\d{2,4}|(week|wk|day)\s*\d{1,3})\.?([\s'-]*(fy\s*)?'?\d{2,4})?$/i;

/** Whether a category name reads as a point in time: a month, a quarter, a weekday, a year, a date. */
export function looksLikeTime(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (TIME_TOKEN.test(t) || /^(19|20)\d{2}$/.test(t)) return true;
  // A date: digits and separators ("2024-03-01", "3/1/24"), or a month and a day ("Mar 3, 2024").
  const dateShaped = /^\d{1,4}[/.-]\d{1,2}([/.-]\d{1,4})?([t\s][\d:.]+z?)?$/i.test(t) || /^[a-z]{3,9}\.?\s+\d{1,2}(,?\s+\d{2,4})?$/i.test(t);
  return dateShaped && !Number.isNaN(Date.parse(t));
}

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
  const timeLike = cats.filter(looksLikeTime).length;
  if (timeLike / cats.length >= 0.6 && cats.length >= 3) return 'line';
  const numericCats = cats.filter((c) => parseNumber(c) !== null).length;
  if (numericCats / cats.length >= 0.8 && cats.length >= 4) return 'line';
  const longest = Math.max(...cats.map((c) => c.length));
  if (data.series.length === 1 && (cats.length > 8 || longest > 14)) return 'barHorizontal';
  return 'bar';
}

/** The readings that differ between two resolutions of one chart, as [series, category] pairs. */
export function changedReadings(before: ChartSpec, after: ChartSpec): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  after.series.forEach((s, si) =>
    s.values.forEach((v, ci) => {
      if (before.categories[ci] !== after.categories[ci] || before.series[si]?.values[ci] !== v) out.push([si, ci]);
    })
  );
  return out;
}

/**
 * Values part-way from one resolution to the next, so bars grow to new values
 * rather than jump. Only when the shape is the same; otherwise the destination.
 */
export function tweenValues(from: ChartSpec, to: ChartSpec, t: number): ChartSpec {
  if (t >= 1 || from.series.length !== to.series.length || from.categories.length !== to.categories.length) return to;
  return {
    ...to,
    series: to.series.map((s, si) => ({
      ...s,
      values: s.values.map((v, ci) => {
        const was = from.series[si].values[ci];
        return v === null || was === null || was === undefined ? v : was + (v - was) * t;
      }),
    })),
  };
}

// ---------------------------------------------------------------------------
// Writing a value back to its cell
// ---------------------------------------------------------------------------

export type WriteBackPlan =
  | { ok: true; r: number; c: number; cell: string; before: string; after: string }
  | { ok: false; reason: string };

/**
 * A number written in the look of the text it replaces: `$1,200` set to 1500
 * reads `$1,500`, `12%` set to 15 reads `15%`.
 */
export function restyleNumber(before: string, value: number): string {
  const rounded = Number(value.toPrecision(12));
  const m = /^\s*([^\d\-+.(]*?)\s*(-?)([\d,]*\.?\d*)\s*(%?)\s*$/.exec(before);
  if (!m || !/\d/.test(m[3])) return String(rounded);
  const [, prefix, , digits, pct] = m;
  const grouped = digits.includes(',');
  const decimals = digits.includes('.') ? digits.split('.')[1].length : 0;
  const abs = Math.abs(rounded);
  const body = grouped
    ? abs.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: Math.max(decimals, 6) })
    : decimals
      ? abs.toFixed(decimals)
      : String(abs);
  return `${rounded < 0 ? '-' : ''}${prefix}${body}${pct}`;
}

/**
 * Where a chart reading lives in its table, and what writing `value` there
 * would change — or why it cannot be written.
 */
export function planWriteBack(table: TableSpec, link: LinkReading, seriesIndex: number, categoryIndex: number, value: number): WriteBackPlan {
  if (!Number.isFinite(value)) return { ok: false, reason: 'Only a number can be written to the table' };
  const data = resolveTableLink(table, link);
  const source = data.sources[categoryIndex];
  const line = data.lines[seriesIndex];
  if (source === undefined || line === undefined) return { ok: false, reason: 'That reading is no longer in the table' };
  if (source === null) {
    return { ok: false, reason: `This value combines ${data.counts[categoryIndex]} rows; change them in the table` };
  }
  const across = link.seriesIn === 'rows';
  const r = across ? line : source;
  const c = across ? source : line;
  const before = table.cells[r]?.[c] ?? '';
  const cell = cellLabel(r, c);
  if (isFormula(before)) return { ok: false, reason: `${cell} is a formula; change it in the table` };
  return { ok: true, r, c, cell, before, after: restyleNumber(before, value) };
}

// ---------------------------------------------------------------------------
// Creating and unlinking
// ---------------------------------------------------------------------------

interface TableNodeLike {
  x: number;
  y: number;
  width: number;
  height: number;
  title?: string;
  table: unknown;
}

/** What "Chart this" may be told rather than left to infer. */
export interface ChartThisChoice {
  kind?: ChartKind;
  seriesIn?: 'columns' | 'rows';
  header?: boolean;
}

/** The spec "Chart this" would add for a range, or null when the range holds no numbers. */
export function specForRange(table: TableSpec, tableId: string, range: TableRange, choice: ChartThisChoice = {}, title?: string): ChartSpec | null {
  const link = anchoredLink(table, tableId, range, {
    ...(choice.seriesIn === 'rows' ? { seriesIn: 'rows' as const } : {}),
    ...(choice.header !== undefined ? { header: choice.header } : {}),
  });
  const data = resolveTableLink(table, link);
  const hasNumbers = data.series.some((s) => s.values.some((v) => v !== null));
  if (!hasNumbers) return null;
  const kind = choice.kind ?? recommendKind(data);
  const base = defaultChartSpec(kind);
  return {
    kind,
    categories: data.categories,
    series: data.series.map((s) => ({ name: s.name, values: s.values })),
    link,
    ...(title?.trim() ? { title: title.trim() } : {}),
    ...(base.sort && kind === 'barHorizontal' ? { sort: base.sort } : {}),
  };
}

/**
 * "Chart this": a chart beside the table, linked to the range.
 *
 * Returns the new chart's id, or null when the range holds no numbers to draw
 * (the caller says so rather than dropping an empty chart on the board).
 */
export function createChartFromTableRange(tableNodeId: string, range: TableRange, choice: ChartThisChoice = {}): string | null {
  const raw = readNode(tableNodeId) as unknown as TableNodeLike | null;
  if (!raw || typeof raw !== 'object') return null;
  const table = normalizeTableSpec(raw.table);
  const spec = specForRange(table, tableNodeId, range, choice, typeof raw.title === 'string' ? raw.title : undefined);
  if (!spec) return null;
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
