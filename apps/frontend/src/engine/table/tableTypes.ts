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
 * step.
 *
 * Positional rather than keyed by column id, because a table's whole
 * relationship with the outside world is CSV — and a CSV is positional. A row
 * that pastes in from a spreadsheet lands as a row here with nothing to
 * translate.
 *
 * ## Bounds
 *
 * The node's `width`/`height` are the only bounds, as for every node. Column
 * widths are *weights* that share the node's width, so resizing the object
 * rescales the columns; rows share its height evenly, so a table grows by one
 * row's height when a row is added (see `tableApply.updateTable`).
 */

export type CellType = 'text' | 'number' | 'currency' | 'percent' | 'date';
export type CellAlign = 'left' | 'center' | 'right';
export type TableTheme = 'clean' | 'striped' | 'grid' | 'minimal' | 'bold';

export const CELL_TYPES: readonly CellType[] = ['text', 'number', 'currency', 'percent', 'date'];
export const TABLE_THEMES: readonly TableTheme[] = ['clean', 'striped', 'grid', 'minimal', 'bold'];

export const CELL_TYPE_LABELS: Record<CellType, string> = {
  text: 'Text',
  number: 'Number',
  currency: 'Currency',
  percent: 'Percent',
  date: 'Date',
};

export const TABLE_THEME_LABELS: Record<TableTheme, string> = {
  clean: 'Clean',
  striped: 'Striped',
  grid: 'Grid',
  minimal: 'Minimal',
  bold: 'Bold',
};

export interface TableColumn {
  /** A share of the table's width, not pixels. */
  width: number;
  type: CellType;
  /** Absent follows the type: numbers right, everything else left. */
  align?: CellAlign;
}

export interface CellStyle {
  bold?: boolean;
  italic?: boolean;
  color?: string;
  fill?: string;
  align?: CellAlign;
}

/** A merged block, anchored at its top-left cell. */
export interface TableMerge {
  r: number;
  c: number;
  rs: number;
  cs: number;
}

export interface TableSort {
  col: number;
  dir: 'asc' | 'desc';
}

export interface TableFilter {
  col: number;
  query: string;
}

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
  filter?: TableFilter;
  /** The symbol written before a currency column's values. */
  currency?: string;
}

export const DEFAULT_ACCENT = '#2563EB';
export const DEFAULT_FONT_SIZE = 13;
export const MAX_ROWS = 2000;
export const MAX_COLS = 60;

export const cellKey = (r: number, c: number) => `${r}:${c}`;

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
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const oneOf = <T extends string>(v: unknown, set: readonly T[], fallback: T): T =>
  typeof v === 'string' && (set as readonly string[]).includes(v) ? (v as T) : fallback;
const ALIGNS: readonly CellAlign[] = ['left', 'center', 'right'];
const color = (v: unknown) => (typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v) ? v : undefined);

/**
 * A `TableSpec` every reader can rely on.
 *
 * Invariant 3: every read passes through here, may not throw and may not
 * return a missing required field. The grid is made rectangular, every column
 * gets a definition, and merges that overlap or run off the table are dropped
 * rather than trusted — two merges claiming one cell would draw it twice.
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
    return {
      width: Math.min(20, Math.max(0.2, w)),
      type: oneOf(col.type, CELL_TYPES, 'text'),
      ...(typeof col.align === 'string' ? { align } : null),
    };
  });

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

  const sort =
    isObj(src.sort) && Number.isInteger(src.sort.col) && (src.sort.col as number) >= 0 && (src.sort.col as number) < cols
      ? { col: src.sort.col as number, dir: src.sort.dir === 'desc' ? ('desc' as const) : ('asc' as const) }
      : undefined;
  const filter =
    isObj(src.filter) &&
    Number.isInteger(src.filter.col) &&
    (src.filter.col as number) >= 0 &&
    (src.filter.col as number) < cols &&
    typeof src.filter.query === 'string' &&
    src.filter.query.trim() !== ''
      ? { col: src.filter.col as number, query: src.filter.query }
      : undefined;

  return {
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
    ...(filter ? { filter } : null),
    ...(typeof src.currency === 'string' && src.currency.trim() ? { currency: src.currency.trim().slice(0, 3) } : null),
  };
}
