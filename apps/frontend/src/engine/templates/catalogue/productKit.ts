import { nanoid } from 'nanoid';
import type { NewNodeInput } from '../../document/mutations';
import type { Author, StickyTheme } from '../../model/schema';
import type { ChartSpec, ChartTableLink } from '../../chart/chartTypes';
import type { CellStyle, CellType, ColourRule, DataBar, SelectOption, TableSpec, TableTheme } from '../../table/tableTypes';
import { HAIRLINE, INK, INK_SOFT, INK_STRONG, PAPER, textHeight, textWidth } from '../templateKit';

/**
 * The product and team boards' own vocabulary.
 *
 * ## Why every word sits inside a frame
 *
 * A text node's ink is a literal, so dark words written straight onto the
 * board vanish on the dark theme's near-black ground. A frame is filled white
 * in both themes, so every one of these boards is a set of frames — a planning
 * wall's themes, a sprint's five days — and everything with words in it lives
 * on one of them. Stickies, tables and cards carry their own paper and would
 * survive anywhere; text does not.
 *
 * ## Why the team is named here
 *
 * The boards share one fictional company, Northwind Labs, which makes
 * Northwind Route: dispatch and route planning for regional carriers. A
 * planning wall whose owners are "User 1" teaches nothing about owner chips;
 * one where Marcus owns auto-assign and Lena owns checkout reads as a board a
 * team actually kept, and the same eight people appear across all seven.
 */

// ---------------------------------------------------------------------------
// The team
// ---------------------------------------------------------------------------

export const PEOPLE = {
  priya: { id: 'nw-priya', name: 'Priya Raman', color: '#7C3AED' },
  marcus: { id: 'nw-marcus', name: 'Marcus Chen', color: '#2563EB' },
  sofia: { id: 'nw-sofia', name: 'Sofia Alvarez', color: '#DB2777' },
  daniel: { id: 'nw-daniel', name: 'Daniel Okafor', color: '#0F766E' },
  lena: { id: 'nw-lena', name: 'Lena Fischer', color: '#B45309' },
  tomas: { id: 'nw-tomas', name: 'Tomás Herrera', color: '#15803D' },
  aiko: { id: 'nw-aiko', name: 'Aiko Tanaka', color: '#BE123C' },
  sam: { id: 'nw-sam', name: 'Sam Whitfield', color: '#0369A1' },
} as const satisfies Record<string, Author>;

export type Person = keyof typeof PEOPLE;

const VOTERS: readonly string[] = Object.values(PEOPLE).map((p) => p.id);

/**
 * Stamps as the sticky stores them: each emoji names who pressed it.
 *
 * `{ '+1': 5, '🔥': 2 }` becomes the first five and the first two teammates,
 * so a stamp is somebody's and can be taken back by them.
 */
export function stamps(counts: Record<string, number>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  Object.entries(counts).forEach(([emoji, n], i) => {
    // Rotated per stamp, so the same three people are not behind every one.
    out[emoji] = Array.from({ length: Math.min(n, VOTERS.length) }, (_, k) => VOTERS[(k + i * 3) % VOTERS.length]);
  });
  return out;
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/** Inside a frame: the margin from its edge, and the gap between siblings. 8px base. */
export const PAD = 40;
export const GAP = 24;
/**
 * Between two frames. Vertical leaves room for the frame's own name and
 * description, which are drawn above it at screen size and so take more board
 * space the further out the board is viewed from.
 */
export const FRAME_GAP_X = 64;
export const FRAME_GAP_Y = 144;

/** A frame as a page: its emoji, a one-line description, white paper in both themes. */
export function page(
  x: number,
  y: number,
  width: number,
  height: number,
  title: string,
  icon: string,
  description: string,
  extra: Record<string, unknown> = {}
): NewNodeInput {
  return {
    id: nanoid(),
    type: 'frame',
    x,
    y,
    width,
    height,
    title,
    icon,
    description,
    appearance: { fill: [{ type: 'solid', color: PAPER }] },
    ...extra,
  } as NewNodeInput;
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

export interface WordsOptions {
  size?: number;
  weight?: number;
  color?: string;
  align?: 'left' | 'center' | 'right';
  lineHeight?: number;
  letterSpacing?: number;
  fontFamily?: string;
  italic?: boolean;
}

/**
 * Text that wraps at `width` and is already the height its lines need.
 *
 * Measured with the gallery's own Inter estimate, which `templates.test.ts`
 * holds every board to, so a box sized here is the box the check reads.
 */
export function words(x: number, y: number, width: number, text: string, o: WordsOptions = {}): NewNodeInput {
  const size = o.size ?? 15;
  const weight = o.weight ?? 450;
  const lineHeight = o.lineHeight ?? 1.5;
  return {
    id: nanoid(),
    type: 'text',
    x,
    y,
    width,
    height: Math.ceil(textHeight(text, width, size, weight, lineHeight)) + 4,
    text,
    resize: 'height',
    typography: {
      fontSize: size,
      fontWeight: weight,
      color: o.color ?? INK_SOFT,
      align: o.align ?? 'left',
      lineHeight,
      ...(o.letterSpacing !== undefined ? { letterSpacing: o.letterSpacing } : null),
      ...(o.fontFamily ? { fontFamily: o.fontFamily } : null),
      ...(o.italic ? { italic: true } : null),
    },
  } as NewNodeInput;
}

/** The height `words` will give a block, for stacking things under it. */
export const wordsHeight = (text: string, width: number, size = 15, weight = 450, lineHeight = 1.5) =>
  Math.ceil(textHeight(text, width, size, weight, lineHeight)) + 4;

/** A frame's own headline. */
export const headline = (x: number, y: number, width: number, text: string, size = 34) =>
  words(x, y, width, text, { size, weight: 700, color: INK_STRONG, lineHeight: 1.2, letterSpacing: -0.5 });

/** A heading over one part of a frame. */
export const head = (x: number, y: number, width: number, text: string, size = 19) =>
  words(x, y, width, text, { size, weight: 650, color: INK_STRONG, lineHeight: 1.3, letterSpacing: -0.2 });

/** Body copy: what a section is for, a reading, a caveat. */
export const body = (x: number, y: number, width: number, text: string, size = 15, color: string = INK_SOFT) =>
  words(x, y, width, text, { size, weight: 450, color, lineHeight: 1.5 });

/** A one-line label that keeps its line: the box is the line's own width. */
export function label(x: number, y: number, text: string, o: WordsOptions = {}): NewNodeInput {
  const size = o.size ?? 13;
  const weight = o.weight ?? 600;
  const width = Math.ceil(textWidth(text, size, weight)) + 8;
  const lineHeight = o.lineHeight ?? 1.3;
  const left = o.align === 'center' ? x - width / 2 : o.align === 'right' ? x - width : x;
  return {
    id: nanoid(),
    type: 'text',
    x: left,
    y,
    width,
    height: Math.ceil(size * lineHeight) + 2,
    text,
    resize: 'width',
    typography: {
      fontSize: size,
      fontWeight: weight,
      color: o.color ?? INK,
      align: o.align ?? 'left',
      lineHeight,
      ...(o.letterSpacing !== undefined ? { letterSpacing: o.letterSpacing } : null),
      ...(o.fontFamily ? { fontFamily: o.fontFamily } : null),
    },
  } as NewNodeInput;
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export interface PlateOptions {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  radius?: number;
  dash?: number[];
  opacity?: number;
  kind?: string;
  geometry?: Record<string, unknown>;
  sketch?: 'light' | 'medium' | 'heavy';
}

/**
 * A shape with no words: a card's ground, a bar, a swatch, a track.
 *
 * Wordless on purpose. A ground that carries its own label collides with the
 * text laid on it; a plain one is a surface, and everything on it stays an
 * ordinary object that can be picked up alone.
 */
export function plate(x: number, y: number, width: number, height: number, o: PlateOptions = {}): NewNodeInput {
  const fill = o.fill ?? PAPER;
  return {
    id: nanoid(),
    type: 'shape',
    x,
    y,
    width,
    height,
    geometry: { kind: o.kind ?? 'rect', ...o.geometry },
    appearance: {
      // "No fill" is a transparent solid: an empty list reads as unset and takes the default paint.
      fill: [{ type: 'solid', color: fill === 'none' ? 'rgba(0,0,0,0)' : fill }],
      stroke: o.stroke
        ? { color: o.stroke, width: o.strokeWidth ?? 1, ...(o.dash ? { dash: o.dash } : null) }
        : { color: fill === 'none' ? HAIRLINE : fill, width: 0 },
      cornerRadius: o.radius ?? 0,
      ...(o.sketch ? { sketch: o.sketch } : null),
    },
    ...(o.opacity !== undefined ? { opacity: o.opacity } : null),
  } as NewNodeInput;
}

/** A card: white on the frame with a hairline edge. Elevation by the edge alone. */
export const card = (x: number, y: number, width: number, height: number, fill = '#F8FAFC', radius = 12) =>
  plate(x, y, width, height, { fill, stroke: HAIRLINE, radius });

export interface ChipOptions {
  fill: string;
  ink?: string;
  stroke?: string;
  radius?: number;
  size?: number;
  weight?: number;
  kind?: string;
  geometry?: Record<string, unknown>;
  align?: 'left' | 'center' | 'right';
  sketch?: 'light' | 'medium' | 'heavy';
}

/** A shape carrying its own label: a pill, a stage, a status. */
export function chip(x: number, y: number, width: number, height: number, text: string, o: ChipOptions): NewNodeInput {
  return {
    id: nanoid(),
    type: 'shape',
    x,
    y,
    width,
    height,
    geometry: { kind: o.kind ?? 'rect', ...o.geometry },
    text,
    appearance: {
      fill: [{ type: 'solid', color: o.fill }],
      stroke: { color: o.stroke ?? o.fill, width: o.stroke ? 1 : 0 },
      cornerRadius: o.radius ?? height / 2,
      ...(o.sketch ? { sketch: o.sketch } : null),
    },
    typography: {
      fontSize: o.size ?? 13,
      fontWeight: o.weight ?? 600,
      color: o.ink ?? INK,
      align: o.align ?? 'center',
      verticalAlign: 'middle',
      lineHeight: 1.3,
    },
  } as NewNodeInput;
}

/** A straight run between two points, drawn as the shape library's line or arrow. */
export function rule(
  a: { x: number; y: number },
  b: { x: number; y: number },
  o: { color: string; width?: number; dash?: number[]; arrow?: boolean; sketch?: 'light' | 'medium' | 'heavy' }
): NewNodeInput {
  const pad = 4;
  const x = Math.min(a.x, b.x) - pad;
  const y = Math.min(a.y, b.y) - pad;
  return {
    id: nanoid(),
    type: 'shape',
    x,
    y,
    width: Math.abs(b.x - a.x) + pad * 2,
    height: Math.abs(b.y - a.y) + pad * 2,
    geometry: {
      kind: o.arrow ? 'arrow' : 'line',
      a: { x: a.x - x, y: a.y - y },
      b: { x: b.x - x, y: b.y - y },
      ...(o.arrow ? { endEnd: 'arrow' } : null),
    },
    appearance: {
      fill: [],
      stroke: { color: o.color, width: o.width ?? 1.5, cap: 'round', ...(o.dash ? { dash: o.dash } : null) },
      cornerRadius: 0,
      ...(o.sketch ? { sketch: o.sketch } : null),
    },
  } as NewNodeInput;
}

/**
 * A progress bar: a track and a fill whose width is the share done.
 *
 * Two wordless shapes, so the number beside it is ordinary text and the fill
 * can be dragged out by hand when the next check-in moves it.
 */
export function progress(x: number, y: number, width: number, share: number, color: string, height = 10): NewNodeInput[] {
  const done = Math.max(0, Math.min(1, share));
  const nodes = [plate(x, y, width, height, { fill: '#E2E8F0', radius: height / 2 })];
  if (done > 0) nodes.push(plate(x, y, Math.max(height, Math.round(width * done)), height, { fill: color, radius: height / 2 }));
  return nodes;
}

// ---------------------------------------------------------------------------
// Stickies
// ---------------------------------------------------------------------------

export interface NoteOptions {
  w?: number;
  h?: number;
  owner?: Person;
  stamps?: Record<string, number>;
  checklist?: boolean;
  fontSize?: number;
  tags?: string[];
}

/**
 * A sticky note, written at one fixed size so a wall of them reads as one
 * voice, with its owner's chip and the team's stamps on it.
 */
export function note(x: number, y: number, text: string, theme: StickyTheme, o: NoteOptions = {}): NewNodeInput {
  const owner = o.owner ? PEOPLE[o.owner] : undefined;
  return {
    id: nanoid(),
    type: 'sticky',
    x,
    y,
    width: o.w ?? 220,
    height: o.h ?? o.w ?? 220,
    text,
    theme,
    fontSize: o.fontSize ?? 18,
    textSizing: 'fixed',
    reactions: o.stamps ? stamps(o.stamps) : {},
    tags: o.tags ?? [],
    pinned: false,
    ...(owner ? { author: { ...owner }, showAuthor: true } : { showAuthor: false }),
    ...(o.checklist ? { checklist: true } : null),
  } as NewNodeInput;
}

// ---------------------------------------------------------------------------
// Connectors
// ---------------------------------------------------------------------------

export interface WireOptions {
  routing?: 'orthogonal' | 'curved' | 'straight';
  label?: string;
  color?: string;
  width?: number;
  dash?: number[];
  from?: 'top' | 'right' | 'bottom' | 'left' | 'auto';
  to?: 'top' | 'right' | 'bottom' | 'left' | 'auto';
  end?: 'arrow' | 'none' | 'dot';
  start?: 'arrow' | 'none' | 'dot';
}

/** A connector bound to both ends, routed around what is in its way. */
export function wire(from: NewNodeInput, to: NewNodeInput, o: WireOptions = {}): NewNodeInput {
  return {
    id: nanoid(),
    type: 'connector',
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    from: { nodeId: from.id as string, port: o.from ?? 'auto' },
    to: { nodeId: to.id as string, port: o.to ?? 'auto' },
    routing: o.routing ?? 'orthogonal',
    avoid: true,
    cornerRadius: 12,
    // A board this dense has wires that pass close by each other; hops at every near-crossing read as noise.
    jumps: 'none',
    endEnd: o.end ?? 'arrow',
    ...(o.start ? { endStart: o.start } : null),
    appearance: {
      stroke: { color: o.color ?? '#64748B', width: o.width ?? 2, cap: 'round', ...(o.dash ? { dash: o.dash } : null) },
    },
    ...(o.label ? { labels: [{ id: nanoid(6), text: o.label }] } : null),
  } as NewNodeInput;
}

// ---------------------------------------------------------------------------
// Tables and the charts that read them
// ---------------------------------------------------------------------------

export interface Column {
  head: string;
  type?: CellType;
  /** A share of the table's width. */
  width?: number;
  /** One per body row: a value or a formula. */
  cells: string[];
  /** What a chart reads from each body row when the cell is a formula. */
  values?: Array<number | null>;
  align?: 'left' | 'center' | 'right';
  style?: CellStyle;
  options?: SelectOption[];
}

export interface SheetOptions {
  title: string;
  columns: Column[];
  theme?: TableTheme;
  accent?: string;
  fontSize?: number;
  rowH?: number;
  firstColumn?: boolean;
  styles?: Record<string, CellStyle>;
  rules?: ColourRule[];
  bars?: DataBar[];
}

export interface Sheet {
  node: NewNodeInput;
  id: string;
  columns: Column[];
  /** Body rows, the header excluded. */
  rows: number;
  height: number;
  rowIds: string[];
  colIds: string[];
}

/** The height the table tool gives a row at 13–14px. */
export const ROW_H = 38;

/** A cell address the spreadsheet's way: column `c` from 0, table row `r` from 1 (the header). */
export const cellRef = (c: number, r: number) => `${String.fromCharCode(65 + c)}${r}`;

/** A table with a header row, its formulas counted the spreadsheet's way. */
export function sheet(x: number, y: number, width: number, o: SheetOptions): Sheet {
  const rows = Math.max(...o.columns.map((c) => c.cells.length));
  const cells: string[][] = [o.columns.map((c) => c.head)];
  for (let r = 0; r < rows; r += 1) cells.push(o.columns.map((c) => c.cells[r] ?? ''));
  const rowIds = cells.map((_, r) => `r${r}`);
  const colIds = o.columns.map((_, c) => `c${c}`);
  const height = (rows + 1) * (o.rowH ?? ROW_H);
  const spec: TableSpec = {
    cells,
    columns: o.columns.map((c) => ({
      width: c.width ?? 1,
      type: c.type ?? 'text',
      ...(c.align ? { align: c.align } : null),
      ...(c.style ? { style: c.style } : null),
      ...(c.options ? { options: c.options } : null),
    })),
    header: true,
    ...(o.firstColumn ? { firstColumn: true } : null),
    theme: o.theme ?? 'clean',
    ...(o.accent ? { accent: o.accent } : null),
    fontSize: o.fontSize ?? 13,
    ...(o.styles ? { styles: o.styles } : null),
    ...(o.rules ? { rules: o.rules } : null),
    ...(o.bars ? { bars: o.bars } : null),
    autoFit: false,
    refs: 2,
    rowIds,
    colIds,
  };
  const id = nanoid();
  const node = { id, type: 'table', x, y, width, height, title: o.title, table: spec, tableRefs: 2 } as unknown as NewNodeInput;
  return { node, id, columns: o.columns, rows, height, rowIds, colIds };
}

const readNumber = (text: string): number | null => {
  const t = text.trim().replace(/[\s,$€£%]/g, '');
  return t !== '' && /^[-+]?(\d+\.?\d*|\.\d+)$/.test(t) ? Number(t) : null;
};

/**
 * A chart spec that reads `series` columns of `s` against its `cat` column,
 * over the first `count` body rows (all of them when absent). The values are
 * stored too, as last resolved, which is what a cover draws.
 */
export function linked(s: Sheet, map: { cat: number; series: number[]; count?: number }, spec: ChartSpec): ChartSpec {
  const cols = [map.cat, ...map.series];
  const c0 = Math.min(...cols);
  const c1 = Math.max(...cols);
  const count = map.count ?? s.rows;
  const link: ChartTableLink = {
    tableId: s.id,
    r0: 0,
    c0,
    r1: count,
    c1,
    ids: { r0: s.rowIds[0], r1: s.rowIds[count], c0: s.colIds[c0], c1: s.colIds[c1] },
    grow: map.count === undefined,
    header: true,
    categoryLine: s.colIds[map.cat],
    seriesLines: map.series.map((c) => s.colIds[c]),
  };
  const categories = s.columns[map.cat].cells.slice(0, count);
  const series = map.series.map((c, i) => {
    const col = s.columns[c];
    const values = Array.from({ length: count }, (_, r) => col.values?.[r] ?? readNumber(col.cells[r] ?? ''));
    return { ...(spec.series[i] ?? {}), name: col.head, values };
  });
  return { ...spec, categories, series, link };
}

/** A chart node. Titles are set as frame text instead, so they read in both themes. */
export function chartNode(x: number, y: number, width: number, height: number, spec: ChartSpec, extra: Record<string, unknown> = {}): NewNodeInput {
  return { id: nanoid(), type: 'chart', x, y, width, height, chart: spec, ...extra } as unknown as NewNodeInput;
}

/** The tag paints a select column offers, by name: grey, blue, green, amber, red, violet, pink, teal. */
export const TAG = { grey: 0, blue: 1, green: 2, amber: 3, red: 4, violet: 5, pink: 6, teal: 7 } as const;

// ---------------------------------------------------------------------------
// Grids
// ---------------------------------------------------------------------------

export interface GridOptions {
  rows: number;
  cols: number;
  gutter?: number;
  palette: string[];
  colorMode?: 'sequence' | 'alternate' | 'solid';
  mode?: 'surface' | 'guide' | 'wireframe';
  radius?: number;
  stroke?: string;
  strokeWidth?: number;
  /** Modules reaching across tracks, keyed by their anchor's `row:col`. */
  spans?: Record<string, { rows: number; cols: number }>;
  labels?: boolean;
}

/** A grid node: modules derived on every draw from this recipe and the node's box. */
export function grid(x: number, y: number, width: number, height: number, o: GridOptions): NewNodeInput {
  const gutter = o.gutter ?? 16;
  return {
    id: nanoid(),
    type: 'grid',
    x,
    y,
    width,
    height,
    grid: {
      spec: {
        kind: 'modular',
        x: 0,
        y: 0,
        width,
        height,
        rows: o.rows,
        columns: o.cols,
        gutterX: gutter,
        gutterY: gutter,
        margin: 0,
        variation: 0,
        seed: 1,
        ...(o.spans ? { spans: o.spans } : null),
      },
      style: {
        shapes: ['rect'],
        palette: o.palette,
        colorMode: o.colorMode ?? 'sequence',
        radius: o.radius ?? 0,
        strokeColor: o.stroke ?? 'transparent',
        strokeWidth: o.stroke ? o.strokeWidth ?? 1 : 0,
        opacity: 1,
        seed: 1,
        mode: o.mode ?? 'surface',
        showLabels: o.labels ?? false,
      },
    },
  } as unknown as NewNodeInput;
}

/**
 * Where a modular grid's modules land, in board space, in the order the grid
 * numbers them (row-major by anchor, spanned tracks skipped). Even tracks and
 * no margin, which is what `grid` writes.
 */
export function gridModules(
  x: number,
  y: number,
  width: number,
  height: number,
  o: Pick<GridOptions, 'rows' | 'cols' | 'gutter' | 'spans'>
): Array<{ x: number; y: number; width: number; height: number; row: number; col: number }> {
  const gutter = o.gutter ?? 16;
  const cw = (width - gutter * (o.cols - 1)) / o.cols;
  const rh = (height - gutter * (o.rows - 1)) / o.rows;
  const taken = Array.from({ length: o.rows }, () => new Array<boolean>(o.cols).fill(false));
  const out: Array<{ x: number; y: number; width: number; height: number; row: number; col: number }> = [];
  for (let r = 0; r < o.rows; r += 1) {
    for (let c = 0; c < o.cols; c += 1) {
      if (taken[r][c]) continue;
      const span = o.spans?.[`${r}:${c}`] ?? { rows: 1, cols: 1 };
      const rs = Math.min(span.rows, o.rows - r);
      const cs = Math.min(span.cols, o.cols - c);
      for (let i = r; i < r + rs; i += 1) for (let j = c; j < c + cs; j += 1) taken[i][j] = true;
      out.push({ x: x + c * (cw + gutter), y: y + r * (rh + gutter), width: cw * cs + gutter * (cs - 1), height: rh * rs + gutter * (rs - 1), row: r, col: c });
    }
  }
  return out;
}

/** Re-exported so the boards read their ink from one place. */
export { INK, INK_SOFT, INK_STRONG };

/**
 * A chart's key, set as frame text.
 *
 * A chart draws its own legend and value labels in the theme's ink, which on
 * a white frame in the dark theme is pale grey on white. Written as text on
 * the frame, the key reads the same in both themes.
 */
export function legend(x: number, y: number, items: Array<{ color: string; text: string; dashed?: boolean }>): NewNodeInput[] {
  const out: NewNodeInput[] = [];
  let cx = x;
  for (const it of items) {
    out.push(plate(cx, y + 3, 14, 14, { fill: it.color, radius: 4 }));
    const t = label(cx + 22, y, it.text, { size: 13, weight: 500, color: INK_SOFT });
    out.push(t);
    cx += 22 + (t.width as number) + 24;
  }
  return out;
}

/**
 * A chart spec with nothing but what is given.
 *
 * Not `templateKit.plot`, which starts from the chart tool's sample for the
 * kind — a line chart's sample reads in milliseconds and a horizontal bar's in
 * thousands of dollars, sorted — and every board here would have to remember
 * to undo that.
 */
export const chartSpec = (kind: ChartSpec['kind'], over: Partial<ChartSpec>): ChartSpec =>
  ({ kind, categories: [], series: [], ...over }) as ChartSpec;

/**
 * Move grounds under the wiring, after `layer()` has run.
 *
 * `layer()` recognises frames and its own zones as grounds; a grid used as a
 * timeline is one too, and drawn above the connectors it would hide every
 * dependency that runs across it.
 */
export function sink(nodes: NewNodeInput[], grounds: NewNodeInput[]): NewNodeInput[] {
  const set = new Set(grounds);
  const frames = nodes.filter((n) => n.type === 'frame');
  const rest = nodes.filter((n) => n.type !== 'frame' && !set.has(n));
  return [...frames, ...grounds, ...rest];
}
