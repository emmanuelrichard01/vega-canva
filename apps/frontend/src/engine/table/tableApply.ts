import { nanoid } from 'nanoid';
import { editor } from '../api/EditorAPI';
import { nextZIndex, updateTableNode } from '../document/mutations';
import { canEditObjects } from '../model/permissions';
import { useStore } from '../../hooks/useStore';
import { effectiveSpec, splitEdit } from './tableView';
import type { AnyNode } from '../model/schema';
import { fitColumns, fitRows } from './tableFit';
import { drawnWeight } from './tableLayout';
import { tableMeasure } from './tableMeasure';
import { downloadTableCsv, tableFromCsv, tableToCsv } from './tableModel';
import type { TableSpec } from './tableTypes';

/**
 * Creating and editing table nodes, through `EditorAPI` like every other
 * write — so a table lands on top, carries its authorship, joins the undo
 * history as one step per edit and is refused for a read-only session.
 */

type TableNodeT = Extract<AnyNode, { type: 'table' }>;

/** One row, at the default type size: comfortable to read and to click into. */
export const TABLE_ROW_H = 36;
export const TABLE_COL_W = 150;
export const TABLE_MIN_SIZE = { width: 160, height: 72 };

const weightSum = (spec: TableSpec) => spec.columns.reduce((a, c) => a + (c.hidden ? 0 : c.width), 0);
const measureFor = (node: TableNodeT) => tableMeasure(Boolean(node.appearance?.sketch));

/** The box a spec wants, at the default row height and column width. */
export function tableSizeFor(spec: TableSpec): { width: number; height: number } {
  return {
    width: Math.round(Math.max(TABLE_MIN_SIZE.width, weightSum(spec) * TABLE_COL_W)),
    height: Math.round(Math.max(TABLE_MIN_SIZE.height, drawnWeight(spec) * TABLE_ROW_H)),
  };
}

/** The height of a standard (weight 1) drawn row on this node. */
export const rowHeightOf = (node: TableNodeT) => node.height / drawnWeight(node.table);

/**
 * The width a node should have for a new spec.
 *
 * Unchanged — unless the shown columns changed, and then the table grows or
 * shrinks by exactly those columns. Column widths are shares of the node's
 * width, so adding one without widening the box would squeeze every other
 * column to make room, cutting text that fitted a moment ago. Rows follow the
 * same rule (`updateTable`).
 */
export function widthFor(node: TableNodeT, spec: TableSpec): number {
  const before = weightSum(node.table);
  const after = weightSum(spec);
  const sameShape =
    spec.columns.length === node.table.columns.length && spec.columns.every((c, i) => Boolean(c.hidden) === Boolean(node.table.columns[i].hidden));
  if (sameShape || !(before > 0)) return node.width;
  return Math.max(TABLE_MIN_SIZE.width / 2, (node.width / before) * after);
}

export function createTable(
  box: { x: number; y: number; width: number; height: number },
  spec: TableSpec
): string | null {
  if (!(box.width > 0) || !(box.height > 0)) return null;
  const id = nanoid();
  editor.createNode({
    id,
    type: 'table',
    ...box,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
    zIndex: nextZIndex(),
    table: spec,
  } as never);
  // Into the merged shape at once, inside the same undo step as the creation,
  // so the first two people to type into it never race to convert it.
  const created = liveNode(id);
  if (created) updateTableNode(id, created.table, undefined);
  return id;
}

/** The node as the store has it now — a write is always made against the latest read. */
function liveNode(id: string): TableNodeT | null {
  const n = useStore.getState().objects[id];
  return n && n.type === 'table' ? (n as TableNodeT) : null;
}

/** The table as this person sees it: the shared spec through their own sort and filter (`tableView.ts`). */
export const drawnSpec = (node: TableNodeT): TableSpec => effectiveSpec(node.id, node.table);

/**
 * The height a person's view of a table is drawn at. Their own filter hides
 * rows from them alone, so it cannot resize the node everyone shares: the
 * rows keep the node's row height and the view ends where its rows do — never
 * taller than the node.
 */
export function drawnHeight(node: TableNodeT, spec: TableSpec): number {
  if (spec === node.table) return node.height;
  const unit = node.height / drawnWeight(node.table);
  return Math.min(node.height, unit * drawnWeight(spec));
}

/** The document half of an edit, sized by whole rows and columns and written as one step. */
function writeDoc(node: TableNodeT, spec: TableSpec, extra?: { width?: number; height?: number }): void {
  const before = drawnWeight(node.table);
  const after = drawnWeight(spec);
  const patch: Record<string, unknown> = {};
  const height = extra?.height ?? (Math.abs(before - after) > 1e-6 ? Math.max(TABLE_MIN_SIZE.height / 2, (node.height / before) * after) : node.height);
  if (Math.abs(height - node.height) > 0.5) patch.height = height;
  const width = extra?.width ?? widthFor(node, spec);
  if (Math.abs(width - node.width) > 0.5) patch.width = width;
  updateTableNode(node.id, spec, node.table, patch);
}

/**
 * Write a new spec, growing or shrinking the box by whole rows and columns.
 *
 * `spec` is an edit of what this person sees (`drawnSpec`). Its sort and
 * filter go to their own view; the rest goes to the document — nothing at all
 * when that is all the edit changed, which is how a viewer sorts a table
 * without writing (`splitEdit`). `scope: 'shared'` writes the sort and filter
 * as the table's default view instead.
 *
 * Rows share the node's height, so adding one without growing the box would
 * squeeze every row to make room — a table that gets harder to read the more
 * you put in it. Keeping the standard row height instead means the table
 * grows down by exactly one row, the way it does in every document editor;
 * a taller row and the summary footer count by their share. `widthFor` is
 * the same rule across. `extra` overrides either for callers that sized the
 * tracks themselves (a fit, a resize of the last column).
 */
export function updateTable(node: TableNodeT, spec: TableSpec, extra?: { width?: number; height?: number }, scope: 'view' | 'shared' = 'view'): void {
  const live = liveNode(node.id) ?? node;
  const doc = splitEdit(node.id, live.table, spec, scope);
  if (!doc || !canEditObjects()) return;
  writeDoc(live, doc, extra);
}

/** Write the sort and filter this person sees as the table's default, for everyone. */
export function saveDefaultView(node: TableNodeT): void {
  const live = liveNode(node.id) ?? node;
  updateTable(live, drawnSpec(live), undefined, 'shared');
}

/**
 * Size columns to their content, as one undo step. `false` when every column
 * already fits, so a caller can say so instead of writing nothing.
 */
export function fitTableColumns(node: TableNodeT, columns?: number[], mode: 'fit' | 'grow' = 'fit'): boolean {
  const live = liveNode(node.id) ?? node;
  const fit = fitColumns(drawnSpec(live), { width: live.width, rowH: rowHeightOf(live) }, measureFor(live), { columns, mode });
  if (!fit) return false;
  updateTable(live, fit.spec, { width: fit.width });
  return true;
}

/** Size wrapped rows to their lines exactly — a double-click on a row's edge. */
export function fitTableRows(node: TableNodeT, rows?: number[]): boolean {
  const live = liveNode(node.id) ?? node;
  const fit = fitRows(live.table, { width: live.width, height: live.height }, measureFor(live), { rows, mode: 'fit' });
  if (!fit) return false;
  if (!canEditObjects()) return false;
  writeDoc(live, fit.spec, { height: fit.height });
  return true;
}

/**
 * Write an edit to some columns, widening them to show what was typed — and
 * growing any wrapped row to its lines — unless the table has growth switched
 * off.
 *
 * One write for the text and the size together, so undoing a keystroke that
 * widened a column narrows it again in the same step. The growth is measured
 * on the document's table, not this person's filtered view of it.
 */
export function updateTableGrowing(node: TableNodeT, spec: TableSpec, touched: number[]): void {
  const live = liveNode(node.id) ?? node;
  const doc = splitEdit(node.id, live.table, spec);
  if (!doc || !canEditObjects()) return;
  if (doc.autoFit === false || !touched.length) {
    writeDoc(live, doc);
    return;
  }
  let next = doc;
  let width = widthFor(live, doc);
  const colFit = fitColumns(next, { width, rowH: rowHeightOf(live) }, measureFor(live), { columns: touched, mode: 'grow' });
  if (colFit) {
    next = colFit.spec;
    width = colFit.width;
  }
  const unit = rowHeightOf(live);
  const rowFit = fitRows(next, { width, height: unit * drawnWeight(next) }, measureFor(live), { mode: 'grow' });
  if (rowFit) next = rowFit.spec;
  writeDoc(live, next, { width, height: unit * drawnWeight(next) });
}

// ---------------------------------------------------------------------------
// CSV in and out
// ---------------------------------------------------------------------------

/** Ask for a CSV/TSV file and resolve to its text, or null if none was picked. */
export function pickDelimitedFile(): Promise<{ text: string; name: string } | null> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') return resolve(null);
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain';
    input.onchange = async () => {
      const file = input.files?.[0];
      resolve(file ? { text: await file.text(), name: file.name } : null);
    };
    input.click();
  });
}

/** A filename from the table's first header cell. */
export function tableFilename(spec: TableSpec): string {
  const head = spec.header ? spec.cells[0]?.find((c) => c.trim()) ?? '' : '';
  const slug = head.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return `${slug || 'table'}.csv`;
}

/**
 * Replace a table's contents with a CSV file, keeping its look.
 *
 * The theme, accent and type size survive — the person chose those — and the
 * columns arrive measured to their content, so nothing lands cut off.
 */
export async function importCsvIntoTable(node: TableNodeT): Promise<string> {
  const file = await pickDelimitedFile();
  if (!file) return '';
  const spec = tableFromCsv(file.text, { theme: node.table.theme, accent: node.table.accent, fontSize: node.table.fontSize });
  if (!spec) return `No table in ${file.name}`;
  const fit = fitColumns(spec, { width: widthFor(node, spec), rowH: rowHeightOf(node) }, measureFor(node));
  updateTable(node, fit?.spec ?? spec, fit ? { width: fit.width } : undefined, 'shared');
  return `Read ${spec.cells.length} rows from ${file.name}`;
}

/** A new table from a CSV file, placed at a point on the board, its columns fitted. */
export async function createTableFromCsvFile(at: { x: number; y: number }): Promise<string | null> {
  const file = await pickDelimitedFile();
  if (!file) return null;
  const spec = tableFromCsv(file.text);
  if (!spec) return null;
  const size = tableSizeFor(spec);
  const fit = fitColumns(spec, { width: size.width, rowH: TABLE_ROW_H }, tableMeasure(false));
  return createTable({ x: at.x, y: at.y, width: fit?.width ?? size.width, height: size.height }, fit?.spec ?? spec);
}

export function exportTableCsv(spec: TableSpec): void {
  downloadTableCsv(spec, tableFilename(spec));
}

export async function copyTableCsv(spec: TableSpec): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(tableToCsv(spec));
    return true;
  } catch {
    return false;
  }
}
