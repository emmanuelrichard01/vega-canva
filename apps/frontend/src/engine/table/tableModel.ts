import { parseDelimited } from '../chart/chartCsv';
import {
  cellKey,
  CELL_TYPES,
  MAX_COLS,
  MAX_ROWS,
  type CellAlign,
  type CellStyle,
  type CellType,
  type TableMerge,
  type TableSpec,
} from './tableTypes';

/**
 * Everything a table can have done to it, as pure functions of the spec.
 *
 * Every operation returns a new spec and touches nothing else, so the editor,
 * the panel, the context menu and the tests all share one implementation —
 * and every one of them is one undo step, because the caller writes the
 * result once.
 *
 * The one piece of bookkeeping that is easy to get wrong is keeping *merges
 * and per-cell styles* attached to the right cells when rows and columns move
 * under them. `shift` does that for all four structural operations.
 */

export interface CellRange {
  r0: number;
  c0: number;
  r1: number;
  c1: number;
}

export const rowCount = (spec: TableSpec) => spec.cells.length;
export const colCount = (spec: TableSpec) => spec.columns.length;

/** Put a range the right way round and inside the table. */
export function normRange(range: CellRange, spec: TableSpec): CellRange {
  const rows = rowCount(spec);
  const cols = colCount(spec);
  return {
    r0: Math.max(0, Math.min(range.r0, range.r1)),
    c0: Math.max(0, Math.min(range.c0, range.c1)),
    r1: Math.min(rows - 1, Math.max(range.r0, range.r1)),
    c1: Math.min(cols - 1, Math.max(range.c0, range.c1)),
  };
}

// ---------------------------------------------------------------------------
// Reading values
// ---------------------------------------------------------------------------

/** A number out of what somebody typed: `$1,250.50`, `12%`, `-3.5`. */
export function parseCellNumber(text: string): number | null {
  const t = text.trim().replace(/[\s,$€£¥]/g, '');
  if (t === '') return null;
  const pct = t.endsWith('%');
  const n = Number(pct ? t.slice(0, -1) : t);
  if (!Number.isFinite(n)) return null;
  return n;
}

function parseDate(text: string): number | null {
  const t = text.trim();
  // Only things that look like dates: a bare number is a year or a count, and
  // `Date.parse('12')` answering December is the classic way to sort wrongly.
  if (!/[-/.]|\b[a-z]{3,}\b/i.test(t)) return null;
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * The column type a set of values most plausibly is.
 *
 * Four in five non-empty values have to agree, so one stray note in a column
 * of prices does not make it text, and one number in a column of names does
 * not make it numeric.
 */
export function inferType(values: string[]): CellType {
  const filled = values.map((v) => v.trim()).filter((v) => v !== '');
  if (filled.length === 0) return 'text';
  const share = (test: (v: string) => boolean) => filled.filter(test).length / filled.length;
  if (share((v) => /^[-+]?[$€£¥]/.test(v) && parseCellNumber(v) !== null) >= 0.8) return 'currency';
  if (share((v) => /%$/.test(v) && parseCellNumber(v) !== null) >= 0.8) return 'percent';
  if (share((v) => parseCellNumber(v) !== null) >= 0.8) return 'number';
  if (share((v) => parseDate(v) !== null) >= 0.8) return 'date';
  return 'text';
}

const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 });

/** The text a cell shows: the raw string read through its column's type. */
export function formatCell(spec: TableSpec, r: number, c: number): string {
  const raw = spec.cells[r]?.[c] ?? '';
  if (spec.header && r === 0) return raw;
  const type = spec.columns[c]?.type ?? 'text';
  if (type === 'text' || raw.trim() === '') return raw;
  if (type === 'date') {
    const ms = parseDate(raw);
    return ms === null
      ? raw
      : new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }
  const n = parseCellNumber(raw);
  if (n === null) return raw;
  if (type === 'currency') {
    const symbol = spec.currency ?? '$';
    const body = Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${n < 0 ? '−' : ''}${symbol}${body}`;
  }
  if (type === 'percent') return `${numberFormat.format(n)}%`;
  return numberFormat.format(n);
}

/** Left for words, right for numbers — unless the cell or column says otherwise. */
export function alignFor(spec: TableSpec, r: number, c: number): CellAlign {
  const own = spec.styles?.[cellKey(r, c)]?.align;
  if (own) return own;
  if (spec.columns[c]?.align) return spec.columns[c].align!;
  const type = spec.columns[c]?.type ?? 'text';
  if (spec.header && r === 0) return type === 'text' || type === 'date' ? 'left' : 'right';
  return type === 'text' || type === 'date' ? 'left' : 'right';
}

// ---------------------------------------------------------------------------
// The view: filter, then sort
// ---------------------------------------------------------------------------

/**
 * Does a cell pass the filter?
 *
 * Numeric columns understand `>10`, `<=5`, `=3` and `10..20`; everything else
 * is a case-insensitive "contains". Small enough to learn from the placeholder,
 * which is where it is explained.
 */
function passes(spec: TableSpec, r: number): boolean {
  const f = spec.filter;
  if (!f) return true;
  const raw = spec.cells[r]?.[f.col] ?? '';
  const q = f.query.trim();
  const type = spec.columns[f.col]?.type ?? 'text';
  if (type !== 'text') {
    const n = parseCellNumber(raw) ?? parseDate(raw);
    const range = /^(-?[\d.]+)\s*\.\.\s*(-?[\d.]+)$/.exec(q);
    if (range && n !== null) return n >= Number(range[1]) && n <= Number(range[2]);
    const op = /^(>=|<=|>|<|=)\s*(.+)$/.exec(q);
    if (op && n !== null) {
      const v = parseCellNumber(op[2]) ?? parseDate(op[2]);
      if (v !== null) {
        switch (op[1]) {
          case '>':
            return n > v;
          case '<':
            return n < v;
          case '>=':
            return n >= v;
          case '<=':
            return n <= v;
          default:
            return n === v;
        }
      }
    }
  }
  return raw.toLowerCase().includes(q.toLowerCase());
}

function compare(spec: TableSpec, a: number, b: number, col: number): number {
  const ra = spec.cells[a]?.[col] ?? '';
  const rb = spec.cells[b]?.[col] ?? '';
  // Empty last whichever way round: a blank is missing, not small.
  if (ra.trim() === '' && rb.trim() === '') return 0;
  if (ra.trim() === '') return 1;
  if (rb.trim() === '') return -1;
  const type = spec.columns[col]?.type ?? 'text';
  if (type === 'date') {
    const da = parseDate(ra);
    const db = parseDate(rb);
    if (da !== null && db !== null) return da - db;
  }
  if (type !== 'text') {
    const na = parseCellNumber(ra);
    const nb = parseCellNumber(rb);
    if (na !== null && nb !== null) return na - nb;
  }
  return ra.localeCompare(rb, undefined, { numeric: true, sensitivity: 'base' });
}

/** The row indices in the order they are drawn. The header always leads. */
export function viewRows(spec: TableSpec): number[] {
  const rows = rowCount(spec);
  const start = spec.header ? 1 : 0;
  const body = Array.from({ length: Math.max(0, rows - start) }, (_, i) => i + start).filter((r) => passes(spec, r));
  if (spec.sort) {
    const { col, dir } = spec.sort;
    const blanksLast = (a: number, b: number) => {
      const ea = (spec.cells[a]?.[col] ?? '').trim() === '';
      const eb = (spec.cells[b]?.[col] ?? '').trim() === '';
      if (ea !== eb) return ea ? 1 : -1;
      const d = compare(spec, a, b, col);
      return dir === 'desc' ? -d : d;
    };
    body.sort(blanksLast);
  }
  return spec.header && rows > 0 ? [0, ...body] : body;
}

/** Whether the drawn rows are the stored rows in order — merges need that. */
export const isIdentityView = (spec: TableSpec) => !spec.sort && !spec.filter;

/** Write the current order into the table and drop the view. */
export function applyView(spec: TableSpec): TableSpec {
  const order = viewRows(spec);
  const hidden = spec.cells.map((_, r) => r).filter((r) => !order.includes(r));
  const rows = [...order, ...hidden];
  return {
    ...spec,
    cells: rows.map((r) => [...spec.cells[r]]),
    styles: remapStyles(spec.styles, (r, c) => [rows.indexOf(r), c]),
    merges: undefined,
    sort: undefined,
    filter: undefined,
  };
}

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------

function remapStyles(
  styles: TableSpec['styles'],
  map: (r: number, c: number) => [number, number] | null
): TableSpec['styles'] {
  if (!styles) return undefined;
  const out: Record<string, CellStyle> = {};
  for (const [key, s] of Object.entries(styles)) {
    const [r, c] = key.split(':').map(Number);
    const to = map(r, c);
    if (to && to[0] >= 0 && to[1] >= 0) out[cellKey(to[0], to[1])] = s;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Move everything at or past `at` along one axis by `delta`.
 *
 * Deleting is a negative delta: cells inside the deleted span lose their
 * styles, and a merge shrinks by however much of it was cut — or disappears
 * once it is down to a single cell.
 */
function shift(spec: TableSpec, axis: 'row' | 'col', at: number, delta: number): Pick<TableSpec, 'styles' | 'merges'> {
  const moved = (i: number) => (i >= at ? (delta < 0 && i < at - delta ? -1 : i + delta) : i);
  const styles = remapStyles(spec.styles, (r, c) => {
    const nr = axis === 'row' ? moved(r) : r;
    const nc = axis === 'col' ? moved(c) : c;
    return nr < 0 || nc < 0 ? null : [nr, nc];
  });
  const merges: TableMerge[] = [];
  for (const m of spec.merges ?? []) {
    const start = axis === 'row' ? m.r : m.c;
    const span = axis === 'row' ? m.rs : m.cs;
    let s = start;
    let n = span;
    if (delta > 0) {
      if (at <= start) s = start + delta;
      else if (at < start + span) n = span + delta;
    } else {
      const cutFrom = at;
      const cutTo = at - delta; // exclusive
      const overlap = Math.max(0, Math.min(start + span, cutTo) - Math.max(start, cutFrom));
      n = span - overlap;
      s = start >= cutTo ? start + delta : start >= cutFrom ? cutFrom : start;
    }
    const next = axis === 'row' ? { ...m, r: s, rs: n } : { ...m, c: s, cs: n };
    if (next.rs * next.cs >= 2 && n >= 1) merges.push(next);
  }
  return { styles, merges: merges.length ? merges : undefined };
}

const blankRow = (cols: number) => Array.from({ length: cols }, () => '');

export function insertRows(spec: TableSpec, at: number, count = 1): TableSpec {
  if (rowCount(spec) + count > MAX_ROWS) return spec;
  const cells = [...spec.cells];
  cells.splice(at, 0, ...Array.from({ length: count }, () => blankRow(colCount(spec))));
  return { ...spec, cells, ...shift(spec, 'row', at, count) };
}

export function deleteRows(spec: TableSpec, from: number, count = 1): TableSpec {
  // A table keeps at least one row; an empty grid has nowhere to type.
  if (rowCount(spec) - count < 1) return spec;
  const cells = spec.cells.filter((_, r) => r < from || r >= from + count);
  const next = { ...spec, cells, ...shift(spec, 'row', from, -count) };
  // The header is row 0; deleting it promotes the next row, which is the
  // spreadsheet reading and never loses anything the person can see.
  return next;
}

export function insertCols(spec: TableSpec, at: number, count = 1): TableSpec {
  if (colCount(spec) + count > MAX_COLS) return spec;
  const cells = spec.cells.map((row) => {
    const next = [...row];
    next.splice(at, 0, ...Array.from({ length: count }, () => ''));
    return next;
  });
  const columns = [...spec.columns];
  columns.splice(at, 0, ...Array.from({ length: count }, () => ({ width: 1, type: 'text' as CellType })));
  const shifted = shift(spec, 'col', at, count);
  const sort = spec.sort && spec.sort.col >= at ? { ...spec.sort, col: spec.sort.col + count } : spec.sort;
  const filter = spec.filter && spec.filter.col >= at ? { ...spec.filter, col: spec.filter.col + count } : spec.filter;
  return { ...spec, cells, columns, ...shifted, sort, filter };
}

export function deleteCols(spec: TableSpec, from: number, count = 1): TableSpec {
  if (colCount(spec) - count < 1) return spec;
  const keep = (c: number) => c < from || c >= from + count;
  const cells = spec.cells.map((row) => row.filter((_, c) => keep(c)));
  const columns = spec.columns.filter((_, c) => keep(c));
  const shifted = shift(spec, 'col', from, -count);
  const fix = <T extends { col: number }>(v: T | undefined): T | undefined =>
    !v ? v : v.col >= from && v.col < from + count ? undefined : v.col >= from + count ? { ...v, col: v.col - count } : v;
  return { ...spec, cells, columns, ...shifted, sort: fix(spec.sort), filter: fix(spec.filter) };
}

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

export function setCell(spec: TableSpec, r: number, c: number, text: string): TableSpec {
  if (spec.cells[r]?.[c] === text) return spec;
  return {
    ...spec,
    cells: spec.cells.map((row, i) => (i === r ? row.map((v, j) => (j === c ? text : v)) : row)),
  };
}

/**
 * Write a block of text in from `(r, c)`, growing the table to take it.
 *
 * What a paste from a spreadsheet does. New columns arrive typed by what was
 * pasted into them, so a column of prices lands as currency without a trip to
 * the panel.
 */
export function setBlock(spec: TableSpec, r0: number, c0: number, block: string[][]): TableSpec {
  if (block.length === 0) return spec;
  const needRows = Math.min(MAX_ROWS, Math.max(rowCount(spec), r0 + block.length));
  const needCols = Math.min(MAX_COLS, Math.max(colCount(spec), c0 + Math.max(...block.map((b) => b.length))));
  const cells = Array.from({ length: needRows }, (_, r) =>
    Array.from({ length: needCols }, (_, c) => spec.cells[r]?.[c] ?? '')
  );
  block.forEach((row, dr) =>
    row.forEach((text, dc) => {
      const r = r0 + dr;
      const c = c0 + dc;
      if (r < needRows && c < needCols) cells[r][c] = text;
    })
  );
  const columns = Array.from({ length: needCols }, (_, c) => {
    if (spec.columns[c]) return spec.columns[c];
    const body = cells.slice(spec.header ? 1 : 0).map((row) => row[c]);
    return { width: 1, type: inferType(body) };
  });
  return { ...spec, cells, columns };
}

export function clearRange(spec: TableSpec, range: CellRange): TableSpec {
  const { r0, c0, r1, c1 } = normRange(range, spec);
  return {
    ...spec,
    cells: spec.cells.map((row, r) => (r < r0 || r > r1 ? row : row.map((v, c) => (c < c0 || c > c1 ? v : '')))),
  };
}

/** The range as tab-separated text, which every spreadsheet pastes. */
export function rangeToTsv(spec: TableSpec, range: CellRange): string {
  const { r0, c0, r1, c1 } = normRange(range, spec);
  const lines: string[] = [];
  for (let r = r0; r <= r1; r++) {
    lines.push(spec.cells[r].slice(c0, c1 + 1).map((v) => v.replace(/[\t\n]/g, ' ')).join('\t'));
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Formatting and merging
// ---------------------------------------------------------------------------

/** Apply a style to every cell in a range. `undefined` values clear that key. */
export function styleRange(spec: TableSpec, range: CellRange, patch: CellStyle): TableSpec {
  const { r0, c0, r1, c1 } = normRange(range, spec);
  const styles: Record<string, CellStyle> = { ...(spec.styles ?? {}) };
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const key = cellKey(r, c);
      const next: CellStyle = { ...(styles[key] ?? {}), ...patch };
      for (const k of Object.keys(next) as Array<keyof CellStyle>) if (next[k] === undefined || next[k] === false) delete next[k];
      if (Object.keys(next).length) styles[key] = next;
      else delete styles[key];
    }
  }
  return { ...spec, styles: Object.keys(styles).length ? styles : undefined };
}

/** The shared value of one style key across a range, or `undefined` when mixed. */
export function styleOf<K extends keyof CellStyle>(spec: TableSpec, range: CellRange, key: K): CellStyle[K] | undefined {
  const { r0, c0, r1, c1 } = normRange(range, spec);
  let first: CellStyle[K] | undefined;
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const v = spec.styles?.[cellKey(r, c)]?.[key];
      if (r === r0 && c === c0) first = v;
      else if (v !== first) return undefined;
    }
  }
  return first;
}

export function mergeAt(spec: TableSpec, r: number, c: number): TableMerge | undefined {
  return spec.merges?.find((m) => r >= m.r && r < m.r + m.rs && c >= m.c && c < m.c + m.cs);
}

/**
 * Merge a range into one cell, keeping the top-left text.
 *
 * Merges it overlaps are absorbed rather than refused — the new block covers
 * them, which is what merging over a merged cell means in every spreadsheet.
 */
export function mergeRange(spec: TableSpec, range: CellRange): TableSpec {
  const { r0, c0, r1, c1 } = normRange(range, spec);
  if (r0 === r1 && c0 === c1) return spec;
  const overlaps = (m: TableMerge) => !(m.r > r1 || m.r + m.rs - 1 < r0 || m.c > c1 || m.c + m.cs - 1 < c0);
  const merges = (spec.merges ?? []).filter((m) => !overlaps(m));
  merges.push({ r: r0, c: c0, rs: r1 - r0 + 1, cs: c1 - c0 + 1 });
  return { ...spec, merges };
}

export function unmergeRange(spec: TableSpec, range: CellRange): TableSpec {
  const { r0, c0, r1, c1 } = normRange(range, spec);
  const merges = (spec.merges ?? []).filter((m) => m.r > r1 || m.r + m.rs - 1 < r0 || m.c > c1 || m.c + m.cs - 1 < c0);
  return { ...spec, merges: merges.length ? merges : undefined };
}

export function setColumn(spec: TableSpec, c: number, patch: Partial<TableSpec['columns'][number]>): TableSpec {
  return {
    ...spec,
    columns: spec.columns.map((col, i) => {
      if (i !== c) return col;
      const next = { ...col, ...patch };
      if (patch.align === undefined && 'align' in patch) delete next.align;
      return next;
    }),
  };
}

/** Give a column a new share of the width, taken from its right neighbour. */
export function resizeColumn(spec: TableSpec, c: number, width: number): TableSpec {
  const next = Math.min(20, Math.max(0.2, width));
  return setColumn(spec, c, { width: next });
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/**
 * A table from CSV (or TSV — the delimiter is detected).
 *
 * The first row is the header, every column is typed by what is under it, and
 * each column gets a share of the width proportional to its longest value, so
 * an imported table arrives looking considered rather than like twelve equal
 * boxes with the long text cut off.
 */
export function tableFromCsv(text: string, base?: Partial<TableSpec>): TableSpec | null {
  const rows = parseDelimited(text)
    .map((r) => r.map((v) => v.trim()))
    .filter((r) => r.some((v) => v !== ''))
    .slice(0, MAX_ROWS);
  if (rows.length === 0) return null;
  const cols = Math.min(MAX_COLS, Math.max(...rows.map((r) => r.length)));
  const cells = rows.map((r) => Array.from({ length: cols }, (_, c) => r[c] ?? ''));
  const columns = Array.from({ length: cols }, (_, c) => {
    const body = cells.slice(1).map((r) => r[c]);
    const longest = Math.max(...cells.map((r) => (r[c] ?? '').length), 3);
    return { width: Math.min(4, Math.max(0.6, longest / 10)), type: inferType(body) };
  });
  return {
    theme: 'clean',
    fontSize: 13,
    ...base,
    cells,
    columns,
    header: true,
    styles: undefined,
    merges: undefined,
    sort: undefined,
    filter: undefined,
  };
}

const quote = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** The table as CSV: the stored cells, or only the rows the view shows. */
export function tableToCsv(spec: TableSpec, viewOnly = false): string {
  const rows = viewOnly ? viewRows(spec) : spec.cells.map((_, r) => r);
  return rows.map((r) => spec.cells[r].map(quote).join(',')).join('\r\n');
}

export function downloadTableCsv(spec: TableSpec, filename: string): void {
  if (typeof document === 'undefined') return;
  // The BOM is what makes Excel read the file as UTF-8 rather than mangling
  // every accent — the same reason the chart export carries one.
  const blob = new Blob(['﻿' + tableToCsv(spec)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const isCellType = (v: string): v is CellType => (CELL_TYPES as readonly string[]).includes(v);
