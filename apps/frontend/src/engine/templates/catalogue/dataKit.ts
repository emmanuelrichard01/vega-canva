import { nanoid } from 'nanoid';
import type { NewNodeInput } from '../../document/mutations';
import type { StickyTheme } from '../../model/schema';
import type { ChartSpec, ChartTableLink } from '../../chart/chartTypes';
import type {
  CellStyle,
  CellType,
  ColourRule,
  ColourScale,
  DataBar,
  SummaryAgg,
  TableSpec,
  TableTheme,
} from '../../table/tableTypes';
import { INK, INK_SOFT, INK_STRONG, HAIRLINE, RULE } from '../templateKit';

/**
 * The data and science boards' own vocabulary.
 *
 * ## Why every board is a white page
 *
 * A text node's ink is a literal, so dark words written for a light board sit
 * on a near-black one in the dark theme and vanish. A frame is the one ground
 * that stays white in both themes, so every board here is laid out *inside*
 * frames sized as 16:9 pages: the content reads the same in either theme, and
 * each page presents as a slide without being touched.
 *
 * ## Why the numbers are computed twice
 *
 * A linked chart resolves its table on every draw, but it also stores the
 * values as last resolved, which is what a cover and an unlinked copy draw.
 * Building those from the same arrays the table is written from, rather than
 * importing the formula engine into the gallery's bundle, keeps the dashboard
 * light; `dataKit.test.ts` holds the two readings against each other.
 */

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

/** A 16:9 page: the size every board's frames share, so each presents as a slide. */
export const PAGE_W = 1920;
export const PAGE_H = 1080;
/** The page margin and the gutter between columns. Multiples of the 8px base. */
export const MARGIN = 64;
export const GUTTER = 32;
/** Space between two pages on one board. */
export const PAGE_GAP = 160;

/** The twelve-column measure every page is laid out on. */
export const COL = (PAGE_W - MARGIN * 2 - GUTTER * 11) / 12;

/** The left edge of column `i` (0-based) on a page at `x0`. */
export const colX = (x0: number, i: number) => x0 + MARGIN + i * (COL + GUTTER);
/** The width of `n` columns, gutters included. */
export const span = (n: number) => n * COL + (n - 1) * GUTTER;

export interface PageOptions {
  icon: string;
  description: string;
  /** Draw the twelve-column guide this page is laid out on. */
  guide?: boolean;
}

/** A frame as a page, with its emoji, its one-line description and, optionally, its column guide. */
export function page(x: number, y: number, title: string, options: PageOptions, w = PAGE_W, h = PAGE_H): NewNodeInput {
  return {
    id: nanoid(),
    type: 'frame',
    x,
    y,
    width: w,
    height: h,
    title,
    icon: options.icon,
    description: options.description,
    ...(options.guide ? { layoutGuide: { columns: { count: 12, gutter: GUTTER, margin: MARGIN } } } : null),
  } as NewNodeInput;
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/** Inter's average advance as a share of the size: enough to size a box before it is measured. */
const ADVANCE = 0.56;

/** How many lines `text` wraps to at `width`, by Inter's average advance. */
export function lineCount(text: string, width: number, size: number, bold = false): number {
  const perLine = Math.max(1, Math.floor(width / (size * (bold ? ADVANCE + 0.04 : ADVANCE))));
  return text.split('\n').reduce((n, para) => n + Math.max(1, Math.ceil(para.length / perLine)), 0);
}

export interface WordsOptions {
  size?: number;
  weight?: number;
  color?: string;
  align?: 'left' | 'center' | 'right';
  lineHeight?: number;
  italic?: boolean;
  letterSpacing?: number;
  fontFamily?: string;
}

/**
 * A block of text that wraps at `width` and grows downward.
 *
 * Sized from a line count so the box a frame checks is the box that will be
 * drawn: a label that wraps one line further than its stored height is cut
 * off by the frame that owns it.
 */
export function words(x: number, y: number, width: number, text: string, options: WordsOptions = {}): NewNodeInput {
  const size = options.size ?? 16;
  const lineHeight = options.lineHeight ?? 1.5;
  const lines = lineCount(text, width, size, (options.weight ?? 400) >= 600);
  return {
    id: nanoid(),
    type: 'text',
    x,
    y,
    width,
    height: Math.ceil(lines * size * lineHeight + 4),
    text,
    resize: 'height',
    typography: {
      fontSize: size,
      fontWeight: options.weight ?? 450,
      color: options.color ?? INK_SOFT,
      align: options.align ?? 'left',
      lineHeight,
      ...(options.italic ? { italic: true } : null),
      ...(options.letterSpacing !== undefined ? { letterSpacing: options.letterSpacing } : null),
      ...(options.fontFamily ? { fontFamily: options.fontFamily } : null),
    },
  } as NewNodeInput;
}

/** A page's own title. */
export const pageTitle = (x: number, y: number, text: string, width = 1400) =>
  words(x, y, width, text, { size: 44, weight: 700, color: INK_STRONG, lineHeight: 1.15, letterSpacing: -0.6 });

/** The sentence under a page title. */
export const lede = (x: number, y: number, text: string, width = 1200) =>
  words(x, y, width, text, { size: 19, weight: 450, color: INK_SOFT, lineHeight: 1.45 });

/** A heading over one part of a page. */
export const head = (x: number, y: number, text: string, width = 600) =>
  words(x, y, width, text, { size: 22, weight: 650, color: INK_STRONG, lineHeight: 1.3, letterSpacing: -0.2 });

/** A short note in the margin: a method, a caveat, a reading. */
export const aside = (x: number, y: number, width: number, text: string, size = 15) =>
  words(x, y, width, text, { size, weight: 450, color: INK_SOFT, lineHeight: 1.5 });

/** An equation, set in the maths face's stand-in: Inter's italic at a reading size. */
export const formula = (x: number, y: number, width: number, text: string, size = 18, align: WordsOptions['align'] = 'left') =>
  words(x, y, width, text, { size, weight: 500, color: INK, lineHeight: 1.35, italic: true, align });

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

/** A seeded generator with the draws the science boards need. Deterministic, so a cover is the board. */
export function seeded(seed: number) {
  // mulberry32: full 32-bit state, so a Box–Muller pair never lands on a lattice.
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let spare: number | null = null;
  const normal = (mean = 0, sd = 1) => {
    if (spare !== null) {
      const z = spare;
      spare = null;
      return mean + sd * z;
    }
    let u = 0;
    while (u === 0) u = next();
    const v = next();
    const r = Math.sqrt(-2 * Math.log(u));
    spare = r * Math.sin(2 * Math.PI * v);
    return mean + sd * r * Math.cos(2 * Math.PI * v);
  };
  /** Knuth's product method: exact, and fast for the small means drawn here. */
  const poisson = (lambda: number) => {
    const limit = Math.exp(-lambda);
    let k = 0;
    let p = next();
    while (p > limit) {
      k += 1;
      p *= next();
    }
    return k;
  };
  const binomial = (n: number, p: number) => {
    let k = 0;
    for (let i = 0; i < n; i += 1) if (next() < p) k += 1;
    return k;
  };
  const exponential = (rate: number) => -Math.log(1 - next()) / rate;
  return { next, normal, poisson, binomial, exponential };
}

export const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;

/** The sample standard deviation, n − 1, as STDEV gives it. */
export function stdev(xs: number[]): number {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / (xs.length - 1));
}

/** Round to `d` places, as the tables' ROUND does, without binary residue. */
export const round = (v: number, d = 0) => {
  const f = 10 ** d;
  return Math.round(v * f + (v >= 0 ? 1e-9 : -1e-9)) / f;
};

/** A number as the board prints it: fixed places, a real minus sign. */
export const fmt = (v: number, d = 0) => {
  const s = Math.abs(v).toFixed(d);
  return v < 0 && Number(s) !== 0 ? `−${s}` : s;
};

/** Ordinary least squares, with the reading every regression board reports. */
export function regress(xs: number[], ys: number[]) {
  const n = xs.length;
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i += 1) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const residuals = ys.map((y, i) => y - (intercept + slope * xs[i]));
  const sse = residuals.reduce((s, r) => s + r * r, 0);
  return { slope, intercept, r2: 1 - sse / syy, residuals, se: Math.sqrt(sse / (n - 2)), r: sxy / Math.sqrt(sxx * syy) };
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

/** The height the table tool gives one row at its standard type size. */
export const ROW_H = 36;

export interface Column {
  head: string;
  type?: CellType;
  /** A share of the table's width. */
  width?: number;
  /** What is typed in each body row: a value or a formula. */
  cells: string[];
  /**
   * The number a chart reads from each body row, when the cell is a formula
   * or not plain digits. A percent column reads in percent, as the table shows it.
   */
  values?: Array<number | null>;
  align?: 'left' | 'center' | 'right';
  style?: CellStyle;
}

export interface SheetOptions {
  /** The table's name: what formulas on other tables call it. */
  title: string;
  columns: Column[];
  theme?: TableTheme;
  accent?: string;
  fontSize?: number;
  rowH?: number;
  header?: boolean;
  firstColumn?: boolean;
  styles?: Record<string, CellStyle>;
  rules?: ColourRule[];
  scales?: ColourScale[];
  bars?: DataBar[];
  summary?: Array<SummaryAgg | null>;
  rowHeights?: number[];
}

export interface Sheet {
  node: NewNodeInput;
  id: string;
  columns: Column[];
  /** Body rows, header excluded. */
  rows: number;
  header: boolean;
  height: number;
  rowIds: string[];
  colIds: string[];
}

/** A cell's address, spreadsheet style: column `c` (0-based), table row `r` (1 is the header). */
export const cell = (c: number, r: number) => `${String.fromCharCode(65 + c)}${r}`;

/** A number cell's digits, read the way a chart reads them. */
export function readNumber(text: string): number | null {
  const t = text.trim().replace(/[\s,$€£¥%]/g, '').replace(/^−/, '-');
  if (t === '' || !/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return null;
  return Number(t);
}

/**
 * A table node, counted the spreadsheet's way (header row 1), with stable row
 * and column ids so the charts that read it can anchor to its corners.
 */
export function sheet(x: number, y: number, width: number, options: SheetOptions): Sheet {
  const header = options.header ?? true;
  const rows = Math.max(...options.columns.map((c) => c.cells.length));
  const cells: string[][] = [];
  if (header) cells.push(options.columns.map((c) => c.head));
  for (let r = 0; r < rows; r += 1) cells.push(options.columns.map((c) => c.cells[r] ?? ''));
  const rowIds = cells.map((_, r) => `r${r}`);
  const colIds = options.columns.map((_, c) => `c${c}`);
  const weights = options.rowHeights ?? cells.map(() => 1);
  const rowH = options.rowH ?? ROW_H;
  const height = Math.round((weights.reduce((s, w) => s + w, 0) + (options.summary ? 1 : 0)) * rowH);

  const spec: TableSpec = {
    cells,
    columns: options.columns.map((c) => ({
      width: c.width ?? 1,
      type: c.type ?? 'text',
      ...(c.align ? { align: c.align } : null),
      ...(c.style ? { style: c.style } : null),
    })),
    header,
    ...(options.firstColumn ? { firstColumn: true } : null),
    theme: options.theme ?? 'clean',
    ...(options.accent ? { accent: options.accent } : null),
    fontSize: options.fontSize ?? 13,
    ...(options.styles ? { styles: options.styles } : null),
    ...(options.rules ? { rules: options.rules } : null),
    ...(options.scales ? { scales: options.scales } : null),
    ...(options.bars ? { bars: options.bars } : null),
    ...(options.summary ? { summary: options.summary } : null),
    ...(options.rowHeights ? { rowHeights: options.rowHeights } : null),
    refs: 2,
    rowIds,
    colIds,
  };
  const id = nanoid();
  const node = {
    id,
    type: 'table',
    x,
    y,
    width,
    height,
    title: options.title,
    table: spec,
    tableRefs: 2,
  } as unknown as NewNodeInput;
  return { node, id, columns: options.columns, rows, header, height, rowIds, colIds };
}

/** Column `c`'s body readings, as a chart reads them. */
export function columnValues(s: Sheet, c: number): Array<number | null> {
  const col = s.columns[c];
  return Array.from({ length: s.rows }, (_, r) => col.values?.[r] ?? readNumber(col.cells[r] ?? ''));
}

export interface LinkMap {
  /** The column whose text names the categories. */
  cat: number;
  /** The columns drawn as series, in order. */
  series: number[];
  /**
   * Keep only the rows where this column is filled: the link's own filter,
   * for a table that opens with a row that is not a reading (an opening balance).
   */
  filled?: number;
}

/**
 * A chart spec reading `map` from `s`: the link, anchored to the range's
 * corner ids and starting on the header row so the series take their names
 * from it, and the values as they resolve today.
 */
export function linked(s: Sheet, map: LinkMap, spec: ChartSpec): ChartSpec {
  // The range spans every line it reads, the filter's included: a filter on a line outside it is dropped.
  const cols = [map.cat, ...map.series, ...(map.filled !== undefined ? [map.filled] : [])];
  const c0 = Math.min(...cols);
  const c1 = Math.max(...cols);
  const r1 = s.rows - (s.header ? 0 : 1);
  const link: ChartTableLink = {
    tableId: s.id,
    r0: 0,
    c0,
    r1,
    c1,
    ids: { r0: s.rowIds[0], r1: s.rowIds[r1], c0: s.colIds[c0], c1: s.colIds[c1] },
    grow: true,
    header: s.header,
    categoryLine: s.colIds[map.cat],
    seriesLines: map.series.map((c) => s.colIds[c]),
    ...(map.filled !== undefined ? { filters: [{ line: s.colIds[map.filled], op: 'filled' as const, value: '' }] } : null),
  };
  const keep = Array.from({ length: s.rows }, (_, r) => r).filter(
    (r) => map.filled === undefined || (s.columns[map.filled].cells[r] ?? '').trim() !== ''
  );
  const categories = keep.map((r) => s.columns[map.cat].cells[r]);
  const series = map.series.map((c, i) => {
    const values = columnValues(s, c);
    return { ...(spec.series[i] ?? {}), name: s.columns[c].head, values: keep.map((r) => values[r]) };
  });
  return { ...spec, categories, series, link };
}

// ---------------------------------------------------------------------------
// Charts and notes
// ---------------------------------------------------------------------------

export function chartAt(x: number, y: number, w: number, h: number, spec: ChartSpec, sketch?: 'light' | 'medium' | 'heavy'): NewNodeInput {
  return {
    id: nanoid(),
    type: 'chart',
    x,
    y,
    width: w,
    height: h,
    chart: spec,
    ...(sketch ? { appearance: { sketch } } : null),
  } as unknown as NewNodeInput;
}

/** How far below a figure's top its chart starts: room for the title and one line of subtitle. */
export const FIGURE_HEAD = 60;

/**
 * A chart under its own title and subtitle, set as text on the page.
 *
 * The chart's own title is drawn in the theme's ink, which on a white page in
 * the dark theme is pale grey on white. Set as page text it is the page's ink
 * in both themes, and it lines up with every other heading on the grid.
 */
export function figure(
  x: number,
  y: number,
  w: number,
  h: number,
  title: string,
  subtitle: string,
  spec: ChartSpec,
  options: { sketch?: 'light' | 'medium' | 'heavy'; hand?: boolean } = {}
): NewNodeInput[] {
  const face = options.hand ? { fontFamily: 'Caveat' } : {};
  // The hand face sets larger for the same reading size, so its lines need more room.
  const sub = options.hand ? 34 : 28;
  const top = options.hand ? FIGURE_HEAD + 8 : FIGURE_HEAD;
  const { title: _t, subtitle: _s, ...rest } = spec;
  return [
    words(x, y, w, title, { size: options.hand ? 26 : 18, weight: 650, color: INK_STRONG, lineHeight: 1.25, ...face }),
    words(x, y + sub, w, subtitle, { size: options.hand ? 20 : 14, weight: 450, color: INK_SOFT, lineHeight: 1.35, ...face }),
    chartAt(x, y + top, w, h - top, rest as ChartSpec, options.sketch),
  ];
}

/**
 * A sticky note with stamps from named teammates.
 *
 * Square, written at a fixed size so a row of notes reads as one voice, and
 * without the author chip: a template's notes have no author.
 */
export function note(
  x: number,
  y: number,
  text: string,
  theme: StickyTheme,
  options: { size?: number; w?: number; h?: number; stamps?: Record<string, string[]>; checklist?: boolean; fontSize?: number } = {}
): NewNodeInput {
  const w = options.w ?? options.size ?? 240;
  const h = options.h ?? options.size ?? 240;
  return {
    id: nanoid(),
    type: 'sticky',
    x,
    y,
    width: w,
    height: h,
    text,
    theme,
    fontSize: options.fontSize ?? 16,
    textSizing: 'fixed',
    reactions: options.stamps ?? {},
    tags: [],
    pinned: false,
    showAuthor: false,
    ...(options.checklist ? { checklist: true } : null),
  } as unknown as NewNodeInput;
}

// ---------------------------------------------------------------------------
// Drawn marks: curves, rules, dots
// ---------------------------------------------------------------------------

export interface Pt {
  x: number;
  y: number;
}

export interface StrokeOptions {
  color: string;
  width?: number;
  dash?: number[];
  closed?: boolean;
  fill?: string;
  fillOpacity?: number;
  opacity?: number;
  sketch?: 'light' | 'medium' | 'heavy';
}

/**
 * A run of points as a pen path, its box the points' own bounds.
 *
 * Anchors without handles, so the run is exactly the sampled curve: the
 * points are dense enough that a polyline is the curve at any zoom a board is
 * read at, and a fitted spline would put the curve somewhere the maths does not.
 */
export function polyline(points: Pt[], options: StrokeOptions): NewNodeInput {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const w = Math.max(1, Math.max(...xs) - left);
  const h = Math.max(1, Math.max(...ys) - top);
  return {
    id: nanoid(),
    type: 'path',
    x: left,
    y: top,
    width: w,
    height: h,
    geometry: {
      kind: 'bezier',
      closed: options.closed ?? false,
      segments: points.map((p) => ({ x: round(p.x - left, 2), y: round(p.y - top, 2) })),
    },
    appearance: {
      fill: options.fill ? [{ type: 'solid', color: options.fill, ...(options.fillOpacity !== undefined ? { opacity: options.fillOpacity } : null) }] : [],
      stroke: { color: options.color, width: options.width ?? 2, cap: 'round', join: 'round', ...(options.dash ? { dash: options.dash } : null) },
      ...(options.sketch ? { sketch: options.sketch } : null),
    },
    ...(options.opacity !== undefined ? { opacity: options.opacity } : null),
  } as unknown as NewNodeInput;
}

/** A straight rule between two points. */
export const rule = (a: Pt, b: Pt, color = RULE, width = 1.5, dash?: number[]) =>
  polyline([a, b], { color, width, dash });

/** A filled disc centred on a point. */
export function dot(cx: number, cy: number, r: number, fill: string, options: { stroke?: string; strokeWidth?: number; opacity?: number; text?: string; ink?: string; size?: number } = {}): NewNodeInput {
  return {
    id: nanoid(),
    type: 'shape',
    x: cx - r,
    y: cy - r,
    width: r * 2,
    height: r * 2,
    geometry: { kind: 'ellipse' },
    text: options.text ?? '',
    ...(options.opacity !== undefined ? { opacity: options.opacity } : null),
    appearance: {
      fill: [{ type: 'solid', color: fill }],
      stroke: { color: options.stroke ?? fill, width: options.strokeWidth ?? (options.stroke ? 1.5 : 0) },
    },
    typography: { fontSize: options.size ?? 12, fontWeight: 650, color: options.ink ?? INK, align: 'center', verticalAlign: 'middle' },
  } as unknown as NewNodeInput;
}

/** A plain rectangle with no label: a ground, a bar, a bin. */
export function slab(x: number, y: number, w: number, h: number, fill: string, options: { stroke?: string; strokeWidth?: number; opacity?: number; radius?: number } = {}): NewNodeInput {
  return {
    id: nanoid(),
    type: 'shape',
    x,
    y,
    width: w,
    height: h,
    geometry: { kind: 'rect' },
    text: '',
    ...(options.opacity !== undefined ? { opacity: options.opacity } : null),
    appearance: {
      fill: [{ type: 'solid', color: fill }],
      stroke: { color: options.stroke ?? fill, width: options.strokeWidth ?? (options.stroke ? 1 : 0) },
      cornerRadius: options.radius ?? 0,
    },
  } as unknown as NewNodeInput;
}

// ---------------------------------------------------------------------------
// A drawn plot: axes in board units, for the figures a chart cannot draw
// ---------------------------------------------------------------------------

export interface Axes {
  /** World x for a data x. */
  sx: (v: number) => number;
  /** World y for a data y. */
  sy: (v: number) => number;
  nodes: NewNodeInput[];
}

export interface AxesOptions {
  x: [number, number];
  y: [number, number];
  xTicks: number[];
  yTicks: number[];
  xLabel?: string;
  yLabel?: string;
  xFormat?: (v: number) => string;
  yFormat?: (v: number) => string;
  /** Draw horizontal rules at the y ticks. */
  grid?: boolean;
}

/**
 * Axes, ticks and gridlines for a figure drawn from shapes.
 *
 * Every mark on the figure is then placed through `sx`/`sy`, so a point drawn
 * at (3.2, 41) sits exactly where the tick labels say 3.2 and 41 are.
 */
export function axes(left: number, top: number, w: number, h: number, options: AxesOptions): Axes {
  const [x0, x1] = options.x;
  const [y0, y1] = options.y;
  const sx = (v: number) => left + ((v - x0) / (x1 - x0)) * w;
  const sy = (v: number) => top + h - ((v - y0) / (y1 - y0)) * h;
  const fx = options.xFormat ?? ((v: number) => fmt(v, Number.isInteger(v) ? 0 : 1));
  const fy = options.yFormat ?? ((v: number) => fmt(v, Number.isInteger(v) ? 0 : 1));
  const nodes: NewNodeInput[] = [];
  if (options.grid !== false) {
    for (const t of options.yTicks) if (t !== y0) nodes.push(rule({ x: left, y: sy(t) }, { x: left + w, y: sy(t) }, HAIRLINE, 1));
  }
  nodes.push(rule({ x: left, y: top + h }, { x: left + w, y: top + h }, RULE, 1.5));
  nodes.push(rule({ x: left, y: top }, { x: left, y: top + h }, RULE, 1.5));
  for (const t of options.xTicks) {
    nodes.push(rule({ x: sx(t), y: top + h }, { x: sx(t), y: top + h + 6 }, RULE, 1.5));
    nodes.push(words(sx(t) - 40, top + h + 10, 80, fx(t), { size: 13, color: INK_SOFT, align: 'center', lineHeight: 1.3 }));
  }
  for (const t of options.yTicks) {
    nodes.push(words(left - 70, sy(t) - 10, 60, fy(t), { size: 13, color: INK_SOFT, align: 'right', lineHeight: 1.3 }));
  }
  if (options.xLabel) nodes.push(words(left, top + h + 38, w, options.xLabel, { size: 14, weight: 550, color: INK_SOFT, align: 'center' }));
  if (options.yLabel) nodes.push(words(left - 70, top - 36, 400, options.yLabel, { size: 14, weight: 550, color: INK_SOFT }));
  return { sx, sy, nodes };
}
