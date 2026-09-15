import { nanoid } from 'nanoid';
import { editor } from '../api/EditorAPI';
import { nextZIndex } from '../document/mutations';
import type { AnyNode } from '../model/schema';
import { downloadTableCsv, tableFromCsv, tableToCsv, viewRows } from './tableModel';
import type { TableSpec } from './tableTypes';

/**
 * Creating and editing table nodes, through `EditorAPI` like every other
 * write — so a table lands on top, carries its authorship, joins the undo
 * history as one step per edit and is refused for a read-only session.
 */

/** One row, at the default type size: comfortable to read and to click into. */
export const TABLE_ROW_H = 36;
export const TABLE_COL_W = 150;
export const TABLE_MIN_SIZE = { width: 160, height: 72 };

/** The box a spec wants, at the default row height and column width. */
export function tableSizeFor(spec: TableSpec): { width: number; height: number } {
  const weights = spec.columns.reduce((a, c) => a + c.width, 0);
  return {
    width: Math.round(Math.max(TABLE_MIN_SIZE.width, weights * TABLE_COL_W)),
    height: Math.round(Math.max(TABLE_MIN_SIZE.height, viewRows(spec).length * TABLE_ROW_H)),
  };
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
 * Write a new spec, growing or shrinking the box by whole rows.
 *
 * Rows share the node's height, so adding one without growing the box would
 * squeeze every row to make room — a table that gets harder to read the more
 * you put in it. Keeping the row height instead means the table grows down by
 * exactly one row, the way it does in every document editor.
 */
export function updateTable(node: Extract<AnyNode, { type: 'table' }>, spec: TableSpec): void {
  const before = Math.max(1, viewRows(node.table).length);
  const after = Math.max(1, viewRows(spec).length);
  const patch: Record<string, unknown> = { table: spec };
  if (before !== after) patch.height = Math.max(TABLE_MIN_SIZE.height / 2, (node.height / before) * after);
  editor.updateNode(node.id, patch as never);
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
 * box keeps its width while its height follows the new row count, so the
 * import lands where the table was rather than somewhere new.
 */
export async function importCsvIntoTable(node: Extract<AnyNode, { type: 'table' }>): Promise<string> {
  const file = await pickDelimitedFile();
  if (!file) return '';
  const spec = tableFromCsv(file.text, { theme: node.table.theme, accent: node.table.accent, fontSize: node.table.fontSize });
  if (!spec) return `No table in ${file.name}`;
  updateTable(node, spec);
  return `Read ${spec.cells.length} rows from ${file.name}`;
}

/** A new table from a CSV file, placed at a point on the board. */
export async function createTableFromCsvFile(at: { x: number; y: number }): Promise<string | null> {
  const file = await pickDelimitedFile();
  if (!file) return null;
  const spec = tableFromCsv(file.text);
  if (!spec) return null;
  const size = tableSizeFor(spec);
  return createTable({ x: at.x, y: at.y, ...size }, spec);
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
