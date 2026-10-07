import React from 'react';
import { createPortal } from 'react-dom';
import {
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  ArrowDownToLine,
  ArrowDownWideNarrow,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpNarrowWide,
  ArrowUpToLine,
  Baseline,
  BetweenHorizontalEnd,
  BetweenHorizontalStart,
  BetweenVerticalEnd,
  BetweenVerticalStart,
  Bold,
  ChartColumn,
  Check,
  ChevronDown,
  Columns3,
  Eraser,
  Eye,
  Funnel,
  Italic,
  PaintBucket,
  PanelBottom,
  Plus,
  Rows3,
  Sigma,
  Snowflake,
  TableCellsMerge,
  TableCellsSplit,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignStart,
  TextWrap,
  Trash2,
  UnfoldHorizontal,
  UnfoldVertical,
} from 'lucide-react';
import './table.css';
import './tableTools.css';
import { useStore } from '../../hooks/useStore';
import { cameraSystem } from '../../engine/CameraSystem';
import { engineEvents } from '../../engine/EventBus';
import { textEditing } from '../../engine/interaction/textEditing';
import { undoManager } from '../../engine/document';
import { collaboratorStore } from '../../engine/presence/collaboratorStore';
import { createChartFromTableRange } from '../../engine/chart/chartFromTable';
import { layoutTable, rowAtY, type TableCellBox } from '../../engine/table/tableLayout';
import { checkboxHit, ratingHit } from '../../engine/table/tablePaint';
import { paintMeasure, tableMeasure } from '../../engine/table/tableMeasure';
import { tableToSvg } from '../../engine/table/tableSvg';
import { ensureTableRegistry } from '../../engine/table/tableRegistry';
import * as M from '../../engine/table/tableModel';
import { fitTableColumns, fitTableRows, rowHeightOf, updateTable, updateTableGrowing } from '../../engine/table/tableApply';
import {
  FORMULA_FUNCTIONS,
  formulaError,
  isFormula,
  referencesIn,
  refNameIn,
  rowLabel as labelOfRow,
  shiftRefs,
  storedOf,
} from '../../engine/table/tableFormula';
import { clipForPaste, clipToHtml, clipToTsv, copyCells, decodeClip, encodeClip, parseHtmlTable, VEGA_CELLS, type PastedBlock } from '../../engine/table/tableClipboard';
import {
  CELL_TYPES,
  CELL_TYPE_LABELS,
  filterOn,
  refsSkipHeader,
  SUMMARY_LABELS,
  type CellAlign,
  type CellStyle,
  type CellType,
  type CellVAlign,
  type SummaryAgg,
  type TableSpec,
} from '../../engine/table/tableTypes';
import type { TableNode } from '../../engine/model/schema';
import { PORTAL_SURFACE_ATTR } from '../ui/portalSurface';
import { ColorPickerPopover } from '../ui/ColorPickerPopover';
import { Menu, type MenuAnchor } from '../menu/Menu';
import type { MenuEntry } from '../menu/menuModel';
import { columnLetter, useSheet, type SheetPos, type SheetRange } from '../sheet/useSheet';
import { columnMenuEntries, setSummary, TYPE_ICONS } from './columnMenu';
import { FilterPanel } from './FilterPanel';
import { CellPicker, type PickerChoice } from './CellPicker';
import { MenuItem, Sep, Tool } from './tableControls';
import { colourName, FILLS, INKS } from './tableColours';

/**
 * A table's cells, open for editing where the table is.
 *
 * ## In place, not in a dialog
 *
 * Every tool this is measured against — FigJam, Miro, Lucidchart, Notion —
 * edits a table on the page. So the editor is a DOM grid laid exactly over
 * the node: the same `layoutTable` the canvas draws, scaled by the camera, so
 * every cell sits on its own drawn cell. The canvas keeps drawing every cell —
 * text, ticks, stars, pills — and this layer adds only what is interaction:
 * the selection, the input, the gutters, the fill handle, the pickers.
 *
 * ## Structure is direct, not a trip to a toolbar
 *
 * - **A `+` on every boundary.** A lane above the column letters and one
 *   beside the row numbers carries a faint dot at each boundary, which opens
 *   into a `+` as the pointer arrives and draws the line where the new row or
 *   column will go. Strips along the right and bottom edges add one at the
 *   end — FigJam's and Miro's grammar.
 * - **Drag to reorder.** Select a whole column or row by its letter or number,
 *   then drag it; a line shows where it will land (`M.moveCols`).
 * - **The column menu** — the caret on a letter, or Alt+↓ — holds the
 *   column's type, sort, filter, summary and structure in one place.
 * - **The fill handle** at the selection's corner continues a series, as in
 *   every spreadsheet; Ctrl+D and Ctrl+R fill down and right.
 *
 * ## Formulas
 *
 * A cell that starts with `=` is a formula (`tableFormula.ts`). The formula
 * bar under the toolbar shows the focused cell's source and edits it; while
 * one is being typed, the cells it reads are outlined in colour, a click or a
 * drag on the grid writes a reference instead of leaving the cell, and a panel
 * beside the cell suggests functions, shows the signature of the one the
 * caret is in, and previews the result before it is committed.
 *
 * ## Cost
 *
 * The editor re-renders on every camera frame to stay on its table, so the
 * grid is a memoised component fed only the rows near the viewport. Panning
 * a two-thousand-row table moves one element; it does not rebuild sixteen
 * thousand.
 */

/**
 * Screen px from the grid's top edge to the far side of the insert lane above
 * the column letters — table.css: gutter gap + gutter + lane gap + lane.
 */
const GUTTER_REACH = 50;
/** The same, leftwards: past the row numbers and their insert lane. */
const ROW_GUTTER_REACH = 56;
/** Screen px the add-a-row strip reaches below the grid. */
const BELOW_REACH = 22;
/** Air between the chrome and the toolbar. */
const CLEARANCE = 14;
/** The toolbar's two rows: tools, then the formula bar. */
const BAR_H = 84;
/** World px per width unit — the table tool's column width — when a drag turns shares into widths. */
const UNIT = 150;
/** Rows rendered at a time, in whole chunks, so a pan re-renders the grid only when it crosses one. */
const CHUNK = 24;

/** The colours references are outlined in, in order of appearance — as every spreadsheet does. */
const REF_COLORS = ['#2563EB', '#DC2626', '#059669', '#9333EA', '#EA580C', '#0891B2'];
const QUICK_FUNCTIONS = ['SUM', 'AVERAGE', 'COUNT', 'MIN', 'MAX'];

type Axis = 'col' | 'row';
type Pop = 'fill' | 'ink' | 'valign' | 'format' | 'fx' | 'sort' | 'filter' | 'struct' | null;

interface MenuState {
  kind: Axis | 'cell';
  /** Drawn rows and columns the menu acts on. */
  r0: number;
  r1: number;
  c0: number;
  c1: number;
  x: number;
  y: number;
}

interface CellHandlers {
  down: (cell: TableCellBox, e: React.PointerEvent) => void;
  enter: (cell: TableCellBox) => void;
  click: (cell: TableCellBox, e: React.MouseEvent) => void;
  dbl: (cell: TableCellBox) => void;
  menu: (cell: TableCellBox, e: React.MouseEvent) => void;
}

const span = (a: number, b: number) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i);

/** The function call the caret is inside, and which argument — for the signature hint. */
function callAt(text: string): { name: string; arg: number } | null {
  let depth = 0;
  let arg = 0;
  let inString = false;
  for (let i = text.length - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === ')') depth++;
    else if (ch === '(') {
      if (depth === 0) {
        const m = /([A-Za-z][A-Za-z0-9.]*)$/.exec(text.slice(0, i));
        return m ? { name: m[1].toUpperCase(), arg } : null;
      }
      depth--;
    } else if ((ch === ',' || ch === ';') && depth === 0) arg++;
  }
  return null;
}

/** A link a cell holds, if it is one a browser may open: http and https only. */
const safeHref = (text: string) => (/^https?:\/\/[^\s]+$/i.test(text.trim()) ? text.trim() : null);

export const TableEditor: React.FC<{ nodeId: string; onClose: () => void }> = ({ nodeId, onClose }) => {
  const node = useStore((s) => s.objects[nodeId]);
  React.useEffect(() => {
    if (!node || node.type !== 'table') onClose();
  }, [node, onClose]);
  if (!node || node.type !== 'table') return null;
  return <Editor node={node} onClose={onClose} />;
};

ensureTableRegistry();

const Editor: React.FC<{ node: TableNode; onClose: () => void }> = ({ node, onClose }) => {
  // Announced as an edit, like typing into text: the transform handles step
  // back while the cells are open — see `textEditing`.
  React.useEffect(() => {
    textEditing.begin(node.id);
    return () => textEditing.end(node.id);
  }, [node.id]);

  const [, reposition] = React.useState(0);
  React.useEffect(() => {
    const again = () => reposition((n) => n + 1);
    engineEvents.on('CameraChanged', again);
    window.addEventListener('resize', again);
    return () => {
      engineEvents.off('CameraChanged', again);
      window.removeEventListener('resize', again);
    };
  }, []);

  const spec = node.table;
  const skip = refsSkipHeader(spec);
  /** Column shares while an edge is being dragged, and the table width while the last one is. */
  const [widths, setWidths] = React.useState<number[] | null>(null);
  const [liveWidth, setLiveWidth] = React.useState<number | null>(null);
  /** Row shares while a row's edge is being dragged, and the table height with them. */
  const [heights, setHeights] = React.useState<number[] | null>(null);
  const [liveHeight, setLiveHeight] = React.useState<number | null>(null);
  const shown: TableSpec = React.useMemo(() => {
    let s = spec;
    if (widths) s = { ...s, columns: s.columns.map((c, i) => ({ ...c, width: widths[i] ?? c.width })) };
    if (heights) s = { ...s, rowHeights: heights };
    return s;
  }, [spec, widths, heights]);
  const tableW = liveWidth ?? node.width;
  const tableH = liveHeight ?? node.height;
  const layout = React.useMemo(() => layoutTable(shown, tableW, tableH), [shown, tableW, tableH]);
  const cellAt = React.useMemo(() => {
    const m = new Map<number, TableCellBox>();
    for (const cell of layout.cells) m.set(cell.vr * 4096 + cell.c, cell);
    return m;
  }, [layout]);
  const rows = layout.rows;
  const cols = spec.columns.length;
  const identity = M.isIdentityView(spec);
  /** The first row that can move or be inserted before: the header stays on top. */
  const floor = spec.header ? 1 : 0;
  const measure = React.useMemo(() => paintMeasure(Boolean(node.appearance?.sketch)), [node.appearance?.sketch]);

  const rowTop = (vr: number) => (vr <= rows.length ? layout.rowY[Math.max(0, vr)] : layout.rowY[rows.length]);
  const rowHt = (vr: number) => layout.rowHs[vr] ?? layout.rowH;

  // ---- placement ------------------------------------------------------------

  const zoom = cameraSystem.zoom || 1;
  const stage = document.querySelector('.konvajs-content')?.getBoundingClientRect();
  const left = (stage?.left ?? 0) + node.x * zoom + cameraSystem.x;
  const top = (stage?.top ?? 0) + node.y * zoom + cameraSystem.y;
  // The bar stands clear of the *chrome*, not the table: the insert lane and
  // the column letters reach GUTTER_REACH screen px above the grid (they hold
  // one screen size at every zoom — see table.css). Below the table it
  // clears the add-a-row strip instead.
  const above = top - GUTTER_REACH - CLEARANCE - BAR_H;
  const barTop = above < 8 ? top + tableH * zoom + BELOW_REACH + CLEARANCE : above;
  // The board's free area, between the side panels. The editor is a board
  // layer, so the panels sit above it and would cover anything placed under
  // them; the toolbar and the formula help keep inside this span instead.
  const sidePanels = Array.from(document.querySelectorAll<HTMLElement>('.hierarchy-panel, .context-inspector'))
    .map((el) => el.getBoundingClientRect())
    .filter((r) => r.width > 0 && r.height > 0);
  const freeLeft = Math.max(8, ...sidePanels.filter((r) => r.left < window.innerWidth / 2).map((r) => r.right + 8));
  const freeRight = Math.min(window.innerWidth - 8, ...sidePanels.filter((r) => r.left >= window.innerWidth / 2).map((r) => r.left - 8));
  const barRef = React.useRef<HTMLDivElement>(null);
  const barWidth = barRef.current?.offsetWidth ?? 760;
  const barLeft = Math.max(freeLeft, Math.min(left - ROW_GUTTER_REACH, freeRight - barWidth));

  // Only the rows near the viewport, in whole chunks.
  const firstRow = Math.max(0, (Math.floor(Math.max(0, rowAtY(layout, -top / zoom)) / CHUNK) - 1) * CHUNK);
  const lastRow = Math.min(rows.length - 1, (Math.floor(Math.max(0, rowAtY(layout, (window.innerHeight - top) / zoom)) / CHUNK) + 2) * CHUNK);
  const windowCells = React.useMemo(() => {
    const y0 = rowTop(firstRow);
    const y1 = rowTop(lastRow + 1);
    return layout.cells.filter((c) => c.r < 0 || (c.y + c.h >= y0 && c.y <= y1));
    // rowTop reads `layout`, which is a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, firstRow, lastRow]);

  /** The node as it is *now*, so a burst of edits never writes over itself. */
  const live = () => {
    const n = useStore.getState().objects[node.id];
    return n && n.type === 'table' ? n : node;
  };
  const apply = (next: TableSpec, extra?: { width?: number; height?: number }) => updateTable(live(), next, extra);
  /** An edit to some columns' text: they widen (and wrapped rows grow) to show it, in the same step. */
  const grow = (next: TableSpec, touched: number[]) => updateTableGrowing(live(), next, touched);

  /** Run `fn` over every stored cell a drawn range stands for. */
  const eachStored = (range: SheetRange, base: TableSpec, fn: (s: TableSpec, r: number, c: number) => TableSpec) => {
    let next = base;
    const order = M.viewRows(base);
    for (let vr = range.r0; vr <= range.r1; vr++) {
      const r = order[vr];
      if (r === undefined) continue;
      for (let c = range.c0; c <= range.c1; c++) next = fn(next, r, c);
    }
    return next;
  };

  const [pop, setPop] = React.useState<Pop>(null);
  const openPop = (p: Pop) => setPop((cur) => (cur === p ? null : p));
  /** Where a `+` under the pointer would insert. */
  const [hint, setHint] = React.useState<{ axis: Axis; at: number } | null>(null);
  /** A row or column block being dragged, and the boundary it would land on. */
  const [drag, setDrag] = React.useState<{ axis: Axis; from: number; to: number; before: number } | null>(null);
  const [menu, setMenu] = React.useState<MenuState | null>(null);
  /** The app menu open on the editor: a column's, or a summary's. */
  const [appMenu, setAppMenu] = React.useState<{ label: string; anchor: MenuAnchor; keys?: boolean; col?: number; entries?: MenuEntry[] } | null>(null);
  /** A select or person cell's chooser. */
  const [picker, setPicker] = React.useState<{ vr: number; c: number; initial: string } | null>(null);
  /** A paste larger than a sorted or filtered view can take, waiting for a decision. */
  const [pendingPaste, setPendingPaste] = React.useState<{ vr: number; c: number; block: PastedBlock } | null>(null);
  /** The fill handle being dragged: the range it would fill. */
  const [fillDrag, setFillDrag] = React.useState<SheetRange | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const say = (text: string) => {
    setNotice(text);
    window.setTimeout(() => setNotice((n) => (n === text ? null : n)), 2600);
  };

  const typeOf = (c: number): CellType => spec.columns[c]?.type ?? 'text';
  const isHeaderVr = (vr: number) => spec.header && rows[vr] === 0;

  // ---- writing blocks -------------------------------------------------------

  /**
   * Write a block in from a drawn cell. In an unsorted, unfiltered table the
   * drawn rows are the stored rows and the table grows to take the block; in
   * a view, rows map through the view's order, and a block longer than the
   * view waits for a decision rather than losing its last rows.
   */
  const writeBlockAt = (vr: number, c: number, block: PastedBlock, base = live().table) => {
    const s = base;
    const width = Math.max(1, ...block.cells.map((line) => line.length));
    const touched = span(c, c + width - 1);
    if (M.isIdentityView(s)) {
      let next = M.setBlock(s, vr, c, block.cells);
      block.styles.forEach((line, i) =>
        line.forEach((st, j) => {
          if (st) next = M.styleRange(next, { r0: vr + i, c0: c + j, r1: vr + i, c1: c + j }, st);
        })
      );
      for (const m of block.merges) next = M.mergeRange(next, { r0: vr + m.r, c0: c + m.c, r1: vr + m.r + m.rs - 1, c1: c + m.c + m.cs - 1 });
      grow(next, touched);
      return { r0: vr, c0: c, r1: vr + block.cells.length - 1, c1: c + width - 1 };
    }
    const order = M.viewRows(s);
    if (vr + block.cells.length > order.length) {
      setPendingPaste({ vr, c, block });
      return null;
    }
    let next = s;
    block.cells.forEach((line, i) => {
      const r = order[vr + i];
      line.forEach((text, j) => {
        if (c + j < next.columns.length) next = M.setCell(next, r, c + j, text);
      });
    });
    grow(next, touched);
    return { r0: vr, c0: c, r1: vr + block.cells.length - 1, c1: c + width - 1 };
  };

  const resolvePending = (how: 'clear' | 'fit') => {
    const p = pendingPaste;
    setPendingPaste(null);
    if (!p) return;
    const s = live().table;
    if (how === 'clear') {
      // The paste lands where its first row is stored, in the table as entered.
      const r = M.viewRows(s)[p.vr] ?? s.cells.length;
      writeBlockAt(r, p.c, p.block, { ...s, sort: undefined, filters: undefined });
      sheet.place({ r, c: p.c });
      return;
    }
    const room = Math.max(0, M.viewRows(s).length - p.vr);
    writeBlockAt(p.vr, p.c, { ...p.block, cells: p.block.cells.slice(0, room), styles: p.block.styles.slice(0, room) });
  };

  const sheet = useSheet({
    rows: rows.length,
    cols,
    read: (vr, c) => spec.cells[rows[vr]]?.[c] ?? '',
    write: (vr, c, text) => {
      const s = live().table;
      const r = M.viewRows(s)[vr];
      if (r !== undefined) grow(M.setCell(s, r, c, text), [c]);
    },
    writeBlock: (vr, c, block) => {
      writeBlockAt(vr, c, { cells: block, styles: block.map((line) => line.map(() => null)), merges: [] });
    },
    clear: (range) => apply(eachStored(range, live().table, (s, r, c) => M.setCell(s, r, c, ''))),
    appendRow: () => {
      const s = live().table;
      apply(M.insertRows(s, s.cells.length, 1));
    },
    onFormat: (key) => toggleStyle(key),
    onExit: onClose,
    onUndo: () => undoManager.undo(),
    onRedo: () => undoManager.redo(),
    onFill: (dir, range) => fillShortcut(dir, range),
    intercept: (e, focus, range) => interceptKey(e, focus, range),
    copy: (range) => {
      const s = live().table;
      const order = M.viewRows(s);
      const clip = copyCells(
        s,
        span(range.r0, range.r1).map((vr) => order[vr]).filter((r) => r !== undefined),
        range
      );
      return { plain: clipToTsv(clip), html: clipToHtml(clip), json: { type: VEGA_CELLS, data: encodeClip(clip) } };
    },
    paste: (data, range, valuesOnly) => pasteRich(data, range, valuesOnly),
  });
  const focusSink = React.useRef(sheet.focusSink);
  focusSink.current = sheet.focusSink;

  const focusStored = { r: rows[sheet.focus.r] ?? 0, c: sheet.focus.c };

  // ---- formatting -----------------------------------------------------------

  const style = (patch: CellStyle) => apply(eachStored(sheet.range, live().table, (s, r, c) => M.styleRange(s, { r0: r, c0: c, r1: r, c1: c }, patch)));
  const styleAtFocus = spec.styles?.[`${focusStored.r}:${focusStored.c}`] ?? {};
  const toggleStyle = (key: 'bold' | 'italic' | 'wrap') => {
    if (key !== 'wrap') {
      style({ [key]: styleAtFocus[key] ? undefined : true });
      return;
    }
    // Wrapping changes how tall rows need to be, so it is a growing edit.
    const on = !styleAtFocus.wrap;
    const s = eachStored(sheet.range, live().table, (x, r, c) => M.styleRange(x, { r0: r, c0: c, r1: r, c1: c }, { wrap: on ? true : undefined }));
    grow(s, span(sheet.range.c0, sheet.range.c1));
  };
  const align = (a: CellAlign) => style({ align: styleAtFocus.align === a ? undefined : a });
  const valign = (v: CellVAlign) => style({ valign: v === 'middle' ? undefined : v });
  const setType = (type: CellType) => {
    let s = live().table;
    for (let c = sheet.range.c0; c <= sheet.range.c1; c++) s = M.setColumnType(s, c, type);
    apply(s);
  };
  const typeAtFocus = typeOf(focusStored.c);

  // ---- structure ------------------------------------------------------------

  /** Insert a stored row, and put the cursor at its start so typing fills it. */
  const insertRowAt = (stored: number) => {
    const s = live().table;
    apply(M.insertRows(s, stored, 1));
    if (M.isIdentityView(s)) sheet.place({ r: stored, c: 0 });
  };
  /** Insert a column, and put the cursor on its heading so typing names it. */
  const insertColAt = (at: number) => {
    apply(M.insertCols(live().table, at, 1));
    sheet.place({ r: 0, c: at });
  };

  /** Delete the stored rows behind drawn rows `vr0..vr1`. */
  const deleteViewRows = (vr0: number, vr1: number) => {
    const s = live().table;
    const order = M.viewRows(s);
    const stored = new Set<number>();
    for (let vr = vr0; vr <= vr1; vr++) if (order[vr] !== undefined) stored.add(order[vr]);
    let next = s;
    [...stored].sort((a, b) => b - a).forEach((r) => (next = M.deleteRows(next, r, 1)));
    apply(next);
  };
  const deleteColRange = (c0: number, c1: number) => apply(M.deleteCols(live().table, c0, c1 - c0 + 1));
  const merged = M.mergeAt(spec, focusStored.r, focusStored.c);
  const canMerge = identity && (sheet.range.r1 > sheet.range.r0 || sheet.range.c1 > sheet.range.c0);
  const merge = () => apply(M.mergeRange(live().table, sheet.range));
  const unmerge = () => apply(M.unmergeRange(live().table, sheet.range));
  const multi = sheet.range.r1 > sheet.range.r0 || sheet.range.c1 > sheet.range.c0;
  const freezeRows = (n: number) => {
    const s = live().table;
    const cur = s.frozen;
    apply({ ...s, frozen: n > 0 || cur?.cols ? { rows: n, cols: cur?.cols ?? 0 } : undefined });
  };
  const toggleSummary = () => {
    const s = live().table;
    if (M.hasSummary(s)) {
      apply({ ...s, summary: undefined });
      return;
    }
    // A footer with something in it at once: a total under every numeric column.
    const summary: Array<SummaryAgg | null> = s.columns.map((col) => {
      const choices = M.summaryChoices(col.type);
      return col.type === 'checkbox' ? 'checked' : choices.includes('sum') ? 'sum' : null;
    });
    if (!summary.some(Boolean)) summary[0] = 'count';
    apply({ ...s, summary });
  };

  // ---- view -----------------------------------------------------------------

  const sortCol = (c: number, dir: 'asc' | 'desc' | null) => {
    const s = live().table;
    const same = dir && s.sort?.col === c && s.sort.dir === dir;
    apply({ ...s, sort: !dir || same ? undefined : { col: c, dir } });
  };

  // ---- rich cells -----------------------------------------------------------

  /** Tick or untick every checkbox cell in a range, all to the opposite of the focused one. */
  const toggleChecks = (range: SheetRange, at: SheetPos) => {
    const s = live().table;
    const r = rows[at.r];
    const on = !M.isChecked(s.cells[r]?.[at.c] ?? '');
    apply(
      eachStored(range, s, (x, rr, c) =>
        x.columns[c]?.type === 'checkbox' && !(x.header && rr === 0) && !isFormula(x.cells[rr]?.[c] ?? '') ? M.setCell(x, rr, c, on ? 'TRUE' : 'FALSE') : x
      )
    );
  };
  const setRating = (range: SheetRange, n: number) =>
    apply(
      eachStored(range, live().table, (x, r, c) =>
        x.columns[c]?.type === 'rating' && !(x.header && r === 0) ? M.setCell(x, r, c, n ? String(n) : '') : x
      )
    );

  const openPicker = (p: SheetPos, initial = '') => {
    if (isHeaderVr(p.r) || isFormula(spec.cells[rows[p.r]]?.[p.c] ?? '')) {
      sheet.begin(p, initial || undefined);
      return;
    }
    sheet.select(p);
    setPicker({ vr: p.r, c: p.c, initial });
  };

  const pickerChoices = (c: number): PickerChoice[] => {
    if (typeOf(c) === 'select') return M.optionsOf(spec, c).map((o) => ({ label: o.label, tag: o.tag }));
    const here = collaboratorStore.getSnapshot().map((p) => p.name).filter(Boolean);
    const inTable = new Set<string>();
    for (let r = floor; r < spec.cells.length; r++) {
      const v = spec.cells[r][c]?.trim();
      if (v && !isFormula(v)) inTable.add(v);
    }
    const out: PickerChoice[] = [];
    const seen = new Set<string>();
    const add = (label: string, detail: string) => {
      if (seen.has(label.toLowerCase())) return;
      seen.add(label.toLowerCase());
      out.push({ label, detail });
    };
    here.forEach((n) => add(n, 'Here now'));
    inTable.forEach((n) => add(n, 'In this table'));
    return out;
  };

  /** A picked value written, any choice that is new added to the column's options in the same step. */
  const writePicked = (vr: number, c: number, value: string) => {
    let s = live().table;
    const r = M.viewRows(s)[vr];
    if (r === undefined) return;
    if (s.columns[c]?.type === 'select') for (const l of M.selectLabels(value)) s = M.addOption(s, c, l);
    grow(M.setCell(s, r, c, value), [c]);
  };

  // ---- keys -----------------------------------------------------------------

  /** The next shown column from `c` in a direction, stepping over hidden ones. */
  const nextShown = (c: number, d: number) => {
    let n = c + d;
    while (n >= 0 && n < cols && spec.columns[n].hidden) n += d;
    return n < 0 || n >= cols ? c : n;
  };

  const interceptKey = (e: React.KeyboardEvent, focus: SheetPos, range: SheetRange): boolean => {
    const mod = e.ctrlKey || e.metaKey;
    const t = typeOf(focus.c);
    const header = isHeaderVr(focus.r);
    const raw = spec.cells[rows[focus.r]]?.[focus.c] ?? '';
    if (e.altKey && e.key === 'ArrowDown') {
      if (!header && (t === 'select' || t === 'person') && !isFormula(raw)) openPicker(focus);
      else openColumnMenu(focus.c, null, true);
      return true;
    }
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Tab') && !mod) {
      const d = e.key === 'ArrowLeft' || (e.key === 'Tab' && e.shiftKey) ? -1 : 1;
      if (spec.columns[focus.c + d]?.hidden) {
        sheet.select({ r: focus.r, c: nextShown(focus.c, d) }, e.key !== 'Tab' && e.shiftKey);
        return true;
      }
    }
    if (header || mod || e.altKey || isFormula(raw)) return false;
    if (t === 'checkbox' && (e.key === ' ' || e.key === 'Enter')) {
      toggleChecks(range, focus);
      return true;
    }
    if (t === 'rating' && /^[0-5]$/.test(e.key)) {
      setRating(range, Number(e.key));
      return true;
    }
    if ((t === 'select' || t === 'person') && (e.key === 'Enter' || e.key === 'F2' || (e.key.length === 1 && e.key !== '='))) {
      openPicker(focus, e.key.length === 1 ? e.key : '');
      return true;
    }
    return false;
  };

  // ---- filling --------------------------------------------------------------

  /** Fill from a drawn source block into a drawn target; drawn rows are stored rows here. */
  const fillInto = (source: SheetRange, target: SheetRange) => {
    if (!M.isIdentityView(live().table)) {
      say('Filling needs the unsorted, unfiltered table');
      return;
    }
    const s = live().table;
    const next = M.fillRange(s, source, target);
    if (next === s) return;
    grow(next, span(target.c0, target.c1));
    sheet.place({ r: target.r0, c: target.c0 });
    sheet.select({ r: target.r1, c: target.c1 }, true);
  };

  /** Ctrl+D and Ctrl+R: the selection's first row (or column) into the rest — from the one above (or left) when only one is selected. */
  const fillShortcut = (dir: 'down' | 'right', range: SheetRange) => {
    if (dir === 'down') {
      if (range.r0 === range.r1) {
        if (range.r0 - 1 < floor) return;
        fillInto({ ...range, r0: range.r0 - 1, r1: range.r0 - 1 }, { ...range, r0: range.r0 - 1 });
      } else fillInto({ ...range, r1: range.r0 }, range);
    } else if (range.c0 === range.c1) {
      if (range.c0 === 0) return;
      fillInto({ ...range, c0: range.c0 - 1, c1: range.c0 - 1 }, { ...range, c0: range.c0 - 1 });
    } else fillInto({ ...range, c1: range.c0 }, range);
  };

  /** The fill handle double-clicked: down as far as the column beside the selection has values. */
  const fillToNeighbour = () => {
    const s = live().table;
    const range = sheet.range;
    const side = range.c0 > 0 ? range.c0 - 1 : range.c1 + 1 < cols ? range.c1 + 1 : -1;
    if (side < 0) return;
    let end = range.r1;
    while (end + 1 < s.cells.length && (s.cells[end + 1][side] ?? '').trim() !== '') end++;
    if (end > range.r1) fillInto(range, { ...range, r1: end });
  };

  const cellAtPoint = (clientX: number, clientY: number): SheetPos | null => {
    const box = rootRef.current?.getBoundingClientRect();
    if (!box) return null;
    const x = (clientX - box.left) / zoom;
    const y = (clientY - box.top) / zoom;
    const vr = Math.max(0, Math.min(rows.length - 1, rowAtY(layout, y)));
    let c = 0;
    while (c < cols - 1 && x >= layout.colX[c] + layout.colW[c]) c++;
    return { r: vr, c };
  };

  const beginFillDrag = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const source = sheet.range;
    let target: SheetRange = source;
    const move = (ev: PointerEvent) => {
      const at = cellAtPoint(ev.clientX, ev.clientY);
      if (!at) return;
      const downBy = at.r > source.r1 ? at.r - source.r1 : at.r < source.r0 ? at.r - source.r0 : 0;
      const acrossBy = at.c > source.c1 ? at.c - source.c1 : at.c < source.c0 ? at.c - source.c0 : 0;
      // One axis at a time, whichever the pointer has gone further along.
      const rowsH = Math.abs(downBy) * layout.rowH;
      const colsW = Math.abs(acrossBy) * (layout.colW[at.c] || 1);
      if (downBy !== 0 && rowsH >= colsW) {
        target = downBy > 0 ? { ...source, r1: at.r } : { ...source, r0: Math.max(floor, at.r) };
      } else if (acrossBy !== 0) {
        target = acrossBy > 0 ? { ...source, c1: at.c } : { ...source, c0: at.c };
      } else target = source;
      setFillDrag(target);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      setFillDrag(null);
      if (target !== source) fillInto(source, target);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  // ---- the clipboard --------------------------------------------------------

  /**
   * A paste with more than text: cells copied from a table on the board (their
   * formulas moved by how far they travelled), or a table from a spreadsheet
   * or a web page with its formatting. Null falls back to the plain paste.
   */
  const pasteRich = (data: DataTransfer, range: SheetRange, valuesOnly: boolean): SheetRange | null => {
    const s = live().table;
    const order = M.viewRows(s);
    const at = { r: order[range.r0] ?? s.cells.length, c: range.c0 };
    let block: PastedBlock | null = null;
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
        block = { cells, styles: cells.map((line) => line.map(() => (valuesOnly ? null : clip.styles[0]?.[0] ?? null))), merges: [] };
      } else block = clipForPaste(clip, at, valuesOnly);
    } else if (!valuesOnly) {
      const html = data.getData('text/html');
      if (html) block = parseHtmlTable(html);
    }
    if (!block || !block.cells.length) return null;
    return writeBlockAt(range.r0, range.c0, block) ?? range;
  };

  // ---- formulas -------------------------------------------------------------

  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  const fxInputRef = React.useRef<HTMLInputElement>(null);
  /** The edit is happening in the formula bar, not in the cell. */
  const [barEditing, setBarEditing] = React.useState(false);
  const activeInput = (): HTMLTextAreaElement | HTMLInputElement | null => (barEditing ? fxInputRef.current : inputRef.current);
  const [caret, setCaret] = React.useState(0);
  const [pick, setPick] = React.useState(0);
  const [dismissed, setDismissed] = React.useState<string | null>(null);
  /** The span of the reference a click last wrote, so the next click replaces it. */
  const lastInsert = React.useRef<{ start: number; end: number } | null>(null);
  /** The cell a reference drag started on. */
  const refDrag = React.useRef<{ r: number; c: number } | null>(null);
  /** While references are being clicked in, the help steps back so it can never be in the way. */
  const [picking, setPicking] = React.useState(false);

  React.useEffect(() => {
    if (!sheet.edit) setBarEditing(false);
  }, [sheet.edit]);

  const draft = sheet.edit?.draft ?? '';
  const writingFormula = Boolean(sheet.edit) && draft.startsWith('=');
  const typedName = writingFormula ? /(?:^=|[(,;+\-*/^&<>=:%\s])([A-Za-z][A-Za-z0-9.]*)$/.exec(draft.slice(0, caret)) : null;
  const suggestions =
    typedName && dismissed !== draft
      ? FORMULA_FUNCTIONS.filter((f) => f.name.startsWith(typedName[1].toUpperCase())).slice(0, 6)
      : [];
  const picked = Math.min(pick, Math.max(0, suggestions.length - 1));
  const call = writingFormula ? callAt(draft.slice(0, caret)) : null;
  const callFn = call ? FORMULA_FUNCTIONS.find((f) => f.name === call.name) : undefined;

  const moveCaret = (p: number) =>
    requestAnimationFrame(() => {
      const el = activeInput();
      if (!el) return;
      el.focus({ preventScroll: true });
      el.setSelectionRange(p, p);
      setCaret(p);
    });

  const accept = (name: string) => {
    if (!typedName) return;
    const start = caret - typedName[1].length;
    sheet.setDraft(`${draft.slice(0, start)}${name}(${draft.slice(caret)}`);
    moveCaret(start + name.length + 1);
  };

  /** Start or continue a formula with `text` — from the function menu or AutoSum. */
  const writeFormula = (text: string, caretFromEnd = 0) => {
    if (sheet.edit) {
      const el = activeInput();
      const at = el?.selectionStart ?? draft.length;
      const body = draft.startsWith('=') ? text.replace(/^=/, '') : text;
      const base = draft.startsWith('=') ? draft : '';
      const pos = draft.startsWith('=') ? at : 0;
      sheet.setDraft(`${base.slice(0, pos)}${body}${base.slice(pos)}`);
      moveCaret(pos + body.length - caretFromEnd);
    } else {
      sheet.begin(sheet.focus, text);
      moveCaret(text.length - caretFromEnd);
    }
  };

  /** AutoSum: the numbers directly above the cursor, the way every spreadsheet finds them. */
  const autoFunction = (fn: string) => {
    const s = live().table;
    const { r, c } = focusStored;
    const numeric = (rr: number) => {
      const v = s.cells[rr]?.[c] ?? '';
      return v.trim() !== '' && (M.parseCellNumber(v) !== null || isFormula(v));
    };
    let topRow = r - 1;
    while (topRow >= floor && numeric(topRow)) topRow--;
    topRow++;
    const a = identity && topRow <= r - 1 ? refNameIn(s, topRow, c) : null;
    const b = a ? refNameIn(s, r - 1, c) : null;
    if (a && b) writeFormula(`=${fn}(${a}:${b})`);
    else writeFormula(`=${fn}()`, 1);
  };

  const insertable = () => {
    const el = activeInput();
    if (!el || !writingFormula) return false;
    const pos = el.selectionStart ?? draft.length;
    if (lastInsert.current && lastInsert.current.end === pos) return true;
    return /[=(,;+\-*/^&<>:]\s*$/.test(draft.slice(0, pos));
  };

  /** Write a reference to a stored cell at the caret — or over the one the last click wrote. */
  const insertRef = (r: number, c: number): boolean => {
    const name = refNameIn(spec, r, c);
    const el = activeInput();
    if (!name || !el) return false;
    let from = el.selectionStart ?? draft.length;
    let to = el.selectionEnd ?? from;
    if (lastInsert.current && lastInsert.current.end === from) {
      from = lastInsert.current.start;
      to = lastInsert.current.end;
    }
    sheet.setDraft(`${draft.slice(0, from)}${name}${draft.slice(to)}`);
    lastInsert.current = { start: from, end: from + name.length };
    refDrag.current = { r, c };
    setPicking(true);
    moveCaret(from + name.length);
    const up = () => {
      refDrag.current = null;
      setPicking(false);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointerup', up);
    return true;
  };

  /** Dragging from a referenced cell turns the reference into a range. */
  const extendRef = (r: number, c: number) => {
    const a = refDrag.current;
    const span0 = lastInsert.current;
    if (!a || !span0) return;
    const lo = refNameIn(spec, Math.min(a.r, r), Math.min(a.c, c));
    const hi = refNameIn(spec, Math.max(a.r, r), Math.max(a.c, c));
    if (!lo || !hi) return;
    const text = lo === hi ? lo : `${lo}:${hi}`;
    sheet.setDraft(`${draft.slice(0, span0.start)}${text}${draft.slice(span0.end)}`);
    lastInsert.current = { start: span0.start, end: span0.start + text.length };
    moveCaret(span0.start + text.length);
  };

  /** The cells a formula being typed reads, outlined in their colours. */
  const refBoxes = writingFormula
    ? referencesIn(draft).flatMap((ref, i) => {
        const color = REF_COLORS[i % REF_COLORS.length];
        const r0 = storedOf(skip, ref.r0);
        const r1 = storedOf(skip, ref.r1);
        if (ref.r0 < 1 || ref.c0 >= cols) return [];
        if (identity) {
          const a = Math.max(0, r0);
          const b = Math.min(rows.length - 1, r1);
          if (a > b) return [];
          return [{ color, box: rectOf({ r0: a, c0: ref.c0, r1: b, c1: Math.min(cols - 1, ref.c1) }) }];
        }
        if (r0 !== r1 || ref.c0 !== ref.c1) return [];
        const vr = rows.indexOf(r0);
        return vr < 0 ? [] : [{ color, box: rectOf({ r0: vr, c0: ref.c0, r1: vr, c1: ref.c0 }) }];
      })
    : [];

  /** What the formula would show if committed now. */
  const resultPreview = React.useMemo(() => {
    if (!writingFormula || !sheet.edit || draft.length < 2) return null;
    // Mid-typing, a formula is usually incomplete. That is not an error worth
    // announcing in red on every keystroke, so it reads as a quiet ellipsis.
    if (formulaError(draft)) return { text: '…', tone: 'pending' as const };
    const r = rows[sheet.edit.r];
    if (r === undefined) return null;
    const text = M.formatCell(M.setCell(spec, r, sheet.edit.c, draft), r, sheet.edit.c);
    return { text: `= ${text || '(empty)'}`, tone: /^#/.test(text) ? ('error' as const) : ('ok' as const) };
  }, [writingFormula, draft, spec, rows, sheet.edit]);
  const measureText = React.useMemo(() => tableMeasure(Boolean(node.appearance?.sketch)), [node.appearance?.sketch]);

  const onInputKey = (e: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    if (suggestions.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        const n = suggestions.length;
        setPick((picked + (e.key === 'ArrowDown' ? 1 : -1) + n) % n);
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && !e.altKey)) {
        e.preventDefault();
        e.stopPropagation();
        accept(suggestions[picked].name);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setDismissed(draft);
        return;
      }
    }
    sheet.onEditorKeyDown(e);
    if (barEditing && (e.key === 'Enter' || e.key === 'Tab' || e.key === 'Escape')) {
      setBarEditing(false);
      focusSink.current();
    }
  };

  // ---- column and row resize ------------------------------------------------

  /**
   * Drag a column's edge. An inner edge trades width with its neighbour, so
   * the table keeps its size; the last edge has no neighbour, so it resizes
   * the table — the right edge of a table is a handle in every editor.
   */
  const beginResize = (c: number, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const start = spec.columns.map((col) => col.width);
    const shownW = spec.columns.reduce((a, col) => a + (col.hidden ? 0 : col.width), 0);
    const startW = node.width;
    let next = c + 1;
    while (next < cols && spec.columns[next].hidden) next++;
    const last = next >= cols;
    let current = start;
    let width = startW;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / zoom;
      if (!moved && Math.abs(dx) * zoom < 2) return;
      moved = true;
      if (last) {
        const px = start.map((w, i) => (spec.columns[i].hidden ? 0 : (startW * w) / shownW));
        const own = Math.max(40, px[c] + dx);
        width = startW - px[c] + own;
        current = start.map((w, i) => (spec.columns[i].hidden ? w : (i === c ? own : px[i]) / UNIT));
        setLiveWidth(width);
      } else {
        const dw = dx * (shownW / startW);
        const a = Math.max(0.2, start[c] + dw);
        const b = Math.max(0.2, start[next] - (a - start[c]));
        current = start.map((w, i) => (i === c ? a : i === next ? b : w));
      }
      setWidths(current);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      setWidths(null);
      setLiveWidth(null);
      // A click is not a resize: a double-click to fit must not first write
      // two resizes that change nothing.
      if (!moved) return;
      const s = live().table;
      apply({ ...s, columns: s.columns.map((col, i) => ({ ...col, width: current[i] ?? col.width })) }, last ? { width } : undefined);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  /** Drag a row's bottom edge: the row takes more of the height, and the table grows by it. */
  const beginRowResize = (vr: number, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const r = rows[vr];
    if (r === undefined) return;
    const startY = e.clientY;
    const unit = rowHeightOf(live());
    const start = Array.from({ length: spec.cells.length }, (_, i) => spec.rowHeights?.[i] ?? 1);
    const startH = node.height;
    let current = start;
    let height = startH;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dy = (ev.clientY - startY) / zoom;
      if (!moved && Math.abs(dy) * zoom < 2) return;
      moved = true;
      const w = Math.min(20, Math.max(0.4, start[r] + dy / unit));
      current = start.map((x, i) => (i === r ? w : x));
      height = startH + (w - start[r]) * unit;
      setHeights(current);
      setLiveHeight(height);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      setHeights(null);
      setLiveHeight(null);
      if (!moved) return;
      apply({ ...live().table, rowHeights: current.some((x) => x !== 1) ? current : undefined }, { height });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  /** A double-click on a row's edge: wrapped rows fit their lines, others go back to standard. */
  const fitRow = (vr: number) => {
    const r = rows[vr];
    if (r === undefined) return;
    if (fitTableRows(live(), [r])) return;
    const s = live().table;
    if ((s.rowHeights?.[r] ?? 1) !== 1) {
      const unit = rowHeightOf(live());
      apply(M.setRowHeight(s, r, 1), { height: node.height + (1 - (s.rowHeights?.[r] ?? 1)) * unit });
    }
  };

  // ---- reordering -----------------------------------------------------------

  const rootRef = React.useRef<HTMLDivElement>(null);

  /** The boundary (0..n) nearest a pointer, along one axis. */
  const boundaryAt = (axis: Axis, clientX: number, clientY: number): number => {
    const box = rootRef.current?.getBoundingClientRect();
    if (!box) return -1;
    if (axis === 'col') {
      const x = (clientX - box.left) / zoom;
      let best = 0;
      let d = Infinity;
      for (let b = 0; b <= cols; b++) {
        const bx = b === cols ? layout.width : layout.colX[b];
        if (Math.abs(bx - x) < d) {
          d = Math.abs(bx - x);
          best = b;
        }
      }
      return best;
    }
    const y = (clientY - box.top) / zoom;
    const vr = rowAtY(layout, y);
    const nearest = vr >= rows.length ? rows.length : y - rowTop(vr) > rowHt(vr) / 2 ? vr + 1 : vr;
    return Math.max(floor, Math.min(rows.length, nearest));
  };

  /**
   * Press on a selected letter or number: a click reselects, a drag moves.
   * The threshold is in screen pixels (invariant 9): a wobble is a wobble at
   * any zoom.
   */
  const startDrag = (axis: Axis, from: number, to: number, index: number, e: React.PointerEvent) => {
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;
    let before = -1;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 4) return;
      moved = true;
      before = boundaryAt(axis, ev.clientX, ev.clientY);
      setDrag({ axis, from, to, before });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      setDrag(null);
      if (!moved) {
        if (axis === 'col') sheet.selectCol(index);
        else sheet.selectRow(index);
        return;
      }
      if (before < 0 || (before >= from && before <= to + 1)) return;
      const s = live().table;
      const next = axis === 'col' ? M.moveCols(s, from, to, before) : M.moveRows(s, from, to, before);
      if (next === s) return;
      apply(next);
      const len = to - from + 1;
      const at = before > to ? before - len : before;
      if (axis === 'col') {
        sheet.place({ r: 0, c: at });
        sheet.select({ r: rows.length - 1, c: at + len - 1 }, true);
      } else {
        sheet.place({ r: at, c: 0 });
        sheet.select({ r: at + len - 1, c: cols - 1 }, true);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const wholeCols = sheet.range.r0 === 0 && sheet.range.r1 === rows.length - 1;
  const wholeRows = sheet.range.c0 === 0 && sheet.range.c1 === cols - 1;
  const rowsMovable = identity && wholeRows && sheet.range.r0 >= floor;

  // ---- menus ----------------------------------------------------------------

  const colHeadRefs = React.useRef<Array<HTMLDivElement | null>>([]);

  /** The column menu, under the column's letter or at a point. */
  function openColumnMenu(c: number, at: { x: number; y: number } | null, keys = false) {
    if (sheet.edit) sheet.commit();
    setPop(null);
    const rect = colHeadRefs.current[c]?.getBoundingClientRect();
    const anchor: MenuAnchor = at ? { kind: 'point', x: at.x, y: at.y } : rect ? { kind: 'rect', rect, prefer: 'below', align: 'start' } : { kind: 'point', x: left, y: top };
    setAppMenu({ label: `Column ${columnLetter(c)}`, anchor, keys, col: c });
  }
  /** Built each render from the live spec, so a choice made in a submenu shows at once. */
  const appMenuCol = appMenu?.col;
  const appEntries: MenuEntry[] =
    appMenu && appMenuCol !== undefined
      ? columnMenuEntries({
          spec,
          col: appMenuCol,
          apply: (next) => apply(next),
          fit: () => fitTableColumns(live(), [appMenuCol]),
          filterPanel: (close) => <FilterPanel spec={spec} col={appMenuCol} apply={(next) => apply(next)} close={close} />,
        })
      : appMenu?.entries ?? [];

  const openSummaryMenu = (c: number, e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const agg = spec.summary?.[c] ?? null;
    setAppMenu({
      label: `Summary for column ${columnLetter(c)}`,
      anchor: { kind: 'rect', rect, prefer: 'below', align: 'end' },
      entries: [
        { kind: 'heading', id: 'h', label: 'Summarise this column' },
        { kind: 'item', id: 'none', label: 'None', ...(agg === null ? { trailing: <Check size={14} aria-label="Current" /> } : null), onSelect: () => apply(setSummary(live().table, c, null)) },
        ...M.summaryChoices(typeOf(c)).map(
          (a): MenuEntry => ({
            kind: 'item',
            id: a,
            label: SUMMARY_LABELS[a],
            ...(agg === a ? { trailing: <Check size={14} aria-label="Current" /> } : null),
            onSelect: () => apply(setSummary(live().table, c, a)),
          })
        ),
        { kind: 'separator', id: 's' },
        { kind: 'item', id: 'off', label: 'Hide the summary row', onSelect: () => apply({ ...live().table, summary: undefined }) },
      ],
    });
  };

  const menuRef = React.useRef<HTMLDivElement>(null);
  const openMenu = (kind: MenuState['kind'], at: { r: number; c: number }, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (sheet.edit) sheet.commit();
    setPop(null);
    const r = sheet.range;
    let box = { r0: at.r, r1: at.r, c0: at.c, c1: at.c };
    if (kind === 'row') {
      const inside = wholeRows && at.r >= r.r0 && at.r <= r.r1;
      box = inside ? { ...r } : { r0: at.r, r1: at.r, c0: 0, c1: cols - 1 };
      if (!inside) sheet.selectRow(at.r);
    } else if (sheet.inRange(at.r, at.c)) {
      box = { ...r };
    } else {
      sheet.select(at);
    }
    setMenu({ kind, ...box, x: Math.min(e.clientX, window.innerWidth - 248), y: Math.min(e.clientY, window.innerHeight - 460) });
  };

  React.useEffect(() => {
    if (!menu) return;
    const down = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(null);
    };
    // Escape closes the menu, not the editor under it.
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      setMenu(null);
      focusSink.current();
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key, true);
    };
  }, [menu]);

  const run = (fn: () => unknown) => {
    fn();
    setMenu(null);
    setPop(null);
    focusSink.current();
  };

  /** A chart of the selection, beside the table, following it. */
  const chartSelection = (range: SheetRange) => {
    const s = live().table;
    const order = M.viewRows(s);
    const stored = span(range.r0, range.r1).map((vr) => order[vr]).filter((r) => r !== undefined);
    let r0 = Math.min(...stored);
    const r1 = Math.max(...stored);
    // The header names the series, so it comes along even when only data was selected.
    if (s.header && r0 > 0) r0 = 0;
    const id = createChartFromTableRange(node.id, { r0, c0: range.c0, r1: Math.max(r1, r0 + 1), c1: range.c1 });
    say(id ? 'Chart added beside the table — it follows these cells' : 'Select cells with numbers to chart them');
  };

  // ---- the grid's handlers, stable for the memoised cells --------------------

  const handlers = React.useRef<CellHandlers>(null as unknown as CellHandlers);
  handlers.current = {
    down: (cell, e) => {
      // Mid-formula, a click on the grid writes a reference instead of leaving the cell.
      if (e.button === 0 && insertable()) {
        e.preventDefault();
        e.stopPropagation();
        if (insertRef(cell.r, cell.c)) return;
      }
      setPop(null);
      setPicker(null);
      sheet.cellPointerDown({ r: cell.vr, c: cell.c }, e);
    },
    enter: (cell) => {
      if (refDrag.current) extendRef(cell.r, cell.c);
      else sheet.cellPointerEnter({ r: cell.vr, c: cell.c });
    },
    click: (cell, e) => {
      if (e.button !== 0 || sheet.edit || e.shiftKey) return;
      const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const x = cell.x + (e.clientX - box.left) / zoom;
      const y = cell.y + (e.clientY - box.top) / zoom;
      if (cell.kind === 'checkbox' && checkboxHit(cell, layout, x, y, measure)) toggleChecks({ r0: cell.vr, c0: cell.c, r1: cell.vr, c1: cell.c }, { r: cell.vr, c: cell.c });
      else if (cell.kind === 'rating') {
        const n = ratingHit(cell, layout, x, y, measure);
        // A click on the star already set clears it: the way back to none.
        if (n !== null) setRating({ r0: cell.vr, c0: cell.c, r1: cell.vr, c1: cell.c }, n === cell.rating ? 0 : n);
      } else if (cell.kind === 'url' && (e.metaKey || e.ctrlKey)) {
        const href = safeHref(cell.text);
        if (href) window.open(href, '_blank', 'noopener,noreferrer');
      }
    },
    dbl: (cell) => {
      const t = typeOf(cell.c);
      if (!cell.header && (t === 'select' || t === 'person')) openPicker({ r: cell.vr, c: cell.c });
      else if (!cell.header && (t === 'checkbox' || t === 'rating') && !cell.formula) return;
      else sheet.begin({ r: cell.vr, c: cell.c });
    },
    menu: (cell, e) => openMenu('cell', { r: cell.vr, c: cell.c }, e),
  };

  // ---- leaving --------------------------------------------------------------

  React.useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!t) return;
      if (rootRef.current?.contains(t) || barRef.current?.contains(t)) return;
      if (t.closest?.(`[${PORTAL_SURFACE_ATTR}], .menu-layer, .menu`)) return;
      sheet.commit();
      onClose();
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  });

  // ---- geometry -------------------------------------------------------------

  function rectOf(range: SheetRange) {
    const x = layout.colX[range.c0] ?? 0;
    const w = (layout.colX[range.c1] ?? 0) + (layout.colW[range.c1] ?? 0) - x;
    const y = rowTop(range.r0);
    return { left: x, top: y, width: w, height: rowTop(range.r1 + 1) - y };
  }
  /** The drawn box for a cell — the whole block when it is the anchor of a merge. */
  const boxOf = (vr: number, c: number) => {
    const exact = cellAt.get(vr * 4096 + c);
    return exact ? { left: exact.x, top: exact.y, width: exact.w, height: exact.h } : rectOf({ r0: vr, c0: c, r1: vr, c1: c });
  };
  const editBox = sheet.edit ? boxOf(sheet.edit.r, sheet.edit.c) : null;
  const focusBox = boxOf(sheet.focus.r, sheet.focus.c);
  const portal = { [PORTAL_SURFACE_ATTR]: 'table-editor' };
  const colX = (b: number) => (b >= cols ? layout.width : layout.colX[b]);
  const rowLabel = (vr: number) => {
    const r = rows[vr];
    return skip && r === 0 ? 'H' : String(labelOfRow(skip, r ?? vr));
  };
  const editKey = sheet.edit ? `${sheet.edit.r}:${sheet.edit.c}` : null;
  const showFill = identity && !sheet.edit && !drag && !writingFormula && !picker && !fillDrag;

  /** One line where something will go: an insert under the pointer, or a block being dragged. */
  const guide = drag
    ? drag.before >= drag.from && drag.before <= drag.to + 1
      ? null
      : { axis: drag.axis, at: drag.before, kind: 'move' }
    : hint
      ? { ...hint, kind: 'insert' }
      : null;

  /** The formula being typed, each reference in the colour its cells are outlined in. */
  const echo: React.ReactNode[] = [];
  if (writingFormula) {
    let last = 0;
    referencesIn(draft).forEach((ref, i) => {
      if (ref.start > last) echo.push(draft.slice(last, ref.start));
      echo.push(
        <span key={i} className="tbled-fxbar__ref" style={{ color: REF_COLORS[i % REF_COLORS.length] }}>
          {draft.slice(ref.start, ref.end)}
        </span>
      );
      last = ref.end;
    });
    echo.push(draft.slice(last));
  }

  /**
   * The input grows sideways with what is typed instead of wrapping inside
   * the cell's height — a formula broken across two clipped lines could not be
   * read. One line, as in every spreadsheet, scrolling once it reaches a
   * sensible width.
   */
  const editWidth = editBox
    ? Math.max(
        editBox.width,
        Math.min(
          (writingFormula ? draft.length * layout.fontSize * 0.62 : measureText(draft, false, false, layout.fontSize)) + layout.padX * 2 + 12,
          Math.max(editBox.width, 520 / zoom)
        )
      )
    : 0;

  // ---- where the formula help goes ------------------------------------------

  /**
   * Beside the cell being written — never on it.
   *
   * Four spots around the input, in screen space so the help's type never
   * scales: below, above, right, left. The first that fits on screen wins, so
   * the help follows the cell wherever it is on the board and at any zoom.
   * Two things reorder them. A formula reading cells *below* the one being
   * written opens the help above, and one reading cells to the right keeps
   * off that side, so the outlined cells being clicked stay in view. And a
   * spot the toolbar already occupies is skipped. Measured each render, so a
   * second line of suggestions moves it rather than pushing it off screen.
   */
  const fxRef = React.useRef<HTMLDivElement>(null);
  const [fxSize, setFxSize] = React.useState({ w: 440, h: 72 });
  React.useLayoutEffect(() => {
    if (!writingFormula) return;
    const el = fxRef.current;
    if (!el) return;
    if (typeof ResizeObserver === 'undefined') {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      setFxSize((prev) => (Math.abs(w - prev.w) > 1 || Math.abs(h - prev.h) > 1 ? { w, h } : prev));
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setFxSize((prev) => (Math.abs(width - prev.w) > 1 || Math.abs(height - prev.h) > 1 ? { w: width, h: height } : prev));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [writingFormula]);
  const fxPlace = (() => {
    if (!editBox) return null;
    const a = { left: left + editBox.left * zoom, top: top + editBox.top * zoom, width: editWidth * zoom, height: editBox.height * zoom };
    const vh = window.innerHeight;
    const gap = 8;
    const m = 8;
    const { w, h } = fxSize;
    // What the help must not land on: the toolbar, and the side panels.
    const blocks = [{ left: barLeft, top: barTop, right: barLeft + barWidth, bottom: barTop + BAR_H }, ...sidePanels];
    const clear = (x: number, y: number) => blocks.every((b) => x + w <= b.left || x >= b.right || y + h <= b.top || y >= b.bottom);
    const cx = (x: number) => Math.max(freeLeft, Math.min(freeRight - w, x));
    const cy = (y: number) => Math.max(m, Math.min(vh - h - m, y));
    const spots = {
      below: { left: cx(a.left), top: a.top + a.height + gap, side: 'below', fits: a.top + a.height + gap + h <= vh - m },
      above: { left: cx(a.left), top: a.top - gap - h, side: 'above', fits: a.top - gap - h >= m },
      right: { left: a.left + a.width + gap, top: cy(a.top), side: 'right', fits: a.left + a.width + gap + w <= freeRight },
      left: { left: a.left - gap - w, top: cy(a.top), side: 'left', fits: a.left - gap - w >= freeLeft },
    };
    const readsBelow = refBoxes.some((b) => b.box.top >= editBox.top + editBox.height - 0.5);
    const readsRight = refBoxes.some((b) => b.box.left >= editBox.left + editWidth - 0.5);
    const order: Array<keyof typeof spots> = readsBelow
      ? ['above', 'right', 'left', 'below']
      : readsRight
        ? ['below', 'above', 'left', 'right']
        : ['below', 'above', 'right', 'left'];
    const candidates = order.map((k) => spots[k]);
    return candidates.find((s) => s.fits && clear(s.left, s.top)) ?? candidates.find((s) => s.fits) ?? spots.below;
  })();

  // ---- frozen rows and columns ----------------------------------------------

  /**
   * Frozen tracks hold their place on screen while the table runs off it: a
   * band drawn from the same SVG the table exports, pinned to the top (and
   * left) of the free board while the rest pans under it.
   */
  const frozen = layout.frozen;
  const stageTop = stage?.top ?? 0;
  const frozenH = frozen.rows > 0 ? rowTop(frozen.rows) : 0;
  const frozenW = frozen.cols > 0 ? colX(frozen.cols) : 0;
  const stickTop = frozen.rows > 0 && top < stageTop && top + (tableH - frozenH) * zoom > stageTop;
  const stickLeft = frozen.cols > 0 && left < freeLeft && left + (tableW - frozenW) * zoom > freeLeft;
  const svgMarkup = React.useMemo(
    () => (stickTop || stickLeft ? tableToSvg(shown, tableW, tableH, { id: node.id, sketch: node.appearance?.sketch, sketchSeed: node.appearance?.sketchSeed }) : ''),
    [stickTop, stickLeft, shown, tableW, tableH, node.id, node.appearance?.sketch, node.appearance?.sketchSeed]
  );
  const bandDown = (e: React.PointerEvent, ox: number, oy: number) => {
    e.preventDefault();
    e.stopPropagation();
    const x = (e.clientX - ox) / zoom;
    const y = (e.clientY - oy) / zoom;
    const vr = Math.max(0, Math.min(rows.length - 1, rowAtY(layout, y)));
    let c = 0;
    while (c < cols - 1 && x >= layout.colX[c] + layout.colW[c]) c++;
    sheet.cellPointerDown({ r: vr, c }, e);
  };

  // ---- the formula bar ------------------------------------------------------

  const [nameDraft, setNameDraft] = React.useState<string | null>(null);
  const focusName = (() => {
    const a = refNameIn(spec, rows[sheet.range.r0] ?? 0, sheet.range.c0) ?? '';
    if (!multi || !identity) return refNameIn(spec, focusStored.r, focusStored.c) ?? '';
    const b = refNameIn(spec, rows[sheet.range.r1] ?? 0, sheet.range.c1) ?? '';
    return `${a}:${b}`;
  })();
  /** Jump to a typed address — `C12`, or `B2:D9` to select a range. */
  const goToName = (text: string) => {
    const m = /^\s*\$?([A-Za-z]{1,3})\$?(\d+)(?::\$?([A-Za-z]{1,3})\$?(\d+))?\s*$/.exec(text);
    if (!m) return;
    const toPos = (letters: string, n: string): SheetPos | null => {
      const r = storedOf(skip, Number(n));
      const vr = rows.indexOf(r);
      let c = 0;
      for (const ch of letters.toUpperCase()) c = c * 26 + (ch.charCodeAt(0) - 64);
      c -= 1;
      return vr < 0 || c < 0 || c >= cols ? null : { r: vr, c };
    };
    const a = toPos(m[1], m[2]);
    if (!a) {
      say(`${text.trim().toUpperCase()} is not in this table${identity ? '' : ' as it is filtered'}`);
      return;
    }
    sheet.select(a);
    if (m[3] && m[4]) {
      const b = toPos(m[3], m[4]);
      if (b) sheet.select(b, true);
    }
  };
  const focusRaw = spec.cells[focusStored.r]?.[focusStored.c] ?? '';
  const fxValue = sheet.edit ? draft : focusRaw;

  const filtered = M.filtersActive(spec);
  const metaText = filtered
    ? `${rows.length - (spec.header ? 1 : 0)} of ${spec.cells.length - (spec.header ? 1 : 0)} rows`
    : `${spec.cells.length} × ${cols}`;
  const hiddenRuns: Array<{ from: number; to: number }> = [];
  spec.columns.forEach((col, c) => {
    if (!col.hidden) return;
    const last = hiddenRuns[hiddenRuns.length - 1];
    if (last && last.to === c - 1) last.to = c;
    else hiddenRuns.push({ from: c, to: c });
  });

  const pickerCell = picker ? boxOf(picker.vr, picker.c) : null;

  return createPortal(
    <>
      <div ref={barRef} className="tbled-bar" style={{ left: barLeft, top: barTop }} role="toolbar" aria-label="Table" {...portal}>
        <div className="tbled-bar__row">
          {/* Type: how the text looks. */}
          <div className="tbled-bar__group" role="group" aria-label="Text">
            <Tool label="Bold" shortcut="Ctrl B" pressed={Boolean(styleAtFocus.bold)} onClick={() => toggleStyle('bold')}>
              <Bold size={15} />
            </Tool>
            <Tool label="Italic" shortcut="Ctrl I" pressed={Boolean(styleAtFocus.italic)} onClick={() => toggleStyle('italic')}>
              <Italic size={15} />
            </Tool>
            <div className="tbled-bar__pop">
              <Tool label={`Text colour · ${colourName(INKS, styleAtFocus.color) ?? 'Automatic'}`} pressed={pop === 'ink'} onClick={() => openPop('ink')}>
                <Baseline size={15} />
                <span className="tbled-bar__chip" style={{ background: styleAtFocus.color ?? '#0F172A' }} />
              </Tool>
              {pop === 'ink' && (
                <div className="tbled-menu tbled-menu--swatches" role="group" aria-label="Text colour">
                  <button
                    type="button"
                    className="tbled-swatch tbled-swatch--none"
                    aria-label="Automatic text colour"
                    data-tooltip="Automatic"
                    onClick={() => run(() => style({ color: undefined }))}
                  />
                  {INKS.map((ink) => (
                    <button
                      key={ink.hex}
                      type="button"
                      className="tbled-swatch tbled-swatch--ink"
                      style={{ color: ink.hex }}
                      aria-label={`Text ${ink.name}`}
                      data-tooltip={ink.name}
                      aria-pressed={styleAtFocus.color === ink.hex}
                      onClick={() => run(() => style({ color: ink.hex }))}
                    >
                      A
                    </button>
                  ))}
                  <div className="tbled-menu__custom">
                    <ColorPickerPopover label="Custom" allowNone={false} color={styleAtFocus.color ?? '#0F172A'} onChange={(color) => style({ color })} contrastAgainst={styleAtFocus.fill ?? '#FFFFFF'} />
                  </div>
                </div>
              )}
            </div>
            <div className="tbled-bar__pop">
              <Tool label={`Cell fill · ${colourName(FILLS, styleAtFocus.fill) ?? 'None'}`} pressed={pop === 'fill'} onClick={() => openPop('fill')}>
                <PaintBucket size={15} />
                <span className="tbled-bar__chip" style={{ background: styleAtFocus.fill ?? 'transparent' }} />
              </Tool>
              {pop === 'fill' && (
                <div className="tbled-menu tbled-menu--swatches" role="group" aria-label="Cell fill">
                  <button type="button" className="tbled-swatch tbled-swatch--none" aria-label="No fill" data-tooltip="No fill" onClick={() => run(() => style({ fill: undefined }))} />
                  {FILLS.map((f) => (
                    <button
                      key={f.hex}
                      type="button"
                      className="tbled-swatch"
                      style={{ background: f.hex }}
                      aria-label={`Fill ${f.name}`}
                      data-tooltip={f.name}
                      aria-pressed={styleAtFocus.fill === f.hex}
                      onClick={() => run(() => style({ fill: f.hex }))}
                    />
                  ))}
                  <div className="tbled-menu__custom">
                    <ColorPickerPopover label="Custom" color={styleAtFocus.fill ?? '#FFFFFF'} onChange={(fill) => style({ fill: fill === 'transparent' ? undefined : fill })} />
                  </div>
                </div>
              )}
            </div>
            <Tool label="Wrap text" pressed={Boolean(styleAtFocus.wrap)} onClick={() => toggleStyle('wrap')}>
              <TextWrap size={15} />
            </Tool>
          </div>
          <span className="tbled-bar__sep" />
          {/* Align: where the text sits. */}
          <div className="tbled-bar__group" role="group" aria-label="Alignment">
            <Tool label="Align left" pressed={styleAtFocus.align === 'left'} onClick={() => align('left')}>
              <TextAlignStart size={15} />
            </Tool>
            <Tool label="Align centre" pressed={styleAtFocus.align === 'center'} onClick={() => align('center')}>
              <TextAlignCenter size={15} />
            </Tool>
            <Tool label="Align right" pressed={styleAtFocus.align === 'right'} onClick={() => align('right')}>
              <TextAlignEnd size={15} />
            </Tool>
            <div className="tbled-bar__pop">
              <Tool label="Vertical alignment" pressed={pop === 'valign'} onClick={() => openPop('valign')}>
                {styleAtFocus.valign === 'top' ? (
                  <AlignVerticalJustifyStart size={15} />
                ) : styleAtFocus.valign === 'bottom' ? (
                  <AlignVerticalJustifyEnd size={15} />
                ) : (
                  <AlignVerticalJustifyCenter size={15} />
                )}
              </Tool>
              {pop === 'valign' && (
                <div className="tbled-menu tbled-menu--list" role="menu">
                  <MenuItem icon={<AlignVerticalJustifyStart size={15} />} label="Top" pressed={styleAtFocus.valign === 'top'} onClick={() => run(() => valign('top'))} />
                  <MenuItem icon={<AlignVerticalJustifyCenter size={15} />} label="Middle" pressed={!styleAtFocus.valign} onClick={() => run(() => valign('middle'))} />
                  <MenuItem icon={<AlignVerticalJustifyEnd size={15} />} label="Bottom" pressed={styleAtFocus.valign === 'bottom'} onClick={() => run(() => valign('bottom'))} />
                </div>
              )}
            </div>
          </div>
          <span className="tbled-bar__sep" />
          {/* Data: what the values are and which rows show. */}
          <div className="tbled-bar__group" role="group" aria-label="Data">
            <div className="tbled-bar__pop">
              <Tool label={`Column type · ${CELL_TYPE_LABELS[typeAtFocus]}`} pressed={pop === 'format'} onClick={() => openPop('format')}>
                {TYPE_ICONS[typeAtFocus]}
                <ChevronDown size={12} className="tbled-tool__caret" />
              </Tool>
              {pop === 'format' && (
                <div className="tbled-menu tbled-menu--list" role="menu">
                  <div className="tbled-menu__label">
                    {sheet.range.c1 > sheet.range.c0
                      ? `Columns ${columnLetter(sheet.range.c0)}–${columnLetter(sheet.range.c1)}`
                      : `Column ${columnLetter(sheet.range.c0)}`}
                  </div>
                  {CELL_TYPES.map((t) => (
                    <MenuItem
                      key={t}
                      icon={TYPE_ICONS[t]}
                      label={CELL_TYPE_LABELS[t]}
                      pressed={typeAtFocus === t}
                      hint={typeAtFocus === t ? '✓' : undefined}
                      onClick={() => run(() => setType(t))}
                    />
                  ))}
                </div>
              )}
            </div>
            <div className="tbled-bar__pop">
              <Tool label="Functions" pressed={pop === 'fx'} onClick={() => openPop('fx')}>
                <Sigma size={15} />
              </Tool>
              {pop === 'fx' && (
                <div className="tbled-menu tbled-menu--list tbled-menu--fx" role="menu">
                  <div className="tbled-menu__label">Quick — reads the numbers above</div>
                  {QUICK_FUNCTIONS.map((name) => (
                    <MenuItem
                      key={name}
                      icon={<Sigma size={14} />}
                      label={name[0] + name.slice(1).toLowerCase()}
                      hint={name}
                      onClick={() => {
                        setPop(null);
                        autoFunction(name);
                      }}
                    />
                  ))}
                  <span className="tbled-ctx__sep" role="separator" />
                  <div className="tbled-menu__label">All functions</div>
                  {FORMULA_FUNCTIONS.map((f) => (
                    <button
                      key={f.name}
                      type="button"
                      role="menuitem"
                      className="tbled-fx__opt"
                      onPointerDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setPop(null);
                        writeFormula(`=${f.name}()`, 1);
                      }}
                    >
                      <span className="tbled-fx__name">{f.name}</span>
                      <span className="tbled-fx__optdoc">{f.doc}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="tbled-bar__pop">
              <Tool label={spec.sort ? `Sorted by ${columnLetter(spec.sort.col)}` : 'Sort'} pressed={pop === 'sort' || Boolean(spec.sort)} onClick={() => openPop('sort')}>
                {spec.sort?.dir === 'desc' ? <ArrowDownWideNarrow size={15} /> : <ArrowUpNarrowWide size={15} />}
              </Tool>
              {pop === 'sort' && (
                <div className="tbled-menu tbled-menu--list" role="menu">
                  <div className="tbled-menu__label">Column {columnLetter(focusStored.c)}</div>
                  <MenuItem
                    icon={<ArrowUpNarrowWide size={15} />}
                    label="A → Z, smallest first"
                    pressed={spec.sort?.col === focusStored.c && spec.sort.dir === 'asc'}
                    onClick={() => run(() => sortCol(focusStored.c, 'asc'))}
                  />
                  <MenuItem
                    icon={<ArrowDownWideNarrow size={15} />}
                    label="Z → A, largest first"
                    pressed={spec.sort?.col === focusStored.c && spec.sort.dir === 'desc'}
                    onClick={() => run(() => sortCol(focusStored.c, 'desc'))}
                  />
                  {spec.sort && (
                    <>
                      <Sep />
                      <MenuItem icon={<Eraser size={15} />} label="Back to the order as entered" onClick={() => run(() => sortCol(focusStored.c, null))} />
                      <MenuItem icon={<Check size={15} />} label="Keep this order" hint="writes it in" onClick={() => run(() => apply(M.applyView(live().table)))} />
                    </>
                  )}
                </div>
              )}
            </div>
            <div className="tbled-bar__pop">
              <Tool
                label={filtered ? 'Filtered — filter this column' : 'Filter this column'}
                pressed={pop === 'filter' || Boolean(filterOn(spec, focusStored.c))}
                onClick={() => openPop('filter')}
              >
                <Funnel size={15} />
              </Tool>
              {pop === 'filter' && (
                <div className="tbled-menu tbled-menu--panel">
                  <FilterPanel spec={spec} col={focusStored.c} apply={(next) => apply(next)} close={() => setPop(null)} />
                </div>
              )}
            </div>
            <Tool label="Chart this selection" onClick={() => chartSelection(sheet.range)}>
              <ChartColumn size={15} />
            </Tool>
          </div>
          <span className="tbled-bar__sep" />
          {/* Structure: cells, rows and columns. */}
          <div className="tbled-bar__group" role="group" aria-label="Structure">
            {merged && !canMerge ? (
              <Tool label="Unmerge" onClick={unmerge}>
                <TableCellsSplit size={15} />
              </Tool>
            ) : (
              <Tool label={identity ? 'Merge cells' : 'Merging needs the unsorted, unfiltered table'} disabled={!canMerge} onClick={merge}>
                <TableCellsMerge size={15} />
              </Tool>
            )}
            <div className="tbled-bar__pop">
              <Tool label="Rows and columns" pressed={pop === 'struct'} onClick={() => openPop('struct')}>
                <Rows3 size={15} />
              </Tool>
              {pop === 'struct' && (
                <div className="tbled-menu tbled-menu--list" role="menu">
                  <MenuItem
                    icon={<BetweenHorizontalStart size={15} />}
                    label="Row above"
                    disabled={spec.header && focusStored.r === 0}
                    onClick={() => run(() => insertRowAt(focusStored.r))}
                  />
                  <MenuItem icon={<BetweenHorizontalEnd size={15} />} label="Row below" onClick={() => run(() => insertRowAt(focusStored.r + 1))} />
                  <MenuItem icon={<BetweenVerticalStart size={15} />} label="Column left" onClick={() => run(() => insertColAt(focusStored.c))} />
                  <MenuItem icon={<BetweenVerticalEnd size={15} />} label="Column right" onClick={() => run(() => insertColAt(focusStored.c + 1))} />
                  <Sep />
                  <MenuItem
                    icon={<Snowflake size={15} />}
                    label={frozen.rows > 0 ? 'Unfreeze rows' : spec.header ? 'Freeze the header row' : 'Freeze the first row'}
                    onClick={() => run(() => freezeRows(frozen.rows > 0 ? 0 : 1))}
                  />
                  <MenuItem icon={<PanelBottom size={15} />} label={M.hasSummary(spec) ? 'Hide the summary row' : 'Show a summary row'} onClick={() => run(toggleSummary)} />
                  <Sep />
                  <MenuItem
                    icon={<Rows3 size={15} />}
                    tone="danger"
                    label={multi ? 'Delete selected rows' : 'Delete row'}
                    onClick={() => run(() => deleteViewRows(sheet.range.r0, sheet.range.r1))}
                  />
                  <MenuItem
                    icon={<Columns3 size={15} />}
                    tone="danger"
                    label={multi ? 'Delete selected columns' : 'Delete column'}
                    onClick={() => run(() => deleteColRange(sheet.range.c0, sheet.range.c1))}
                  />
                </div>
              )}
            </div>
            <Tool label="Fit columns to content" onClick={() => fitTableColumns(live())}>
              <UnfoldHorizontal size={15} />
            </Tool>
          </div>
          <span className="tbled-bar__spacer" />
          <span className="tbled-bar__meta" role="status" aria-live="polite">
            {notice ?? metaText}
          </span>
          <button
            type="button"
            className="tbled-bar__done"
            onClick={() => {
              sheet.commit();
              onClose();
            }}
          >
            <Check size={14} /> Done
          </button>
        </div>

        {/* The formula bar: where the focused cell is, and what it really holds. */}
        <div className="tbled-fx" role="group" aria-label="Formula bar">
          <input
            className="tbled-fx__name"
            aria-label="Cell address — type one to go to it"
            value={nameDraft ?? focusName}
            spellCheck={false}
            onFocus={(e) => {
              setNameDraft(focusName);
              e.currentTarget.select();
            }}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={() => setNameDraft(null)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') {
                goToName(nameDraft ?? '');
                setNameDraft(null);
                focusSink.current();
              } else if (e.key === 'Escape') {
                setNameDraft(null);
                focusSink.current();
              }
            }}
          />
          <span className="tbled-fx__mark" aria-hidden="true">
            fx
          </span>
          <input
            ref={fxInputRef}
            className="tbled-fx__input"
            aria-label="The focused cell's contents"
            spellCheck={false}
            value={fxValue}
            placeholder={isHeaderVr(sheet.focus.r) ? 'Column heading' : 'A value, or = to start a formula'}
            onFocus={(e) => {
              if (!sheet.edit) {
                setBarEditing(true);
                sheet.begin(sheet.focus);
              } else if (!barEditing) setBarEditing(true);
              const n = e.currentTarget.value.length;
              setCaret(n);
            }}
            onChange={(e) => {
              if (!sheet.edit) {
                setBarEditing(true);
                sheet.begin(sheet.focus, e.target.value);
              } else sheet.setDraft(e.target.value);
              setCaret(e.target.selectionEnd ?? e.target.value.length);
              lastInsert.current = null;
              setPick(0);
            }}
            onSelect={(e) => setCaret(e.currentTarget.selectionEnd ?? 0)}
            onKeyDown={onInputKey}
            onBlur={() => {
              if (barEditing && !refDrag.current) {
                sheet.commit();
                setBarEditing(false);
              }
            }}
          />
        </div>

        {pendingPaste && (
          <div className="tbled-paste" role="alert">
            <span>
              This view shows {Math.max(0, rows.length - pendingPaste.vr)} rows from here; the paste has {pendingPaste.block.cells.length}.
            </span>
            <button type="button" className="tbled-paste__go" onClick={() => resolvePending('clear')}>
              Clear the view and paste all
            </button>
            <button type="button" onClick={() => resolvePending('fit')}>
              Paste what fits
            </button>
            <button type="button" onClick={() => setPendingPaste(null)}>
              Cancel
            </button>
          </div>
        )}
      </div>

      <div
        ref={rootRef}
        className="tbled"
        data-dragging={drag ? drag.axis : undefined}
        style={
          {
            left,
            top,
            width: tableW,
            height: tableH,
            transform: `scale(${zoom})`,
            '--inv': 1 / zoom,
          } as React.CSSProperties
        }
        {...portal}
      >
        {/* Insert lanes: a dot on every boundary, a `+` when approached. The
            end boundary is the add strip's job, so the lanes stop one short. */}
        <div className="tbled__lane tbled__lane--cols">
          {span(0, cols - 1)
            .filter((b) => !spec.columns[b].hidden)
            .map((b) => (
              <InsertDot
                key={b}
                axis="col"
                style={{ left: colX(b) }}
                label={`Insert a column before ${columnLetter(b)}`}
                onHover={(on) => setHint(on ? { axis: 'col', at: b } : null)}
                onInsert={() => insertColAt(b)}
              />
            ))}
        </div>
        {identity && (
          <div className="tbled__lane tbled__lane--rows">
            {span(Math.max(floor, firstRow), lastRow).map((b) => (
              <InsertDot
                key={b}
                axis="row"
                style={{ top: rowTop(b) }}
                label={`Insert a row before row ${rowLabel(b)}`}
                onHover={(on) => setHint(on ? { axis: 'row', at: b } : null)}
                onInsert={() => insertRowAt(b)}
              />
            ))}
          </div>
        )}

        {/* Column letters: select a column, drag a selected one to move it,
            drag an edge to resize, double-click an edge to fit; the caret
            opens the column menu. */}
        <div className="tbled__cols">
          {layout.colX.map((x, c) => {
            if (spec.columns[c].hidden) return null;
            const inSel = c >= sheet.range.c0 && c <= sheet.range.c1;
            const colFilter = filterOn(spec, c);
            const marked = (colFilter && (colFilter.values || colFilter.query.trim())) || spec.sort?.col === c;
            return (
              <div
                key={c}
                ref={(el) => {
                  colHeadRefs.current[c] = el;
                }}
                className="tbled__colhead"
                data-selected={inSel || undefined}
                data-movable={(wholeCols && inSel) || undefined}
                data-frozen={c < frozen.cols || undefined}
                style={{ left: x, width: layout.colW[c] }}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  e.preventDefault();
                  setPop(null);
                  if (!e.shiftKey && wholeCols && inSel) startDrag('col', sheet.range.c0, sheet.range.c1, c, e);
                  else sheet.selectCol(c, e.shiftKey);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (!(wholeCols && inSel)) sheet.selectCol(c);
                  openColumnMenu(c, { x: e.clientX, y: e.clientY });
                }}
              >
                <span className="tbled__letter">{columnLetter(c)}</span>
                {marked && <span className="tbled__mark" aria-hidden="true" />}
                <button
                  type="button"
                  className="tbled__caret"
                  aria-label={`Column ${columnLetter(c)} menu`}
                  aria-haspopup="menu"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    openColumnMenu(c, null);
                  }}
                >
                  <ChevronDown />
                </button>
                <span
                  className="tbled__resize"
                  title="Drag to resize · double-click to fit"
                  onPointerDown={(e) => beginResize(c, e)}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    fitTableColumns(live(), [c]);
                  }}
                />
              </div>
            );
          })}
          {hiddenRuns.map((run) => (
            <button
              key={run.from}
              type="button"
              className="tbled__unhide"
              style={{ left: colX(run.from) }}
              aria-label={`Show hidden column${run.to > run.from ? 's' : ''} ${columnLetter(run.from)}${run.to > run.from ? `–${columnLetter(run.to)}` : ''}`}
              data-tooltip={`Show ${columnLetter(run.from)}${run.to > run.from ? `–${columnLetter(run.to)}` : ''}`}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => {
                let s = live().table;
                for (let c = run.from; c <= run.to; c++) s = M.setHidden(s, c, false);
                apply(s);
              }}
            >
              <Eye />
            </button>
          ))}
        </div>
        <div className="tbled__rows">
          {span(firstRow, lastRow).map((vr) => {
            const inSel = vr >= sheet.range.r0 && vr <= sheet.range.r1;
            return (
              <div
                key={vr}
                className="tbled__rowhead"
                data-selected={inSel || undefined}
                data-movable={(rowsMovable && inSel) || undefined}
                data-frozen={vr < frozen.rows || undefined}
                style={{ top: rowTop(vr), height: rowHt(vr) }}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  e.preventDefault();
                  setPop(null);
                  if (!e.shiftKey && rowsMovable && inSel) startDrag('row', sheet.range.r0, sheet.range.r1, vr, e);
                  else sheet.selectRow(vr, e.shiftKey);
                }}
                onContextMenu={(e) => openMenu('row', { r: vr, c: 0 }, e)}
              >
                {rowLabel(vr)}
                <span
                  className="tbled__rowresize"
                  title="Drag to resize · double-click to fit"
                  onPointerDown={(e) => beginRowResize(vr, e)}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    fitRow(vr);
                  }}
                />
              </div>
            );
          })}
        </div>

        <div className="tbled__grid" style={{ fontSize: layout.fontSize }}>
          <Cells cells={windowCells} editing={editKey} handlers={handlers} onFooter={openSummaryMenu} />

          {multi && !drag && !writingFormula && <div className="tbled__range" style={rectOf(sheet.range)} />}
          {!sheet.edit && !drag && <div className="tbled__focus" style={focusBox} />}
          {fillDrag && <div className="tbled__fillpreview" style={rectOf(fillDrag)} />}
          {showFill && (
            <span
              className="tbled__fill"
              style={{ left: rectOf(sheet.range).left + rectOf(sheet.range).width, top: rectOf(sheet.range).top + rectOf(sheet.range).height }}
              role="button"
              aria-label="Fill handle: drag to continue the series, double-click to fill down"
              data-tooltip="Drag to fill · double-click to fill down"
              onPointerDown={beginFillDrag}
              onDoubleClick={(e) => {
                e.stopPropagation();
                fillToNeighbour();
              }}
            />
          )}
          {refBoxes.map((b, i) => (
            <div key={i} className="tbled__refbox" style={{ ...b.box, '--ref': b.color } as React.CSSProperties} />
          ))}
          {drag && (
            <div
              className="tbled__lifted"
              style={
                drag.axis === 'col'
                  ? rectOf({ r0: 0, c0: drag.from, r1: rows.length - 1, c1: drag.to })
                  : rectOf({ r0: drag.from, c0: 0, r1: drag.to, c1: cols - 1 })
              }
            />
          )}
          {guide && (
            <div
              className="tbled__guide"
              data-axis={guide.axis}
              data-kind={guide.kind}
              style={guide.axis === 'col' ? { left: colX(guide.at) } : { top: rowTop(guide.at) }}
            />
          )}
          {sheet.edit && editBox && (
            <textarea
              ref={inputRef}
              className="tbled__input"
              data-formula={writingFormula || undefined}
              data-wrap={styleAtFocus.wrap || undefined}
              autoFocus={!barEditing}
              spellCheck={false}
              wrap={styleAtFocus.wrap ? 'soft' : 'off'}
              value={sheet.edit.draft}
              style={{
                ...editBox,
                width: styleAtFocus.wrap ? editBox.width : editWidth,
                minHeight: editBox.height,
                height: styleAtFocus.wrap ? 'auto' : editBox.height,
                fontSize: layout.fontSize,
                padding: styleAtFocus.wrap
                  ? `${Math.max(2, layout.fontSize * 0.45)}px ${layout.padX - 2}px`
                  : `${Math.max(0, (editBox.height - layout.fontSize * 1.35) / 2)}px ${layout.padX - 2}px 0`,
                textAlign: writingFormula ? 'left' : M.alignFor(spec, rows[sheet.edit.r] ?? 0, sheet.edit.c),
              }}
              // The caret goes to the end, never a select-all: an edit that
              // began with a keystroke would otherwise select that keystroke,
              // and the next one would replace it.
              onFocus={(e) => {
                const n = e.currentTarget.value.length;
                e.currentTarget.setSelectionRange(n, n);
                setCaret(n);
              }}
              onChange={(e) => {
                sheet.setDraft(e.target.value);
                setCaret(e.target.selectionEnd ?? e.target.value.length);
                lastInsert.current = null;
                setPick(0);
              }}
              onSelect={(e) => setCaret(e.currentTarget.selectionEnd ?? 0)}
              onKeyDown={onInputKey}
              onBlur={() => {
                if (!barEditing) sheet.commit();
              }}
            />
          )}
        </div>

        {/* Add at the end: the right edge takes a column, the bottom a row. */}
        <button
          type="button"
          tabIndex={-1}
          className="tbled__append"
          data-axis="col"
          aria-label="Add a column"
          data-tooltip="Add column"
          onPointerDown={(e) => e.preventDefault()}
          onPointerEnter={() => setHint({ axis: 'col', at: cols })}
          onPointerLeave={() => setHint(null)}
          onClick={() => insertColAt(cols)}
        >
          <span className="tbled__appendpill">
            <Plus />
          </span>
        </button>
        <button
          type="button"
          tabIndex={-1}
          className="tbled__append"
          data-axis="row"
          aria-label="Add a row"
          data-tooltip="Add row"
          onPointerDown={(e) => e.preventDefault()}
          onPointerEnter={() => setHint({ axis: 'row', at: rows.length })}
          onPointerLeave={() => setHint(null)}
          onClick={() => insertRowAt(live().table.cells.length)}
        >
          <span className="tbled__appendpill">
            <Plus />
          </span>
        </button>
        <textarea {...sheet.sinkProps} />
      </div>

      {stickTop && (
        <div
          className="tbled-band tbled-band--rows"
          style={{ left, top: stageTop, width: tableW * zoom, height: frozenH * zoom }}
          onPointerDown={(e) => bandDown(e, left, stageTop)}
          {...portal}
        >
          <svg viewBox={`0 0 ${tableW} ${frozenH}`} width={tableW * zoom} height={frozenH * zoom} aria-hidden="true" dangerouslySetInnerHTML={{ __html: svgMarkup }} />
        </div>
      )}
      {stickLeft && (
        <div
          className="tbled-band tbled-band--cols"
          style={{ left: freeLeft, top, width: frozenW * zoom, height: tableH * zoom }}
          onPointerDown={(e) => bandDown(e, freeLeft, top)}
          {...portal}
        >
          <svg viewBox={`0 0 ${frozenW} ${tableH}`} width={frozenW * zoom} height={tableH * zoom} aria-hidden="true" dangerouslySetInnerHTML={{ __html: svgMarkup }} />
        </div>
      )}

      {picker && pickerCell && (
        <CellPicker
          kind={typeOf(picker.c) === 'person' ? 'person' : 'select'}
          value={spec.cells[rows[picker.vr]]?.[picker.c] ?? ''}
          choices={pickerChoices(picker.c)}
          multi={typeOf(picker.c) === 'select' && Boolean(spec.columns[picker.c].multi)}
          initial={picker.initial}
          left={left + pickerCell.left * zoom}
          top={top + (pickerCell.top + pickerCell.height) * zoom + 4}
          minWidth={Math.max(220, pickerCell.width * zoom)}
          onChange={(value) => writePicked(picker.vr, picker.c, value)}
          onCreate={typeOf(picker.c) === 'select' ? () => undefined : undefined}
          onClose={(move) => {
            const at = picker;
            setPicker(null);
            if (move === 'down') sheet.select({ r: Math.min(rows.length - 1, at.vr + 1), c: at.c });
            else if (move === 'right') sheet.select({ r: at.vr, c: nextShown(at.c, 1) });
            focusSink.current();
          }}
        />
      )}

      {writingFormula && fxPlace && (
        <div
          ref={fxRef}
          className="tbled-fxbar"
          data-side={fxPlace.side}
          data-picking={picking || undefined}
          style={{ left: fxPlace.left, top: fxPlace.top }}
          role="group"
          aria-label="Formula"
          // Keeps the caret in the cell: nothing in here takes focus.
          onPointerDown={(e) => e.preventDefault()}
          {...portal}
        >
          <div className="tbled-fxbar__line">
            <span className="tbled-fxbar__fx" aria-hidden="true">
              fx
            </span>
            {draft.length > 1 ? (
              <code className="tbled-fxbar__echo">{echo}</code>
            ) : (
              <span className="tbled-fxbar__placeholder">Type a function like SUM, or click cells to reference them</span>
            )}
            {resultPreview && (
              <span className="tbled-fxbar__result" data-tone={resultPreview.tone}>
                {resultPreview.text}
              </span>
            )}
          </div>
          <div className="tbled-fxbar__line tbled-fxbar__line--aid">
            {suggestions.length > 0 ? (
              <>
                <div className="tbled-fxbar__chips" role="listbox" aria-label="Functions">
                  {suggestions.map((f, i) => (
                    <button
                      key={f.name}
                      type="button"
                      role="option"
                      aria-selected={i === picked}
                      className="tbled-fxbar__chip"
                      onPointerEnter={() => setPick(i)}
                      onClick={() => accept(f.name)}
                    >
                      {f.name}
                    </button>
                  ))}
                </div>
                <span className="tbled-fxbar__doc">{suggestions[picked]?.doc}</span>
                <kbd className="tbled-fxbar__key">Tab</kbd>
              </>
            ) : callFn && call ? (
              <Signature sig={callFn.sig} arg={call.arg} doc={callFn.doc} />
            ) : (
              <span className="tbled-fxbar__doc">Enter commits · Esc cancels · another table: ='Title'!B2:B9</span>
            )}
          </div>
        </div>
      )}

      {menu && (
        <div
          ref={menuRef}
          className="tbled-ctx"
          role="menu"
          aria-label="Table commands"
          style={{ left: menu.x, top: menu.y }}
          onContextMenu={(e) => e.preventDefault()}
          {...portal}
        >
          <MenuBody
            menu={menu}
            spec={spec}
            rows={rows}
            cols={cols}
            identity={identity}
            rowLabel={rowLabel}
            wrapped={Boolean(styleAtFocus.wrap)}
            actions={{
              insertRowAbove: () => run(() => insertRowAt(rows[menu.r0] ?? 0)),
              insertRowBelow: () => run(() => insertRowAt((rows[menu.r1] ?? 0) + 1)),
              insertColLeft: () => run(() => insertColAt(menu.c0)),
              insertColRight: () => run(() => insertColAt(menu.c1 + 1)),
              fit: () => run(() => fitTableColumns(live(), span(menu.c0, menu.c1))),
              fitRows: () => run(() => span(menu.r0, menu.r1).forEach((vr) => fitRow(vr))),
              sort: (dir) => run(() => sortCol(menu.c0, dir)),
              clear: () => run(() => apply(eachStored(menu, live().table, (s, r, c) => M.setCell(s, r, c, '')))),
              merge: () => run(() => apply(M.mergeRange(live().table, menu))),
              unmerge: () => run(() => apply(M.unmergeRange(live().table, menu))),
              deleteRows: () => run(() => deleteViewRows(menu.r0, menu.r1)),
              deleteCols: () => run(() => deleteColRange(menu.c0, menu.c1)),
              fillDown: () => run(() => fillShortcut('down', menu)),
              fillRight: () => run(() => fillShortcut('right', menu)),
              wrap: () => run(() => toggleStyle('wrap')),
              chart: () => run(() => chartSelection(menu)),
              freezeHere: () => run(() => freezeRows(frozen.rows === menu.r1 + 1 ? 0 : menu.r1 + 1)),
            }}
            frozenRows={frozen.rows}
          />
        </div>
      )}

      {appMenu && (
        <Menu
          entries={appEntries}
          label={appMenu.label}
          anchor={appMenu.anchor}
          focusFirst={appMenu.keys}
          onClose={() => {
            setAppMenu(null);
            focusSink.current();
          }}
        />
      )}
    </>,
    document.body
  );
};

/**
 * The cells, memoised — hit targets and the editor's own marks, not text: the
 * canvas underneath draws every cell's content, open or closed.
 *
 * The editor re-renders on every camera frame to stay over its table, and on
 * every hover of a `+`. None of that changes a cell, so the cells are their
 * own component, fed the rows near the viewport and a stable handlers ref —
 * a re-render of the editor does not reconcile a single cell unless the
 * window, the layout or the cell being typed into changed.
 */
const Cells = React.memo<{
  cells: TableCellBox[];
  editing: string | null;
  handlers: React.MutableRefObject<CellHandlers>;
  onFooter: (c: number, e: React.MouseEvent) => void;
}>(({ cells, editing, handlers, onFooter }) => (
  <>
    {cells.map((cell) => {
      const key = `${cell.vr}:${cell.c}`;
      if (cell.r < 0) {
        return (
          <button
            key={key}
            type="button"
            className="tbled__foot"
            style={{ left: cell.x, top: cell.y, width: cell.w, height: cell.h }}
            aria-label={cell.footer?.label ? `${cell.footer.label}: ${cell.text}. Change the summary` : 'Add a summary for this column'}
            onPointerDown={(e) => e.preventDefault()}
            onClick={(e) => onFooter(cell.c, e)}
          >
            {!cell.footer?.label && <span className="tbled__foot-add">Summarise</span>}
          </button>
        );
      }
      return (
        <div
          key={key}
          className="tbled__cell"
          data-header={cell.header || undefined}
          data-kind={cell.kind}
          data-editing={editing === key || undefined}
          style={{ left: cell.x, top: cell.y, width: cell.w, height: cell.h }}
          onPointerDown={(e) => handlers.current.down(cell, e)}
          onPointerEnter={() => handlers.current.enter(cell)}
          onClick={(e) => handlers.current.click(cell, e)}
          onDoubleClick={() => handlers.current.dbl(cell)}
          onContextMenu={(e) => handlers.current.menu(cell, e)}
        >
          {cell.formula && <span className="tbled__ftick" aria-hidden="true" />}
          {(cell.kind === 'select' || cell.kind === 'person') && <span className="tbled__chev" aria-hidden="true" />}
        </div>
      );
    })}
  </>
));
Cells.displayName = 'Cells';

/** A function's signature with the argument the caret is in set in bold. */
const Signature: React.FC<{ sig: string; arg: number; doc: string }> = ({ sig, arg, doc }) => {
  const open = sig.indexOf('(');
  const name = sig.slice(0, open);
  const params = sig.slice(open + 1, -1).split(', ').filter(Boolean);
  let at = Math.min(arg, params.length - 1);
  if (params[at] === '…') at = Math.max(0, params.length - 2);
  return (
    <div className="tbled-fxbar__sig">
      <code>
        {name}(
        {params.map((p, i) => (
          <React.Fragment key={i}>
            {i > 0 && ', '}
            {i === at ? <b>{p}</b> : p}
          </React.Fragment>
        ))}
        )
      </code>
      <span className="tbled-fxbar__doc">{doc}</span>
    </div>
  );
};

/** A boundary in an insert lane: a faint dot that opens into a `+`. */
const InsertDot: React.FC<{
  axis: Axis;
  style: React.CSSProperties;
  label: string;
  onHover: (on: boolean) => void;
  onInsert: () => void;
}> = ({ axis, style, label, onHover, onInsert }) => (
  <button
    type="button"
    tabIndex={-1}
    className="tbled__ins"
    data-axis={axis}
    style={style}
    aria-label={label}
    data-tooltip={label}
    onPointerDown={(e) => e.preventDefault()}
    onPointerEnter={() => onHover(true)}
    onPointerLeave={() => onHover(false)}
    onClick={() => {
      onHover(false);
      onInsert();
    }}
  >
    <span className="tbled__insdot">
      <Plus />
    </span>
  </button>
);

interface MenuActions {
  insertRowAbove: () => void;
  insertRowBelow: () => void;
  insertColLeft: () => void;
  insertColRight: () => void;
  fit: () => void;
  fitRows: () => void;
  sort: (dir: 'asc' | 'desc') => void;
  clear: () => void;
  merge: () => void;
  unmerge: () => void;
  deleteRows: () => void;
  deleteCols: () => void;
  fillDown: () => void;
  fillRight: () => void;
  wrap: () => void;
  chart: () => void;
  freezeHere: () => void;
}

/**
 * What a right-click offers, by where it landed.
 *
 * A number is about rows, and a cell about both — every spreadsheet's
 * arrangement; a letter opens the column menu. The heading names what the
 * menu acts on ("Rows 3–5"): a right-click inside a selection acts on the
 * selection and outside it on the one thing clicked, and that should never be
 * a surprise.
 */
const MenuBody: React.FC<{
  menu: MenuState;
  spec: TableSpec;
  rows: number[];
  cols: number;
  identity: boolean;
  rowLabel: (vr: number) => string;
  wrapped: boolean;
  frozenRows: number;
  actions: MenuActions;
}> = ({ menu, spec, rows, cols, identity, rowLabel, wrapped, frozenRows, actions }) => {
  const nCols = menu.c1 - menu.c0 + 1;
  const nRows = menu.r1 - menu.r0 + 1;
  const headerOnly = spec.header && rows[menu.r0] === 0 && nRows === 1;
  const title =
    menu.kind === 'row'
      ? nRows > 1
        ? `Rows ${rowLabel(menu.r0)}–${rowLabel(menu.r1)}`
        : headerOnly
          ? 'Header row'
          : `Row ${rowLabel(menu.r0)}`
      : nRows * nCols > 1
        ? `${nRows} × ${nCols} cells`
        : `Cell ${columnLetter(menu.c0)}${rowLabel(menu.r0)}`;
  const aboveBlocked = spec.header && rows[menu.r0] === 0;
  const isMerged = Boolean(M.mergeAt(spec, rows[menu.r0] ?? 0, menu.c0));
  const canMerge = identity && nRows * nCols > 1;
  const sorted = spec.sort?.col === menu.c0 ? spec.sort.dir : null;

  const rowItems = (
    <>
      <MenuItem
        icon={<ArrowUpToLine size={15} />}
        label="Insert row above"
        disabled={aboveBlocked}
        hint={aboveBlocked ? 'header stays on top' : undefined}
        onClick={actions.insertRowAbove}
      />
      <MenuItem icon={<ArrowDownToLine size={15} />} label="Insert row below" onClick={actions.insertRowBelow} />
    </>
  );
  const deleteRowItem = (
    <MenuItem
      icon={<Trash2 size={15} />}
      tone="danger"
      label={nRows > 1 ? `Delete ${nRows} rows` : 'Delete row'}
      disabled={nRows >= spec.cells.length}
      onClick={actions.deleteRows}
    />
  );

  return (
    <>
      <div className="tbled-ctx__head">{title}</div>
      {menu.kind === 'row' && (
        <>
          {rowItems}
          <Sep />
          <MenuItem icon={<UnfoldVertical size={15} />} label="Fit height to text" hint="double-click edge" onClick={actions.fitRows} />
          <MenuItem
            icon={<Snowflake size={15} />}
            label={frozenRows === menu.r1 + 1 ? 'Unfreeze rows' : `Freeze up to row ${rowLabel(menu.r1)}`}
            onClick={actions.freezeHere}
          />
          <MenuItem icon={<Eraser size={15} />} label="Clear contents" onClick={actions.clear} />
          <Sep />
          {deleteRowItem}
        </>
      )}
      {menu.kind === 'cell' && (
        <>
          <MenuItem icon={<ChartColumn size={15} />} label="Chart this" onClick={actions.chart} />
          <MenuItem icon={<ArrowDownToLine size={15} />} label="Fill down" hint="Ctrl D" disabled={!identity} onClick={actions.fillDown} />
          <MenuItem icon={<ArrowRightToLine size={15} />} label="Fill right" hint="Ctrl R" disabled={!identity} onClick={actions.fillRight} />
          <MenuItem icon={<TextWrap size={15} />} label={wrapped ? 'Stop wrapping text' : 'Wrap text'} onClick={actions.wrap} />
          <Sep />
          {rowItems}
          <MenuItem icon={<ArrowLeftToLine size={15} />} label="Insert column left" onClick={actions.insertColLeft} />
          <MenuItem icon={<ArrowRightToLine size={15} />} label="Insert column right" onClick={actions.insertColRight} />
          <Sep />
          <MenuItem icon={<UnfoldHorizontal size={15} />} label={nCols > 1 ? 'Fit columns to content' : 'Fit column to content'} hint="double-click edge" onClick={actions.fit} />
          <MenuItem icon={<ArrowUpNarrowWide size={15} />} label={`Sort ${columnLetter(menu.c0)}, A → Z`} pressed={sorted === 'asc'} onClick={() => actions.sort('asc')} />
          <MenuItem icon={<ArrowDownWideNarrow size={15} />} label={`Sort ${columnLetter(menu.c0)}, Z → A`} pressed={sorted === 'desc'} onClick={() => actions.sort('desc')} />
          <Sep />
          {isMerged && !canMerge ? (
            <MenuItem icon={<TableCellsSplit size={15} />} label="Unmerge" onClick={actions.unmerge} />
          ) : (
            <MenuItem
              icon={<TableCellsMerge size={15} />}
              label="Merge cells"
              disabled={!canMerge}
              hint={!identity ? 'turn off sort and filter' : undefined}
              onClick={actions.merge}
            />
          )}
          <MenuItem icon={<Eraser size={15} />} label="Clear contents" hint="Delete" onClick={actions.clear} />
          <Sep />
          {deleteRowItem}
          <MenuItem
            icon={<Trash2 size={15} />}
            tone="danger"
            label={nCols > 1 ? `Delete ${nCols} columns` : 'Delete column'}
            disabled={nCols >= cols}
            onClick={actions.deleteCols}
          />
        </>
      )}
    </>
  );
};
