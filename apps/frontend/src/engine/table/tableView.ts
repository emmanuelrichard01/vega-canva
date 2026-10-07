import type { TableFilter, TableSort, TableSpec } from './tableTypes';

/**
 * Each person's own sort and filter on a table — Sheets' filter views,
 * Airtable's views.
 *
 * ## Why a view is not the document
 *
 * Sorting and filtering are how one person reads a table. Written into the
 * shared spec, one person's filter hid rows from everybody in the room and
 * shrank the table under their hands, and two people sorting by different
 * columns fought over one value. So the sort and filter a person picks live
 * here, in this session only, and the board draws their table through them.
 *
 * The spec's own `sort` and `filters` are the table's *default view*: what
 * everyone sees until they choose otherwise, and what exports and charts
 * read. Writing it is an explicit editor action ("Save as default view").
 *
 * A view names its columns by id, so it keeps pointing at the same column when
 * columns are inserted, moved or deleted — by this person or anyone else.
 * `undefined` for a part means "the default's"; `null` means "none, whatever
 * the default has".
 */

export interface TableView {
  sort?: { colId: string; dir: TableSort['dir'] } | null;
  filters?: Array<{ colId: string; query: string; values?: string[] }> | null;
}

const views = new Map<string, TableView>();
let version = 0;
const listeners = new Set<() => void>();

/** For `useSyncExternalStore`: changes whenever anyone's view on this client does. */
export const viewsVersion = () => version;
export function subscribeViews(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const viewOf = (id: string): TableView | undefined => views.get(id);

function setView(id: string, view: TableView | null): void {
  const empty = !view || (view.sort === undefined && view.filters === undefined);
  if (empty && !views.has(id)) return;
  if (empty) views.delete(id);
  else views.set(id, view!);
  version++;
  listeners.forEach((fn) => fn());
}

/** Back to the table's default view. */
export const resetView = (id: string) => setView(id, null);

/** Whether this person is looking through a view of their own. */
export const hasOwnView = (id: string) => views.has(id);

/** A column's id in a spec, or its position when the spec carries no ids. */
const colIdAt = (spec: TableSpec, c: number) => spec.colIds?.[c] ?? `#${c}`;

function colIndex(spec: TableSpec, id: string): number {
  const i = spec.colIds ? spec.colIds.indexOf(id) : -1;
  if (i >= 0) return i;
  const m = /^#(\d+)$/.exec(id);
  return m && Number(m[1]) < spec.columns.length ? Number(m[1]) : -1;
}

const sortById = (spec: TableSpec, sort: TableSort | undefined): TableView['sort'] =>
  sort && spec.columns[sort.col] ? { colId: colIdAt(spec, sort.col), dir: sort.dir } : null;

const filtersById = (spec: TableSpec, filters: TableFilter[] | undefined): NonNullable<TableView['filters']> =>
  (filters ?? [])
    .filter((f) => spec.columns[f.col])
    .map((f) => ({ colId: colIdAt(spec, f.col), query: f.query, ...(f.values ? { values: f.values } : null) }));

const sortIn = (spec: TableSpec, sort: TableView['sort']): TableSort | undefined => {
  if (!sort) return undefined;
  const c = colIndex(spec, sort.colId);
  return c < 0 ? undefined : { col: c, dir: sort.dir };
};

const filtersIn = (spec: TableSpec, filters: TableView['filters']): TableFilter[] | undefined => {
  const out = (filters ?? []).flatMap((f) => {
    const c = colIndex(spec, f.colId);
    return c < 0 ? [] : [{ col: c, query: f.query, ...(f.values ? { values: f.values } : null) }];
  });
  return out.length ? out : undefined;
};

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Spec and view → the spec drawn, cached so a view keeps one object per spec while neither changes. */
const drawn = new WeakMap<TableSpec, { view: TableView; out: TableSpec }>();

/** A spec seen through a view. */
export function withView(spec: TableSpec, view: TableView | undefined): TableSpec {
  if (!view) return spec;
  const hit = drawn.get(spec);
  if (hit && hit.view === view) return hit.out;
  let out = spec;
  if (view.sort !== undefined) out = { ...out, sort: sortIn(spec, view.sort) };
  if (view.filters !== undefined) out = { ...out, filters: filtersIn(spec, view.filters) };
  drawn.set(spec, { view, out });
  return out;
}

/** The table as this person sees it: the default view, or their own. */
export const effectiveSpec = (id: string, spec: TableSpec): TableSpec => withView(spec, views.get(id));

/** The fields an edit writes to the document, as against the view kept here. */
const VIEW_KEYS = new Set(['sort', 'filters']);

/**
 * An edit made to what this person sees, split in two.
 *
 * `next` is the spec after an edit to `effectiveSpec(id, shared)`. A change to
 * its sort or filters is this person's: it goes into their view, and the
 * document keeps the default view — following its columns by id when the
 * same edit inserted, moved or deleted some. Everything else is the
 * document's, returned for writing; null when the edit changed nothing else,
 * so a viewer sorting their own view writes nothing at all.
 *
 * `scope: 'shared'` writes the sort and filters as the new default instead,
 * and clears the view: "Save as default view", or a whole table replaced
 * (an example, an imported file) whose order belongs to the table.
 */
export function splitEdit(id: string, shared: TableSpec, next: TableSpec, scope: 'view' | 'shared' = 'view'): TableSpec | null {
  if (scope === 'shared') {
    resetView(id);
    return next;
  }
  const before = effectiveSpec(id, shared);
  const nextSort = sortById(next, next.sort);
  const nextFilters = filtersById(next, next.filters);
  // An edit made from the stored spec rather than the drawn one (a theme from
  // the rail) carries the default's own sort and filters, untouched: that is
  // not this person choosing the default view over their own.
  const inherited = next.sort === shared.sort && next.filters === shared.filters && before !== shared;
  const sortChanged = !inherited && !same(sortById(before, before.sort), nextSort);
  const filtersChanged = !inherited && !same(filtersById(before, before.filters), nextFilters);
  if (sortChanged || filtersChanged) {
    const current = views.get(id) ?? {};
    const view: TableView = { ...current };
    // A choice that matches the default is the default: the view lets go of it.
    if (sortChanged) view.sort = same(sortById(shared, shared.sort), nextSort) ? undefined : nextSort;
    if (filtersChanged) view.filters = same(filtersById(shared, shared.filters), nextFilters) ? undefined : nextFilters.length ? nextFilters : null;
    setView(id, view);
  }
  const doc: TableSpec = {
    ...next,
    sort: sortIn(next, sortById(shared, shared.sort)),
    filters: filtersIn(next, filtersById(shared, shared.filters)),
  };
  const keys = new Set([...Object.keys(doc), ...Object.keys(shared)]);
  for (const k of keys) {
    if (VIEW_KEYS.has(k)) {
      if (!same(doc[k as keyof TableSpec], shared[k as keyof TableSpec])) return doc;
      continue;
    }
    if (doc[k as keyof TableSpec] !== shared[k as keyof TableSpec]) return doc;
  }
  return null;
}
