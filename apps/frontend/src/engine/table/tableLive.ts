import { fromIdForm, isFormula } from './tableFormula';

/**
 * A table as the shared document stores it, read back into the plain shape
 * `normalizeTableSpec` validates.
 *
 * ## Why the stored shape is not the spec
 *
 * A spec is one value: written whole, it is last-writer-wins, and two people
 * typing into different cells at once lose one of the edits. So a table is
 * stored as small pieces that merge — a map entry per cell, one per column,
 * one per style, one per setting — with rows and columns in id-keyed order
 * lists (`tableCrdt.ts` writes it):
 *
 *     v: 2
 *     rowOrder: [rowId…]              colOrder: [colId…]
 *     cells:  { "rowId:colId": raw }  styles: { "rowId:colId": CellStyle }
 *     cols:   { colId: TableColumn }  rowH:   { rowId: weight }
 *     meta:   { header, theme, … }    — columns named by id, merges by corner ids
 *
 * Formulas name cells by id (`toIdForm`), so they keep meaning the same cells
 * across a concurrent insert. This turns that shape — as `toJSON()` gives it,
 * plain objects — back into positional rows and A1 formulas, counted the
 * spreadsheet's way, with the ids alongside (`rowIds`, `colIds`) so the next
 * write knows which row is which. Everything that reads `node.table` sees an
 * ordinary spec and never this.
 */

export const LIVE_VERSION = 2;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Whether a stored `table` value is the merged shape rather than a whole spec. */
export function isLiveShape(raw: unknown): raw is Record<string, unknown> {
  return isObj(raw) && raw.v === LIVE_VERSION && Array.isArray(raw.rowOrder) && Array.isArray(raw.colOrder);
}

/**
 * An order list with every id once, at its first place. Two people moving the
 * same row at once each delete and re-insert it, and the merge can hold it
 * twice; the first copy is where it is.
 */
export function uniqueIds(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of list) {
    if (typeof id !== 'string' || !id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

const splitKey = (key: string): [string, string] | null => {
  const at = key.indexOf(':');
  return at > 0 ? [key.slice(0, at), key.slice(at + 1)] : null;
};

/** The stored shape as a plain spec-shaped object, for `normalizeTableSpec` to validate. */
export function liveToRaw(raw: Record<string, unknown>): Record<string, unknown> {
  const rowIds = uniqueIds(raw.rowOrder);
  const colIds = uniqueIds(raw.colOrder);
  const rowAt = new Map(rowIds.map((id, i) => [id, i]));
  const colAt = new Map(colIds.map((id, i) => [id, i]));
  const stored = isObj(raw.cells) ? raw.cells : {};
  const cells = rowIds.map((rid) =>
    colIds.map((cid) => {
      const v = stored[`${rid}:${cid}`];
      const s = typeof v === 'string' ? v : '';
      return isFormula(s) ? `=${fromIdForm(s.slice(1), rowAt, colAt)}` : s;
    })
  );
  const colsIn = isObj(raw.cols) ? raw.cols : {};
  const columns = colIds.map((id) => (isObj(colsIn[id]) ? colsIn[id] : {}));

  const styles: Record<string, unknown> = {};
  if (isObj(raw.styles)) {
    for (const [key, style] of Object.entries(raw.styles)) {
      const ids = splitKey(key);
      if (!ids) continue;
      const r = rowAt.get(ids[0]);
      const c = colAt.get(ids[1]);
      if (r !== undefined && c !== undefined) styles[`${r}:${c}`] = style;
    }
  }

  const heightsIn = isObj(raw.rowH) ? raw.rowH : {};
  const rowHeights = rowIds.map((id) => (typeof heightsIn[id] === 'number' ? heightsIn[id] : 1));

  const meta = isObj(raw.meta) ? raw.meta : {};
  const col = (id: unknown) => (typeof id === 'string' ? colAt.get(id) : undefined);
  const byCol = (list: unknown) =>
    Array.isArray(list)
      ? list.flatMap((x) => {
          if (!isObj(x)) return [];
          const c = col(x.col);
          return c === undefined ? [] : [{ ...x, col: c }];
        })
      : undefined;

  const merges = Array.isArray(meta.merges)
    ? meta.merges.flatMap((m) => {
        if (!isObj(m)) return [];
        const r0 = typeof m.r === 'string' ? rowAt.get(m.r) : undefined;
        const r1 = typeof m.r1 === 'string' ? rowAt.get(m.r1) : undefined;
        const c0 = col(m.c);
        const c1 = col(m.c1);
        if (r0 === undefined || r1 === undefined || c0 === undefined || c1 === undefined || r1 < r0 || c1 < c0) return [];
        return [{ r: r0, c: c0, rs: r1 - r0 + 1, cs: c1 - c0 + 1 }];
      })
    : undefined;

  let summary: unknown[] | undefined;
  if (isObj(meta.summary)) {
    const s = meta.summary;
    summary = colIds.map((id) => (typeof s[id] === 'string' ? s[id] : null));
  }

  const sortCol = isObj(meta.sort) ? col(meta.sort.col) : undefined;

  return {
    ...meta,
    cells,
    columns,
    styles,
    rowHeights,
    merges,
    sort: isObj(meta.sort) && sortCol !== undefined ? { ...meta.sort, col: sortCol } : undefined,
    filters: byCol(meta.filters),
    rules: byCol(meta.rules),
    scales: byCol(meta.scales),
    bars: byCol(meta.bars),
    summary,
    refs: 2,
    rowIds,
    colIds,
  };
}
