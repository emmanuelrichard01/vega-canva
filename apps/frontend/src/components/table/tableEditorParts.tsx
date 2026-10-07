import React from 'react';
import { Plus } from 'lucide-react';
import type { TableCellBox } from '../../engine/table/tableLayout';

/**
 * The table editor's small, memoised pieces: the grid of hit targets, the
 * insert dots and the function signature. Kept apart from `TableEditor` so
 * the parts that re-render on every camera frame stay small and readable.
 */

export type Axis = 'col' | 'row';

export interface CellHandlers {
  down: (cell: TableCellBox, e: React.PointerEvent) => void;
  enter: (cell: TableCellBox) => void;
  click: (cell: TableCellBox, e: React.MouseEvent) => void;
  dbl: (cell: TableCellBox) => void;
  menu: (cell: TableCellBox, e: React.MouseEvent) => void;
}

export const span = (a: number, b: number) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i);

/** The function call the caret is inside, and which argument — for the signature hint. */
export function callAt(text: string): { name: string; arg: number } | null {
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

/** What a cell says to a screen reader: its text, or what a rich cell draws instead of text. */
export function spokenCell(cell: TableCellBox): string {
  switch (cell.kind) {
    case 'checkbox':
      return cell.checked ? 'Ticked' : 'Not ticked';
    case 'rating':
      return cell.blank ? 'No rating' : `${cell.rating ?? 0} of 5 stars`;
    case 'select':
      return (cell.tags ?? []).map((t) => t.label).join(', ');
    default:
      return cell.text || 'Empty';
  }
}

/**
 * The cells, memoised — hit targets and the editor's own marks, not text: the
 * canvas underneath draws every cell's content, open or closed.
 *
 * The editor re-renders on every camera frame to stay over its table, and on
 * every hover of a `+`. None of that changes a cell, so the cells are their
 * own component, fed the rows near the viewport and a stable handlers ref —
 * a re-render of the editor does not reconcile a single cell unless the
 * window, the layout, the selection or the cell being typed into changed.
 *
 * They are an ARIA grid: rows of cells, each saying what it shows, so a
 * screen reader can read the table that the canvas paints.
 */
export const Cells = React.memo<{
  cells: TableCellBox[];
  editing: string | null;
  handlers: React.MutableRefObject<CellHandlers>;
  onFooter: (c: number, e: React.MouseEvent) => void;
  /** The selection, drawn rows and columns, for `aria-selected`. */
  r0: number;
  c0: number;
  r1: number;
  c1: number;
  readOnly: boolean;
}>(({ cells, editing, handlers, onFooter, r0, c0, r1, c1, readOnly }) => {
  const rows: Array<{ vr: number; cells: TableCellBox[] }> = [];
  for (const cell of cells) {
    const last = rows[rows.length - 1];
    if (last && last.vr === cell.vr) last.cells.push(cell);
    else rows.push({ vr: cell.vr, cells: [cell] });
  }
  return (
    <>
      {rows.map((row) => (
        <div key={row.vr} role="row" aria-rowindex={row.vr + 1} className="tbled__row">
          {row.cells.map((cell) => {
            const key = `${cell.vr}:${cell.c}`;
            if (cell.r < 0) {
              const full = cell.footer?.label ? `${cell.footer.label}: ${cell.text}` : '';
              return (
                <button
                  key={key}
                  type="button"
                  role="gridcell"
                  aria-colindex={cell.c + 1}
                  className="tbled__foot"
                  style={{ left: cell.x, top: cell.y, width: cell.w, height: cell.h }}
                  aria-label={full ? (readOnly ? full : `${full}. Change the summary`) : 'Add a summary for this column'}
                  data-tooltip={full || undefined}
                  disabled={readOnly && !full}
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={(e) => {
                    if (!readOnly) onFooter(cell.c, e);
                  }}
                >
                  {!cell.footer?.label && !readOnly && <span className="tbled__foot-add">Summarise</span>}
                </button>
              );
            }
            const selected = cell.vr >= r0 && cell.vr <= r1 && cell.c >= c0 && cell.c <= c1;
            return (
              <div
                key={key}
                role={cell.header ? 'columnheader' : 'gridcell'}
                aria-colindex={cell.c + 1}
                aria-selected={selected}
                aria-readonly={readOnly || undefined}
                aria-label={spokenCell(cell)}
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
                {!readOnly && (cell.kind === 'select' || cell.kind === 'person') && <span className="tbled__chev" aria-hidden="true" />}
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
});
Cells.displayName = 'Cells';

/** A function's signature with the argument the caret is in set in bold. */
export const Signature: React.FC<{ sig: string; arg: number; doc: string }> = ({ sig, arg, doc }) => {
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
export const InsertDot: React.FC<{
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

/**
 * Keep an absolutely placed popover inside the viewport: below its anchor when
 * there is room, above it when there is not, and clamped sideways — then, if
 * neither side has room, capped to the taller one and scrolled. Measured after
 * layout, before paint, so it never shows in the wrong place first.
 */
export function useKeepInView(ref: React.RefObject<HTMLElement | null>, open: boolean): void {
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!open || !el) return;
    el.style.removeProperty('top');
    el.style.removeProperty('bottom');
    el.style.removeProperty('max-height');
    el.style.removeProperty('transform');
    const anchor = (el.offsetParent as HTMLElement | null)?.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    const m = 8;
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    if (anchor && box.bottom > vh - m) {
      const above = anchor.top - m;
      const below = vh - m - anchor.bottom;
      if (above >= box.height + 8 || above > below) {
        el.style.top = 'auto';
        el.style.bottom = 'calc(100% + 8px)';
        if (box.height + 8 > above) el.style.maxHeight = `${Math.max(120, above - 8)}px`;
      } else el.style.maxHeight = `${Math.max(120, below - 8)}px`;
    }
    const now = el.getBoundingClientRect();
    if (now.right > vw - m) el.style.transform = `translateX(${vw - m - now.right}px)`;
    else if (now.left < m) el.style.transform = `translateX(${m - now.left}px)`;
  });
}
