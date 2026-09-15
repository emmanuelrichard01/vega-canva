import React from 'react';
import { createPortal } from 'react-dom';
import {
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
  Check,
  Columns3,
  Eraser,
  Funnel,
  FunnelX,
  Hash,
  Italic,
  PaintBucket,
  Plus,
  Rows3,
  Sigma,
  TableCellsMerge,
  TableCellsSplit,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignStart,
  Trash2,
  UnfoldHorizontal,
} from 'lucide-react';
import './table.css';
import { useStore } from '../../hooks/useStore';
import { cameraSystem } from '../../engine/CameraSystem';
import { engineEvents } from '../../engine/EventBus';
import { textEditing } from '../../engine/interaction/textEditing';
import { layoutTable, type TableCellBox } from '../../engine/table/tableLayout';
import * as M from '../../engine/table/tableModel';
import { fitTableColumns, updateTable, updateTableGrowing } from '../../engine/table/tableApply';
import { tableMeasure } from '../../engine/table/tableMeasure';
import { FORMULA_FUNCTIONS, formulaError, isFormula, referencesIn, refName, storedOf } from '../../engine/table/tableFormula';
import {
  CELL_TYPES,
  CELL_TYPE_LABELS,
  type CellAlign,
  type CellStyle,
  type CellType,
  type TableSpec,
} from '../../engine/table/tableTypes';
import type { TableNode } from '../../engine/model/schema';
import { PORTAL_SURFACE_ATTR } from '../ui/portalSurface';
import { columnLetter, useSheet, type SheetRange } from '../sheet/useSheet';

/**
 * A table's cells, open for editing where the table is.
 *
 * ## In place, not in a dialog
 *
 * Every tool this is measured against — FigJam, Miro, Lucidchart, Notion —
 * edits a table on the page. So the editor is a DOM grid laid exactly over
 * the node: the same `layoutTable` the canvas draws, scaled by the camera, so
 * every cell sits on its own drawn cell. The canvas keeps drawing the rules
 * and fills underneath and steps its text back while this is open.
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
 * - **Right-click** a letter, a number or a cell for what applies there.
 *
 * ## Columns fit their content
 *
 * Typing a value wider than its column widens the column (up to a limit; see
 * `tableFit.ts`), in the same undo step as the text. Double-clicking a
 * column's edge fits it exactly; the toolbar fits them all.
 *
 * ## Formulas
 *
 * A cell that starts with `=` is a formula (`tableFormula.ts`). While one is
 * being typed, the cells it reads are outlined in colour, a click or a drag on
 * the grid writes a reference instead of leaving the cell, and a panel under
 * the cell suggests functions, shows the signature of the one the caret is
 * in, and previews the result before it is committed — the spreadsheet
 * conventions, so nothing here has to be learned.
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
const BAR_H = 42;
/** World px per width unit — the table tool's column width — when a drag turns shares into widths. */
const UNIT = 150;
/** Rows rendered at a time, in whole chunks, so a pan re-renders the grid only when it crosses one. */
const CHUNK = 24;

const FILLS = ['#FFFFFF', '#F1F5F9', '#FEF3C7', '#DCFCE7', '#DBEAFE', '#EDE9FE', '#FCE7F3', '#FEE2E2', '#1E293B'];
/** Text inks: each holds AA on white and on the light fills above. */
const INKS = ['#0F172A', '#475569', '#B91C1C', '#C2410C', '#A16207', '#15803D', '#0E7490', '#1D4ED8', '#6D28D9', '#BE185D'];
/** The colours references are outlined in, in order of appearance — as every spreadsheet does. */
const REF_COLORS = ['#2563EB', '#DC2626', '#059669', '#9333EA', '#EA580C', '#0891B2'];
const TYPE_SAMPLE: Record<CellType, string> = {
  text: 'Abc',
  number: '1,234.5',
  currency: '$1,234.50',
  percent: '12.5%',
  date: 'Mar 6, 2026',
};
const QUICK_FUNCTIONS = ['SUM', 'AVERAGE', 'COUNT', 'MIN', 'MAX'];

type Axis = 'col' | 'row';
type Pop = 'fill' | 'ink' | 'format' | 'fx' | 'filter' | 'struct' | null;

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

export const TableEditor: React.FC<{ nodeId: string; onClose: () => void }> = ({ nodeId, onClose }) => {
  const node = useStore((s) => s.objects[nodeId]);
  React.useEffect(() => {
    if (!node || node.type !== 'table') onClose();
  }, [node, onClose]);
  if (!node || node.type !== 'table') return null;
  return <Editor node={node} onClose={onClose} />;
};

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
  /** Column shares while an edge is being dragged, and the table width while the last one is. */
  const [widths, setWidths] = React.useState<number[] | null>(null);
  const [liveWidth, setLiveWidth] = React.useState<number | null>(null);
  const shown: TableSpec = React.useMemo(
    () => (widths ? { ...spec, columns: spec.columns.map((c, i) => ({ ...c, width: widths[i] ?? c.width })) } : spec),
    [spec, widths]
  );
  const tableW = liveWidth ?? node.width;
  const layout = React.useMemo(() => layoutTable(shown, tableW, node.height), [shown, tableW, node.height]);
  const cellAt = React.useMemo(() => {
    const m = new Map<number, TableCellBox>();
    for (const cell of layout.cells) m.set(cell.vr * 4096 + cell.c, cell);
    return m;
  }, [layout]);
  const rows = layout.rows;
  const cols = spec.columns.length;
  const rowH = layout.rowH;
  const identity = M.isIdentityView(spec);
  /** The first row that can move or be inserted before: the header stays on top. */
  const floor = spec.header ? 1 : 0;

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
  const barTop = above < 8 ? top + node.height * zoom + BELOW_REACH + CLEARANCE : above;
  const barLeft = Math.max(8, left - ROW_GUTTER_REACH);

  // Only the rows near the viewport, in whole chunks.
  const firstRow = Math.max(0, (Math.floor(-top / zoom / rowH / CHUNK) - 1) * CHUNK);
  const lastRow = Math.min(rows.length - 1, (Math.floor((window.innerHeight - top) / zoom / rowH / CHUNK) + 2) * CHUNK);
  const windowCells = React.useMemo(() => {
    const y0 = firstRow * rowH;
    const y1 = (lastRow + 1) * rowH;
    return layout.cells.filter((c) => c.y + c.h >= y0 && c.y <= y1);
  }, [layout, firstRow, lastRow, rowH]);

  /** The node as it is *now*, so a burst of edits never writes over itself. */
  const live = () => {
    const n = useStore.getState().objects[node.id];
    return n && n.type === 'table' ? n : node;
  };
  const apply = (next: TableSpec, extra?: { width?: number }) => updateTable(live(), next, extra);
  /** An edit to some columns' text: they widen to show it, in the same step. */
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
      const s = live().table;
      const touched = span(c, c + Math.max(1, ...block.map((line) => line.length)) - 1);
      if (M.isIdentityView(s)) {
        grow(M.setBlock(s, vr, c, block), touched);
        return;
      }
      const order = M.viewRows(s);
      let next = s;
      block.forEach((line, i) => {
        const r = order[vr + i];
        if (r === undefined) return;
        line.forEach((text, j) => {
          if (c + j < next.columns.length) next = M.setCell(next, r, c + j, text);
        });
      });
      grow(next, touched);
    },
    clear: (range) => apply(eachStored(range, live().table, (s, r, c) => M.setCell(s, r, c, ''))),
    appendRow: () => {
      const s = live().table;
      apply(M.insertRows(s, s.cells.length, 1));
    },
    onFormat: (key) => toggleStyle(key),
    onExit: onClose,
  });
  const focusSink = React.useRef(sheet.focusSink);
  focusSink.current = sheet.focusSink;

  const focusStored = { r: rows[sheet.focus.r] ?? 0, c: sheet.focus.c };

  // ---- formatting -----------------------------------------------------------

  const style = (patch: CellStyle) => apply(eachStored(sheet.range, live().table, (s, r, c) => M.styleRange(s, { r0: r, c0: c, r1: r, c1: c }, patch)));
  const styleAtFocus = spec.styles?.[`${focusStored.r}:${focusStored.c}`] ?? {};
  const toggleStyle = (key: 'bold' | 'italic') => style({ [key]: styleAtFocus[key] ? undefined : true });
  const align = (a: CellAlign) => style({ align: styleAtFocus.align === a ? undefined : a });
  const setType = (type: CellType) => {
    let s = live().table;
    for (let c = sheet.range.c0; c <= sheet.range.c1; c++) s = M.setColumn(s, c, { type });
    apply(s);
  };
  const typeAtFocus = spec.columns[focusStored.c]?.type ?? 'text';

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

  // ---- view -----------------------------------------------------------------

  const sortCol = (c: number, dir: 'asc' | 'desc') => {
    const s = live().table;
    const same = s.sort?.col === c && s.sort.dir === dir;
    apply({ ...s, sort: same ? undefined : { col: c, dir } });
  };
  const [filterDraft, setFilterDraft] = React.useState(spec.filter?.query ?? '');
  const applyFilter = (query: string) => {
    const s = live().table;
    apply({ ...s, filter: query.trim() ? { col: focusStored.c, query } : undefined });
  };

  // ---- formulas -------------------------------------------------------------

  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = React.useState(0);
  const [pick, setPick] = React.useState(0);
  const [dismissed, setDismissed] = React.useState<string | null>(null);
  /** The span of the reference a click last wrote, so the next click replaces it. */
  const lastInsert = React.useRef<{ start: number; end: number } | null>(null);
  /** The cell a reference drag started on. */
  const refDrag = React.useRef<{ r: number; c: number } | null>(null);
  /** While references are being clicked in, the help steps back so it can never be in the way. */
  const [picking, setPicking] = React.useState(false);

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
      const el = inputRef.current;
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
      const el = inputRef.current;
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
    let top = r - 1;
    while (top >= floor && numeric(top)) top--;
    top++;
    const a = identity && top <= r - 1 ? refName(s.header, top, c) : null;
    const b = a ? refName(s.header, r - 1, c) : null;
    if (a && b) writeFormula(`=${fn}(${a}:${b})`);
    else writeFormula(`=${fn}()`, 1);
  };

  const insertable = () => {
    const el = inputRef.current;
    if (!el || !writingFormula) return false;
    const pos = el.selectionStart ?? draft.length;
    if (lastInsert.current && lastInsert.current.end === pos) return true;
    return /[=(,;+\-*/^&<>:]\s*$/.test(draft.slice(0, pos));
  };

  /** Write a reference to a stored cell at the caret — or over the one the last click wrote. */
  const insertRef = (r: number, c: number): boolean => {
    const name = refName(spec.header, r, c);
    const el = inputRef.current;
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
    if (!a || !span0 || (spec.header && r === 0)) return;
    const lo = refName(spec.header, Math.min(a.r, r), Math.min(a.c, c));
    const hi = refName(spec.header, Math.max(a.r, r), Math.max(a.c, c));
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
        const r0 = storedOf(spec.header, ref.r0);
        const r1 = storedOf(spec.header, ref.r1);
        if (ref.r0 < 1 || ref.c0 >= cols) return [];
        if (identity) {
          const a = Math.max(floor, r0);
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

  const onInputKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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
  };

  // ---- column resize --------------------------------------------------------

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
    const total = start.reduce((a, b) => a + b, 0);
    const startW = node.width;
    const last = c === cols - 1;
    let current = start;
    let width = startW;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / zoom;
      if (!moved && Math.abs(dx) * zoom < 2) return;
      moved = true;
      if (last) {
        const px = start.map((w) => (startW * w) / total);
        const own = Math.max(40, px[c] + dx);
        width = startW - px[c] + own;
        current = px.map((p, i) => (i === c ? own : p) / UNIT);
        setLiveWidth(width);
      } else {
        const dw = dx * (total / startW);
        const a = Math.max(0.2, start[c] + dw);
        const b = Math.max(0.2, start[c + 1] - (a - start[c]));
        current = start.map((w, i) => (i === c ? a : i === c + 1 ? b : w));
      }
      setWidths(current);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
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
    return Math.max(floor, Math.min(rows.length, Math.round(y / rowH)));
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
  };

  const wholeCols = sheet.range.r0 === 0 && sheet.range.r1 === rows.length - 1;
  const wholeRows = sheet.range.c0 === 0 && sheet.range.c1 === cols - 1;
  const rowsMovable = identity && wholeRows && sheet.range.r0 >= floor;

  // ---- menus ----------------------------------------------------------------

  const menuRef = React.useRef<HTMLDivElement>(null);
  const openMenu = (kind: MenuState['kind'], at: { r: number; c: number }, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (sheet.edit) sheet.commit();
    setPop(null);
    const r = sheet.range;
    let box = { r0: at.r, r1: at.r, c0: at.c, c1: at.c };
    if (kind === 'col') {
      const inside = wholeCols && at.c >= r.c0 && at.c <= r.c1;
      box = inside ? { ...r } : { r0: 0, r1: rows.length - 1, c0: at.c, c1: at.c };
      if (!inside) sheet.selectCol(at.c);
    } else if (kind === 'row') {
      const inside = wholeRows && at.r >= r.r0 && at.r <= r.r1;
      box = inside ? { ...r } : { r0: at.r, r1: at.r, c0: 0, c1: cols - 1 };
      if (!inside) sheet.selectRow(at.r);
    } else if (sheet.inRange(at.r, at.c)) {
      box = { ...r };
    } else {
      sheet.select(at);
    }
    setMenu({ kind, ...box, x: Math.min(e.clientX, window.innerWidth - 248), y: Math.min(e.clientY, window.innerHeight - 400) });
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

  // ---- the grid's handlers, stable for the memoised cells --------------------

  const handlers = React.useRef<CellHandlers>(null as unknown as CellHandlers);
  handlers.current = {
    down: (cell, e) => {
      // Mid-formula, a click on the grid writes a reference instead of leaving the cell.
      if (e.button === 0 && insertable() && !(spec.header && cell.r === 0)) {
        e.preventDefault();
        e.stopPropagation();
        if (insertRef(cell.r, cell.c)) return;
      }
      setPop(null);
      sheet.cellPointerDown({ r: cell.vr, c: cell.c }, e);
    },
    enter: (cell) => {
      if (refDrag.current) extendRef(cell.r, cell.c);
      else sheet.cellPointerEnter({ r: cell.vr, c: cell.c });
    },
    dbl: (cell) => sheet.begin({ r: cell.vr, c: cell.c }),
    menu: (cell, e) => openMenu('cell', { r: cell.vr, c: cell.c }, e),
  };

  // ---- leaving --------------------------------------------------------------

  const barRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!t) return;
      if (rootRef.current?.contains(t) || barRef.current?.contains(t)) return;
      if (t.closest?.(`[${PORTAL_SURFACE_ATTR}]`)) return;
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
    return { left: x, top: range.r0 * rowH, width: w, height: (range.r1 - range.r0 + 1) * rowH };
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
    return spec.header && r === 0 ? 'H' : String((r ?? vr) + (spec.header ? 0 : 1));
  };
  const editKey = sheet.edit ? `${sheet.edit.r}:${sheet.edit.c}` : null;

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
   * spot the toolbar already occupies is skipped.
   *
   * History, because both earlier answers were wrong: it first opened under
   * the cell on `=` whatever the formula read, covering the cells it wanted
   * clicked; then it docked to the toolbar, clear of the grid but nowhere
   * near what was being typed. Measured each render, so a second line of
   * suggestions moves it rather than pushing it off screen.
   */
  const fxRef = React.useRef<HTMLDivElement>(null);
  const [fxSize, setFxSize] = React.useState({ w: 440, h: 72 });
  React.useLayoutEffect(() => {
    const el = fxRef.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    if (Math.abs(w - fxSize.w) > 1 || Math.abs(h - fxSize.h) > 1) setFxSize({ w, h });
  });
  const fxPlace = (() => {
    if (!editBox) return null;
    const a = { left: left + editBox.left * zoom, top: top + editBox.top * zoom, width: editWidth * zoom, height: editBox.height * zoom };
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const gap = 8;
    const m = 8;
    const { w, h } = fxSize;
    const bar = { left: barLeft, top: barTop, right: barLeft + (barRef.current?.offsetWidth ?? 720), bottom: barTop + BAR_H };
    const clearOfBar = (x: number, y: number) => x + w <= bar.left || x >= bar.right || y + h <= bar.top || y >= bar.bottom;
    const cx = (x: number) => Math.max(m, Math.min(vw - w - m, x));
    const cy = (y: number) => Math.max(m, Math.min(vh - h - m, y));
    const spots = {
      below: { left: cx(a.left), top: a.top + a.height + gap, side: 'below', fits: a.top + a.height + gap + h <= vh - m },
      above: { left: cx(a.left), top: a.top - gap - h, side: 'above', fits: a.top - gap - h >= m },
      right: { left: a.left + a.width + gap, top: cy(a.top), side: 'right', fits: a.left + a.width + gap + w <= vw - m },
      left: { left: a.left - gap - w, top: cy(a.top), side: 'left', fits: a.left - gap - w >= m },
    };
    const readsBelow = refBoxes.some((b) => b.box.top >= editBox.top + editBox.height - 0.5);
    const readsRight = refBoxes.some((b) => b.box.left >= editBox.left + editWidth - 0.5);
    const order: Array<keyof typeof spots> = readsBelow
      ? ['above', 'right', 'left', 'below']
      : readsRight
        ? ['below', 'above', 'left', 'right']
        : ['below', 'above', 'right', 'left'];
    const candidates = order.map((k) => spots[k]);
    return candidates.find((s) => s.fits && clearOfBar(s.left, s.top)) ?? candidates.find((s) => s.fits) ?? spots.below;
  })();

  return createPortal(
    <>
      <div ref={barRef} className="tbled-bar" style={{ left: barLeft, top: barTop }} role="toolbar" aria-label="Table" {...portal}>
        <div className="tbled-bar__group">
          <Tool label="Bold" shortcut="Ctrl B" pressed={Boolean(styleAtFocus.bold)} onClick={() => toggleStyle('bold')}>
            <Bold size={15} />
          </Tool>
          <Tool label="Italic" shortcut="Ctrl I" pressed={Boolean(styleAtFocus.italic)} onClick={() => toggleStyle('italic')}>
            <Italic size={15} />
          </Tool>
          <div className="tbled-bar__pop">
            <Tool label="Text colour" pressed={pop === 'ink'} onClick={() => openPop('ink')}>
              <Baseline size={15} />
              <span className="tbled-bar__chip" style={{ background: styleAtFocus.color ?? '#0F172A' }} />
            </Tool>
            {pop === 'ink' && (
              <div className="tbled-menu tbled-menu--swatches">
                <button
                  type="button"
                  className="tbled-swatch tbled-swatch--none"
                  aria-label="Automatic text colour"
                  data-tooltip="Automatic"
                  onClick={() => run(() => style({ color: undefined }))}
                />
                {INKS.map((ink) => (
                  <button
                    key={ink}
                    type="button"
                    className="tbled-swatch tbled-swatch--ink"
                    style={{ color: ink }}
                    aria-label={`Text ${ink}`}
                    aria-pressed={styleAtFocus.color === ink}
                    onClick={() => run(() => style({ color: ink }))}
                  >
                    A
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="tbled-bar__pop">
            <Tool label="Cell fill" pressed={pop === 'fill'} onClick={() => openPop('fill')}>
              <PaintBucket size={15} />
              <span className="tbled-bar__chip" style={{ background: styleAtFocus.fill ?? 'transparent' }} />
            </Tool>
            {pop === 'fill' && (
              <div className="tbled-menu tbled-menu--swatches">
                <button type="button" className="tbled-swatch tbled-swatch--none" aria-label="No fill" onClick={() => run(() => style({ fill: undefined }))} />
                {FILLS.map((f) => (
                  <button
                    key={f}
                    type="button"
                    className="tbled-swatch"
                    style={{ background: f }}
                    aria-label={`Fill ${f}`}
                    aria-pressed={styleAtFocus.fill === f}
                    onClick={() => run(() => style({ fill: f }))}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
        <span className="tbled-bar__sep" />
        <div className="tbled-bar__group">
          <Tool label="Align left" pressed={styleAtFocus.align === 'left'} onClick={() => align('left')}>
            <TextAlignStart size={15} />
          </Tool>
          <Tool label="Align centre" pressed={styleAtFocus.align === 'center'} onClick={() => align('center')}>
            <TextAlignCenter size={15} />
          </Tool>
          <Tool label="Align right" pressed={styleAtFocus.align === 'right'} onClick={() => align('right')}>
            <TextAlignEnd size={15} />
          </Tool>
        </div>
        <span className="tbled-bar__sep" />
        <div className="tbled-bar__group">
          <div className="tbled-bar__pop">
            <Tool label={`Number format · ${CELL_TYPE_LABELS[typeAtFocus]}`} pressed={pop === 'format'} onClick={() => openPop('format')}>
              <Hash size={15} />
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
                    icon={<Check size={14} style={{ opacity: typeAtFocus === t ? 1 : 0 }} />}
                    label={CELL_TYPE_LABELS[t]}
                    hint={TYPE_SAMPLE[t]}
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
        </div>
        <span className="tbled-bar__sep" />
        <div className="tbled-bar__group">
          {merged && !canMerge ? (
            <Tool label="Unmerge" onClick={unmerge}>
              <TableCellsSplit size={15} />
            </Tool>
          ) : (
            <Tool label={identity ? 'Merge cells' : 'Merging needs the unsorted, unfiltered table'} disabled={!canMerge} onClick={merge}>
              <TableCellsMerge size={15} />
            </Tool>
          )}
          <Tool label="Fit columns to content" onClick={() => fitTableColumns(live())}>
            <UnfoldHorizontal size={15} />
          </Tool>
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
                <span className="tbled-ctx__sep" role="separator" />
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
        </div>
        <span className="tbled-bar__sep" />
        <div className="tbled-bar__group">
          <Tool
            label={`Sort ${columnLetter(focusStored.c)} ascending`}
            pressed={spec.sort?.col === focusStored.c && spec.sort.dir === 'asc'}
            onClick={() => sortCol(focusStored.c, 'asc')}
          >
            <ArrowUpNarrowWide size={15} />
          </Tool>
          <Tool
            label={`Sort ${columnLetter(focusStored.c)} descending`}
            pressed={spec.sort?.col === focusStored.c && spec.sort.dir === 'desc'}
            onClick={() => sortCol(focusStored.c, 'desc')}
          >
            <ArrowDownWideNarrow size={15} />
          </Tool>
          <div className="tbled-bar__pop">
            <Tool label="Filter by this column" pressed={pop === 'filter' || Boolean(spec.filter)} onClick={() => openPop('filter')}>
              <Funnel size={15} />
            </Tool>
            {pop === 'filter' && (
              <div className="tbled-menu tbled-menu--filter">
                <label className="tbled-filter">
                  <span className="tbled-filter__col">{spec.cells[0]?.[focusStored.c] || columnLetter(focusStored.c)}</span>
                  <input
                    autoFocus
                    value={filterDraft}
                    placeholder={spec.columns[focusStored.c]?.type === 'text' ? 'Contains…' : '>10, <5, 5..20'}
                    onChange={(e) => setFilterDraft(e.target.value)}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter') {
                        applyFilter(filterDraft);
                        setPop(null);
                      } else if (e.key === 'Escape') setPop(null);
                    }}
                  />
                </label>
                {spec.filter && (
                  <button
                    type="button"
                    className="tbled-menu__action"
                    onClick={() => {
                      setFilterDraft('');
                      applyFilter('');
                      setPop(null);
                    }}
                  >
                    <FunnelX size={13} /> Clear filter
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
        <span className="tbled-bar__sep" />
        <span className="tbled-bar__meta">
          {spec.filter ? `${rows.length - (spec.header ? 1 : 0)} of ${spec.cells.length - (spec.header ? 1 : 0)} rows` : `${spec.cells.length} × ${cols}`}
        </span>
        <button type="button" className="tbled-bar__done" onClick={() => { sheet.commit(); onClose(); }}>
          <Check size={14} /> Done
        </button>
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
            height: node.height,
            transform: `scale(${zoom})`,
            '--inv': 1 / zoom,
          } as React.CSSProperties
        }
        {...portal}
      >
        {/* Insert lanes: a dot on every boundary, a `+` when approached. The
            end boundary is the add strip's job, so the lanes stop one short. */}
        <div className="tbled__lane tbled__lane--cols">
          {span(0, cols - 1).map((b) => (
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
                style={{ top: b * rowH }}
                label={`Insert a row before row ${rowLabel(b)}`}
                onHover={(on) => setHint(on ? { axis: 'row', at: b } : null)}
                onInsert={() => insertRowAt(b)}
              />
            ))}
          </div>
        )}

        {/* Column letters: select a column, drag a selected one to move it,
            drag an edge to resize, double-click an edge to fit. */}
        <div className="tbled__cols">
          {layout.colX.map((x, c) => {
            const inSel = c >= sheet.range.c0 && c <= sheet.range.c1;
            return (
              <div
                key={c}
                className="tbled__colhead"
                data-selected={inSel || undefined}
                data-movable={(wholeCols && inSel) || undefined}
                style={{ left: x, width: layout.colW[c] }}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  e.preventDefault();
                  setPop(null);
                  if (!e.shiftKey && wholeCols && inSel) startDrag('col', sheet.range.c0, sheet.range.c1, c, e);
                  else sheet.selectCol(c, e.shiftKey);
                }}
                onContextMenu={(e) => openMenu('col', { r: 0, c }, e)}
              >
                {columnLetter(c)}
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
                style={{ top: vr * rowH, height: rowH }}
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
              </div>
            );
          })}
        </div>

        <div className="tbled__grid" style={{ fontSize: layout.fontSize }}>
          <Cells cells={windowCells} padX={layout.padX} editing={editKey} handlers={handlers} />

          {multi && !drag && !writingFormula && <div className="tbled__range" style={rectOf(sheet.range)} />}
          {!sheet.edit && !drag && <div className="tbled__focus" style={focusBox} />}
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
              style={guide.axis === 'col' ? { left: colX(guide.at) } : { top: guide.at * rowH }}
            />
          )}
          {sheet.edit && editBox && (
            <textarea
              ref={inputRef}
              className="tbled__input"
              data-formula={writingFormula || undefined}
              autoFocus
              spellCheck={false}
              wrap="off"
              value={sheet.edit.draft}
              style={{
                ...editBox,
                width: editWidth,
                fontSize: layout.fontSize,
                padding: `${Math.max(0, (editBox.height - layout.fontSize * 1.35) / 2)}px ${layout.padX - 2}px 0`,
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
              onBlur={() => sheet.commit()}
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
              <span className="tbled-fxbar__doc">Enter commits · Esc cancels · Σ in the toolbar lists every function</span>
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
            actions={{
              insertRowAbove: () => run(() => insertRowAt(rows[menu.r0] ?? 0)),
              insertRowBelow: () => run(() => insertRowAt((rows[menu.r1] ?? 0) + 1)),
              insertColLeft: () => run(() => insertColAt(menu.c0)),
              insertColRight: () => run(() => insertColAt(menu.c1 + 1)),
              fit: () => run(() => fitTableColumns(live(), span(menu.c0, menu.c1))),
              sort: (dir) => run(() => sortCol(menu.c0, dir)),
              clear: () => run(() => apply(eachStored(menu, live().table, (s, r, c) => M.setCell(s, r, c, '')))),
              merge: () => run(() => apply(M.mergeRange(live().table, menu))),
              unmerge: () => run(() => apply(M.unmergeRange(live().table, menu))),
              deleteRows: () => run(() => deleteViewRows(menu.r0, menu.r1)),
              deleteCols: () => run(() => deleteColRange(menu.c0, menu.c1)),
            }}
          />
        </div>
      )}
    </>,
    document.body
  );
};

/**
 * The cells, memoised.
 *
 * The editor re-renders on every camera frame to stay over its table, and on
 * every hover of a `+`. None of that changes a cell, so the cells are their
 * own component, fed the rows near the viewport and a stable handlers ref —
 * a re-render of the editor does not reconcile a single cell unless the
 * window, the layout or the cell being typed into changed.
 */
const Cells = React.memo<{
  cells: TableCellBox[];
  padX: number;
  editing: string | null;
  handlers: React.MutableRefObject<CellHandlers>;
}>(({ cells, padX, editing, handlers }) => (
  <>
    {cells.map((cell) => {
      const key = `${cell.vr}:${cell.c}`;
      return (
        <div
          key={key}
          className="tbled__cell"
          data-header={cell.header || undefined}
          style={{
            left: cell.x,
            top: cell.y,
            width: cell.w,
            height: cell.h,
            color: cell.color,
            fontWeight: cell.bold ? 600 : 400,
            fontStyle: cell.italic ? 'italic' : undefined,
            justifyContent: cell.align === 'center' ? 'center' : cell.align === 'right' ? 'flex-end' : 'flex-start',
            padding: `0 ${padX}px`,
          }}
          onPointerDown={(e) => handlers.current.down(cell, e)}
          onPointerEnter={() => handlers.current.enter(cell)}
          onDoubleClick={() => handlers.current.dbl(cell)}
          onContextMenu={(e) => handlers.current.menu(cell, e)}
        >
          {editing !== key && <span className="tbled__text">{cell.text}</span>}
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
  sort: (dir: 'asc' | 'desc') => void;
  clear: () => void;
  merge: () => void;
  unmerge: () => void;
  deleteRows: () => void;
  deleteCols: () => void;
}

/**
 * What a right-click offers, by where it landed.
 *
 * A letter is about columns, a number about rows, and a cell about both —
 * every spreadsheet's arrangement. The heading names what the menu acts on
 * ("Columns B–D"): a right-click inside a selection acts on the selection and
 * outside it on the one thing clicked, and that should never be a surprise.
 */
const MenuBody: React.FC<{
  menu: MenuState;
  spec: TableSpec;
  rows: number[];
  cols: number;
  identity: boolean;
  rowLabel: (vr: number) => string;
  actions: MenuActions;
}> = ({ menu, spec, rows, cols, identity, rowLabel, actions }) => {
  const nCols = menu.c1 - menu.c0 + 1;
  const nRows = menu.r1 - menu.r0 + 1;
  const colName = (c: number) => {
    const head = spec.header ? spec.cells[0]?.[c]?.trim() : '';
    return head ? `${columnLetter(c)} · ${head}` : columnLetter(c);
  };
  const headerOnly = spec.header && rows[menu.r0] === 0 && nRows === 1;
  const title =
    menu.kind === 'col'
      ? nCols > 1
        ? `Columns ${columnLetter(menu.c0)}–${columnLetter(menu.c1)}`
        : `Column ${colName(menu.c0)}`
      : menu.kind === 'row'
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
  const colItems = (
    <>
      <MenuItem icon={<ArrowLeftToLine size={15} />} label="Insert column left" onClick={actions.insertColLeft} />
      <MenuItem icon={<ArrowRightToLine size={15} />} label="Insert column right" onClick={actions.insertColRight} />
    </>
  );
  const viewItems = (
    <>
      <MenuItem icon={<UnfoldHorizontal size={15} />} label={nCols > 1 ? 'Fit columns to content' : 'Fit column to content'} hint="double-click edge" onClick={actions.fit} />
      <MenuItem icon={<ArrowUpNarrowWide size={15} />} label={`Sort ${columnLetter(menu.c0)}, A → Z`} pressed={sorted === 'asc'} onClick={() => actions.sort('asc')} />
      <MenuItem icon={<ArrowDownWideNarrow size={15} />} label={`Sort ${columnLetter(menu.c0)}, Z → A`} pressed={sorted === 'desc'} onClick={() => actions.sort('desc')} />
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
  const deleteColItem = (
    <MenuItem
      icon={<Trash2 size={15} />}
      tone="danger"
      label={nCols > 1 ? `Delete ${nCols} columns` : 'Delete column'}
      disabled={nCols >= cols}
      onClick={actions.deleteCols}
    />
  );

  return (
    <>
      <div className="tbled-ctx__head">{title}</div>
      {menu.kind === 'col' && (
        <>
          {colItems}
          <Sep />
          {viewItems}
          <Sep />
          {deleteColItem}
        </>
      )}
      {menu.kind === 'row' && (
        <>
          {rowItems}
          <Sep />
          <MenuItem icon={<Eraser size={15} />} label="Clear contents" onClick={actions.clear} />
          <Sep />
          {deleteRowItem}
        </>
      )}
      {menu.kind === 'cell' && (
        <>
          {rowItems}
          {colItems}
          <Sep />
          {viewItems}
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
          {deleteColItem}
        </>
      )}
    </>
  );
};

const Sep = () => <span className="tbled-ctx__sep" role="separator" />;

const MenuItem: React.FC<{
  icon: React.ReactNode;
  label: string;
  hint?: string;
  tone?: 'danger';
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
}> = ({ icon, label, hint, tone, pressed, disabled, onClick }) => (
  <button
    type="button"
    role="menuitem"
    className="tbled-ctx__item"
    data-tone={tone}
    data-pressed={pressed || undefined}
    disabled={disabled}
    onPointerDown={(e) => e.preventDefault()}
    onClick={onClick}
  >
    {icon}
    <span className="tbled-ctx__label">{label}</span>
    {hint && <span className="tbled-ctx__hint">{hint}</span>}
  </button>
);

const Tool: React.FC<{
  label: string;
  shortcut?: string;
  pressed?: boolean;
  disabled?: boolean;
  tone?: 'danger';
  onClick: () => void;
  children: React.ReactNode;
}> = ({ label, shortcut, pressed, disabled, tone, onClick, children }) => (
  <button
    type="button"
    className="tbled-tool"
    aria-label={label}
    aria-pressed={pressed}
    data-tooltip={shortcut ? `${label} · ${shortcut}` : label}
    data-tone={tone}
    disabled={disabled}
    // Keeps the grid's selection: a mousedown on a button would otherwise
    // take focus from the sheet before the click lands.
    onPointerDown={(e) => e.preventDefault()}
    onClick={onClick}
  >
    {children}
  </button>
);
