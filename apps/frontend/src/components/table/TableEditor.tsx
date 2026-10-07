import React from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Eye, Plus } from 'lucide-react';
import './table.css';
import './tableTools.css';
import { useStore } from '../../hooks/useStore';
import { cameraSystem } from '../../engine/CameraSystem';
import { engineEvents } from '../../engine/EventBus';
import { textEditing } from '../../engine/interaction/textEditing';
import { undoManager } from '../../engine/document';
import { canEditObjects, subscribeRoomRole } from '../../engine/model/permissions';
import { collaboratorStore } from '../../engine/presence/collaboratorStore';
import { createChartFromTableRange } from '../../engine/chart/chartFromTable';
import { layoutTable, rowAtY, safeHref, type TableCellBox } from '../../engine/table/tableLayout';
import { checkboxHit, ratingHit } from '../../engine/table/tablePaint';
import { paintMeasure, tableMeasure } from '../../engine/table/tableMeasure';
import { buildSketch, primsCache } from '../../engine/table/tableCanvas';
import { ensureTableRegistry } from '../../engine/table/tableRegistry';
import * as M from '../../engine/table/tableModel';
import {
  drawnHeight,
  fitTableColumns,
  fitTableRows,
  rowHeightOf,
  saveDefaultView,
  updateTable,
  updateTableGrowing,
} from '../../engine/table/tableApply';
import { effectiveSpec, hasOwnView, resetView, subscribeViews, viewsVersion } from '../../engine/table/tableView';
import { subscribeNothing, subscribeVolatile, volatileEpoch } from '../../engine/table/tableVolatile';
import {
  bindTableId,
  FORMULA_FUNCTIONS,
  formulaError,
  hasVolatile,
  isFormula,
  referencesIn,
  refNameIn,
  rowLabel as labelOfRow,
  storedOf,
} from '../../engine/table/tableFormula';
import { clipToHtml, clipToTsv, copyCells, encodeClip, VEGA_CELLS, type PastedBlock } from '../../engine/table/tableClipboard';
import { refsSkipHeader, SUMMARY_LABELS, filterOn, type CellAlign, type CellStyle, type CellType, type CellVAlign, type SummaryAgg, type TableSpec } from '../../engine/table/tableTypes';
import type { TableNode } from '../../engine/model/schema';
import { seedFor } from '../../engine/model/rough';
import { PORTAL_SURFACE_ATTR } from '../ui/portalSurface';
import { Menu, type MenuAnchor } from '../menu/Menu';
import type { MenuEntry } from '../menu/menuModel';
import { columnLetter, useSheet, type SheetPos, type SheetRange } from '../sheet/useSheet';
import { columnMenuEntries, columnName, setSummary } from './columnMenu';
import { FilterPanel } from './FilterPanel';
import { CellPicker, type PickerChoice } from './CellPicker';
import { FrozenBand } from './FrozenBand';
import { MenuBody, type MenuState } from './TableContextMenu';
import { TableToolbar, type Pop, type ToolbarModel } from './TableToolbar';
import { callAt, Cells, InsertDot, Signature, span, spokenCell, type Axis, type CellHandlers } from './tableEditorParts';
import { pasteBlock, readClipboardBlock } from './tableEditorClipboard';

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
 * ## Whose view, and who may write
 *
 * The grid shows this person's own sort and filter (`tableView.ts`): choosing
 * one writes nothing to the board. A viewer or commenter gets the same grid
 * read-only — select, copy, sort and filter for themselves — and a plain
 * "View only" in the toolbar; nothing here offers them an edit, so nothing
 * here attempts one.
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

const subscribeRole = (fn: () => void) => subscribeRoomRole(() => fn());

export const TableEditor: React.FC<{ nodeId: string; onClose: () => void; readOnly?: boolean }> = ({ nodeId, onClose, readOnly }) => {
  const node = useStore((s) => s.objects[nodeId]);
  // The role can change while the editor is open; the grid follows it.
  const canEdit = React.useSyncExternalStore(subscribeRole, canEditObjects, canEditObjects);
  React.useEffect(() => {
    if (!node || node.type !== 'table') onClose();
  }, [node, onClose]);
  if (!node || node.type !== 'table') return null;
  return <Editor node={node} onClose={onClose} readOnly={Boolean(readOnly) || !canEdit} />;
};

ensureTableRegistry();

const Editor: React.FC<{ node: TableNode; onClose: () => void; readOnly: boolean }> = ({ node, onClose, readOnly }) => {
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

  // This person's own sort and filter, and TODAY's minute.
  const viewVersion = React.useSyncExternalStore(subscribeViews, viewsVersion, () => 0);
  const minute = React.useSyncExternalStore(hasVolatile(node.table) ? subscribeVolatile : subscribeNothing, volatileEpoch, () => 0);
  const spec = React.useMemo(
    () => effectiveSpec(node.id, node.table),
    // viewVersion: the view lives outside the node.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [node.id, node.table, viewVersion]
  );
  const ownView = hasOwnView(node.id);
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
    // The drag's draft is this table, for any formula that reads it by title.
    return s === spec ? s : bindTableId(s, node.id);
  }, [spec, widths, heights, node.id]);
  const tableW = liveWidth ?? node.width;
  const tableH = liveHeight ?? drawnHeight(node, spec);
  const layout = React.useMemo(
    () => layoutTable(shown, tableW, tableH),
    // minute: TODAY and NOW move without the spec changing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shown, tableW, tableH, minute]
  );
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
  const sketch = node.appearance?.sketch;
  const measure = React.useMemo(() => paintMeasure(Boolean(sketch)), [sketch]);

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
  /** The table as this person sees it *now*: every edit is made to this. */
  const liveSpec = () => effectiveSpec(node.id, live().table);
  const apply = (next: TableSpec, extra?: { width?: number; height?: number }) => updateTable(live(), next, extra);
  /** An edit to some columns' text: they widen (and wrapped rows grow) to show it, in the same step. */
  const grow = (next: TableSpec, touched: number[]) => updateTableGrowing(live(), next, touched);

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
  const timers = React.useRef(new Set<number>());
  React.useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((t) => window.clearTimeout(t));
  }, []);
  const say = (text: string) => {
    setNotice(text);
    const t = window.setTimeout(() => {
      timers.current.delete(t);
      setNotice((n) => (n === text ? null : n));
    }, 2600);
    timers.current.add(t);
  };

  const typeOf = (c: number): CellType => spec.columns[c]?.type ?? 'text';
  const isHeaderVr = (vr: number) => spec.header && rows[vr] === 0;

  // ---- writing blocks -------------------------------------------------------

  /** Write a block in from a drawn cell; a block longer than a sorted or filtered view waits for a decision. */
  const writeBlockAt = (vr: number, c: number, block: PastedBlock, base = liveSpec()) => {
    const out = pasteBlock(base, vr, c, block);
    if ('pending' in out) {
      setPendingPaste({ vr, c, block });
      return null;
    }
    grow(out.spec, out.touched);
    return out.range;
  };

  const resolvePending = (how: 'clear' | 'fit') => {
    const p = pendingPaste;
    setPendingPaste(null);
    if (!p) return;
    const s = liveSpec();
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

  const clearRange = (range: SheetRange) => {
    const s = liveSpec();
    apply(M.setCells(s, Array.from(M.storedCells(range, M.viewRows(s)), ([r, c]) => [r, c, ''] as const)));
  };

  const sheet = useSheet({
    rows: rows.length,
    cols,
    readOnly,
    read: (vr, c) => spec.cells[rows[vr]]?.[c] ?? '',
    write: (vr, c, text) => {
      const s = liveSpec();
      const r = M.viewRows(s)[vr];
      if (r !== undefined) grow(M.setCell(s, r, c, text), [c]);
    },
    writeBlock: (vr, c, block) => {
      writeBlockAt(vr, c, { cells: block, styles: block.map((line) => line.map(() => null)), merges: [] });
    },
    clear: clearRange,
    appendRow: () => {
      const s = liveSpec();
      apply(M.insertRows(s, s.cells.length, 1));
    },
    onFormat: (key) => toggleStyle(key),
    onExit: onClose,
    onUndo: () => undoManager.undo(),
    onRedo: () => undoManager.redo(),
    onFill: (dir, range) => fillShortcut(dir, range),
    intercept: (e, focus, range) => interceptKey(e, focus, range),
    copy: (range) => {
      const s = liveSpec();
      const order = M.viewRows(s);
      const clip = copyCells(
        s,
        span(range.r0, range.r1).map((vr) => order[vr]).filter((r) => r !== undefined),
        range
      );
      return { plain: clipToTsv(clip), html: clipToHtml(clip), json: { type: VEGA_CELLS, data: encodeClip(clip) } };
    },
    paste: (data, range, valuesOnly) => {
      const block = readClipboardBlock(data, liveSpec(), range, valuesOnly);
      if (!block || !block.cells.length) return null;
      return writeBlockAt(range.r0, range.c0, block) ?? range;
    },
  });
  const focusSink = React.useRef(sheet.focusSink);
  focusSink.current = sheet.focusSink;

  const focusStored = { r: rows[sheet.focus.r] ?? 0, c: sheet.focus.c };

  // ---- formatting -----------------------------------------------------------

  /** A style on the selection, written once — a column at a time when whole columns are selected. */
  const style = (patch: CellStyle) => {
    const s = liveSpec();
    apply(M.styleStored(s, sheet.range, M.viewRows(s), patch));
  };
  const styleAtFocus = M.cellStyleAt(spec, focusStored.r, focusStored.c) ?? {};
  const toggleStyle = (key: 'bold' | 'italic' | 'wrap') => {
    if (key !== 'wrap') {
      style({ [key]: styleAtFocus[key] ? undefined : true });
      return;
    }
    // Wrapping changes how tall rows need to be, so it is a growing edit.
    const s = liveSpec();
    grow(M.styleStored(s, sheet.range, M.viewRows(s), { wrap: styleAtFocus.wrap ? undefined : true }), span(sheet.range.c0, sheet.range.c1));
  };
  const align = (a: CellAlign) => style({ align: styleAtFocus.align === a ? undefined : a });
  const valign = (v: CellVAlign) => style({ valign: v === 'middle' ? undefined : v });
  const setType = (type: CellType) => {
    let s = liveSpec();
    for (let c = sheet.range.c0; c <= sheet.range.c1; c++) s = M.setColumnType(s, c, type);
    apply(s);
  };
  const typeAtFocus = typeOf(focusStored.c);

  // ---- structure ------------------------------------------------------------

  /** Insert a stored row, and put the cursor at its start so typing fills it. */
  const insertRowAt = (stored: number) => {
    const s = liveSpec();
    apply(M.insertRows(s, stored, 1));
    if (M.isIdentityView(s)) sheet.place({ r: stored, c: 0 });
  };
  /** Insert a column, and put the cursor on its heading so typing names it. */
  const insertColAt = (at: number) => {
    apply(M.insertCols(liveSpec(), at, 1));
    sheet.place({ r: 0, c: at });
  };

  /** Delete the stored rows behind drawn rows `vr0..vr1`. */
  const deleteViewRows = (vr0: number, vr1: number) => {
    const s = liveSpec();
    const order = M.viewRows(s);
    const stored = new Set<number>();
    for (let vr = vr0; vr <= vr1; vr++) if (order[vr] !== undefined) stored.add(order[vr]);
    let next = s;
    [...stored].sort((a, b) => b - a).forEach((r) => (next = M.deleteRows(next, r, 1)));
    apply(next);
  };
  const deleteColRange = (c0: number, c1: number) => apply(M.deleteCols(liveSpec(), c0, c1 - c0 + 1));
  const merged = M.mergeAt(spec, focusStored.r, focusStored.c);
  const canMerge = identity && (sheet.range.r1 > sheet.range.r0 || sheet.range.c1 > sheet.range.c0);
  const merge = () => apply(M.mergeRange(liveSpec(), sheet.range));
  const unmerge = () => apply(M.unmergeRange(liveSpec(), sheet.range));
  const multi = sheet.range.r1 > sheet.range.r0 || sheet.range.c1 > sheet.range.c0;
  const freezeRows = (n: number) => {
    const s = liveSpec();
    const cur = s.frozen;
    apply({ ...s, frozen: n > 0 || cur?.cols ? { rows: n, cols: cur?.cols ?? 0 } : undefined });
  };
  const toggleSummary = () => {
    const s = liveSpec();
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

  /** This person's sort: it goes to their own view and writes nothing. */
  const sortCol = (c: number, dir: 'asc' | 'desc' | null) => {
    const s = liveSpec();
    const same = dir && s.sort?.col === c && s.sort.dir === dir;
    apply({ ...s, sort: !dir || same ? undefined : { col: c, dir } });
  };

  // ---- rich cells -----------------------------------------------------------

  /** Tick or untick every checkbox cell in a range, all to the opposite of the focused one. */
  const toggleChecks = (range: SheetRange, at: SheetPos) => {
    const s = liveSpec();
    const r = rows[at.r];
    const on = !M.isChecked(s.cells[r]?.[at.c] ?? '');
    const edits = Array.from(M.storedCells(range, M.viewRows(s)))
      .filter(([rr, c]) => s.columns[c]?.type === 'checkbox' && !(s.header && rr === 0) && !isFormula(s.cells[rr]?.[c] ?? ''))
      .map(([rr, c]) => [rr, c, on ? 'TRUE' : 'FALSE'] as const);
    apply(M.setCells(s, edits));
  };
  const setRating = (range: SheetRange, n: number) => {
    const s = liveSpec();
    const edits = Array.from(M.storedCells(range, M.viewRows(s)))
      .filter(([r, c]) => s.columns[c]?.type === 'rating' && !(s.header && r === 0))
      .map(([r, c]) => [r, c, n ? String(n) : ''] as const);
    apply(M.setCells(s, edits));
  };

  const openPicker = (p: SheetPos, initial = '') => {
    if (readOnly) return;
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
    let s = liveSpec();
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
      if (!readOnly && !header && (t === 'select' || t === 'person') && !isFormula(raw)) openPicker(focus);
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
    if (readOnly || header || mod || e.altKey || isFormula(raw)) return false;
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
    const s = liveSpec();
    if (!M.isIdentityView(s)) {
      say('Filling needs the unsorted, unfiltered table');
      return;
    }
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
    const s = liveSpec();
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
    const s = liveSpec();
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
    // The preview is this table, too: a reference to it by title reads it.
    const text = M.formatCell(bindTableId(M.setCell(spec, r, sheet.edit.c, draft), node.id), r, sheet.edit.c);
    return { text: `= ${text || '(empty)'}`, tone: /^#/.test(text) ? ('error' as const) : ('ok' as const) };
  }, [writingFormula, draft, spec, rows, sheet.edit, node.id]);
  const measureText = React.useMemo(() => tableMeasure(Boolean(sketch)), [sketch]);

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
    if (e.button !== 0 || readOnly) return;
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
      const s = liveSpec();
      apply({ ...s, columns: s.columns.map((col, i) => ({ ...col, width: current[i] ?? col.width })) }, last ? { width } : undefined);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  /** Drag a row's bottom edge: the row takes more of the height, and the table grows by it. */
  const beginRowResize = (vr: number, e: React.PointerEvent) => {
    if (e.button !== 0 || readOnly) return;
    e.preventDefault();
    e.stopPropagation();
    const r = rows[vr];
    if (r === undefined) return;
    const startY = e.clientY;
    const unit = rowHeightOf(live());
    const start = Array.from({ length: spec.cells.length }, (_, i) => spec.rowHeights?.[i] ?? 1);
    const startH = tableH;
    const nodeH = node.height;
    let current = start;
    let moved = false;
    let delta = 0;
    const move = (ev: PointerEvent) => {
      const dy = (ev.clientY - startY) / zoom;
      if (!moved && Math.abs(dy) * zoom < 2) return;
      moved = true;
      const w = Math.min(20, Math.max(0.4, start[r] + dy / unit));
      current = start.map((x, i) => (i === r ? w : x));
      delta = (w - start[r]) * unit;
      setHeights(current);
      setLiveHeight(startH + delta);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      setHeights(null);
      setLiveHeight(null);
      if (!moved) return;
      apply({ ...liveSpec(), rowHeights: current.some((x) => x !== 1) ? current : undefined }, { height: nodeH + delta });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  /** A double-click on a row's edge: wrapped rows fit their lines, others go back to standard. */
  const fitRow = (vr: number) => {
    if (readOnly) return;
    const r = rows[vr];
    if (r === undefined) return;
    if (fitTableRows(live(), [r])) return;
    const s = liveSpec();
    if ((s.rowHeights?.[r] ?? 1) !== 1) {
      const unit = rowHeightOf(live());
      apply(M.setRowHeight(s, r, 1), { height: live().height + (1 - (s.rowHeights?.[r] ?? 1)) * unit });
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
      const s = liveSpec();
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
  const rowsMovable = !readOnly && identity && wholeRows && sheet.range.r0 >= floor;

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
          readOnly,
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
        { kind: 'item', id: 'none', label: 'None', ...(agg === null ? { trailing: <Check size={14} aria-label="Current" /> } : null), onSelect: () => apply(setSummary(liveSpec(), c, null)) },
        ...M.summaryChoices(typeOf(c)).map(
          (a): MenuEntry => ({
            kind: 'item',
            id: a,
            label: SUMMARY_LABELS[a],
            ...(agg === a ? { trailing: <Check size={14} aria-label="Current" /> } : null),
            onSelect: () => apply(setSummary(liveSpec(), c, a)),
          })
        ),
        { kind: 'separator', id: 's' },
        { kind: 'item', id: 'off', label: 'Hide the summary row', onSelect: () => apply({ ...liveSpec(), summary: undefined }) },
      ],
    });
  };

  const menuRef = React.useRef<HTMLDivElement>(null);
  const openMenu = (kind: MenuState['kind'], at: { r: number; c: number }, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (readOnly) {
      if (!sheet.inRange(at.r, at.c)) sheet.select(at);
      return;
    }
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
    const s = liveSpec();
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
      if (cell.kind === 'url' && (e.metaKey || e.ctrlKey)) {
        const href = safeHref(cell.text);
        if (href) window.open(href, '_blank', 'noopener,noreferrer');
        return;
      }
      if (readOnly) return;
      const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const x = cell.x + (e.clientX - box.left) / zoom;
      const y = cell.y + (e.clientY - box.top) / zoom;
      if (cell.kind === 'checkbox' && checkboxHit(cell, layout, x, y, measure)) toggleChecks({ r0: cell.vr, c0: cell.c, r1: cell.vr, c1: cell.c }, { r: cell.vr, c: cell.c });
      else if (cell.kind === 'rating') {
        const n = ratingHit(cell, layout, x, y, measure);
        // A click on the star already set clears it: the way back to none.
        if (n !== null) setRating({ r0: cell.vr, c0: cell.c, r1: cell.vr, c1: cell.c }, n === cell.rating ? 0 : n);
      }
    },
    dbl: (cell) => {
      if (readOnly) return;
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
  const showFill = !readOnly && identity && !sheet.edit && !drag && !writingFormula && !picker && !fillDrag;

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
   * band pinned to the top (and left) of the free board while the rest pans
   * under it, painted from the same layout (`FrozenBand`).
   */
  const frozen = layout.frozen;
  const stageTop = stage?.top ?? 0;
  const frozenH = frozen.rows > 0 ? rowTop(frozen.rows) : 0;
  const frozenW = frozen.cols > 0 ? colX(frozen.cols) : 0;
  const stickTop = frozen.rows > 0 && top < stageTop && top + (tableH - frozenH) * zoom > stageTop;
  const stickLeft = frozen.cols > 0 && left < freeLeft && left + (tableW - frozenW) * zoom > freeLeft;
  const bandSeed = React.useMemo(() => seedFor(node.id, node.appearance?.sketchSeed), [node.id, node.appearance?.sketchSeed]);
  const bandPaint = React.useMemo(() => {
    if (!stickTop && !stickLeft) return null;
    return {
      prims: primsCache(layout, measure, Boolean(sketch)),
      sketchPaths: sketch && typeof Path2D !== 'undefined' ? buildSketch(layout, bandSeed, sketch) : null,
    };
  }, [stickTop, stickLeft, layout, measure, sketch, bandSeed]);
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
  const status = notice ?? (ownView ? `Your view · ${metaText}` : metaText);
  const hiddenRuns: Array<{ from: number; to: number }> = [];
  spec.columns.forEach((col, c) => {
    if (!col.hidden) return;
    const last = hiddenRuns[hiddenRuns.length - 1];
    if (last && last.to === c - 1) last.to = c;
    else hiddenRuns.push({ from: c, to: c });
  });

  const pickerCell = picker ? boxOf(picker.vr, picker.c) : null;

  /** What a screen reader hears as the cursor moves: where, under which heading, and what is there. */
  const focusCell = cellAt.get(sheet.focus.r * 4096 + sheet.focus.c);
  const heading = spec.header && !isHeaderVr(sheet.focus.r) ? columnName(spec, sheet.focus.c) : '';
  const announce = `${columnLetter(sheet.focus.c)}${rowLabel(sheet.focus.r)}${heading ? `, ${heading}` : ''}: ${focusCell ? spokenCell(focusCell) : 'Empty'}${multi ? `, ${sheet.range.r1 - sheet.range.r0 + 1} by ${sheet.range.c1 - sheet.range.c0 + 1} selected` : ''}`;

  const toolbar: ToolbarModel = {
    spec,
    readOnly,
    pop,
    openPop,
    closePop: () => setPop(null),
    run,
    styleAtFocus,
    typeAtFocus,
    focus: focusStored,
    cols: { c0: sheet.range.c0, c1: sheet.range.c1 },
    multi,
    identity,
    canMerge,
    merged: Boolean(merged),
    frozenRows: frozen.rows,
    hasSummary: M.hasSummary(spec),
    ownView,
    status,
    toggleStyle,
    style,
    align,
    valign,
    setType,
    autoFunction,
    writeFormula,
    sortCol,
    keepOrder: () => apply(M.applyView(liveSpec())),
    applySpec: (next) => apply(next),
    chart: () => chartSelection(sheet.range),
    merge,
    unmerge,
    insertRowAt,
    insertColAt,
    freezeRows,
    toggleSummary,
    deleteRows: () => deleteViewRows(sheet.range.r0, sheet.range.r1),
    deleteCols: () => deleteColRange(sheet.range.c0, sheet.range.c1),
    fitAll: () => fitTableColumns(live()),
    saveDefaultView: () => saveDefaultView(live()),
    resetView: () => resetView(node.id),
    done: () => {
      sheet.commit();
      onClose();
    },
  };

  return createPortal(
    <>
      <div ref={barRef} className="tbled-bar" style={{ left: barLeft, top: barTop }} role="toolbar" aria-label={readOnly ? 'Table, view only' : 'Table'} {...portal}>
        <TableToolbar m={toolbar} />

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
            readOnly={readOnly}
            value={fxValue}
            placeholder={readOnly ? '' : isHeaderVr(sheet.focus.r) ? 'Column heading' : 'A value, or = to start a formula'}
            onFocus={(e) => {
              if (readOnly) return;
              if (!sheet.edit) {
                setBarEditing(true);
                sheet.begin(sheet.focus);
              } else if (!barEditing) setBarEditing(true);
              const n = e.currentTarget.value.length;
              setCaret(n);
            }}
            onChange={(e) => {
              if (readOnly) return;
              if (!sheet.edit) {
                setBarEditing(true);
                sheet.begin(sheet.focus, e.target.value);
              } else sheet.setDraft(e.target.value);
              setCaret(e.target.selectionEnd ?? e.target.value.length);
              lastInsert.current = null;
              setPick(0);
            }}
            onSelect={(e) => setCaret(e.currentTarget.selectionEnd ?? 0)}
            onKeyDown={(e) => {
              if (readOnly) {
                e.stopPropagation();
                if (e.key === 'Escape' || e.key === 'Enter') focusSink.current();
                return;
              }
              onInputKey(e);
            }}
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
        data-readonly={readOnly || undefined}
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
        {!readOnly && (
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
        )}
        {!readOnly && identity && (
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
                data-movable={(!readOnly && wholeCols && inSel) || undefined}
                data-frozen={c < frozen.cols || undefined}
                style={{ left: x, width: layout.colW[c] }}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  e.preventDefault();
                  setPop(null);
                  if (!readOnly && !e.shiftKey && wholeCols && inSel) startDrag('col', sheet.range.c0, sheet.range.c1, c, e);
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
                {!readOnly && (
                  <span
                    className="tbled__resize"
                    title="Drag to resize · double-click to fit"
                    onPointerDown={(e) => beginResize(c, e)}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      fitTableColumns(live(), [c]);
                    }}
                  />
                )}
              </div>
            );
          })}
          {!readOnly &&
            hiddenRuns.map((run) => (
              <button
                key={run.from}
                type="button"
                className="tbled__unhide"
                style={{ left: colX(run.from) }}
                aria-label={`Show hidden column${run.to > run.from ? 's' : ''} ${columnLetter(run.from)}${run.to > run.from ? `–${columnLetter(run.to)}` : ''}`}
                data-tooltip={`Show ${columnLetter(run.from)}${run.to > run.from ? `–${columnLetter(run.to)}` : ''}`}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => {
                  let s = liveSpec();
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
                {!readOnly && (
                  <span
                    className="tbled__rowresize"
                    title="Drag to resize · double-click to fit"
                    onPointerDown={(e) => beginRowResize(vr, e)}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      fitRow(vr);
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>

        <div
          className="tbled__grid"
          role="grid"
          aria-label={readOnly ? 'Table cells, view only' : 'Table cells'}
          aria-readonly={readOnly || undefined}
          aria-rowcount={rows.length + (layout.footer ? 1 : 0)}
          aria-colcount={cols}
          aria-multiselectable="true"
          style={{ fontSize: layout.fontSize }}
        >
          <Cells
            cells={windowCells}
            editing={editKey}
            handlers={handlers}
            onFooter={openSummaryMenu}
            r0={sheet.range.r0}
            c0={sheet.range.c0}
            r1={sheet.range.r1}
            c1={sheet.range.c1}
            readOnly={readOnly}
          />

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
              aria-label={`Editing ${columnLetter(sheet.edit.c)}${rowLabel(sheet.edit.r)}`}
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
        {!readOnly && (
          <>
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
              onClick={() => insertRowAt(liveSpec().cells.length)}
            >
              <span className="tbled__appendpill">
                <Plus />
              </span>
            </button>
          </>
        )}
        <textarea {...sheet.sinkProps} aria-readonly={readOnly || undefined} />
        <div className="tbled__announce" role="status" aria-live="polite" aria-atomic="true">
          {announce}
        </div>
      </div>

      {stickTop && bandPaint && (
        <FrozenBand
          axis="rows"
          layout={layout}
          prims={bandPaint.prims}
          sketch={sketch}
          sketchPaths={bandPaint.sketchPaths}
          zoom={zoom}
          left={left}
          top={stageTop}
          extent={frozenH}
          rowLabels={span(0, frozen.rows - 1).map((vr) => ({ top: rowTop(vr), height: rowHt(vr), label: rowLabel(vr) }))}
          onPointerDown={(e) => bandDown(e, left, stageTop)}
          portal={portal}
        />
      )}
      {stickLeft && bandPaint && (
        <FrozenBand
          axis="cols"
          layout={layout}
          prims={bandPaint.prims}
          sketch={sketch}
          sketchPaths={bandPaint.sketchPaths}
          zoom={zoom}
          left={freeLeft}
          top={top}
          extent={frozenW}
          onPointerDown={(e) => bandDown(e, freeLeft, top)}
          portal={portal}
        />
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
              clear: () => run(() => clearRange(menu)),
              merge: () => run(() => apply(M.mergeRange(liveSpec(), menu))),
              unmerge: () => run(() => apply(M.unmergeRange(liveSpec(), menu))),
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
