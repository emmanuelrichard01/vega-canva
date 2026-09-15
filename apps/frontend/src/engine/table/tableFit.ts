import { layoutTable } from './tableLayout';
import { viewRows } from './tableModel';
import type { TableSpec } from './tableTypes';

/**
 * Columns sized to what is in them.
 *
 * ## Why measured, not counted
 *
 * The CSV import used to size columns by character count, which is a guess:
 * "WWW" and "iii" are both three characters and one is three times wider. The
 * board decides whether text is cut by `measureText` with the real font, so a
 * fit that is not measured the same way either leaves a column too wide or
 * — worse — one pixel short, and the renderer cuts the last letter for an
 * ellipsis. So the fit asks the same questions the renderer does: the same
 * layout (for type size, padding, bold headers, the sort mark) and a measure
 * that is handed in, the canvas's in the browser (`tableMeasure.ts`) and an
 * approximation in tests.
 *
 * ## Two modes
 *
 * **Fit** sizes each column to its widest value, narrowing as well as
 * widening — the "double-click the edge" of every spreadsheet. **Grow** only
 * ever widens, and only up to `GROW_MAX`: it runs after typing, where a column
 * somebody narrowed on purpose must not snap back because of a short value,
 * and a pasted paragraph must not throw the table across the board.
 *
 * Either way only the named columns change; the others keep their width in
 * pixels and the *table* gets wider or narrower. Squeezing the neighbours to
 * make room would cut the text the fit just revealed somewhere else.
 */

/** The width of `text` set at `size` px, in that weight and slant. */
export type Measure = (text: string, bold: boolean, italic: boolean, size: number) => number;

/** Inter's average advance — for tests, and wherever there is no canvas. */
export const approxMeasure: Measure = (text, bold, _italic, size) => text.length * size * (bold ? 0.6 : 0.56);

/** Narrowest a fitted column goes: a short number and its padding. */
export const FIT_MIN = 56;
/** Widest a column is fitted to. Past this a value is a paragraph, and a table of paragraphs is a document. */
export const FIT_MAX = 480;
/** Widest typing grows a column on its own — growth nobody asked for stays modest. */
export const GROW_MAX = 360;
/**
 * A fitted table's weights are its widths over this — the table tool's column
 * width — so weights keep reading as "about one column" and stay inside the
 * range `normalizeTableSpec` allows.
 */
const UNIT = 150;

export interface FitResult {
  spec: TableSpec;
  /** The node's new width: the sum of the columns. */
  width: number;
}

/**
 * The width each column needs to show every value whole — or `null` for a
 * column with nothing in it, which a fit leaves alone rather than collapsing.
 */
export function contentWidths(spec: TableSpec, box: { width: number; rowH: number }, measure: Measure): Array<number | null> {
  // Every stored row, not only those the filter shows: a fit that ignored the
  // hidden rows would cut them the moment the filter came off.
  const all: TableSpec = { ...spec, filter: undefined };
  const layout = layoutTable(all, box.width, box.rowH * Math.max(1, viewRows(all).length));
  const need: Array<number | null> = spec.columns.map(() => null);
  for (const cell of layout.cells) {
    // A merge across columns belongs to none of them.
    if (Math.abs(cell.w - layout.colW[cell.c]) > 0.5) continue;
    if (!cell.text && !cell.sort && !cell.filtered) continue;
    const mark = cell.sort || cell.filtered ? layout.fontSize * 0.9 : 0;
    // +2: the renderer's test is `width <= room`, and a fit that lands exactly
    // on the edge is one sub-pixel rounding away from an ellipsis.
    const w = measure(cell.text, cell.bold, cell.italic, layout.fontSize) + layout.padX * 2 + mark + 2;
    need[cell.c] = Math.max(need[cell.c] ?? 0, w);
  }
  return need;
}

/**
 * Size columns to their content. `null` when nothing would change, so a
 * caller never writes an undo step that does nothing.
 */
export function fitColumns(
  spec: TableSpec,
  box: { width: number; rowH: number },
  measure: Measure,
  opts: { columns?: number[]; mode?: 'fit' | 'grow' } = {}
): FitResult | null {
  const mode = opts.mode ?? 'fit';
  const total = spec.columns.reduce((a, c) => a + c.width, 0) || 1;
  const px = spec.columns.map((c) => (box.width * c.width) / total);
  const need = contentWidths(spec, box, measure);
  const which = new Set(opts.columns ?? spec.columns.map((_, i) => i));

  let changed = false;
  const next = px.map((w, c) => {
    const n = need[c];
    if (!which.has(c) || n === null) return w;
    const target =
      mode === 'grow' ? (n > w + 0.5 ? Math.max(w, Math.min(Math.ceil(n), GROW_MAX)) : w) : Math.min(FIT_MAX, Math.max(FIT_MIN, Math.ceil(n)));
    if (Math.abs(target - w) > 0.5) changed = true;
    return target;
  });
  if (!changed) return null;

  const weights = next.map((w) => Math.min(20, Math.max(0.2, Math.round((w / UNIT) * 10000) / 10000)));
  return {
    spec: { ...spec, columns: spec.columns.map((col, i) => ({ ...col, width: weights[i] })) },
    width: Math.round(weights.reduce((a, b) => a + b, 0) * UNIT * 100) / 100,
  };
}
