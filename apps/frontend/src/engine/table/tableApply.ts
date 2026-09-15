import { nanoid } from 'nanoid';
import { editor } from '../api/EditorAPI';
import { nextZIndex } from '../document/mutations';
import type { AnyNode } from '../model/schema';
import { fitColumns } from './tableFit';
import { tableMeasure } from './tableMeasure';
import { downloadTableCsv, tableFromCsv, tableToCsv, viewRows } from './tableModel';
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

const weightSum = (spec: TableSpec) => spec.columns.reduce((a, c) => a + c.width, 0);
const measureFor = (node: TableNodeT) => tableMeasure(Boolean(node.appearance?.sketch));

/** The box a spec wants, at the default row height and column width. */
export function tableSizeFor(spec: TableSpec): { width: number; height: number } {
  return {
    width: Math.round(Math.max(TABLE_MIN_SIZE.width, weightSum(spec) * TABLE_COL_W)),
    height: Math.round(Math.max(TABLE_MIN_SIZE.height, viewRows(spec).length * TABLE_ROW_H)),
  };
}

/** The height one drawn row takes on this node. */
export const rowHeightOf = (node: TableNodeT) => node.height / Math.max(1, viewRows(node.table).length);

/**
 * The width a node should have for a new spec.
 *
 * Unchanged — unless the column count changed, and then the table grows or
 * shrinks by exactly those columns. Column widths are shares of the node's
 * width, so adding one without widening the box would squeeze every other
 * column to make room, cutting text that fitted a moment ago. Rows have always
 * followed this rule; columns follow it now too.
 */
export function widthFor(node: TableNodeT, spec: TableSpec): number {
  const before = weightSum(node.table);
  if (spec.columns.length === node.table.columns.length || !(before > 0)) return node.width;
  return Math.max(TABLE_MIN_SIZE.width / 2, (node.width / before) * weightSum(spec));
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
  return id;
}

/**
 * Write a new spec, growing or shrinking the box by whole rows and columns.
 *
 * Rows share the node's height, so adding one without growing the box would
 * squeeze every row to make room — a table that gets harder to read the more
 * you put in it. Keeping the row height instead means the table grows down by
 * exactly one row, the way it does in every document editor; `widthFor` is
 * the same rule across. `extra.width` overrides it for callers that sized the
 * columns themselves (a fit, a resize of the last column).
 */
export function updateTable(node: TableNodeT, spec: TableSpec, extra?: { width?: number }): void {
  const before = Math.max(1, viewRows(node.table).length);
  const after = Math.max(1, viewRows(spec).length);
  const patch: Record<string, unknown> = { table: spec };
  if (before !== after) patch.height = Math.max(TABLE_MIN_SIZE.height / 2, (node.height / before) * after);
  const width = extra?.width ?? widthFor(node, spec);
  if (Math.abs(width - node.width) > 0.5) patch.width = width;
  editor.updateNode(node.id, patch as never);
}

/**
 * Size columns to their content, as one undo step. `false` when every column
 * already fits, so a caller can say so instead of writing nothing.
 */
export function fitTableColumns(node: TableNodeT, columns?: number[], mode: 'fit' | 'grow' = 'fit'): boolean {
  const fit = fitColumns(node.table, { width: node.width, rowH: rowHeightOf(node) }, measureFor(node), { columns, mode });
  if (!fit) return false;
  updateTable(node, fit.spec, { width: fit.width });
  return true;
}

/**
 * Write an edit to some columns, widening them to show what was typed —
 * unless the table has growth switched off.
 *
 * One write for the text and the width together, so undoing a keystroke that
 * widened a column narrows it again in the same step.
 */
export function updateTableGrowing(node: TableNodeT, spec: TableSpec, touched: number[]): void {
  if (spec.autoFit !== false && touched.length) {
    const fit = fitColumns(spec, { width: widthFor(node, spec), rowH: rowHeightOf(node) }, measureFor(node), {
      columns: touched,
      mode: 'grow',
    });
    if (fit) {
      updateTable(node, fit.spec, { width: fit.width });
      return;
    }
  }
  updateTable(node, spec);
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
  updateTable(node, fit?.spec ?? spec, fit ? { width: fit.width } : undefined);
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
