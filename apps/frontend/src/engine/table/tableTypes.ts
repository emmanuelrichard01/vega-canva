/**
 * A table: a real grid of cells, not a pile of text boxes.
 *
 * ## One array of strings, and everything else is a reading of it
 *
 * `cells` is the table as typed — rows of raw text, row 0 the header when
 * there is one. Types, alignment, number formatting, sorting and filtering are
 * all *views* of those strings, applied at layout time and never written back.
 * That is the same rule the chart's `sort` follows, for the same reason:
 * turning a view off must give back exactly what was entered, and a sort that
 * rewrote the rows would fight the next paste and could not be undone in one
 * step. The rich column types keep to it too: a checkbox is `TRUE`/`FALSE`, a
 * multi-select is `a;b`, a rating is a digit — strings a CSV carries as-is.
 *
 * Positional rather than keyed by column id, because a table's whole
 * relationship with the outside world is CSV — and a CSV is positional. A row
 * that pastes in from a spreadsheet lands as a row here with nothing to
 * translate.
 *
 * ## Bounds
 *
 * The node's `width`/`height` are the only bounds, as for every node. Column
 * widths and row heights are *weights* that share the node's size, so
 * resizing the object rescales them; a table grows by one row's height when a
 * row is added (see `tableApply.updateTable`).
 */

import { migrateFormulaRows } from './tableFormula';

export type CellType =
  | 'text'
  | 'number'
  | 'currency'
  | 'percent'
  | 'date'
  | 'checkbox'
  | 'select'
  | 'url'
  | 'rating'
  | 'person';
export type CellAlign = 'left' | 'center' | 'right';
export type CellVAlign = 'top' | 'middle' | 'bottom';
export type TableTheme = 'clean' | 'striped' | 'grid' | 'minimal' | 'bold';

export const CELL_TYPES: readonly CellType[] = [
  'text',
  'number',
  'currency',
  'percent',
  'date',
  'checkbox',
  'select',
  'url',
  'rating',
  'person',
];
export const TABLE_THEMES: readonly TableTheme[] = ['clean', 'striped', 'grid', 'minimal', 'bold'];

export const CELL_TYPE_LABELS: Record<CellType, string> = {
  text: 'Text',
  number: 'Number',
  currency: 'Currency',
  percent: 'Percent',
  date: 'Date',
  checkbox: 'Checkbox',
  select: 'Select',
  url: 'Link',
  rating: 'Rating',
  person: 'Person',
};

/** Types whose values are numbers, for alignment, summaries and filters. */
export const NUMERIC_TYPES: readonly CellType[] = ['number', 'currency', 'percent', 'rating'];
export const isNumericType = (t: CellType) => (NUMERIC_TYPES as readonly string[]).includes(t);

export const TABLE_THEME_LABELS: Record<TableTheme, string> = {
  clean: 'Clean',
  striped: 'Striped',
  grid: 'Grid',
  minimal: 'Minimal',
  bold: 'Bold',
};

/**
 * The eight tag colours a select option can wear, as paper and ink.
 *
 * A table is content, so on the board these are fixed — the table is the same
 * picture on a dark board and in an exported file. Each pair holds its label
 * at 4.5:1 or better (`tableTypes.test.ts` checks). The menus that pick an
 * option are app chrome and use `--tag-n-*` from table.css instead, which
 * follow the theme.
 */
export const TAG_PAINTS: ReadonlyArray<{ name: string; paper: string; ink: string }> = [
  { name: 'Grey', paper: '#F1F5F9', ink: '#334155' },
  { name: 'Blue', paper: '#DBEAFE', ink: '#1E40AF' },
  { name: 'Green', paper: '#DCFCE7', ink: '#166534' },
  { name: 'Amber', paper: '#FEF3C7', ink: '#92400E' },
  { name: 'Red', paper: '#FEE2E2', ink: '#991B1B' },
  { name: 'Violet', paper: '#EDE9FE', ink: '#5B21B6' },
  { name: 'Pink', paper: '#FCE7F3', ink: '#9D174D' },
  { name: 'Teal', paper: '#CCFBF1', ink: '#115E59' },
];

export interface SelectOption {
  label: string;
  /** Index into `TAG_PAINTS`. */
  tag: number;
}

export interface TableColumn {
  /** A share of the table's width, not pixels. */
  width: number;
  type: CellType;
  /** Absent follows the type: numbers right, everything else left. */
  align?: CellAlign;
  /** Out of the drawing and the export; the data stays. */
  hidden?: boolean;
  /** A select column's choices, in the order the menu offers them. */
  options?: SelectOption[];
  /** A select column that holds several choices per cell, written `a;b`. */
  multi?: boolean;
}

export interface CellStyle {
  bold?: boolean;
  italic?: boolean;
  color?: string;
  fill?: string;
  align?: CellAlign;
  /** Wrap long text onto more lines instead of cutting it. */
  wrap?: boolean;
  valign?: CellVAlign;
}

/** A merged block, anchored at its top-left cell. */
export interface TableMerge {
  r: number;
  c: number;
  rs: number;
  cs: number;
}

/**
 * A colour rule: cells in a column whose value matches `when` take its paint.
 *
 * `when` is a COUNTIF-style criterion — `Done`, `>100`, `<>Open`, `<0` — read
 * against the cell's *value*, a formula's result included, so the colour
 * follows every edit. A status typed as a fixed fill goes stale the moment the
 * status changes; a rule cannot. `wholeRow` paints the row the match is on.
 */
export interface ColourRule {
  col: number;
  when: string;
  fill?: string;
  color?: string;
  bold?: boolean;
  wholeRow?: boolean;
}

/** A column's numbers on a colour ramp, low to high (and through a middle). */
export interface ColourScale {
  col: number;
  from: string;
  mid?: string;
  to: string;
}

/** A bar inside each cell of a column, its length the value's share of the largest. */
export interface DataBar {
  col: number;
  color: string;
}

export interface TableSort {
  col: number;
  dir: 'asc' | 'desc';
}

/**
 * Rows a column lets through. `values`, when present, is a pick-list ("show
 * Done and Blocked"); otherwise `query` is a condition. An empty query with no
 * values matches every row: a filter that has been armed but not written yet.
 */
export interface TableFilter {
  col: number;
  query: string;
  values?: string[];
}

export type SummaryAgg = 'sum' | 'average' | 'median' | 'min' | 'max' | 'count' | 'empty' | 'filled' | 'checked';

export const SUMMARY_AGGS: readonly SummaryAgg[] = ['sum', 'average', 'median', 'min', 'max', 'count', 'empty', 'filled', 'checked'];

export const SUMMARY_LABELS: Record<SummaryAgg, string> = {
  sum: 'Sum',
  average: 'Average',
  median: 'Median',
  min: 'Min',
  max: 'Max',
  count: 'Count',
  empty: 'Empty',
  filled: '% filled',
  checked: 'Checked',
};

export interface TableSpec {
  cells: string[][];
  columns: TableColumn[];
  /** Row 0 is a header: styled, kept on top, never sorted or filtered away. */
  header: boolean;
  /** The first column reads as row labels. */
  firstColumn?: boolean;
  theme: TableTheme;
  /** The theme's one colour. Absent is the default blue. */
  accent?: string;
  fontSize: number;
  /** Per-cell overrides, keyed `"row:col"` against `cells`. */
  styles?: Record<string, CellStyle>;
  merges?: TableMerge[];
  sort?: TableSort;
  /** At most one per column; a row shows when it passes all of them. */
  filters?: TableFilter[];
  /** The symbol written before a currency column's values. */
  currency?: string;
  /**
   * Whether columns widen (and wrapped rows grow) to show what is typed into
   * them. Absent is on — cut-off text is the thing people least expect a
   * table to do to them — and `false` keeps every track exactly where it was put.
   */
  autoFit?: boolean;
  /** Colour rules, first match wins. */
  rules?: ColourRule[];
  scales?: ColourScale[];
  bars?: DataBar[];
  /** Drawn rows and columns that hold their place on screen while the editor is open. */
  frozen?: { rows: number; cols: number };
  /** A share of the row height per stored row; absent entries are 1. */
  rowHeights?: number[];
  /** A footer row summarising each column, over the rows the view shows. */
  summary?: Array<SummaryAgg | null>;
  /**
   * How row numbers in formulas are counted. 2 is the spreadsheet's way —
   * the header is row 1 and data starts at row 2 — so a formula copied out to
   * Sheets or Excel means the same cells. Absent is the older count, where the
   * header had no number; `normalizeTableSpec` rewrites those formulas once.
   */
  refs?: 2;
}

export const DEFAULT_ACCENT = '#2563EB';
export const DEFAULT_FONT_SIZE = 13;
export const MAX_ROWS = 2000;
export const MAX_COLS = 60;
export const MAX_OPTIONS = 50;

export const cellKey = (r: number, c: number) => `${r}:${c}`;

/** Whether formula row numbers skip the header — the count before `refs: 2`. */
export const refsSkipHeader = (spec: Pick<TableSpec, 'header' | 'refs'>) => spec.header && spec.refs !== 2;

/** The filter on a column, if it has one. */
export const filterOn = (spec: TableSpec, col: number) => spec.filters?.find((f) => f.col === col);

/** A table somebody can start typing into. */
export function defaultTableSpec(rows = 4, cols = 4): TableSpec {
  const heads = ['Name', 'Status', 'Owner', 'Due', 'Notes', 'Cost'];
  const types: CellType[] = ['text', 'text', 'text', 'date', 'text', 'currency'];
  return {
    cells: Array.from({ length: rows }, (_, r) =>
      Array.from({ length: cols }, (_, c) => (r === 0 ? heads[c] ?? `Column ${c + 1}` : ''))
    ),
    columns: Array.from({ length: cols }, (_, c) => ({ width: c === 0 ? 1.4 : 1, type: types[c] ?? 'text' })),
    header: true,
    theme: 'clean',
    fontSize: DEFAULT_FONT_SIZE,
    refs: 2,
  };
}

/**
 * The same spec with its formulas counted the spreadsheet's way.
 *
 * Idempotent: a spec already at `refs: 2` comes back as it is. Without a
 * header the two counts agree, so only the marker changes.
 */
export function migrateTableRefs<T extends TableSpec>(spec: T): T {
  if (spec.refs === 2) return spec;
  if (!spec.header) return { ...spec, refs: 2 };
  let changed = false;
  const cells = spec.cells.map((row) => {
    let hit = false;
    const out = row.map((v) => {
      if (typeof v !== 'string' || v.length < 2 || v[0] !== '=') return v;
      const w = `=${migrateFormulaRows(v.slice(1))}`;
      if (w !== v) hit = true;
      return w;
    });
    if (hit) changed = true;
    return hit ? out : row;
  });
  return { ...spec, cells: changed ? cells : spec.cells, refs: 2 };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const oneOf = <T extends string>(v: unknown, set: readonly T[], fallback: T): T =>
  typeof v === 'string' && (set as readonly string[]).includes(v) ? (v as T) : fallback;
const ALIGNS: readonly CellAlign[] = ['left', 'center', 'right'];
const VALIGNS: readonly CellVAlign[] = ['top', 'middle', 'bottom'];
const color = (v: unknown) => (typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v) ? v : undefined);
const inCols = (v: unknown, cols: number): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) < cols;

function readOptions(v: unknown): SelectOption[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const seen = new Set<string>();
  const out: SelectOption[] = [];
  for (const o of v.slice(0, MAX_OPTIONS)) {
    if (!isObj(o) || typeof o.label !== 'string') continue;
    const label = o.label.replace(/;/g, ',').trim().slice(0, 60);
    if (!label || seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    const tag = Number.isInteger(o.tag) ? Math.min(TAG_PAINTS.length - 1, Math.max(0, o.tag as number)) : out.length % TAG_PAINTS.length;
    out.push({ label, tag });
  }
  return out.length ? out : undefined;
}

function readFilter(f: unknown, cols: number): TableFilter | null {
  if (!isObj(f) || !inCols(f.col, cols)) return null;
  const query = typeof f.query === 'string' ? f.query.slice(0, 200) : '';
  const values = Array.isArray(f.values)
    ? [...new Set(f.values.filter((x): x is string => typeof x === 'string').map((x) => x.slice(0, 200)))].slice(0, 500)
    : undefined;
  return { col: f.col, query, ...(values ? { values } : null) };
}

/**
 * A `TableSpec` every reader can rely on.
 *
 * Invariant 3: every read passes through here, may not throw and may not
 * return a missing required field. The grid is made rectangular, every column
 * gets a definition, and merges that overlap or run off the table are dropped
 * rather than trusted — two merges claiming one cell would draw it twice.
 * Formulas written under the older row count are rewritten to the
 * spreadsheet's (`migrateTableRefs`).
 */
export function normalizeTableSpec(raw: unknown): TableSpec {
  const src = isObj(raw) ? raw : {};
  const rowsIn = Array.isArray(src.cells) ? src.cells.slice(0, MAX_ROWS) : [];
  let cols = Math.min(
    MAX_COLS,
    Math.max(1, ...rowsIn.map((r) => (Array.isArray(r) ? r.length : 0)), Array.isArray(src.columns) ? src.columns.length : 0)
  );
  if (!Number.isFinite(cols)) cols = 1;
  const cells: string[][] = rowsIn.length
    ? rowsIn.map((r) =>
        Array.from({ length: cols }, (_, c) => {
          const v = Array.isArray(r) ? r[c] : undefined;
          return typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v);
        })
      )
    : defaultTableSpec(4, cols).cells;

  const columnsIn = Array.isArray(src.columns) ? src.columns : [];
  const columns: TableColumn[] = Array.from({ length: cols }, (_, c) => {
    const col = isObj(columnsIn[c]) ? columnsIn[c] : {};
    const w = typeof col.width === 'number' && Number.isFinite(col.width) && col.width > 0 ? col.width : 1;
    const align = oneOf(col.align, ALIGNS, 'left');
    const type = oneOf(col.type, CELL_TYPES, 'text');
    const options = type === 'select' ? readOptions(col.options) : undefined;
    return {
      width: Math.min(20, Math.max(0.2, w)),
      type,
      ...(typeof col.align === 'string' ? { align } : null),
      ...(col.hidden === true ? { hidden: true } : null),
      ...(options ? { options } : null),
      ...(type === 'select' && col.multi === true ? { multi: true } : null),
    };
  });
  // A table always shows at least one column.
  if (columns.every((c) => c.hidden)) delete columns[0].hidden;

  const rows = cells.length;
  const styles: Record<string, CellStyle> = {};
  if (isObj(src.styles)) {
    for (const [key, value] of Object.entries(src.styles)) {
      const m = /^(\d+):(\d+)$/.exec(key);
      if (!m || !isObj(value)) continue;
      if (Number(m[1]) >= rows || Number(m[2]) >= cols) continue;
      const s: CellStyle = {};
      if (value.bold === true) s.bold = true;
      if (value.italic === true) s.italic = true;
      if (color(value.color)) s.color = color(value.color);
      if (color(value.fill)) s.fill = color(value.fill);
      if (typeof value.align === 'string') s.align = oneOf(value.align, ALIGNS, 'left');
      if (value.wrap === true) s.wrap = true;
      if (typeof value.valign === 'string' && value.valign !== 'middle') s.valign = oneOf(value.valign, VALIGNS, 'middle');
      if (s.valign === 'middle') delete s.valign;
      if (Object.keys(s).length) styles[key] = s;
    }
  }

  const merges: TableMerge[] = [];
  const claimed = new Set<string>();
  for (const m of Array.isArray(src.merges) ? src.merges : []) {
    if (!isObj(m)) continue;
    const r = Math.floor(Number(m.r));
    const c = Math.floor(Number(m.c));
    const rs = Math.floor(Number(m.rs));
    const cs = Math.floor(Number(m.cs));
    if (![r, c, rs, cs].every(Number.isFinite) || r < 0 || c < 0 || rs < 1 || cs < 1) continue;
    if (r + rs > rows || c + cs > cols || rs * cs < 2) continue;
    const keys: string[] = [];
    for (let i = r; i < r + rs; i++) for (let j = c; j < c + cs; j++) keys.push(cellKey(i, j));
    if (keys.some((k) => claimed.has(k))) continue;
    keys.forEach((k) => claimed.add(k));
    merges.push({ r, c, rs, cs });
  }

  // An empty `when` is kept — it is a rule being typed, and it matches nothing
  // — so clearing the field does not delete the rule under the person's hands.
  const rules: ColourRule[] = [];
  for (const rule of Array.isArray(src.rules) ? src.rules.slice(0, 40) : []) {
    if (!isObj(rule) || !inCols(rule.col, cols)) continue;
    if (typeof rule.when !== 'string') continue;
    const r: ColourRule = { col: rule.col, when: rule.when.slice(0, 80) };
    if (color(rule.fill)) r.fill = color(rule.fill);
    if (color(rule.color)) r.color = color(rule.color);
    if (rule.bold === true) r.bold = true;
    if (rule.wholeRow === true) r.wholeRow = true;
    rules.push(r);
  }

  const scales: ColourScale[] = [];
  for (const s of Array.isArray(src.scales) ? src.scales.slice(0, 20) : []) {
    if (!isObj(s) || !inCols(s.col, cols) || !color(s.from) || !color(s.to)) continue;
    if (scales.some((x) => x.col === s.col)) continue;
    scales.push({ col: s.col, from: color(s.from)!, to: color(s.to)!, ...(color(s.mid) ? { mid: color(s.mid) } : null) });
  }

  const bars: DataBar[] = [];
  for (const b of Array.isArray(src.bars) ? src.bars.slice(0, 20) : []) {
    if (!isObj(b) || !inCols(b.col, cols) || !color(b.color)) continue;
    if (bars.some((x) => x.col === b.col)) continue;
    bars.push({ col: b.col, color: color(b.color)! });
  }

  const sort =
    isObj(src.sort) && inCols(src.sort.col, cols)
      ? { col: src.sort.col, dir: src.sort.dir === 'desc' ? ('desc' as const) : ('asc' as const) }
      : undefined;

  // `filter` was the single filter before there could be one per column.
  const filters: TableFilter[] = [];
  for (const f of [...(Array.isArray(src.filters) ? src.filters.slice(0, MAX_COLS) : []), ...(src.filter ? [src.filter] : [])]) {
    const read = readFilter(f, cols);
    if (read && !filters.some((x) => x.col === read.col)) filters.push(read);
  }

  const frozen =
    isObj(src.frozen) && (Number(src.frozen.rows) > 0 || Number(src.frozen.cols) > 0)
      ? {
          rows: Math.max(0, Math.min(rows, Math.floor(Number(src.frozen.rows) || 0))),
          cols: Math.max(0, Math.min(cols, Math.floor(Number(src.frozen.cols) || 0))),
        }
      : undefined;

  let rowHeights: number[] | undefined;
  if (Array.isArray(src.rowHeights)) {
    const hs = Array.from({ length: rows }, (_, r) => {
      const v = (src.rowHeights as unknown[])[r];
      return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(20, Math.max(0.4, v)) : 1;
    });
    if (hs.some((h) => h !== 1)) rowHeights = hs;
  }

  let summary: Array<SummaryAgg | null> | undefined;
  if (Array.isArray(src.summary)) {
    const s = Array.from({ length: cols }, (_, c) => {
      const v = (src.summary as unknown[])[c];
      return typeof v === 'string' && (SUMMARY_AGGS as readonly string[]).includes(v) ? (v as SummaryAgg) : null;
    });
    summary = s;
  }

  const spec: TableSpec = {
    cells,
    columns,
    header: src.header !== false,
    ...(src.firstColumn === true ? { firstColumn: true } : null),
    theme: oneOf(src.theme, TABLE_THEMES, 'clean'),
    ...(color(src.accent) ? { accent: color(src.accent) } : null),
    fontSize:
      typeof src.fontSize === 'number' && Number.isFinite(src.fontSize)
        ? Math.min(32, Math.max(9, Math.round(src.fontSize)))
        : DEFAULT_FONT_SIZE,
    ...(Object.keys(styles).length ? { styles } : null),
    ...(merges.length ? { merges } : null),
    ...(sort ? { sort } : null),
    ...(filters.length ? { filters } : null),
    ...(typeof src.currency === 'string' && src.currency.trim() ? { currency: src.currency.trim().slice(0, 3) } : null),
    ...(src.autoFit === false ? { autoFit: false } : null),
    ...(rules.length ? { rules } : null),
    ...(scales.length ? { scales } : null),
    ...(bars.length ? { bars } : null),
    ...(frozen && (frozen.rows > 0 || frozen.cols > 0) ? { frozen } : null),
    ...(rowHeights ? { rowHeights } : null),
    ...(summary ? { summary } : null),
    ...(src.refs === 2 ? { refs: 2 as const } : null),
  };
  return migrateTableRefs(spec);
}
