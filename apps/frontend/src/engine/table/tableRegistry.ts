import { useStore } from '../../hooks/useStore';
import type { AnyNode } from '../model/schema';
import type { ChartTableLink } from '../chart/chartTypes';
import { setTableResolver } from './tableFormula';
import type { TableSpec } from './tableTypes';

/**
 * The board's tables and the charts that read them.
 *
 * - By title, for formulas that read another table (`='Q3 revenue'!B2:B9`).
 * - By link, for the charts drawn from each table: the board's link lines,
 *   a table's "Used by" list and the named ranges charts share.
 *
 * Kept up to date from the store's change set (`lastChangedIds`), so an edit
 * costs a look at the nodes it touched, never a walk of the board. Resolving
 * a title is a map lookup, and the version formulas memoise against moves
 * only when some table actually changed. Installed once, the first time a
 * table or a link is drawn or edited.
 */

type TableNodeT = Extract<AnyNode, { type: 'table' }>;
type ChartNodeT = Extract<AnyNode, { type: 'chart' }>;

const tables = new Map<string, TableNodeT>();
/** Each linked chart's link, by chart id. */
const links = new Map<string, ChartTableLink>();
/** Chart ids reading each table id, in id order. */
const readers = new Map<string, string[]>();

let byTitle = new Map<string, { id: string; spec: TableSpec }>();
/**
 * A table's node id by its cells array — shared by the stored spec, a person's
 * sorted or filtered view of it and the editor's live drag, so every one of
 * them is known as the same table.
 */
let idOfCells = new WeakMap<string[][], string>();
let version = 0;
let linkVersion = 0;
let installed = false;
const listeners = new Set<() => void>();
const linkListeners = new Set<() => void>();

/** When each linked chart's source last changed, for the board's "data flowing" pulse. */
const pulses = new Map<string, number>();
const pulseListeners = new Set<(chartIds: string[]) => void>();

/** The name a table is referred to by: its title, as the Layers panel shows and edits it. */
export const tableTitle = (node: { title?: string }) => node.title?.trim() ?? '';

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function reindexTitles(): void {
  byTitle = new Map();
  idOfCells = new WeakMap();
  for (const id of [...tables.keys()].sort(byId)) {
    const t = tables.get(id)!;
    idOfCells.set(t.table.cells, t.id);
    const title = tableTitle(t).toLowerCase();
    // Two tables with one title: the lower id answers, on every client alike.
    if (title && !byTitle.has(title)) byTitle.set(title, { id: t.id, spec: t.table });
  }
  version++;
  listeners.forEach((fn) => fn());
}

/** Links are small; a chart re-read after a move carries an equal link in a new object, which is not a change. */
const sameLink = (a: ChartTableLink | undefined, b: ChartTableLink | undefined) => a === b || (!!a && !!b && JSON.stringify(a) === JSON.stringify(b));

function setReader(chartId: string, link: ChartTableLink | undefined): boolean {
  const was = links.get(chartId);
  if (sameLink(was, link)) {
    if (link) links.set(chartId, link);
    return false;
  }
  if (was && (!link || was.tableId !== link.tableId)) {
    const list = (readers.get(was.tableId) ?? []).filter((id) => id !== chartId);
    if (list.length) readers.set(was.tableId, list);
    else readers.delete(was.tableId);
  }
  if (link) {
    links.set(chartId, link);
    const list = readers.get(link.tableId) ?? [];
    if (!list.includes(chartId)) readers.set(link.tableId, [...list, chartId].sort(byId));
  } else {
    links.delete(chartId);
    pulses.delete(chartId);
  }
  return true;
}

/** Fold one node's new state (or its removal) into the index. */
function take(id: string, node: AnyNode | undefined): { tables: boolean; links: boolean; sourceChanged: boolean } {
  let tablesChanged = false;
  let sourceChanged = false;
  const wasTable = tables.get(id);
  if (node?.type === 'table') {
    if (wasTable !== node) {
      tablesChanged = !wasTable || wasTable.title !== node.title || wasTable.table !== node.table;
      // The cells array is kept across reads while no text changed, so a move
      // or a restyle is not a change of data.
      sourceChanged = Boolean(wasTable && wasTable.table.cells !== node.table.cells);
      tables.set(id, node);
    }
  } else if (wasTable) {
    tables.delete(id);
    tablesChanged = true;
  }
  const link = node?.type === 'chart' ? (node as ChartNodeT).chart.link : undefined;
  const linksChanged = setReader(id, link);
  return { tables: tablesChanged, links: linksChanged, sourceChanged };
}

function sync(objects: Record<string, AnyNode>, changed: readonly string[] | null, removed: readonly string[]): void {
  let titles = false;
  let linked = false;
  const sources: string[] = [];
  const visit = (id: string, node: AnyNode | undefined) => {
    const r = take(id, node);
    titles ||= r.tables;
    linked ||= r.links;
    if (r.sourceChanged) sources.push(id);
  };
  if (changed === null) {
    // No change set to go by: everything, once.
    for (const id of [...tables.keys(), ...links.keys()]) if (!objects[id]) visit(id, undefined);
    for (const [id, node] of Object.entries(objects)) visit(id, node);
  } else {
    for (const id of removed) visit(id, undefined);
    for (const id of changed) visit(id, objects[id]);
  }
  if (titles) reindexTitles();
  if (linked) {
    linkVersion++;
    linkListeners.forEach((fn) => fn());
  }
  if (sources.length) {
    const now = Date.now();
    const charts = sources.flatMap((t) => readers.get(t) ?? []);
    for (const c of charts) pulses.set(c, now);
    if (charts.length) pulseListeners.forEach((fn) => fn(charts));
  }
}

/** For `useSyncExternalStore`: changes whenever any table on the board does. */
export const registryVersion = () => version;
export function subscribeRegistry(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** For `useSyncExternalStore`: changes whenever a chart links, unlinks or edits its link. */
export const linksVersion = () => linkVersion;
export function subscribeLinks(fn: () => void): () => void {
  ensureTableRegistry();
  linkListeners.add(fn);
  return () => linkListeners.delete(fn);
}

/** Called with the ids of linked charts whose source table just changed. */
export function subscribePulses(fn: (chartIds: string[]) => void): () => void {
  ensureTableRegistry();
  pulseListeners.add(fn);
  return () => pulseListeners.delete(fn);
}

/** When a linked chart's source last changed, or 0. */
export const lastPulse = (chartId: string) => pulses.get(chartId) ?? 0;

/** The table a title names, for the editor's reference outlines. */
export const tableByTitle = (title: string) => byTitle.get(title.trim().toLowerCase()) ?? null;

/** The charts reading a table, in id order. */
export const chartsReading = (tableId: string): readonly string[] => readers.get(tableId) ?? EMPTY;
const EMPTY: readonly string[] = [];

/** A chart's link, as the index has it. */
export const linkOf = (chartId: string) => links.get(chartId) ?? null;

/** Linked charts whose table is no longer on the board. */
export const orphanedCharts = (): string[] => [...links].filter(([, l]) => !tables.has(l.tableId)).map(([id]) => id);

/** Every table on the board, in id order. */
export const boardTables = (): TableNodeT[] => [...tables.values()].sort((a, b) => byId(a.id, b.id));

/** A table node by id, without asking the store. */
export const tableNode = (id: string) => tables.get(id) ?? null;

/** A named range on one table: the name and the link of the lowest chart id carrying it. */
export interface NamedRange {
  name: string;
  link: ChartTableLink;
  charts: string[];
}

/** The named ranges on a table, by name, each with the charts that read it. */
export function namedRanges(tableId: string): NamedRange[] {
  const out = new Map<string, NamedRange>();
  for (const chartId of chartsReading(tableId)) {
    const link = links.get(chartId);
    const name = link?.name?.trim();
    if (!link || !name) continue;
    const key = name.toLowerCase();
    const hit = out.get(key);
    if (hit) hit.charts.push(chartId);
    else out.set(key, { name, link, charts: [chartId] });
  }
  return [...out.values()];
}

/** The charts carrying one named range on a table. */
export function chartsNamed(tableId: string, name: string): string[] {
  const key = name.trim().toLowerCase();
  return chartsReading(tableId).filter((id) => links.get(id)?.name?.trim().toLowerCase() === key);
}

export function ensureTableRegistry(): void {
  if (installed) return;
  installed = true;
  sync(useStore.getState().objects, null, []);
  useStore.subscribe((s, prev) => {
    if (s.objects === prev.objects) return;
    // A store write that did not say what changed is read whole.
    const known = s.lastChangedIds !== prev.lastChangedIds || s.lastRemovedIds !== prev.lastRemovedIds;
    sync(s.objects, known ? s.lastChangedIds : null, known ? s.lastRemovedIds : []);
  });
  setTableResolver({
    byTitle: (title) => byTitle.get(title.trim().toLowerCase()) ?? null,
    idOf: (spec) => idOfCells.get(spec.cells) ?? null,
    version: () => version,
  });
}
