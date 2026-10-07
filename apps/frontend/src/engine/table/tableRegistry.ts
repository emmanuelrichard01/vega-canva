import { useStore } from '../../hooks/useStore';
import type { AnyNode } from '../model/schema';
import { setTableResolver } from './tableFormula';
import type { TableSpec } from './tableTypes';

/**
 * The board's tables, by title, for formulas that read another table
 * (`='Q3 revenue'!B2:B9`).
 *
 * Built from the store's nodes and rebuilt only when a table node changes —
 * by reference, which the store keeps stable for nodes that did not change —
 * so resolving a title is a map lookup, and the version formulas memoise
 * against moves only when some table actually did. Installed once, the first
 * time a table is drawn or edited.
 */

type TableNodeT = Extract<AnyNode, { type: 'table' }>;

let byTitle = new Map<string, { id: string; spec: TableSpec }>();
/**
 * A table's node id by its cells array — shared by the stored spec, a person's
 * sorted or filtered view of it and the editor's live drag, so every one of
 * them is known as the same table.
 */
let idOfCells = new WeakMap<string[][], string>();
let version = 0;
let lastTables: TableNodeT[] = [];
let installed = false;
const listeners = new Set<() => void>();

/** The name a table is referred to by: its title, as the Layers panel shows and edits it. */
export const tableTitle = (node: { title?: string }) => node.title?.trim() ?? '';

function rebuild(objects: Record<string, AnyNode>): void {
  const tables = Object.values(objects).filter((n): n is TableNodeT => n.type === 'table')
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const same = tables.length === lastTables.length && tables.every((t, i) => t === lastTables[i]);
  if (same) return;
  lastTables = tables;
  byTitle = new Map();
  idOfCells = new WeakMap();
  for (const t of tables) {
    idOfCells.set(t.table.cells, t.id);
    const title = tableTitle(t).toLowerCase();
    // Two tables with one title: the lower id answers, on every client alike.
    if (title && !byTitle.has(title)) byTitle.set(title, { id: t.id, spec: t.table });
  }
  version++;
  listeners.forEach((fn) => fn());
}

/** For `useSyncExternalStore`: changes whenever any table on the board does. */
export const registryVersion = () => version;
export function subscribeRegistry(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The table a title names, for the editor's reference outlines. */
export const tableByTitle = (title: string) => byTitle.get(title.trim().toLowerCase()) ?? null;

export function ensureTableRegistry(): void {
  if (installed) return;
  installed = true;
  rebuild(useStore.getState().objects);
  useStore.subscribe((s, prev) => {
    if (s.objects !== prev.objects) rebuild(s.objects);
  });
  setTableResolver({
    byTitle: (title) => byTitle.get(title.trim().toLowerCase()) ?? null,
    idOf: (spec) => idOfCells.get(spec.cells) ?? null,
    version: () => version,
  });
}
