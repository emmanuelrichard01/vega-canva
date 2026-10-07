import { evaluateCell, isFormula, r1c1ToA1, shiftRefs } from './tableFormula';
import { cellStyleAt, formatCell, normRange, type CellRange } from './tableModel';
import { MAX_COLS, MAX_ROWS, type CellAlign, type CellStyle, type TableMerge, type TableSpec } from './tableTypes';

/**
 * Cells on the clipboard, in three dialects.
 *
 * - **`text/plain`** — tab-separated *values*, what a cell shows. What other
 *   apps paste, and what Sheets puts there.
 * - **`text/html`** — a `<table>` with each cell's formula in a data
 *   attribute, and bold, italic, colours, alignment and merges as markup — so
 *   formatting survives the trip to and from Sheets, Excel and Docs.
 * - **`application/x-vega-cells`** — the raw cells and their styles as JSON,
 *   for a paste back into a table on the board. It carries where the copy
 *   came from, so a pasted formula moves the way a spreadsheet moves it:
 *   `=A2*2` copied one row down becomes `=A3*2`.
 */

export const VEGA_CELLS = 'application/x-vega-cells';

export interface ClipCells {
  /** Raw text, formulas included. */
  cells: string[][];
  /** What each cell showed. */
  values: string[][];
  styles: Array<Array<CellStyle | null>>;
  merges: TableMerge[];
  /** The stored top-left the cells were copied from. */
  origin: { r: number; c: number };
}

/**
 * Stored rows of a table between two columns, as the clipboard carries them —
 * in the order given, which is the order the rows are drawn in.
 */
export function copyCells(spec: TableSpec, rows: number[], range: Pick<CellRange, 'c0' | 'c1'>): ClipCells {
  const { c0, c1 } = normRange({ r0: 0, r1: 0, ...range }, spec);
  const cells: string[][] = [];
  const values: string[][] = [];
  const styles: Array<Array<CellStyle | null>> = [];
  const contiguous = rows.every((r, i) => i === 0 || r === rows[i - 1] + 1);
  const r0 = rows[0] ?? 0;
  const r1 = rows[rows.length - 1] ?? 0;
  for (const r of rows) {
    cells.push(spec.cells[r].slice(c0, c1 + 1));
    values.push(spec.cells[r].slice(c0, c1 + 1).map((_, j) => shownValue(spec, r, c0 + j)));
    styles.push(spec.cells[r].slice(c0, c1 + 1).map((_, j) => cellStyleAt(spec, r, c0 + j) ?? null));
  }
  const merges = (contiguous ? spec.merges ?? [] : [])
    .filter((m) => m.r >= r0 && m.c >= c0 && m.r + m.rs - 1 <= r1 && m.c + m.cs - 1 <= c1)
    .map((m) => ({ ...m, r: m.r - r0, c: m.c - c0 }));
  return { cells, values, styles, merges, origin: { r: r0, c: c0 } };
}

/** What a cell shows, in words a plain-text paste can use: a ticked box is TRUE, a rating its digit. */
function shownValue(spec: TableSpec, r: number, c: number): string {
  const raw = spec.cells[r]?.[c] ?? '';
  const type = spec.columns[c]?.type;
  if (!isFormula(raw) && (type === 'checkbox' || type === 'rating' || type === 'select')) return raw;
  if (isFormula(raw)) {
    const v = evaluateCell(spec, r, c);
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  }
  return formatCell(spec, r, c);
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function clipToTsv(clip: ClipCells): string {
  return clip.values.map((row) => row.map((v) => v.replace(/[\t\n]/g, ' ')).join('\t')).join('\n');
}

/** The cells as an HTML table that spreadsheets and documents read with their formatting. */
export function clipToHtml(clip: ClipCells): string {
  const covered = new Set<string>();
  for (const m of clip.merges) for (let r = m.r; r < m.r + m.rs; r++) for (let c = m.c; c < m.c + m.cs; c++) if (r !== m.r || c !== m.c) covered.add(`${r}:${c}`);
  const rows = clip.values.map((row, r) =>
    `<tr>${row
      .map((v, c) => {
        if (covered.has(`${r}:${c}`)) return '';
        const s = clip.styles[r][c];
        const m = clip.merges.find((x) => x.r === r && x.c === c);
        const css: string[] = [];
        if (s?.bold) css.push('font-weight:bold');
        if (s?.italic) css.push('font-style:italic');
        if (s?.color) css.push(`color:${s.color}`);
        if (s?.fill) css.push(`background-color:${s.fill}`);
        if (s?.align) css.push(`text-align:${s.align}`);
        if (s?.wrap) css.push('white-space:normal');
        const raw = clip.cells[r][c];
        const attrs = [
          css.length ? ` style="${esc(css.join(';'))}"` : '',
          m && m.rs > 1 ? ` rowspan="${m.rs}"` : '',
          m && m.cs > 1 ? ` colspan="${m.cs}"` : '',
          isFormula(raw) ? ` data-sheets-formula="${esc(raw)}"` : '',
        ].join('');
        return `<td${attrs}>${esc(v)}</td>`;
      })
      .join('')}</tr>`
  );
  return `<meta charset="utf-8"><table>${rows.join('')}</table>`;
}

export interface PastedBlock {
  cells: string[][];
  styles: Array<Array<CellStyle | null>>;
  merges: TableMerge[];
}

/** The most cells a paste writes: the whole of the largest table, and no more. */
export const PASTE_CELL_LIMIT = MAX_ROWS * MAX_COLS;
const PASTE_MERGE_LIMIT = 1000;

/**
 * An HTML table off the clipboard — from Sheets, Excel, Docs or a web page —
 * as cells with their formatting, or null when there is no table in it.
 * Merged cells are expanded into the grid they cover, so a pasted block is
 * always rectangular.
 *
 * ## Hostile markup
 *
 * Clipboard HTML is text anyone can put there. A `rowspan="65534"` on every
 * cell asked for billions of grid entries and took the tab down. So every
 * span is clamped to what is left of the largest table (2,000 × 60) from
 * where it starts, rows and cells past that edge are dropped, the total cells
 * written stop at the table's capacity, and only the outer table's own rows
 * and cells are read — a `<table>` nested in a cell is that cell's text, not
 * more rows.
 *
 * ## Formulas from Sheets
 *
 * Sheets puts each formula in `data-sheets-formula`, in R1C1 notation
 * (`=R[0]C[-1]*2`). It is turned into A1 for the cell it lands in — `at` is
 * where the block's top-left cell is stored — or, when it cannot be, the cell
 * keeps the value it showed.
 */
export function parseHtmlTable(html: string, at: { r: number; c: number } = { r: 0, c: 0 }): PastedBlock | null {
  if (typeof DOMParser === 'undefined' || !/<table/i.test(html)) return null;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const table = doc.querySelector('table');
  if (!table) return null;
  const grid: Array<Array<{ text: string; style: CellStyle | null } | undefined>> = [];
  const merges: TableMerge[] = [];
  const trs = Array.from((table as HTMLTableElement).rows ?? []).slice(0, MAX_ROWS);
  let written = 0;
  let full = false;
  for (let r = 0; r < trs.length && !full; r++) {
    grid[r] = grid[r] ?? [];
    let c = 0;
    for (const td of Array.from((trs[r] as HTMLTableRowElement).cells ?? [])) {
      while (c < MAX_COLS && grid[r][c]) c++;
      if (c >= MAX_COLS) break;
      const rs = Math.max(1, Math.min(MAX_ROWS - r, Math.floor(Number(td.getAttribute('rowspan'))) || 1));
      const cs = Math.max(1, Math.min(MAX_COLS - c, Math.floor(Number(td.getAttribute('colspan'))) || 1));
      if (written + rs * cs > PASTE_CELL_LIMIT) {
        full = true;
        break;
      }
      written += rs * cs;
      const text = (td.textContent ?? '').replace(/ /g, ' ').replace(/\s*\n\s*/g, ' ').trim();
      const formula = td.getAttribute('data-sheets-formula');
      const value = formula && isFormula(formula) ? r1c1ToA1(formula, at.r + r, at.c + c) ?? text : text;
      const style = styleOfElement(td as HTMLElement);
      for (let i = 0; i < rs; i++) {
        const row = (grid[r + i] = grid[r + i] ?? []);
        for (let j = 0; j < cs; j++) {
          if (i === 0 && j === 0) row[c] = { text: value, style };
          else if (!row[c + j]) row[c + j] = { text: '', style: null };
        }
      }
      if (rs * cs > 1 && merges.length < PASTE_MERGE_LIMIT) merges.push({ r, c, rs, cs });
      c += cs;
    }
  }
  if (!grid.length) return null;
  const width = Math.min(MAX_COLS, Math.max(0, ...grid.map((row) => row.length)));
  if (width === 0) return null;
  return {
    cells: grid.map((row) => Array.from({ length: width }, (_, c) => row[c]?.text ?? '')),
    styles: grid.map((row) => Array.from({ length: width }, (_, c) => row[c]?.style ?? null)),
    merges,
  };
}

const ALIGNS: CellAlign[] = ['left', 'center', 'right'];

/** The formatting a cell's markup carries, read the way spreadsheets write it. */
function styleOfElement(el: HTMLElement): CellStyle | null {
  const s: CellStyle = {};
  const css = el.style;
  const weight = css.fontWeight;
  if (weight === 'bold' || Number(weight) >= 600 || el.querySelector('b,strong') || el.tagName === 'TH') s.bold = true;
  if (css.fontStyle === 'italic' || el.querySelector('i,em')) s.italic = true;
  const hex = (v: string) => {
    const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(v.trim());
    if (m) {
      if (m[4] !== undefined && Number(m[4]) === 0) return undefined;
      return `#${[m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
    }
    return /^#[0-9a-f]{3,8}$/i.test(v.trim()) ? v.trim().toUpperCase() : undefined;
  };
  const fill = hex(css.backgroundColor || el.getAttribute('bgcolor') || '');
  // White is the paper every table already has, not a choice to keep.
  if (fill && fill !== '#FFFFFF' && fill !== '#FFF') s.fill = fill;
  const color = hex(css.color || '');
  if (color && color !== '#000000' && color !== '#000') s.color = color;
  const align = (css.textAlign || el.getAttribute('align') || '').toLowerCase();
  if ((ALIGNS as string[]).includes(align)) s.align = align as CellAlign;
  if (css.whiteSpace === 'normal' || css.whiteSpace === 'pre-wrap') s.wrap = true;
  return Object.keys(s).length ? s : null;
}

export function encodeClip(clip: ClipCells): string {
  return JSON.stringify({ v: 1, ...clip });
}

export function decodeClip(json: string): ClipCells | null {
  try {
    const d = JSON.parse(json) as Partial<ClipCells> & { v?: number };
    if (d.v !== 1 || !Array.isArray(d.cells) || !Array.isArray(d.values) || !d.origin) return null;
    const cells = d.cells.slice(0, 2000).map((row) => (Array.isArray(row) ? row.slice(0, 60).map((v) => (typeof v === 'string' ? v : '')) : []));
    const values = d.values.slice(0, 2000).map((row) => (Array.isArray(row) ? row.slice(0, 60).map((v) => (typeof v === 'string' ? v : '')) : []));
    return {
      cells,
      values,
      styles: Array.isArray(d.styles) ? d.styles.slice(0, 2000).map((row) => (Array.isArray(row) ? row.slice(0, 60) : [])) : cells.map((row) => row.map(() => null)),
      merges: Array.isArray(d.merges) ? d.merges.slice(0, 200) : [],
      origin: { r: Number(d.origin.r) || 0, c: Number(d.origin.c) || 0 },
    };
  } catch {
    return null;
  }
}

/**
 * A copied block, as it lands at `(r, c)`: formulas moved by how far the
 * block travelled, or every cell its value when `valuesOnly` (Mod+Shift+V).
 */
export function clipForPaste(clip: ClipCells, at: { r: number; c: number }, valuesOnly: boolean): PastedBlock {
  const dr = at.r - clip.origin.r;
  const dc = at.c - clip.origin.c;
  return {
    cells: clip.cells.map((row, i) => row.map((raw, j) => (valuesOnly ? clip.values[i][j] ?? '' : isFormula(raw) ? `=${shiftRefs(raw.slice(1), dr, dc)}` : raw))),
    styles: valuesOnly ? clip.cells.map((row) => row.map(() => null)) : clip.styles,
    merges: valuesOnly ? [] : clip.merges,
  };
}
