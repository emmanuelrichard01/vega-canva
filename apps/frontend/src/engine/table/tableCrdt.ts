import * as Y from 'yjs';
import { isFormula, toIdForm } from './tableFormula';
import { LIVE_VERSION, uniqueIds } from './tableLive';
import { migrateTableRefs, normalizeTableSpec, refsSkipHeader, type CellStyle, type TableColumn, type TableSpec } from './tableTypes';

/**
 * Writing a table into the shared document so concurrent edits merge.
 *
 * ## The shape, and why
 *
 * The table lives under the node's `table` key as a `Y.Map` of small pieces
 * (described in `tableLive.ts`, which reads it back): a map entry per cell,
 * per column, per cell style and per setting, and the row and column order as
 * `Y.Array`s of ids. A write is a *diff* — only the pieces that changed are
 * touched — so two people typing in different cells change different entries
 * and both edits survive the merge, and two rows inserted at once are two ids
 * in the order list, both kept, in an order every client agrees on.
 *
 * Formulas are stored with their references by id (`toIdForm`), so an insert
 * somebody else made never re-points a formula written without seeing it, and
 * an insert or a move rewrites no formula at all: only the order list changes.
 *
 * ## What still conflicts
 *
 * Two people writing the *same* cell, the same column setting or the same
 * style: the last write wins, as in every spreadsheet. The node's width and
 * height are single values too, so two rows inserted at once grow the box by
 * one row's height between them, and the rows share it.
 *
 * ## Undo
 *
 * Every write happens inside the caller's transaction, with the caller's
 * origin; the document's undo manager tracks only local changes, so an undo
 * takes back this person's diff and leaves everybody else's edits where they are.
 */

export function isLiveTable(v: unknown): v is Y.Map<unknown> {
  return v instanceof Y.Map && v.get('v') === LIVE_VERSION;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sub<T extends Y.AbstractType<any>>(live: Y.Map<unknown>, key: string, make: () => T): T {
  const cur = live.get(key);
  if (cur instanceof Y.AbstractType) return cur as T;
  const created = make();
  live.set(key, created);
  return live.get(key) as T;
}

/** JSON equality, for values a Y.Map holds: plain data, never functions or cycles. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((v, i) => same(v, bb[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao).filter((k) => ao[k] !== undefined);
  const bk = Object.keys(bo).filter((k) => bo[k] !== undefined);
  return ak.length === bk.length && ak.every((k) => same(ao[k], bo[k]));
}

/** A copy with every `undefined` dropped: a stored value carries only what it says. */
function clean<T>(v: T): T {
  if (Array.isArray(v)) return v.map(clean) as unknown as T;
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) if (x !== undefined) out[k] = clean(x);
    return out as T;
  }
  return v;
}

/** Set the keys of a map to `want`'s, deleting those it no longer has. */
function syncFields(map: Y.Map<unknown>, want: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(want)) {
    if (v === undefined) continue;
    if (!same(map.get(k), v)) map.set(k, v);
  }
  for (const k of [...map.keys()]) if (want[k] === undefined) map.delete(k);
}

/** Indices of a longest strictly increasing subsequence of `xs`. */
function lisIndices(xs: number[]): Set<number> {
  const tails: number[] = [];
  const prev = new Array<number>(xs.length).fill(-1);
  for (let i = 0; i < xs.length; i++) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (xs[tails[mid]] < xs[i]) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1];
    tails[lo] = i;
  }
  const out = new Set<number>();
  for (let i = tails.length ? tails[tails.length - 1] : -1; i >= 0; i = prev[i]) out.add(i);
  return out;
}

/**
 * Bring an order list to `ids` with as few operations as it takes: ids that
 * left are deleted, ids that arrived are inserted where they belong, and of
 * the ids that stayed, the longest run already in order is left untouched —
 * so a move is one delete and one insert, and an insert next to a concurrent
 * insert keeps both.
 */
export function syncOrder(arr: Y.Array<string>, ids: readonly string[]): void {
  const cur = arr.toArray();
  if (cur.length === ids.length && cur.every((v, i) => v === ids[i])) return;
  const want = new Map(ids.map((id, i) => [id, i]));
  const seen = new Set<string>();
  const kept: number[] = [];
  const drop: number[] = [];
  cur.forEach((id, i) => {
    if (want.has(id) && !seen.has(id)) {
      seen.add(id);
      kept.push(i);
    } else drop.push(i);
  });
  const stay = lisIndices(kept.map((i) => want.get(cur[i])!));
  kept.forEach((i, k) => {
    if (!stay.has(k)) drop.push(i);
  });
  drop.sort((a, b) => b - a);
  for (let k = 0; k < drop.length; ) {
    let start = drop[k];
    let len = 1;
    while (k + len < drop.length && drop[k + len] === start - 1) {
      start--;
      len++;
    }
    arr.delete(start, len);
    k += len;
  }
  // What is left is in the wanted order; the new ids go in between, in runs.
  const after = arr.toArray();
  let k = 0;
  let pos = 0;
  let pending: string[] = [];
  for (const id of ids) {
    if (k < after.length && after[k] === id) {
      if (pending.length) {
        arr.insert(pos, pending);
        pos += pending.length;
        pending = [];
      }
      k++;
      pos++;
    } else pending.push(id);
  }
  if (pending.length) arr.insert(pos, pending);
}

/** Ids naming each of `n` tracks once, or null. */
function validIds(ids: readonly string[] | undefined, n: number): string[] | null {
  if (!ids || ids.length !== n) return null;
  const u = uniqueIds(ids);
  return u.length === n && u.every((id) => /^[\w-]{1,40}$/.test(id)) ? u : null;
}

/** Ids for `n` tracks when the spec carries none that fit: the stored order's, by position, then new ones. */
function idsByPosition(stored: string[], n: number, prefix: string): string[] {
  const out = stored.slice(0, n);
  const taken = new Set(out);
  for (let i = out.length; out.length < n; i++) {
    let id = `${prefix}${i}`;
    while (taken.has(id)) id = `${id}x`;
    taken.add(id);
    out.push(id);
  }
  return out;
}

const columnValue = (col: TableColumn): Record<string, unknown> => clean({ ...col });

const sameIds = (a: readonly string[] | undefined, b: readonly string[]) => Boolean(a) && a!.length === b.length && a!.every((v, i) => v === b[i]);

/**
 * Write a spec into a table node's merged shape, converting a whole-value
 * table on the way. Call inside a transaction.
 *
 * `prev` is the spec the edit started from — the node as last read — and lets
 * a cell, row, style or column that is the same object as before be skipped
 * without reading the document. It is only trusted while its rows and columns
 * are still the stored ones.
 */
export function writeTable(node: Y.Map<unknown>, next: TableSpec, prev?: TableSpec): void {
  let live = node.get('table');
  let fresh = false;
  if (!isLiveTable(live)) {
    live = new Y.Map<unknown>();
    node.set('table', live);
    live = node.get('table') as Y.Map<unknown>;
    (live as Y.Map<unknown>).set('v', LIVE_VERSION);
    fresh = true;
  }
  const map = live as Y.Map<unknown>;
  const rowOrder = sub(map, 'rowOrder', () => new Y.Array<string>());
  const colOrder = sub(map, 'colOrder', () => new Y.Array<string>());
  const ycells = sub(map, 'cells', () => new Y.Map<string>());
  const ycols = sub(map, 'cols', () => new Y.Map<unknown>());
  const yrowH = sub(map, 'rowH', () => new Y.Map<number>());
  const ystyles = sub(map, 'styles', () => new Y.Map<CellStyle>());
  const ymeta = sub(map, 'meta', () => new Y.Map<unknown>());

  const storedRows = uniqueIds(rowOrder.toArray());
  const storedCols = uniqueIds(colOrder.toArray());
  const rowIds = validIds(next.rowIds, next.cells.length) ?? idsByPosition(storedRows, next.cells.length, 'r');
  const colIds = validIds(next.colIds, next.columns.length) ?? idsByPosition(storedCols, next.columns.length, 'c');

  const goneRows = new Set(storedRows.filter((id) => !rowIds.includes(id)));
  const goneCols = new Set(storedCols.filter((id) => !colIds.includes(id)));
  syncOrder(rowOrder, rowIds);
  syncOrder(colOrder, colIds);

  // `prev` stands for the stored table only when nothing moved under it.
  const fast =
    !fresh &&
    Boolean(prev) &&
    sameIds(prev!.rowIds, rowIds) &&
    sameIds(prev!.colIds, colIds) &&
    sameIds(storedRows, rowIds) &&
    sameIds(storedCols, colIds) &&
    refsSkipHeader(prev!) === refsSkipHeader(next);
  const before = fast ? prev! : null;
  const skip = refsSkipHeader(next);

  // --- cells ---------------------------------------------------------------
  if (goneRows.size || goneCols.size) {
    for (const key of [...ycells.keys()]) {
      const at = key.indexOf(':');
      if (goneRows.has(key.slice(0, at)) || goneCols.has(key.slice(at + 1))) ycells.delete(key);
    }
  }
  for (let r = 0; r < next.cells.length; r++) {
    const row = next.cells[r];
    const old = before?.cells[r];
    if (old && old === row) continue;
    for (let c = 0; c < colIds.length; c++) {
      const raw = row[c] ?? '';
      if (old && old[c] === raw) continue;
      const stored = isFormula(raw) ? `=${toIdForm(raw.slice(1), skip, rowIds, colIds)}` : raw;
      const key = `${rowIds[r]}:${colIds[c]}`;
      const cur = ycells.get(key);
      if (stored === '') {
        if (cur !== undefined) ycells.delete(key);
      } else if (cur !== stored) ycells.set(key, stored);
    }
  }

  // --- columns --------------------------------------------------------------
  colIds.forEach((id, c) => {
    if (before && before.columns[c] === next.columns[c]) return;
    let ym = ycols.get(id);
    if (!(ym instanceof Y.Map)) {
      ycols.set(id, new Y.Map<unknown>());
      ym = ycols.get(id);
    }
    syncFields(ym as Y.Map<unknown>, columnValue(next.columns[c]));
  });
  for (const id of goneCols) ycols.delete(id);

  // --- row heights ----------------------------------------------------------
  if (!before || before.rowHeights !== next.rowHeights) {
    rowIds.forEach((id, r) => {
      const w = next.rowHeights?.[r] ?? 1;
      const cur = yrowH.get(id);
      if (w === 1) {
        if (cur !== undefined) yrowH.delete(id);
      } else if (cur !== w) yrowH.set(id, w);
    });
  }
  for (const id of goneRows) yrowH.delete(id);

  // --- styles ---------------------------------------------------------------
  const styleKey = (key: string) => {
    const at = key.indexOf(':');
    const r = Number(key.slice(0, at));
    const c = Number(key.slice(at + 1));
    return rowIds[r] !== undefined && colIds[c] !== undefined ? `${rowIds[r]}:${colIds[c]}` : null;
  };
  if (before) {
    if (before.styles !== next.styles) {
      const a = before.styles ?? {};
      const b = next.styles ?? {};
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (a[key] === b[key]) continue;
        const id = styleKey(key);
        if (!id) continue;
        if (b[key]) {
          if (!same(ystyles.get(id), b[key])) ystyles.set(id, clean(b[key]));
        } else ystyles.delete(id);
      }
    }
  } else {
    const want = new Map<string, CellStyle>();
    for (const [key, style] of Object.entries(next.styles ?? {})) {
      const id = styleKey(key);
      if (id) want.set(id, style);
    }
    for (const key of [...ystyles.keys()]) if (!want.has(key)) ystyles.delete(key);
    for (const [id, style] of want) if (!same(ystyles.get(id), style)) ystyles.set(id, clean(style));
  }

  // --- settings -------------------------------------------------------------
  syncFields(ymeta, metaOf(next, rowIds, colIds));
}

/** Everything that is not a cell, a column, a style or a row height, with columns and corners named by id. */
function metaOf(spec: TableSpec, rowIds: string[], colIds: string[]): Record<string, unknown> {
  const col = (c: number) => colIds[c];
  const byCol = <T extends { col: number }>(list: T[] | undefined) => {
    const out = (list ?? []).filter((x) => col(x.col) !== undefined).map((x) => clean({ ...x, col: col(x.col) }));
    return out.length ? out : undefined;
  };
  const merges = (spec.merges ?? [])
    .filter((m) => rowIds[m.r] && rowIds[m.r + m.rs - 1] && colIds[m.c] && colIds[m.c + m.cs - 1])
    .map((m) => ({ r: rowIds[m.r], c: colIds[m.c], r1: rowIds[m.r + m.rs - 1], c1: colIds[m.c + m.cs - 1] }));
  let summary: Record<string, string> | undefined;
  if (spec.summary) {
    summary = {};
    spec.summary.forEach((agg, c) => {
      if (agg && colIds[c]) summary![colIds[c]] = agg;
    });
  }
  return clean({
    header: spec.header,
    firstColumn: spec.firstColumn || undefined,
    theme: spec.theme,
    accent: spec.accent,
    fontSize: spec.fontSize,
    currency: spec.currency,
    autoFit: spec.autoFit === false ? false : undefined,
    frozen: spec.frozen,
    merges: merges.length ? merges : undefined,
    sort: spec.sort && col(spec.sort.col) !== undefined ? { col: col(spec.sort.col), dir: spec.sort.dir } : undefined,
    filters: byCol(spec.filters),
    rules: byCol(spec.rules),
    scales: byCol(spec.scales),
    bars: byCol(spec.bars),
    summary,
  });
}

/**
 * A table node brought to the current storage, once: formulas written in the
 * older row count rewritten to the spreadsheet's (`migrateTableRefs`), the
 * whole-value spec converted to the merged shape, and the node marked
 * (`tableRefs: 2`) so neither can happen again — the mark sits beside the
 * spec, where an older build that writes the spec back without `refs` leaves
 * it alone. Part of the document migration (`migrateDoc`): editors only,
 * after sync, in its transaction. True when it changed anything.
 */
export function migrateTableNode(node: Y.Map<unknown>): boolean {
  if (node.get('tableRefs') === 2) return false;
  const stored = node.get('table');
  if (!isLiveTable(stored)) {
    const plain = stored instanceof Y.AbstractType ? stored.toJSON() : stored;
    writeTable(node, migrateTableRefs(normalizeTableSpec(plain)));
  }
  node.set('tableRefs', 2);
  return true;
}
