import { parseDelimited } from '../chart/chartCsv';
import { evaluateCell, formatSerial, isErr, isFormula, parseDateText, rewriteRefs, shiftRefs, type FValue } from './tableFormula';
import {
  cellKey,
  CELL_TYPES,
  isNumericType,
  MAX_COLS,
  MAX_OPTIONS,
  MAX_ROWS,
  newTableId,
  refsSkipHeader,
  SUMMARY_LABELS,
  TAG_PAINTS,
  type CellAlign,
  type CellStyle,
  type CellType,
  type SelectOption,
  type SummaryAgg,
  type TableColumn,
  type TableFilter,
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
 * The one piece of bookkeeping that is easy to get wrong is keeping *merges,
 * per-cell styles, row heights and everything keyed by column* attached to
 * the right cells when rows and columns move under them. `shift` and
 * `permute` do that for every structural operation.
 */

export interface CellRange {
  r0: number;
  c0: number;
  r1: number;
  c1: number;
}

export const rowCount = (spec: TableSpec) => spec.cells.length;

/** Fresh ids for tracks that did not exist before. */
const freshIds = (n: number) => Array.from({ length: n }, () => newTableId());

/** Ids edited alongside the tracks they name — or absent, when the spec carries none. */
const editIds = (ids: string[] | undefined, edit: (ids: string[]) => string[]) => (ids ? edit([...ids]) : undefined);
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

/** A checkbox cell's state: `TRUE`, `yes`, `x`, `1` and a tick all count as ticked. */
export const isChecked = (raw: string) => /^(true|yes|y|x|1|✓|✔)$/i.test(raw.trim());

/** A multi-select cell's labels; a single select is the one-element case. */
export const selectLabels = (raw: string): string[] =>
  raw
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);

/** A rating cell's stars, 0 to 5. */
export function ratingOf(raw: string): number {
  const n = parseCellNumber(raw);
  return n === null ? 0 : Math.max(0, Math.min(5, Math.round(n)));
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
  if (share((v) => /^(true|false)$/i.test(v)) >= 0.8) return 'checkbox';
  if (share((v) => /^[-+]?[$€£¥]/.test(v) && parseCellNumber(v) !== null) >= 0.8) return 'currency';
  if (share((v) => /%$/.test(v) && parseCellNumber(v) !== null) >= 0.8) return 'percent';
  if (share((v) => parseCellNumber(v) !== null) >= 0.8) return 'number';
  if (share((v) => parseDateText(v) !== null) >= 0.8) return 'date';
  if (share((v) => /^https?:\/\/\S+$/i.test(v)) >= 0.8) return 'url';
  return 'text';
}

const intl = new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 });
/** The locale's thousands separator, read once, for the whole-number fast path. */
const GROUP = intl.formatToParts(1000).find((p) => p.type === 'group')?.value ?? ',';
const MINUS = intl.formatToParts(-1).find((p) => p.type === 'minusSign')?.value ?? '-';

/**
 * Numbers as the locale writes them. Whole numbers — most of what a table
 * holds, and every running total — are grouped by hand: `Intl` costs about
 * ten microseconds a call, and a 2,000-row table formats thousands of them
 * on every edit.
 */
const numberFormat = {
  format(n: number): string {
    if (Number.isSafeInteger(n)) {
      const digits = String(Math.abs(n));
      let out = '';
      for (let i = digits.length; i > 0; i -= 3) out = i > 3 ? `${GROUP}${digits.slice(i - 3, i)}${out}` : `${digits.slice(0, i)}${out}`;
      return n < 0 ? `${MINUS}${out}` : out;
    }
    return intl.format(n);
  },
};

/** The text a cell shows: the raw string read through its column's type. */
export function formatCell(spec: TableSpec, r: number, c: number): string {
  const rawVal = spec.cells[r]?.[c] as unknown;
  const raw =
    typeof rawVal === 'object' && rawVal !== null
      ? String((rawVal as { value?: unknown; text?: unknown }).value ?? (rawVal as { text?: unknown }).text ?? '')
      : String(rawVal ?? '');
  if (spec.header && r === 0) return raw;
  if (isFormula(raw)) return formatValue(spec, c, evaluateCell(spec, r, c));
  const type = spec.columns[c]?.type ?? 'text';
  if (raw.trim() === '') return raw;
  switch (type) {
    case 'text':
    case 'url':
    case 'person':
      return raw;
    // Drawn, not written: a box and stars say it better than the words.
    case 'checkbox':
    case 'rating':
      return '';
    case 'select':
      return selectLabels(raw).join(', ');
    case 'date': {
      const d = parseDateText(raw);
      return d === null ? raw : formatSerial(d);
    }
    default:
      break;
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

/**
 * A formula's result, shown through its column's type. A percent column shows
 * a computed fraction as a percentage — `=B2/B3` giving 0.62 reads 62% — which
 * is how every spreadsheet treats a computed share; a date column shows a
 * serial number as the date it is.
 */
export function formatValue(spec: TableSpec, c: number, v: FValue): string {
  if (isErr(v)) return v.err;
  if (v === null) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'string') return v;
  const type = spec.columns[c]?.type ?? 'text';
  if (type === 'currency') {
    const body = Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${v < 0 ? '−' : ''}${spec.currency ?? '$'}${body}`;
  }
  if (type === 'percent') return `${numberFormat.format(v * 100)}%`;
  if (type === 'date') return formatSerial(v);
  return numberFormat.format(v);
}

/**
 * What sorting and filtering read for a cell: its text — or, for a formula,
 * its result in the units the cell displays, so a computed column sorts by
 * the numbers on screen rather than by how its formulas are spelled.
 */
export function valueText(spec: TableSpec, r: number, c: number): string {
  const raw = spec.cells[r]?.[c] ?? '';
  if (!isFormula(raw)) return raw;
  const v = evaluateCell(spec, r, c);
  if (isErr(v) || v === null) return '';
  if (typeof v === 'number') return String(spec.columns[c]?.type === 'percent' ? v * 100 : v);
  return typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : v;
}

/** Left for words, right for numbers — unless the cell or column says otherwise. */
export function alignFor(spec: TableSpec, r: number, c: number): CellAlign {
  const own = cellStyleAt(spec, r, c)?.align;
  if (own) return own;
  if (spec.columns[c]?.align) return spec.columns[c].align!;
  const type = spec.columns[c]?.type ?? 'text';
  if (type === 'checkbox') return 'center';
  // A heading sits over what its column draws: right over numbers, left over
  // stars, which start at the left like the rating cells under them.
  if (spec.header && r === 0) return isNumericType(type) && type !== 'rating' ? 'right' : 'left';
  // A formula that computes a number reads as a number, even in a text column.
  if (type === 'text' && isFormula(spec.cells[r]?.[c] ?? '') && typeof evaluateCell(spec, r, c) === 'number') return 'right';
  return isNumericType(type) && type !== 'rating' ? 'right' : 'left';
}

// ---------------------------------------------------------------------------
// The view: filter, then sort
// ---------------------------------------------------------------------------

/** The label a blank wears in a filter's pick-list. */
export const BLANK = '';

/** The values a filter can pick from in a column, with how many rows hold each — most common first. */
export function distinctValues(spec: TableSpec, col: number): Array<{ value: string; count: number }> {
  const counts = new Map<string, number>();
  const start = spec.header ? 1 : 0;
  const type = spec.columns[col]?.type ?? 'text';
  for (let r = start; r < spec.cells.length; r++) {
    const v = valueText(spec, r, col).trim();
    const keys = type === 'select' ? (selectLabels(v).length ? selectLabels(v) : [BLANK]) : [type === 'checkbox' ? (isChecked(v) ? 'TRUE' : 'FALSE') : v];
    for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || (a.value === BLANK ? 1 : b.value === BLANK ? -1 : a.value.localeCompare(b.value, undefined, { numeric: true })));
}

/**
 * Does a cell pass one column's filter?
 *
 * A pick-list keeps the rows holding one of its values. A condition on a
 * numeric or date column understands `>10`, `<=5`, `=3` and `10..20`;
 * everything else is a case-insensitive "contains". An empty condition lets
 * everything through: a filter armed on a column and not yet written.
 */
function passesOne(spec: TableSpec, r: number, f: TableFilter): boolean {
  const raw = valueText(spec, r, f.col);
  const type = spec.columns[f.col]?.type ?? 'text';
  if (f.values) {
    const v = raw.trim();
    if (type === 'select') {
      const labels = selectLabels(v);
      return labels.length ? labels.some((l) => f.values!.includes(l)) : f.values.includes(BLANK);
    }
    if (type === 'checkbox') return f.values.includes(isChecked(v) ? 'TRUE' : 'FALSE');
    return f.values.includes(v);
  }
  const q = f.query.trim();
  if (q === '') return true;
  if (type === 'checkbox') return /^(true|yes|checked)$/i.test(q) ? isChecked(raw) : /^(false|no|unchecked)$/i.test(q) ? !isChecked(raw) : true;
  if (type !== 'text') {
    const read = (t: string) => (type === 'date' ? parseDateText(t) ?? parseCellNumber(t) : parseCellNumber(t) ?? parseDateText(t));
    const n = read(raw);
    const range = /^(.+?)\s*\.\.\s*(.+)$/.exec(q);
    if (range && n !== null) {
      const lo = read(range[1]);
      const hi = read(range[2]);
      if (lo !== null && hi !== null) return n >= lo && n <= hi;
    }
    const op = /^(>=|<=|<>|>|<|=)\s*(.+)$/.exec(q);
    if (op && n !== null) {
      const v = read(op[2]);
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
          case '<>':
            return n !== v;
          default:
            return n === v;
        }
      }
    }
  }
  return raw.toLowerCase().includes(q.toLowerCase());
}

const passes = (spec: TableSpec, r: number) => (spec.filters ?? []).every((f) => passesOne(spec, r, f));

function compare(spec: TableSpec, a: number, b: number, col: number): number {
  const ra = valueText(spec, a, col);
  const rb = valueText(spec, b, col);
  // Empty last whichever way round: a blank is missing, not small.
  if (ra.trim() === '' && rb.trim() === '') return 0;
  if (ra.trim() === '') return 1;
  if (rb.trim() === '') return -1;
  const type = spec.columns[col]?.type ?? 'text';
  if (type === 'checkbox') return (isChecked(ra) ? 1 : 0) - (isChecked(rb) ? 1 : 0);
  if (type === 'select') {
    // Choices sort in the order the column offers them, as in every database.
    const order = new Map((spec.columns[col].options ?? []).map((o, i) => [o.label, i]));
    const ia = order.get(selectLabels(ra)[0] ?? '') ?? Infinity;
    const ib = order.get(selectLabels(rb)[0] ?? '') ?? Infinity;
    if (ia !== ib) return ia === Infinity ? 1 : ib === Infinity ? -1 : ia - ib;
  }
  if (type === 'date') {
    const da = parseDateText(ra) ?? parseCellNumber(ra);
    const db = parseDateText(rb) ?? parseCellNumber(rb);
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
      const ea = valueText(spec, a, col).trim() === '';
      const eb = valueText(spec, b, col).trim() === '';
      if (ea !== eb) return ea ? 1 : -1;
      const d = compare(spec, a, b, col);
      return dir === 'desc' ? -d : d;
    };
    body.sort(blanksLast);
  }
  return spec.header && rows > 0 ? [0, ...body] : body;
}

/** Whether a filter is actually hiding anything — an armed, empty one is not. */
export const filtersActive = (spec: TableSpec) => (spec.filters ?? []).some((f) => f.values || f.query.trim() !== '');

/** Whether the drawn rows are the stored rows in order — merges need that. */
export const isIdentityView = (spec: TableSpec) => !spec.sort && !filtersActive(spec);

/** Write the current order into the table and drop the view. */
export function applyView(spec: TableSpec): TableSpec {
  const order = viewRows(spec);
  const hidden = spec.cells.map((_, r) => r).filter((r) => !order.includes(r));
  const rows = [...order, ...hidden];
  const inv: number[] = [];
  rows.forEach((old, i) => (inv[old] = i));
  return {
    ...spec,
    cells: reref(spec, rows.map((r) => [...spec.cells[r]]), 'row', (i) => inv[i] ?? i),
    styles: remapStyles(spec.styles, (r, c) => [rows.indexOf(r), c]),
    rowHeights: spec.rowHeights ? rows.map((r) => spec.rowHeights![r] ?? 1) : undefined,
    rowIds: editIds(spec.rowIds, (ids) => rows.map((r) => ids[r] ?? newTableId())),
    merges: undefined,
    sort: undefined,
    filters: undefined,
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

/**
 * Keep formulas pointing at the same cells when rows or columns move under
 * them — why `=SUM(B2:B9)` still sums the same prices after a row goes in
 * above them. A reference to a deleted cell becomes `#REF!`; a range that
 * loses an end shrinks to what is left (`rewriteRefs`).
 */
function reref(spec: TableSpec, cells: string[][], axis: 'row' | 'col', map: (i: number) => number): string[][] {
  const same = (i: number) => i;
  const skip = refsSkipHeader(spec);
  let changed = false;
  const next = cells.map((row) => {
    let hit = false;
    const out = row.map((v) => {
      if (!isFormula(v)) return v;
      const w = `=${rewriteRefs(v.slice(1), skip, axis === 'row' ? map : same, axis === 'col' ? map : same)}`;
      if (w !== v) hit = true;
      return w;
    });
    if (hit) changed = true;
    return hit ? out : row;
  });
  return changed ? next : cells;
}

/**
 * Everything keyed by column — rules, scales, bars, filters, summaries — moved
 * with a column map. A column mapped to -1 was deleted and takes its entries
 * with it.
 */
function remapByColumn(spec: TableSpec, map: (c: number) => number, cols: number): Partial<TableSpec> {
  const keyed = <T extends { col: number }>(list: T[] | undefined): T[] | undefined => {
    if (!list) return undefined;
    const out = list.flatMap((x) => {
      const c = map(x.col);
      return c < 0 ? [] : [{ ...x, col: c }];
    });
    return out.length ? out : undefined;
  };
  let summary: TableSpec['summary'];
  if (spec.summary) {
    summary = Array.from({ length: cols }, () => null);
    spec.summary.forEach((agg, c) => {
      const to = map(c);
      if (to >= 0 && to < cols) summary![to] = agg;
    });
  }
  const sort = spec.sort ? (map(spec.sort.col) < 0 ? undefined : { ...spec.sort, col: map(spec.sort.col) }) : undefined;
  return {
    rules: keyed(spec.rules),
    scales: keyed(spec.scales),
    bars: keyed(spec.bars),
    filters: keyed(spec.filters),
    sort,
    summary,
  };
}

function shiftRowHeights(spec: TableSpec, at: number, delta: number): number[] | undefined {
  if (!spec.rowHeights) return undefined;
  const hs = [...spec.rowHeights];
  if (delta > 0) hs.splice(at, 0, ...Array.from({ length: delta }, () => 1));
  else hs.splice(at, -delta);
  return hs.some((h) => h !== 1) ? hs : undefined;
}

const blankRow = (cols: number) => Array.from({ length: cols }, () => '');

export function insertRows(spec: TableSpec, at: number, count = 1): TableSpec {
  if (rowCount(spec) + count > MAX_ROWS) return spec;
  const cells = [...spec.cells];
  cells.splice(at, 0, ...Array.from({ length: count }, () => blankRow(colCount(spec))));
  return {
    ...spec,
    cells: reref(spec, cells, 'row', (r) => (r >= at ? r + count : r)),
    ...shift(spec, 'row', at, count),
    rowHeights: shiftRowHeights(spec, at, count),
    rowIds: editIds(spec.rowIds, (ids) => {
      ids.splice(at, 0, ...freshIds(count));
      return ids;
    }),
  };
}

export function deleteRows(spec: TableSpec, from: number, count = 1): TableSpec {
  // A table keeps at least one row; an empty grid has nowhere to type.
  if (rowCount(spec) - count < 1) return spec;
  const cells = reref(
    spec,
    spec.cells.filter((_, r) => r < from || r >= from + count),
    'row',
    (r) => (r < from ? r : r < from + count ? -1 : r - count)
  );
  // The header is row 0; deleting it promotes the next row, which is the
  // spreadsheet reading and never loses anything the person can see.
  return {
    ...spec,
    cells,
    ...shift(spec, 'row', from, -count),
    rowHeights: shiftRowHeights(spec, from, -count),
    rowIds: editIds(spec.rowIds, (ids) => ids.filter((_, r) => r < from || r >= from + count)),
  };
}

/** How many of the rows from `from` on hold anything — what lowering the row count would lose. */
export function filledRowsFrom(spec: TableSpec, from: number): number {
  return spec.cells.slice(from).filter((row) => row.some((v) => v.trim() !== '')).length;
}

/** How many of the columns from `from` on hold anything below the header. */
export function filledColsFrom(spec: TableSpec, from: number): number {
  let n = 0;
  for (let c = from; c < colCount(spec); c++) if (spec.cells.slice(spec.header ? 1 : 0).some((row) => (row[c] ?? '').trim() !== '')) n++;
  return n;
}

export function insertCols(spec: TableSpec, at: number, count = 1, template?: Partial<TableColumn>): TableSpec {
  if (colCount(spec) + count > MAX_COLS) return spec;
  const cells = spec.cells.map((row) => {
    const next = [...row];
    next.splice(at, 0, ...Array.from({ length: count }, () => ''));
    return next;
  });
  const columns = [...spec.columns];
  columns.splice(at, 0, ...Array.from({ length: count }, () => ({ width: 1, type: 'text' as CellType, ...template })));
  const map = (c: number) => (c >= at ? c + count : c);
  return {
    ...spec,
    cells: reref(spec, cells, 'col', map),
    columns,
    ...shift(spec, 'col', at, count),
    ...remapByColumn(spec, map, columns.length),
    colIds: editIds(spec.colIds, (ids) => {
      ids.splice(at, 0, ...freshIds(count));
      return ids;
    }),
  };
}

export function deleteCols(spec: TableSpec, from: number, count = 1): TableSpec {
  if (colCount(spec) - count < 1) return spec;
  const keep = (c: number) => c < from || c >= from + count;
  const cells = spec.cells.map((row) => row.filter((_, c) => keep(c)));
  const columns = spec.columns.filter((_, c) => keep(c));
  const map = (c: number) => (c < from ? c : c < from + count ? -1 : c - count);
  const moved = reref(spec, cells, 'col', map);
  return {
    ...spec,
    cells: moved,
    columns,
    ...shift(spec, 'col', from, -count),
    ...remapByColumn(spec, map, columns.length),
    colIds: editIds(spec.colIds, (ids) => ids.filter((_, c) => keep(c))),
  };
}

/**
 * A copy of a column, to its right: values, type, choices, width and cell
 * styles. Its formulas move one column across, as a spreadsheet's do when a
 * column is copied beside itself — `=B2*2` in B becomes `=C2*2` in C.
 */
export function duplicateCol(spec: TableSpec, c: number): TableSpec {
  if (colCount(spec) + 1 > MAX_COLS) return spec;
  const { width, type, align, options, multi, style } = spec.columns[c];
  let next = insertCols(spec, c + 1, 1, { width, type, ...(align ? { align } : null), ...(options ? { options } : null), ...(multi ? { multi } : null), ...(style ? { style } : null) });
  next = {
    ...next,
    cells: next.cells.map((row) => row.map((v, j) => (j === c + 1 ? (isFormula(row[c]) ? `=${shiftRefs(row[c].slice(1), 0, 1)}` : row[c]) : v))),
  };
  const styles = { ...(next.styles ?? {}) };
  for (let r = 0; r < next.cells.length; r++) {
    const s = next.styles?.[cellKey(r, c)];
    if (s) styles[cellKey(r, c + 1)] = { ...s };
  }
  if (spec.header) next = { ...next, cells: next.cells.map((row, r) => (r === 0 ? row.map((v, j) => (j === c + 1 ? `${row[c]} copy` : v)) : row)) };
  return { ...next, styles: Object.keys(styles).length ? styles : undefined };
}

export function setHidden(spec: TableSpec, c: number, hidden: boolean): TableSpec {
  if (hidden && spec.columns.filter((col, i) => i !== c && !col.hidden).length === 0) return spec;
  return setColumn(spec, c, { hidden: hidden || undefined });
}

// ---------------------------------------------------------------------------
// Moving rows and columns
// ---------------------------------------------------------------------------

/**
 * The order after moving the block `from..to` to stand before index `before`
 * (0..n), as `order[newIndex] = oldIndex` — or null when it would not move.
 */
export function moveOrder(n: number, from: number, to: number, before: number): number[] | null {
  if (from < 0 || to >= n || from > to || before < 0 || before > n) return null;
  if (before >= from && before <= to + 1) return null;
  const all = Array.from({ length: n }, (_, i) => i);
  const block = all.slice(from, to + 1);
  const rest = all.filter((i) => i < from || i > to);
  rest.splice(before > to ? before - block.length : before, 0, ...block);
  return rest;
}

/**
 * Put rows or columns in a new order, carrying everything attached to them.
 *
 * Styles follow their cells, a row's height follows the row, and anything
 * keyed by column follows its column. A merge survives only if the cells it
 * spans are still neighbours afterwards: moving one column out of the middle
 * of a merged heading leaves two halves that are no longer one block, and
 * drawing them as one would cover a column that has nothing to do with them.
 */
function permute(spec: TableSpec, axis: 'row' | 'col', order: number[]): TableSpec {
  const inv: number[] = [];
  order.forEach((old, i) => (inv[old] = i));
  const cells = reref(
    spec,
    axis === 'row' ? order.map((o) => spec.cells[o]) : spec.cells.map((row) => order.map((o) => row[o])),
    axis,
    (i) => inv[i] ?? i
  );
  const columns = axis === 'col' ? order.map((o) => spec.columns[o]) : spec.columns;
  const styles = remapStyles(spec.styles, (r, c) => (axis === 'row' ? [inv[r], c] : [r, inv[c]]));
  const merges: TableMerge[] = [];
  for (const m of spec.merges ?? []) {
    const start = axis === 'row' ? m.r : m.c;
    const span = axis === 'row' ? m.rs : m.cs;
    const spots = Array.from({ length: span }, (_, i) => inv[start + i]).sort((a, b) => a - b);
    if (spots[spots.length - 1] - spots[0] !== span - 1) continue;
    merges.push(axis === 'row' ? { ...m, r: spots[0] } : { ...m, c: spots[0] });
  }
  return {
    ...spec,
    cells,
    columns,
    styles,
    merges: merges.length ? merges : undefined,
    ...(axis === 'row' && spec.rowHeights ? { rowHeights: order.map((o) => spec.rowHeights![o] ?? 1) } : null),
    ...(axis === 'col' ? remapByColumn(spec, (c) => inv[c] ?? c, columns.length) : null),
    ...(axis === 'row' ? { rowIds: editIds(spec.rowIds, (ids) => order.map((o) => ids[o] ?? newTableId())) } : null),
    ...(axis === 'col' ? { colIds: editIds(spec.colIds, (ids) => order.map((o) => ids[o] ?? newTableId())) } : null),
  };
}

/** Move columns `from..to` to stand before column `before`. */
export function moveCols(spec: TableSpec, from: number, to: number, before: number): TableSpec {
  const order = moveOrder(colCount(spec), from, to, before);
  return order ? permute(spec, 'col', order) : spec;
}

/** Move rows `from..to` to stand before row `before`. The header row stays on top. */
export function moveRows(spec: TableSpec, from: number, to: number, before: number): TableSpec {
  const floor = spec.header ? 1 : 0;
  if (from < floor || before < floor) return spec;
  const order = moveOrder(rowCount(spec), from, to, before);
  return order ? permute(spec, 'row', order) : spec;
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
 * Many cells written at once: each row touched is copied once, and the rows
 * array once, however many cells change — where a `setCell` per cell copies
 * the rows array per cell, and clearing a 2,000-row column did so 2,000 times.
 */
export function setCells(spec: TableSpec, edits: Iterable<readonly [number, number, string]>): TableSpec {
  let cells: string[][] | null = null;
  const copied = new Set<number>();
  for (const [r, c, text] of edits) {
    const row = (cells ?? spec.cells)[r];
    if (!row || c < 0 || c >= row.length || row[c] === text) continue;
    if (!cells) cells = [...spec.cells];
    if (!copied.has(r)) {
      cells[r] = [...cells[r]];
      copied.add(r);
    }
    cells[r][c] = text;
  }
  return cells ? { ...spec, cells } : spec;
}

/** The stored cells a drawn range stands for, through the view's row order. */
export function* storedCells(range: CellRange, order: readonly number[]): Generator<[number, number]> {
  for (let vr = range.r0; vr <= range.r1; vr++) {
    const r = order[vr];
    if (r === undefined) continue;
    for (let c = range.c0; c <= range.c1; c++) yield [r, c];
  }
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
  return {
    ...spec,
    cells,
    columns,
    ...(spec.rowHeights && needRows > spec.cells.length ? { rowHeights: [...spec.rowHeights, ...Array.from({ length: needRows - spec.cells.length }, () => 1)] } : null),
    ...(spec.summary && needCols > spec.columns.length ? { summary: [...spec.summary, ...Array.from({ length: needCols - spec.columns.length }, () => null)] } : null),
    rowIds: editIds(spec.rowIds, (ids) => [...ids, ...freshIds(Math.max(0, needRows - ids.length))]),
    colIds: editIds(spec.colIds, (ids) => [...ids, ...freshIds(Math.max(0, needCols - ids.length))]),
  };
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
// Rich types
// ---------------------------------------------------------------------------

/** `optionsOf` per cells array and column, valid while the column's own options and the header are the same. */
const optionsCache = new WeakMap<string[][], Map<number, { own: SelectOption[] | undefined; header: boolean; out: SelectOption[] }>>();

/**
 * The options a select column offers, with any value typed into it that is
 * not one of them yet. Cached on the cells, so a layout that asks for every
 * cell of a column reads the column once rather than once per cell.
 */
export function optionsOf(spec: TableSpec, c: number): SelectOption[] {
  let byCol = optionsCache.get(spec.cells);
  const own = spec.columns[c]?.options;
  const hit = byCol?.get(c);
  if (hit && hit.own === own && hit.header === spec.header) return hit.out;
  const out = readOptions(spec, c);
  if (!byCol) {
    byCol = new Map();
    optionsCache.set(spec.cells, byCol);
  }
  byCol.set(c, { own, header: spec.header, out });
  return out;
}

function readOptions(spec: TableSpec, c: number): SelectOption[] {
  const own = spec.columns[c]?.options ?? [];
  const known = new Set(own.map((o) => o.label.toLowerCase()));
  const extra: SelectOption[] = [];
  for (let r = spec.header ? 1 : 0; r < spec.cells.length; r++) {
    for (const l of selectLabels(spec.cells[r][c] ?? '')) {
      if (known.has(l.toLowerCase()) || isFormula(l)) continue;
      known.add(l.toLowerCase());
      extra.push({ label: l, tag: (own.length + extra.length) % TAG_PAINTS.length });
    }
  }
  return [...own, ...extra].slice(0, MAX_OPTIONS);
}

/**
 * Make a column a type, seeding a select column's options from what it
 * already holds — so turning a Status column into a select gives every status
 * its own colour at once instead of an empty list to fill in.
 */
export function setColumnType(spec: TableSpec, c: number, type: CellType): TableSpec {
  if (type !== 'select') return setColumn(spec, c, { type, options: undefined, multi: undefined });
  const withType = setColumn(spec, c, { type });
  return setColumn(withType, c, { options: optionsOf(withType, c) });
}

/** Add an option to a select column, or return the spec as it is when it is already there. */
export function addOption(spec: TableSpec, c: number, label: string): TableSpec {
  const clean = label.replace(/;/g, ',').trim().slice(0, 60);
  const own = spec.columns[c]?.options ?? [];
  if (!clean || own.some((o) => o.label.toLowerCase() === clean.toLowerCase()) || own.length >= MAX_OPTIONS) return spec;
  return setColumn(spec, c, { options: [...own, { label: clean, tag: own.length % TAG_PAINTS.length }] });
}

// ---------------------------------------------------------------------------
// Filling
// ---------------------------------------------------------------------------

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** A name in a cyclic list — `Mon`, `Tuesday`, `jan` — kept in the case and length it was typed in. */
function cyclic(list: string[], text: string): { i: number; style: (name: string) => string } | null {
  const t = text.trim();
  const lower = t.toLowerCase();
  const i = list.findIndex((n) => n === lower || (lower.length === 3 && n.startsWith(lower)));
  if (i < 0) return null;
  const short = lower.length === 3 && list[i] !== lower;
  const caps = t === t.toUpperCase() ? 'upper' : t[0] === t[0].toUpperCase() ? 'title' : 'lower';
  return {
    i,
    style: (name) => {
      const n = short ? name.slice(0, 3) : name;
      return caps === 'upper' ? n.toUpperCase() : caps === 'title' ? n[0].toUpperCase() + n.slice(1) : n;
    },
  };
}

/**
 * What comes after a run of values, the way a spreadsheet's fill handle reads
 * it. `values` are the source cells in order; the result gives the text for
 * position `k` (0-based, counting on from the end of the source).
 *
 * - Two or more numbers with a constant step continue the step (1, 3 → 5, 7).
 * - Dates with a constant step in days, or in whole months, continue it.
 * - Weekday and month names count on, even from one (Mon → Tue).
 * - Text ending in a number with a constant step counts on (Item 1 → Item 2).
 * - Anything else repeats the source, a formula moved as it is copied.
 */
export function seriesFor(values: string[], offsetOf: (k: number) => { dr: number; dc: number }): (k: number) => string {
  const n = values.length;
  const repeat = (k: number) => {
    const i = k % n;
    const src = values[i];
    if (!isFormula(src)) return src;
    const { dr, dc } = offsetOf(k);
    return `=${shiftRefs(src.slice(1), dr, dc)}`;
  };
  if (n === 0) return () => '';
  if (values.some(isFormula)) return repeat;

  const names = (list: string[]) => {
    const parsed = values.map((v) => cyclic(list, v));
    if (parsed.some((p) => !p)) return null;
    const step = n > 1 ? (((parsed[1]!.i - parsed[0]!.i) % list.length) + list.length) % list.length || 1 : 1;
    if (parsed.some((p, i) => i > 0 && (((p!.i - parsed[i - 1]!.i) % list.length) + list.length) % list.length !== step)) return null;
    const last = parsed[n - 1]!;
    return (k: number) => last.style(list[(last.i + step * (k + 1)) % list.length]);
  };
  const byName = names(WEEKDAYS) ?? names(MONTH_NAMES);
  if (byName) return byName;
  if (n < 2) return repeat;

  const nums = values.map((v) => parseCellNumber(v));
  if (nums.every((x) => x !== null) && values.every((v) => !/[-/]/.test(v.trim().slice(1)))) {
    const step = nums[1]! - nums[0]!;
    if (nums.every((x, i) => i === 0 || Math.abs(x! - nums[i - 1]! - step) < 1e-9)) {
      const last = nums[n - 1]!;
      const decimals = Math.max(...values.map((v) => (/\.(\d+)/.exec(v)?.[1].length ?? 0)));
      const pct = values.every((v) => v.trim().endsWith('%'));
      return (k) => {
        const x = last + step * (k + 1);
        return `${Number(x.toFixed(Math.min(10, decimals)))}${pct ? '%' : ''}`;
      };
    }
  }

  const dates = values.map((v) => parseDateText(v));
  if (dates.every((d) => d !== null)) {
    const iso = values.every((v) => /^\d{4}-\d{1,2}-\d{1,2}$/.test(v.trim()));
    const fmt = (serial: number) => {
      const d = new Date(Math.round((serial - 25569) * 86_400_000));
      const y = d.getUTCFullYear();
      const m = d.getUTCMonth() + 1;
      const day = d.getUTCDate();
      return iso ? `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}` : formatSerial(serial);
    };
    const parts = dates.map((s) => new Date(Math.round((s! - 25569) * 86_400_000)));
    const monthIndex = parts.map((d) => d.getUTCFullYear() * 12 + d.getUTCMonth());
    const dim = (y: number, mo: number) => new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
    const sameDay = parts.every((d) => d.getUTCDate() === parts[0].getUTCDate());
    // Month ends continue as month ends: Jan 31, Feb 28 → Mar 31.
    const monthEnds = parts.every((d) => d.getUTCDate() === dim(d.getUTCFullYear(), d.getUTCMonth()));
    const mStep = monthIndex[1] - monthIndex[0];
    if ((sameDay || monthEnds) && mStep !== 0 && monthIndex.every((m, i) => i === 0 || m - monthIndex[i - 1] === mStep)) {
      const lastM = monthIndex[n - 1];
      const day = parts[0].getUTCDate();
      return (k) => {
        const m = lastM + mStep * (k + 1);
        const y = Math.floor(m / 12);
        const mo = m - y * 12;
        const last = dim(y, mo);
        return fmt(Date.UTC(y, mo, monthEnds ? last : Math.min(day, last)) / 86_400_000 + 25569);
      };
    }
    const dStep = dates[1]! - dates[0]!;
    if (dStep !== 0 && dates.every((d, i) => i === 0 || Math.abs(d! - dates[i - 1]! - dStep) < 1e-6)) {
      const last = dates[n - 1]!;
      return (k) => fmt(last + dStep * (k + 1));
    }
  }

  const tails = values.map((v) => /^(.*?)(\d+)(\D*)$/.exec(v));
  if (tails.every((t) => t && t[1] === tails[0]![1] && t[3] === tails[0]![3])) {
    const ns = tails.map((t) => Number(t![2]));
    const step = ns[1] - ns[0];
    if (step !== 0 && ns.every((x, i) => i === 0 || x - ns[i - 1] === step)) {
      const [, prefix, , suffix] = tails[0]!;
      const width = tails[0]![2].startsWith('0') ? tails[0]![2].length : 0;
      return (k) => {
        const x = ns[n - 1] + step * (k + 1);
        return `${prefix}${x < 0 ? x : String(x).padStart(width, '0')}${suffix}`;
      };
    }
  }
  return repeat;
}

/**
 * Fill from a source block into the cells beyond it, as the fill handle does.
 *
 * `target` must extend `source` along one axis — down, up, right or left —
 * and covers the source. Each row (filling across) or column (filling down)
 * is its own series. Stored coordinates; the editor only fills an unsorted,
 * unfiltered table, where drawn rows are stored rows.
 */
export function fillRange(spec: TableSpec, source: CellRange, target: CellRange): TableSpec {
  const s = normRange(source, spec);
  const t = normRange(target, spec);
  const down = t.r1 > s.r1;
  const up = t.r0 < s.r0;
  const right = t.c1 > s.c1;
  const left = t.c0 < s.c0;
  const edits: Array<[number, number, string]> = [];
  if (down || up) {
    for (let c = s.c0; c <= s.c1; c++) {
      const col: string[] = [];
      for (let r = s.r0; r <= s.r1; r++) col.push(spec.cells[r]?.[c] ?? '');
      const src = up ? [...col].reverse() : col;
      const from = up ? s.r0 : s.r1;
      const sign = up ? -1 : 1;
      const count = up ? s.r0 - t.r0 : t.r1 - s.r1;
      const gen = seriesFor(src, (k) => ({ dr: sign * (Math.floor(k / src.length) + 1) * src.length, dc: 0 }));
      for (let k = 0; k < count; k++) edits.push([from + sign * (k + 1), c, gen(k)]);
    }
  } else if (right || left) {
    for (let r = s.r0; r <= s.r1; r++) {
      const row = spec.cells[r].slice(s.c0, s.c1 + 1);
      const src = left ? [...row].reverse() : row;
      const from = left ? s.c0 : s.c1;
      const sign = left ? -1 : 1;
      const count = left ? s.c0 - t.c0 : t.c1 - s.c1;
      const gen = seriesFor(src, (k) => ({ dr: 0, dc: sign * (Math.floor(k / src.length) + 1) * src.length }));
      for (let k = 0; k < count; k++) edits.push([r, from + sign * (k + 1), gen(k)]);
    }
  }
  return setCells(spec, edits);
}

// ---------------------------------------------------------------------------
// Summaries
// ---------------------------------------------------------------------------

/** The aggregations that make sense for a column's type. */
export function summaryChoices(type: CellType): SummaryAgg[] {
  if (type === 'checkbox') return ['checked', 'count', 'filled'];
  if (isNumericType(type)) return ['sum', 'average', 'median', 'min', 'max', 'count', 'empty', 'filled'];
  if (type === 'date') return ['min', 'max', 'count', 'empty', 'filled'];
  return ['count', 'empty', 'filled'];
}

/**
 * A column's summary over the rows the view shows — the filter's result, not
 * the whole table — as the text the footer draws. `visible` and `total` let
 * the footer say "of 14 visible" when a filter is on.
 */
export function summarize(spec: TableSpec, c: number, agg: SummaryAgg, drawn: readonly number[] = viewRows(spec)): string {
  const rows = drawn.filter((r) => !(spec.header && r === 0));
  const type = spec.columns[c]?.type ?? 'text';
  const raws = rows.map((r) => spec.cells[r]?.[c] ?? '');
  const values = rows.map((r) => {
    const raw = spec.cells[r]?.[c] ?? '';
    if (isFormula(raw)) return evaluateCell(spec, r, c);
    if (type === 'date') return parseDateText(raw);
    if (type === 'percent') {
      const n = parseCellNumber(raw);
      return n === null ? null : n / 100;
    }
    return parseCellNumber(raw);
  });
  const nums = values.filter((v): v is number => typeof v === 'number');
  const filled = raws.filter((v) => v.trim() !== '').length;
  // As many decimals as the column's own values show — an average of whole
  // numbers reads 2.36, not 2.357143 — and at least two when an average or a
  // median falls between whole numbers.
  const places = Math.min(4, Math.max(0, ...raws.map((v) => (isFormula(v) ? 0 : /\.(\d+)/.exec(v.replace(/[^\d.]/g, ''))?.[1].length ?? 0))));
  const fmt = (v: number) => {
    if (type === 'date') return formatSerial(v);
    if (type === 'currency') return formatValue(spec, c, v);
    const shown = type === 'percent' ? v * 100 : v;
    const spread = (agg === 'average' || agg === 'median') && !Number.isInteger(Math.round(shown * 1e9) / 1e9) ? 2 : 0;
    const digits = Math.min(4, Math.max(places, spread));
    const text = new Intl.NumberFormat(undefined, { maximumFractionDigits: digits, minimumFractionDigits: spread ? Math.min(digits, 2) : 0 }).format(shown);
    return type === 'percent' ? `${text}%` : text;
  };
  switch (agg) {
    case 'sum':
      return fmt(nums.reduce((a, b) => a + b, 0));
    case 'average':
      return nums.length ? fmt(nums.reduce((a, b) => a + b, 0) / nums.length) : '—';
    case 'median': {
      if (!nums.length) return '—';
      const s = [...nums].sort((a, b) => a - b);
      const m = s.length >> 1;
      return fmt(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2);
    }
    case 'min':
      return nums.length ? fmt(Math.min(...nums)) : '—';
    case 'max':
      return nums.length ? fmt(Math.max(...nums)) : '—';
    case 'count':
      return String(filled);
    case 'empty':
      return String(rows.length - filled);
    case 'filled':
      return rows.length ? `${Math.round((filled / rows.length) * 100)}%` : '—';
    case 'checked':
      return `${raws.filter(isChecked).length} of ${rows.length}`;
  }
}

/** The footer's label for a column: `Sum`, or `Sum of 14 visible` while a filter hides rows. */
export function summaryLabel(spec: TableSpec, agg: SummaryAgg, drawn?: readonly number[]): string {
  if (!filtersActive(spec)) return SUMMARY_LABELS[agg];
  const shown = (drawn ?? viewRows(spec)).length - (spec.header ? 1 : 0);
  return `${SUMMARY_LABELS[agg]} of ${shown} visible`;
}

export const hasSummary = (spec: TableSpec) => Boolean(spec.summary?.some((s) => s !== null));

// ---------------------------------------------------------------------------
// Formatting and merging
// ---------------------------------------------------------------------------

/**
 * Style patches on stored cells, `undefined` values clearing their key — the
 * styles map built once for the whole edit. Bold across a 2,000 × 60 range is
 * one copy of the map, not 120,000 of them.
 */
export function styleCells(spec: TableSpec, entries: Iterable<readonly [number, number, CellStyle]>): TableSpec {
  const edit = styleEditor(spec);
  for (const [r, c, patch] of entries) edit(r, c, patch);
  return edit.done();
}

/** A patch with its cleared keys gone, or null when it only clears. */
function setPart(patch: CellStyle): CellStyle | null {
  const out: CellStyle = {};
  let any = false;
  for (const k of Object.keys(patch) as Array<keyof CellStyle>) {
    const v = patch[k];
    if (v === undefined || v === false) continue;
    (out as Record<string, unknown>)[k] = v;
    any = true;
  }
  return any ? out : null;
}

/** A cell's style as drawn: its column's (`TableColumn.style`), under its own. */
export function cellStyleAt(spec: TableSpec, r: number, c: number): CellStyle | undefined {
  const own = spec.styles?.[`${r}:${c}`];
  const col = spec.columns[c]?.style;
  if (!col) return own;
  if (!own) return col;
  return { ...col, ...own };
}

/**
 * One styles map, copied on the first change and written in place after that.
 * A cell with no style yet takes the patch object itself — styles are never
 * mutated, so 120,000 bold cells can share one `{ bold: true }`.
 *
 * A cell in a column that carries a style of its own is edited after that
 * style has been handed down to the column's cells: a cell cannot say "not
 * bold" over a bold column, so the column's style becomes theirs first.
 */
function styleEditor(spec: TableSpec) {
  let styles: Record<string, CellStyle> | null = null;
  let columns: TableColumn[] | null = null;
  const rows = spec.cells.length;
  const cols = spec.columns.length;
  const parts = new Map<CellStyle, CellStyle | null>();
  const handDown = (c: number) => {
    const colStyle = (columns ?? spec.columns)[c]?.style;
    if (!colStyle) return;
    if (!columns) columns = [...spec.columns];
    const { style: _gone, ...rest } = columns[c];
    columns[c] = rest;
    if (!styles) styles = { ...(spec.styles ?? {}) };
    for (let r = 0; r < rows; r++) {
      const key = `${r}:${c}`;
      styles[key] = styles[key] ? { ...colStyle, ...styles[key] } : colStyle;
    }
  };
  const edit = (r: number, c: number, patch: CellStyle) => {
    if (r < 0 || c < 0 || r >= rows || c >= cols) return;
    handDown(c);
    const key = `${r}:${c}`;
    const before = (styles ?? spec.styles)?.[key];
    let next: CellStyle | null;
    if (!before) {
      let part = parts.get(patch);
      if (part === undefined) {
        part = setPart(patch);
        parts.set(patch, part);
      }
      if (!part) return;
      next = part;
    } else {
      next = setPart({ ...before, ...patch });
    }
    if (!styles) styles = { ...(spec.styles ?? {}) };
    if (next) styles[key] = next;
    else delete styles[key];
  };
  /**
   * A patch on a whole column: the column's own style takes it, and the
   * column's cells let go of the keys it sets, so the column's value shows.
   */
  edit.column = (c: number, patch: CellStyle) => {
    if (c < 0 || c >= cols) return;
    if (!columns) columns = [...spec.columns];
    const col = columns[c];
    const next = setPart({ ...(col.style ?? {}), ...patch });
    const { style: _old, ...rest } = col;
    columns[c] = next ? { ...rest, style: next } : rest;
    const keys = Object.keys(patch) as Array<keyof CellStyle>;
    const current = styles ?? spec.styles;
    if (!current) return;
    for (let r = 0; r < rows; r++) {
      const key = `${r}:${c}`;
      const own = current[key];
      if (!own || !keys.some((k) => k in own)) continue;
      if (!styles) styles = { ...(spec.styles ?? {}) };
      const left = { ...own };
      for (const k of keys) delete left[k];
      if (Object.keys(left).length) styles[key] = left;
      else delete styles[key];
    }
  };
  edit.done = (): TableSpec => {
    if (!styles && !columns) return spec;
    let out: TableSpec = columns ? { ...spec, columns } : { ...spec };
    if (styles) {
      let any = false;
      for (const _ in styles) {
        any = true;
        break;
      }
      out = { ...out, styles: any ? styles : undefined };
    }
    return out;
  };
  return edit;
}

/**
 * Apply a style to every cell in a range. `undefined` values clear that key.
 * A range that runs the full height of the table styles its columns instead.
 */
export function styleRange(spec: TableSpec, range: CellRange, patch: CellStyle): TableSpec {
  const { r0, c0, r1, c1 } = normRange(range, spec);
  const edit = styleEditor(spec);
  if (r0 === 0 && r1 === spec.cells.length - 1) {
    for (let c = c0; c <= c1; c++) edit.column(c, patch);
    return edit.done();
  }
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) edit(r, c, patch);
  return edit.done();
}

/**
 * A style patch on every stored cell a drawn range stands for — the editor's
 * bold, fill, ink, alignment, vertical alignment and wrap. When the range
 * covers every stored row, it is the columns that are styled: one write per
 * column, however long the table.
 */
export function styleStored(spec: TableSpec, range: CellRange, order: readonly number[], patch: CellStyle): TableSpec {
  const edit = styleEditor(spec);
  const stored = new Set<number>();
  for (let vr = range.r0; vr <= range.r1; vr++) if (order[vr] !== undefined) stored.add(order[vr]);
  if (stored.size === spec.cells.length) {
    for (let c = range.c0; c <= range.c1; c++) edit.column(c, patch);
    return edit.done();
  }
  for (const r of stored) for (let c = range.c0; c <= range.c1; c++) edit(r, c, patch);
  return edit.done();
}

/** The shared value of one style key across a range, or `undefined` when mixed. */
export function styleOf<K extends keyof CellStyle>(spec: TableSpec, range: CellRange, key: K): CellStyle[K] | undefined {
  const { r0, c0, r1, c1 } = normRange(range, spec);
  let first: CellStyle[K] | undefined;
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const v = cellStyleAt(spec, r, c)?.[key];
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

export function setColumn(spec: TableSpec, c: number, patch: Partial<TableColumn>): TableSpec {
  return {
    ...spec,
    columns: spec.columns.map((col, i) => {
      if (i !== c) return col;
      const next = { ...col, ...patch };
      for (const k of Object.keys(patch) as Array<keyof TableColumn>) if (patch[k] === undefined) delete next[k];
      return next;
    }),
  };
}

/** Give a column a new share of the width, taken from its right neighbour. */
export function resizeColumn(spec: TableSpec, c: number, width: number): TableSpec {
  const next = Math.min(20, Math.max(0.2, width));
  return setColumn(spec, c, { width: next });
}

/** Set one stored row's share of the height. */
export function setRowHeight(spec: TableSpec, r: number, weight: number): TableSpec {
  const hs = Array.from({ length: spec.cells.length }, (_, i) => spec.rowHeights?.[i] ?? 1);
  hs[r] = Math.min(20, Math.max(0.4, weight));
  return { ...spec, rowHeights: hs.some((h) => h !== 1) ? hs : undefined };
}

/** A filter on one column set, replaced, or (null) removed. */
export function setFilter(spec: TableSpec, col: number, filter: Omit<TableFilter, 'col'> | null): TableSpec {
  const rest = (spec.filters ?? []).filter((f) => f.col !== col);
  const filters = filter ? [...rest, { col, ...filter }] : rest;
  return { ...spec, filters: filters.length ? filters : undefined };
}

/** How many drawn rows are frozen and how many columns, clamped to what the table has. */
export function frozenOf(spec: TableSpec): { rows: number; cols: number } {
  return {
    rows: Math.min(spec.frozen?.rows ?? 0, spec.cells.length),
    cols: Math.min(spec.frozen?.cols ?? 0, spec.columns.length),
  };
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
    filters: undefined,
    rowHeights: undefined,
    summary: undefined,
    refs: 2,
    rowIds: freshIds(cells.length),
    colIds: freshIds(cols),
  };
}

const quote = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/**
 * The table as CSV: the stored cells, or only the rows the view shows.
 *
 * A formula goes out as its result, as it does from every spreadsheet: CSV has
 * no formulas, and `=SUM(B2:B9)` in a file read by something else is a string
 * that looks like a bug.
 */
export function tableToCsv(spec: TableSpec, viewOnly = false): string {
  const rows = viewOnly ? viewRows(spec) : spec.cells.map((_, r) => r);
  return rows.map((r) => spec.cells[r].map((v, c) => quote(isFormula(v) ? formatCell(spec, r, c) : v)).join(',')).join('\r\n');
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
