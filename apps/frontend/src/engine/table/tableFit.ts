import { drawnWeight, layoutTable, WRAP_LEADING, wrapLines, type TableCellBox } from './tableLayout';
import type { TableSpec } from './tableTypes';

/**
 * Columns sized to what is in them, and wrapped rows to their lines.
 *
 * ## Why measured, not counted
 *
 * Sizing by character count is a guess: "WWW" and "iii" are both three
 * characters and one is three times wider. The board decides whether text is
 * cut by `measureText` with the real font, so a fit that is not measured the
 * same way either leaves a column too wide or — worse — one pixel short, and
 * the renderer cuts the last letter for an ellipsis. So the fit asks the same
 * questions the renderer does: the same layout (for type size, padding, bold
 * headers, the sort mark) and a measure that is handed in, the canvas's in the
 * browser (`tableMeasure.ts`) and an approximation in tests.
 *
 * ## Two modes
 *
 * **Fit** sizes each track to its content, narrowing as well as widening —
 * the "double-click the edge" of every spreadsheet. **Grow** only ever
 * widens, and only up to `GROW_MAX`: it runs after typing, where a column
 * somebody narrowed on purpose must not snap back because of a short value,
 * and a pasted paragraph must not throw the table across the board.
 *
 * Either way only the named tracks change; the others keep their size in
 * pixels and the *table* gets bigger or smaller. Squeezing the neighbours to
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

/** What a rich cell draws beside or instead of its text, in px at the layout's type size. */
export function decorationWidth(cell: TableCellBox, fontSize: number, measure: Measure): number {
  switch (cell.kind) {
    case 'checkbox':
      return fontSize * 1.15;
    case 'rating':
      return fontSize * 1.05 * 5;
    case 'person':
      return fontSize * 1.55;
    case 'select':
      return (cell.tags ?? []).reduce((a, t) => a + measure(t.label, false, false, fontSize * 0.88) + fontSize * 1.3, 0) - measure(cell.text, cell.bold, cell.italic, fontSize);
    default:
      return 0;
  }
}

/**
 * The width each column needs to show every value whole — or `null` for a
 * column with nothing in it, or one whose text wraps, which a fit leaves
 * alone: a wrapped column grows downwards, not across.
 */
export function contentWidths(spec: TableSpec, box: { width: number; rowH: number }, measure: Measure): Array<number | null> {
  // Every stored row, not only those the filters show: a fit that ignored the
  // hidden rows would cut them the moment the filter came off.
  const all: TableSpec = { ...spec, filters: undefined, rowHeights: undefined };
  const layout = layoutTable(all, box.width, box.rowH * drawnWeight(all));
  const need: Array<number | null> = spec.columns.map(() => null);
  const wrapped = new Set<number>();
  for (const cell of layout.cells) {
    if (cell.c < 0 || spec.columns[cell.c]?.hidden) continue;
    // A merge across columns belongs to none of them.
    if (Math.abs(cell.w - layout.colW[cell.c]) > 0.5) continue;
    if (cell.wrap) {
      wrapped.add(cell.c);
      continue;
    }
    const text = cell.footer ? `${cell.footer.label} ${cell.text}` : cell.text;
    if (!text && !cell.sort && !cell.filtered && !cell.kind) continue;
    const mark = cell.sort || cell.filtered ? layout.fontSize * 0.9 : 0;
    // +2: the renderer's test is `width <= room`, and a fit that lands exactly
    // on the edge is one sub-pixel rounding away from an ellipsis.
    const w = measure(text, cell.bold, cell.italic, layout.fontSize) + decorationWidth(cell, layout.fontSize, measure) + layout.padX * 2 + mark + 2;
    need[cell.c] = Math.max(need[cell.c] ?? 0, w);
  }
  for (const c of wrapped) need[c] = null;
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
  const total = spec.columns.reduce((a, c) => a + (c.hidden ? 0 : c.width), 0) || 1;
  const px = spec.columns.map((c) => (c.hidden ? 0 : (box.width * c.width) / total));
  const need = contentWidths(spec, box, measure);
  const which = new Set(opts.columns ?? spec.columns.map((_, i) => i));

  let changed = false;
  const next = px.map((w, c) => {
    const n = need[c];
    if (!which.has(c) || n === null || spec.columns[c].hidden) return w;
    const target =
      mode === 'grow' ? (n > w + 0.5 ? Math.max(w, Math.min(Math.ceil(n), GROW_MAX)) : w) : Math.min(FIT_MAX, Math.max(FIT_MIN, Math.ceil(n)));
    if (Math.abs(target - w) > 0.5) changed = true;
    return target;
  });
  if (!changed) return null;

  const weights = next.map((w, c) => (spec.columns[c].hidden ? spec.columns[c].width : Math.min(20, Math.max(0.2, Math.round((w / UNIT) * 10000) / 10000))));
  return {
    spec: { ...spec, columns: spec.columns.map((col, i) => ({ ...col, width: weights[i] })) },
    width: Math.round(weights.reduce((a, b, i) => a + (spec.columns[i].hidden ? 0 : b), 0) * UNIT * 100) / 100,
  };
}

export interface RowFitResult {
  spec: TableSpec;
  /** The node's new height. */
  height: number;
}

/**
 * Size wrapped rows to their lines.
 *
 * A row's share of the height becomes what its tallest wrapped cell needs, in
 * standard rows. **Grow** only raises a row (after typing); **fit** sets it
 * exactly, which is what a double-click on a row's edge asks for. Rows with
 * nothing wrapped keep their height.
 */
export function fitRows(
  spec: TableSpec,
  box: { width: number; height: number },
  measure: Measure,
  opts: { rows?: number[]; mode?: 'fit' | 'grow' } = {}
): RowFitResult | null {
  const mode = opts.mode ?? 'grow';
  const layout = layoutTable(spec, box.width, box.height);
  const unit = layout.rowH;
  const need = new Map<number, number>();
  for (const cell of layout.cells) {
    if (!cell.wrap || cell.r < 0 || !cell.text) continue;
    if (opts.rows && !opts.rows.includes(cell.r)) continue;
    const room = Math.max(4, cell.w - layout.padX * 2);
    const lines = wrapLines(cell.text, room, (s) => measure(s, cell.bold, cell.italic, layout.fontSize)).length;
    const px = lines * layout.fontSize * WRAP_LEADING + layout.fontSize * 0.9;
    need.set(cell.r, Math.max(need.get(cell.r) ?? 0, px / unit));
  }
  if (need.size === 0) return null;
  const hs = Array.from({ length: spec.cells.length }, (_, r) => spec.rowHeights?.[r] ?? 1);
  let changed = false;
  for (const [r, weight] of need) {
    const target = Math.min(20, Math.max(1, Math.round(weight * 100) / 100));
    const next = mode === 'grow' ? Math.max(hs[r], target) : target;
    if (Math.abs(next - hs[r]) > 0.01) {
      hs[r] = next;
      changed = true;
    }
  }
  if (!changed) return null;
  const nextSpec: TableSpec = { ...spec, rowHeights: hs.some((h) => h !== 1) ? hs : undefined };
  return { spec: nextSpec, height: unit * drawnWeight(nextSpec) };
}
