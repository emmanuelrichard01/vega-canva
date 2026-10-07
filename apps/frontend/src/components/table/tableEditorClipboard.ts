import * as M from '../../engine/table/tableModel';
import { isFormula, shiftRefs } from '../../engine/table/tableFormula';
import { clipForPaste, decodeClip, parseHtmlTable, VEGA_CELLS, type PastedBlock } from '../../engine/table/tableClipboard';
import type { TableSpec } from '../../engine/table/tableTypes';
import type { SheetRange } from '../sheet/useSheet';
import { span } from './tableEditorParts';

/**
 * What a paste does to a table, as pure functions of the spec — the editor
 * calls these and writes the result once, so a paste is one undo step and can
 * be tested without a grid.
 */

/** More merges than any real sheet has; a paste carrying more keeps the first. */
const MERGE_LIMIT = 200;

export type PasteOutcome =
  | { spec: TableSpec; range: SheetRange; touched: number[] }
  /** The block is longer than a sorted or filtered view has rows for: ask first. */
  | { pending: true };

/**
 * A block written in from a drawn cell. In an unsorted, unfiltered table the
 * drawn rows are the stored rows and the table grows to take the block, its
 * styles and merges with it — the styles map built once for the whole block.
 * In a view, rows map through the view's order, and a block longer than the
 * view waits for a decision rather than losing its last rows.
 */
export function pasteBlock(s: TableSpec, vr: number, c: number, block: PastedBlock): PasteOutcome {
  const width = Math.max(1, ...block.cells.map((line) => line.length));
  const touched = span(c, c + width - 1);
  const range = { r0: vr, c0: c, r1: vr + block.cells.length - 1, c1: c + width - 1 };
  if (M.isIdentityView(s)) {
    let next = M.setBlock(s, vr, c, block.cells);
    const entries: Array<[number, number, NonNullable<PastedBlock['styles'][number][number]>]> = [];
    block.styles.forEach((line, i) =>
      line.forEach((st, j) => {
        if (st) entries.push([vr + i, c + j, st]);
      })
    );
    if (entries.length) next = M.styleCells(next, entries);
    for (const m of block.merges.slice(0, MERGE_LIMIT)) next = M.mergeRange(next, { r0: vr + m.r, c0: c + m.c, r1: vr + m.r + m.rs - 1, c1: c + m.c + m.cs - 1 });
    return { spec: next, range, touched };
  }
  const order = M.viewRows(s);
  if (vr + block.cells.length > order.length) return { pending: true };
  const edits: Array<[number, number, string]> = [];
  block.cells.forEach((line, i) => {
    const r = order[vr + i];
    line.forEach((text, j) => {
      if (c + j < s.columns.length) edits.push([r, c + j, text]);
    });
  });
  return { spec: M.setCells(s, edits), range, touched };
}

/**
 * A paste with more than text: cells copied from a table on the board (their
 * formulas moved by how far they travelled), or a table from a spreadsheet or
 * a web page with its formatting — Sheets' R1C1 formulas turned into A1 for
 * where they land. Null falls back to the plain paste.
 */
export function readClipboardBlock(data: DataTransfer, s: TableSpec, range: SheetRange, valuesOnly: boolean): PastedBlock | null {
  const order = M.viewRows(s);
  const at = { r: order[range.r0] ?? s.cells.length, c: range.c0 };
  let json = '';
  try {
    json = data.getData(VEGA_CELLS);
  } catch {
    json = '';
  }
  const clip = json ? decodeClip(json) : null;
  if (clip) {
    // One cell into a selected range fills it, each copy moved to its own place.
    if (clip.cells.length === 1 && clip.cells[0].length === 1 && (range.r1 > range.r0 || range.c1 > range.c0)) {
      const raw = clip.cells[0][0];
      const cells = span(range.r0, range.r1).map((vr) =>
        span(range.c0, range.c1).map((c) => {
          if (valuesOnly) return clip.values[0][0];
          const r = order[vr] ?? vr;
          return isFormula(raw) ? `=${shiftRefs(raw.slice(1), r - clip.origin.r, c - clip.origin.c)}` : raw;
        })
      );
      return { cells, styles: cells.map((line) => line.map(() => (valuesOnly ? null : clip.styles[0]?.[0] ?? null))), merges: [] };
    }
    return clipForPaste(clip, at, valuesOnly);
  }
  if (valuesOnly) return null;
  const html = data.getData('text/html');
  return html ? parseHtmlTable(html, at) : null;
}
