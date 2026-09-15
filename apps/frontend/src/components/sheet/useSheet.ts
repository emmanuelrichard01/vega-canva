import React from 'react';
import { parseDelimited } from '../../engine/chart/chartCsv';

/**
 * The spreadsheet, as behaviour.
 *
 * ## One interaction model, two grids
 *
 * The board's table editor and the chart's data sheet are both spreadsheets,
 * and a spreadsheet is judged almost entirely on muscle memory: arrows move,
 * Shift extends, Enter edits and then goes down, Tab goes right, typing
 * replaces, Delete clears, a pasted block fills from the cell you are in. Two
 * implementations of that drift — one gets Shift+Enter, the other forgets
 * Escape — and the person moving between them notices every difference.
 *
 * So the behaviour lives here, once, and each grid supplies only what is its
 * own: how to read a cell, how to write one, and how to lay itself out.
 *
 * ## Why a hidden text area holds the keyboard
 *
 * While no cell is being edited, focus sits on an invisible `<textarea>`.
 * Clipboard events only fire on something focusable, so that is what makes
 * Ctrl+C, Ctrl+X and Ctrl+V native — the system clipboard, real TSV, pasting
 * from Sheets and Excel as-is. It is also what keeps the board's own
 * shortcuts out: they already ignore keys typed into a text field, so Delete
 * clears cells instead of deleting the whole table from under you.
 */

export interface SheetPos {
  r: number;
  c: number;
}

export interface SheetRange {
  r0: number;
  c0: number;
  r1: number;
  c1: number;
}

export interface SheetModel {
  rows: number;
  cols: number;
  /** The raw text of a cell — what editing starts from and copying takes. */
  read: (r: number, c: number) => string;
  write: (r: number, c: number, text: string) => void;
  /** A pasted block, written in from `(r, c)`; the model may grow to take it. */
  writeBlock: (r: number, c: number, block: string[][]) => void;
  clear: (range: SheetRange) => void;
  /** Enter past the last row: grow the sheet by one and carry on typing. */
  appendRow?: () => void;
  /** Ctrl+B / Ctrl+I, where the grid has formatting. */
  onFormat?: (key: 'bold' | 'italic', range: SheetRange) => void;
  /** Escape with nothing being edited. */
  onExit?: () => void;
}

export const toRange = (a: SheetPos, b: SheetPos): SheetRange => ({
  r0: Math.min(a.r, b.r),
  c0: Math.min(a.c, b.c),
  r1: Math.max(a.r, b.r),
  c1: Math.max(a.c, b.c),
});

/** Spreadsheet column letters: A … Z, AA … */
export function columnLetter(c: number): string {
  let n = c + 1;
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * Clipboard text as a block of cells.
 *
 * A single line with no tab is one value, whatever it contains — `1,250` is a
 * number, not two cells. Anything with a tab or a line break is a table, read
 * with the same quote-aware parser the CSV import uses, so a cell that holds a
 * comma or a newline in quotes survives the trip from Excel.
 */
export function parseClipboard(text: string): string[][] {
  const t = text.replace(/\r\n?/g, '\n').replace(/\n$/, '');
  if (t === '') return [];
  if (!t.includes('\t') && !t.includes('\n')) return [[t]];
  return parseDelimited(t);
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function useSheet(model: SheetModel) {
  const [anchor, setAnchor] = React.useState<SheetPos>({ r: 0, c: 0 });
  const [focus, setFocus] = React.useState<SheetPos>({ r: 0, c: 0 });
  const [edit, setEdit] = React.useState<{ r: number; c: number; draft: string } | null>(null);
  const sinkRef = React.useRef<HTMLTextAreaElement>(null);
  const dragging = React.useRef(false);
  const modelRef = React.useRef(model);
  modelRef.current = model;

  const rows = Math.max(1, model.rows);
  const cols = Math.max(1, model.cols);

  // The selection stays inside the sheet when rows or columns go.
  React.useEffect(() => {
    const fit = (p: SheetPos) => ({ r: clamp(p.r, 0, rows - 1), c: clamp(p.c, 0, cols - 1) });
    setAnchor(fit);
    setFocus(fit);
  }, [rows, cols]);

  // The keyboard returns to the sink whenever nothing is being typed into.
  React.useEffect(() => {
    if (!edit) sinkRef.current?.focus({ preventScroll: true });
  }, [edit]);

  React.useEffect(() => {
    const up = () => {
      dragging.current = false;
    };
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, []);

  const range = toRange(anchor, focus);

  const select = React.useCallback(
    (p: SheetPos, extend = false) => {
      const q = { r: clamp(p.r, 0, rows - 1), c: clamp(p.c, 0, cols - 1) };
      setFocus(q);
      if (!extend) setAnchor(q);
    },
    [rows, cols]
  );

  const begin = (p: SheetPos = focus, initial?: string) => {
    select(p);
    setEdit({ r: p.r, c: p.c, draft: initial ?? modelRef.current.read(p.r, p.c) });
  };

  const commit = (then?: [number, number]) => {
    setEdit((current) => {
      if (!current) return null;
      const m = modelRef.current;
      if (m.read(current.r, current.c) !== current.draft) m.write(current.r, current.c, current.draft);
      if (then) {
        const [dr, dc] = then;
        const target = { r: current.r + dr, c: current.c + dc };
        if (dr > 0 && target.r >= m.rows && m.appendRow) {
          m.appendRow();
          // Unclamped: the new row arrives with the next render.
          setAnchor(target);
          setFocus(target);
        } else {
          select(target);
        }
      }
      return null;
    });
  };

  const cancel = () => setEdit(null);

  const rangeText = () => {
    const m = modelRef.current;
    const lines: string[] = [];
    for (let r = range.r0; r <= range.r1; r++) {
      const cells: string[] = [];
      for (let c = range.c0; c <= range.c1; c++) cells.push(m.read(r, c).replace(/[\t\n]/g, ' '));
      lines.push(cells.join('\t'));
    }
    return lines.join('\n');
  };

  const onSinkKeyDown = (e: React.KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    const stop = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    const arrows: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    if (arrows[k]) {
      stop();
      const [dr, dc] = arrows[k];
      // Ctrl jumps to the edge, as in every spreadsheet.
      const next = mod
        ? { r: dr === 0 ? focus.r : dr < 0 ? 0 : rows - 1, c: dc === 0 ? focus.c : dc < 0 ? 0 : cols - 1 }
        : { r: focus.r + dr, c: focus.c + dc };
      select(next, e.shiftKey);
      return;
    }
    if (k === 'Tab') {
      stop();
      select({ r: focus.r, c: focus.c + (e.shiftKey ? -1 : 1) });
      return;
    }
    if (k === 'Enter' || k === 'F2') {
      stop();
      begin(focus);
      return;
    }
    if (k === 'Delete' || k === 'Backspace') {
      stop();
      modelRef.current.clear(range);
      return;
    }
    if (k === 'Escape') {
      stop();
      modelRef.current.onExit?.();
      return;
    }
    if (k === 'Home' || k === 'End') {
      stop();
      const c = k === 'Home' ? 0 : cols - 1;
      select({ r: mod ? (k === 'Home' ? 0 : rows - 1) : focus.r, c }, e.shiftKey);
      return;
    }
    if (k === 'PageDown' || k === 'PageUp') {
      stop();
      select({ r: focus.r + (k === 'PageDown' ? 10 : -10), c: focus.c }, e.shiftKey);
      return;
    }
    if (mod && k.toLowerCase() === 'a') {
      stop();
      setAnchor({ r: 0, c: 0 });
      setFocus({ r: rows - 1, c: cols - 1 });
      return;
    }
    if (mod && (k.toLowerCase() === 'b' || k.toLowerCase() === 'i') && modelRef.current.onFormat) {
      stop();
      modelRef.current.onFormat(k.toLowerCase() === 'b' ? 'bold' : 'italic', range);
      return;
    }
    // Typing replaces the cell, the way it does everywhere else.
    if (!mod && !e.altKey && k.length === 1) {
      stop();
      begin(focus, k);
    }
  };

  const onEditorKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.altKey) {
      e.preventDefault();
      commit(e.shiftKey ? [-1, 0] : [1, 0]);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      commit([0, e.shiftKey ? -1 : 1]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  };

  const onCopy = (e: React.ClipboardEvent) => {
    e.preventDefault();
    e.clipboardData.setData('text/plain', rangeText());
  };

  const onCut = (e: React.ClipboardEvent) => {
    onCopy(e);
    modelRef.current.clear(range);
  };

  const onPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    let block = parseClipboard(e.clipboardData.getData('text/plain'));
    if (block.length === 0) return;
    // One value into a selected range fills the range — the fill-down every
    // spreadsheet does, without a handle to drag.
    if (block.length === 1 && block[0].length === 1 && (range.r1 > range.r0 || range.c1 > range.c0)) {
      const v = block[0][0];
      block = Array.from({ length: range.r1 - range.r0 + 1 }, () =>
        Array.from({ length: range.c1 - range.c0 + 1 }, () => v)
      );
    }
    modelRef.current.writeBlock(range.r0, range.c0, block);
    const width = Math.max(...block.map((row) => row.length));
    setAnchor({ r: range.r0, c: range.c0 });
    setFocus({ r: range.r0 + block.length - 1, c: range.c0 + width - 1 });
  };

  const cellPointerDown = (p: SheetPos, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    if (edit && (edit.r !== p.r || edit.c !== p.c)) commit();
    select(p, e.shiftKey);
    dragging.current = true;
    sinkRef.current?.focus({ preventScroll: true });
  };

  const cellPointerEnter = (p: SheetPos) => {
    if (dragging.current) select(p, true);
  };

  const selectRow = (r: number, extend = false) => {
    if (!extend) setAnchor({ r, c: 0 });
    setFocus({ r, c: cols - 1 });
    sinkRef.current?.focus({ preventScroll: true });
  };

  const selectCol = (c: number, extend = false) => {
    if (!extend) setAnchor({ r: 0, c });
    setFocus({ r: rows - 1, c });
    sinkRef.current?.focus({ preventScroll: true });
  };

  const inRange = (r: number, c: number) => r >= range.r0 && r <= range.r1 && c >= range.c0 && c <= range.c1;

  return {
    anchor,
    focus,
    range,
    edit,
    inRange,
    select,
    begin,
    commit,
    cancel,
    setDraft: (draft: string) => setEdit((cur) => (cur ? { ...cur, draft } : cur)),
    selectRow,
    selectCol,
    cellPointerDown,
    cellPointerEnter,
    onEditorKeyDown,
    focusSink: () => sinkRef.current?.focus({ preventScroll: true }),
    sinkProps: {
      ref: sinkRef,
      className: 'sheet-sink',
      'aria-label': 'Spreadsheet: arrows to move, Enter to edit, type to replace',
      value: '',
      onChange: () => undefined,
      onKeyDown: onSinkKeyDown,
      onCopy,
      onCut,
      onPaste,
    },
  };
}
