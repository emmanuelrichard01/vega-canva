import React from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  BetweenHorizontalEnd,
  BetweenHorizontalStart,
  BetweenVerticalEnd,
  BetweenVerticalStart,
  Bold,
  Check,
  Columns3,
  Funnel,
  FunnelX,
  Italic,
  PaintBucket,
  Rows3,
  TableCellsMerge,
  TableCellsSplit,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignStart,
} from 'lucide-react';
import './table.css';
import { useStore } from '../../hooks/useStore';
import { cameraSystem } from '../../engine/CameraSystem';
import { engineEvents } from '../../engine/EventBus';
import { textEditing } from '../../engine/interaction/textEditing';
import { layoutTable } from '../../engine/table/tableLayout';
import * as M from '../../engine/table/tableModel';
import { updateTable } from '../../engine/table/tableApply';
import type { CellAlign, CellStyle, TableSpec } from '../../engine/table/tableTypes';
import type { TableNode } from '../../engine/model/schema';
import { PORTAL_SURFACE_ATTR } from '../ui/portalSurface';
import { columnLetter, useSheet, type SheetRange } from '../sheet/useSheet';

/**
 * A table's cells, open for editing where the table is.
 *
 * ## In place, not in a dialog
 *
 * Every tool this is measured against — Figma, Miro, Notion, Keynote — edits a
 * table on the page. A dialog would put the cells somewhere other than the
 * table and hide the board you were writing it for. So the editor is a DOM
 * grid laid exactly over the node: the same `layoutTable` the canvas draws,
 * scaled by the camera, so every cell sits on its own drawn cell. The canvas
 * keeps drawing the rules and fills underneath and steps its text back while
 * this is open, so nothing is drawn twice.
 *
 * ## What it does
 *
 * Everything `useSheet` gives a spreadsheet — select, extend, type, copy,
 * paste — plus what a *table* adds: bold, italic, alignment and fill on the
 * selection; merging; rows and columns in and out; sorting and filtering by a
 * column; and dragging a column's edge in the letter gutter to resize it. The
 * view (sort, filter) is respected throughout: edits land on the stored row
 * the drawn row stands for.
 */

/** Screen px from the grid's top edge to the far side of the column letters (table.css: gap + size). */
const GUTTER_REACH = 28;
/** Screen px from the grid's left edge to the far side of the row numbers. */
const ROW_GUTTER_REACH = 34;
/** Air between the gutters and the toolbar. */
const CLEARANCE = 14;
const BAR_H = 42;

const FILLS = ['#FFFFFF', '#F1F5F9', '#FEF3C7', '#DCFCE7', '#DBEAFE', '#EDE9FE', '#FCE7F3', '#FEE2E2', '#1E293B'];

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
  // back while the cells are open, so the grid's own gutters and toolbar are
  // the only chrome on the table — see `textEditing`.
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
  const [widths, setWidths] = React.useState<number[] | null>(null);
  // Memoised, so the layout below is only redone when the table or a column
  // drag actually changes — not on every camera move that re-renders this.
  const shown: TableSpec = React.useMemo(
    () => (widths ? { ...spec, columns: spec.columns.map((c, i) => ({ ...c, width: widths[i] ?? c.width })) } : spec),
    [spec, widths]
  );
  const layout = React.useMemo(() => layoutTable(shown, node.width, node.height), [shown, node.width, node.height]);
  const rows = layout.rows;
  const cols = spec.columns.length;
  const identity = M.isIdentityView(spec);

  /** The spec as it is *now*, so a burst of edits never writes over itself. */
  const live = () => {
    const n = useStore.getState().objects[node.id];
    return n && n.type === 'table' ? n : node;
  };
  const apply = (next: TableSpec) => updateTable(live(), next);

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

  const [filterOpen, setFilterOpen] = React.useState(false);
  const [fillOpen, setFillOpen] = React.useState(false);

  const sheet = useSheet({
    rows: rows.length,
    cols,
    read: (vr, c) => spec.cells[rows[vr]]?.[c] ?? '',
    write: (vr, c, text) => {
      const s = live().table;
      const r = M.viewRows(s)[vr];
      if (r !== undefined) apply(M.setCell(s, r, c, text));
    },
    writeBlock: (vr, c, block) => {
      const s = live().table;
      if (M.isIdentityView(s)) {
        apply(M.setBlock(s, vr, c, block));
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
      apply(next);
    },
    clear: (range) => apply(eachStored(range, live().table, (s, r, c) => M.setCell(s, r, c, ''))),
    appendRow: () => {
      const s = live().table;
      apply(M.insertRows(s, s.cells.length, 1));
    },
    onFormat: (key) => toggle(key),
    onExit: onClose,
  });

  const focusStored = { r: rows[sheet.focus.r] ?? 0, c: sheet.focus.c };

  // ---- formatting -----------------------------------------------------------

  const style = (patch: CellStyle) => apply(eachStored(sheet.range, live().table, (s, r, c) => M.styleRange(s, { r0: r, c0: c, r1: r, c1: c }, patch)));
  const styleAtFocus = spec.styles?.[`${focusStored.r}:${focusStored.c}`] ?? {};
  const toggle = (key: 'bold' | 'italic') => style({ [key]: styleAtFocus[key] ? undefined : true });
  const align = (a: CellAlign) => style({ align: styleAtFocus.align === a ? undefined : a });

  // ---- structure ------------------------------------------------------------

  const insertRow = (after: boolean) => apply(M.insertRows(live().table, focusStored.r + (after ? 1 : 0), 1));
  const insertCol = (after: boolean) => apply(M.insertCols(live().table, focusStored.c + (after ? 1 : 0), 1));
  const deleteRows = () => {
    const s = live().table;
    const order = M.viewRows(s);
    const stored = new Set<number>();
    for (let vr = sheet.range.r0; vr <= sheet.range.r1; vr++) if (order[vr] !== undefined) stored.add(order[vr]);
    let next = s;
    [...stored].sort((a, b) => b - a).forEach((r) => (next = M.deleteRows(next, r, 1)));
    apply(next);
  };
  const deleteCols = () => apply(M.deleteCols(live().table, sheet.range.c0, sheet.range.c1 - sheet.range.c0 + 1));
  const merged = M.mergeAt(spec, focusStored.r, focusStored.c);
  const canMerge = identity && (sheet.range.r1 > sheet.range.r0 || sheet.range.c1 > sheet.range.c0);
  const merge = () => apply(M.mergeRange(live().table, sheet.range));
  const unmerge = () => apply(M.unmergeRange(live().table, sheet.range));

  // ---- view -----------------------------------------------------------------

  const sortBy = (dir: 'asc' | 'desc') => {
    const s = live().table;
    const same = s.sort?.col === focusStored.c && s.sort.dir === dir;
    apply({ ...s, sort: same ? undefined : { col: focusStored.c, dir } });
  };
  const [filterDraft, setFilterDraft] = React.useState(spec.filter?.query ?? '');
  const applyFilter = (query: string) => {
    const s = live().table;
    apply({ ...s, filter: query.trim() ? { col: focusStored.c, query } : undefined });
  };

  // ---- column resize --------------------------------------------------------

  const beginResize = (c: number, e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const start = spec.columns.map((col) => col.width);
    const total = start.reduce((a, b) => a + b, 0);
    const zoom = cameraSystem.zoom || 1;
    let current = start;
    const move = (ev: PointerEvent) => {
      const dw = ((ev.clientX - startX) / zoom) * (total / node.width);
      const a = Math.max(0.2, start[c] + dw);
      const b = Math.max(0.2, start[c + 1] - (a - start[c]));
      current = start.map((w, i) => (i === c ? a : i === c + 1 ? b : w));
      setWidths(current);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setWidths(null);
      const s = live().table;
      apply({ ...s, columns: s.columns.map((col, i) => ({ ...col, width: current[i] ?? col.width })) });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // ---- leaving --------------------------------------------------------------

  const rootRef = React.useRef<HTMLDivElement>(null);
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

  // ---- placement ------------------------------------------------------------

  const zoom = cameraSystem.zoom;
  const stage = document.querySelector('.konvajs-content')?.getBoundingClientRect();
  const left = (stage?.left ?? 0) + node.x * zoom + cameraSystem.x;
  const top = (stage?.top ?? 0) + node.y * zoom + cameraSystem.y;
  // The bar stands clear of the *gutters*, not the table: the column letters
  // reach GUTTER_REACH screen px above the grid (they hold one screen size at
  // every zoom — see table.css), and the bar clears them by CLEARANCE. The old
  // fixed 58px was measured to the table's edge, so the letters sat under the
  // bar at 100% and vanished behind it zoomed in. Left-aligned with the row
  // numbers, so the chrome reads as one column down the left.
  const above = top - GUTTER_REACH - CLEARANCE - BAR_H;
  const barTop = above < 8 ? top + node.height * zoom + CLEARANCE : above;
  const barLeft = Math.max(8, left - ROW_GUTTER_REACH);

  const rowH = layout.rowH;
  const rect = (range: SheetRange) => {
    const x = layout.colX[range.c0] ?? 0;
    const w = (layout.colX[range.c1] ?? 0) + (layout.colW[range.c1] ?? 0) - x;
    return { left: x, top: range.r0 * rowH, width: w, height: (range.r1 - range.r0 + 1) * rowH };
  };
  /** The drawn box for a cell — the whole block when it is the anchor of a merge. */
  const boxOf = (vr: number, c: number) => {
    const exact = layout.cells.find((b) => b.vr === vr && b.c === c);
    return exact ? { left: exact.x, top: exact.y, width: exact.w, height: exact.h } : rect({ r0: vr, c0: c, r1: vr, c1: c });
  };
  const editBox = sheet.edit ? boxOf(sheet.edit.r, sheet.edit.c) : null;
  const focusBox = boxOf(sheet.focus.r, sheet.focus.c);
  const multi = sheet.range.r1 > sheet.range.r0 || sheet.range.c1 > sheet.range.c0;
  const portal = { [PORTAL_SURFACE_ATTR]: 'table-editor' };

  return createPortal(
    <>
      <div ref={barRef} className="tbled-bar" style={{ left: barLeft, top: barTop }} role="toolbar" aria-label="Table" {...portal}>
        <div className="tbled-bar__group">
          <Tool label="Bold" shortcut="Ctrl B" pressed={Boolean(styleAtFocus.bold)} onClick={() => toggle('bold')}>
            <Bold size={15} />
          </Tool>
          <Tool label="Italic" shortcut="Ctrl I" pressed={Boolean(styleAtFocus.italic)} onClick={() => toggle('italic')}>
            <Italic size={15} />
          </Tool>
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
          <div className="tbled-bar__pop">
            <Tool label="Cell fill" pressed={fillOpen} onClick={() => setFillOpen((v) => !v)}>
              <PaintBucket size={15} />
              <span className="tbled-bar__chip" style={{ background: styleAtFocus.fill ?? 'transparent' }} />
            </Tool>
            {fillOpen && (
              <div className="tbled-menu tbled-menu--swatches">
                <button type="button" className="tbled-swatch tbled-swatch--none" aria-label="No fill" onClick={() => { style({ fill: undefined, color: undefined }); setFillOpen(false); }} />
                {FILLS.map((f) => (
                  <button
                    key={f}
                    type="button"
                    className="tbled-swatch"
                    style={{ background: f }}
                    aria-label={`Fill ${f}`}
                    aria-pressed={styleAtFocus.fill === f}
                    onClick={() => {
                      style({ fill: f });
                      setFillOpen(false);
                    }}
                  />
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
            <Tool
              label={identity ? 'Merge cells' : 'Merging needs the unsorted, unfiltered table'}
              disabled={!canMerge}
              onClick={merge}
            >
              <TableCellsMerge size={15} />
            </Tool>
          )}
        </div>
        <span className="tbled-bar__sep" />
        <div className="tbled-bar__group">
          <Tool label="Row above" onClick={() => insertRow(false)}>
            <BetweenHorizontalStart size={15} />
          </Tool>
          <Tool label="Row below" onClick={() => insertRow(true)}>
            <BetweenHorizontalEnd size={15} />
          </Tool>
          <Tool label="Column left" onClick={() => insertCol(false)}>
            <BetweenVerticalStart size={15} />
          </Tool>
          <Tool label="Column right" onClick={() => insertCol(true)}>
            <BetweenVerticalEnd size={15} />
          </Tool>
          <Tool label={multi ? 'Delete selected rows' : 'Delete row'} tone="danger" onClick={deleteRows}>
            <Rows3 size={15} />
          </Tool>
          <Tool label={multi ? 'Delete selected columns' : 'Delete column'} tone="danger" onClick={deleteCols}>
            <Columns3 size={15} />
          </Tool>
        </div>
        <span className="tbled-bar__sep" />
        <div className="tbled-bar__group">
          <Tool
            label={`Sort ${columnLetter(focusStored.c)} ascending`}
            pressed={spec.sort?.col === focusStored.c && spec.sort.dir === 'asc'}
            onClick={() => sortBy('asc')}
          >
            <ArrowUpNarrowWide size={15} />
          </Tool>
          <Tool
            label={`Sort ${columnLetter(focusStored.c)} descending`}
            pressed={spec.sort?.col === focusStored.c && spec.sort.dir === 'desc'}
            onClick={() => sortBy('desc')}
          >
            <ArrowDownWideNarrow size={15} />
          </Tool>
          <div className="tbled-bar__pop">
            <Tool label="Filter by this column" pressed={filterOpen || Boolean(spec.filter)} onClick={() => setFilterOpen((v) => !v)}>
              <Funnel size={15} />
            </Tool>
            {filterOpen && (
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
                        setFilterOpen(false);
                      } else if (e.key === 'Escape') setFilterOpen(false);
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
                      setFilterOpen(false);
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
        style={
          {
            left,
            top,
            width: node.width,
            height: node.height,
            transform: `scale(${zoom})`,
            '--inv': 1 / (zoom || 1),
          } as React.CSSProperties
        }
        {...portal}
      >
        {/* Column letters: select a column, or drag an edge to resize it. */}
        <div className="tbled__cols" aria-hidden="true">
          {layout.colX.map((x, c) => (
            <div
              key={c}
              className="tbled__colhead"
              data-selected={c >= sheet.range.c0 && c <= sheet.range.c1 || undefined}
              style={{ left: x, width: layout.colW[c] }}
              onPointerDown={(e) => {
                e.preventDefault();
                sheet.selectCol(c, e.shiftKey);
              }}
            >
              {columnLetter(c)}
              {c < cols - 1 && <span className="tbled__resize" onPointerDown={(e) => beginResize(c, e)} />}
            </div>
          ))}
        </div>
        <div className="tbled__rows" aria-hidden="true">
          {rows.map((r, vr) => (
            <div
              key={vr}
              className="tbled__rowhead"
              data-selected={vr >= sheet.range.r0 && vr <= sheet.range.r1 || undefined}
              style={{ top: vr * rowH, height: rowH }}
              onPointerDown={(e) => {
                e.preventDefault();
                sheet.selectRow(vr, e.shiftKey);
              }}
            >
              {spec.header && r === 0 ? 'H' : r + (spec.header ? 0 : 1)}
            </div>
          ))}
        </div>

        <div className="tbled__grid" style={{ fontSize: layout.fontSize }}>
          {layout.cells.map((cell) => {
            const editing = sheet.edit && sheet.edit.r === cell.vr && sheet.edit.c === cell.c;
            return (
              <div
                key={`${cell.vr}:${cell.c}`}
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
                  padding: `0 ${layout.padX}px`,
                }}
                onPointerDown={(e) => sheet.cellPointerDown({ r: cell.vr, c: cell.c }, e)}
                onPointerEnter={() => sheet.cellPointerEnter({ r: cell.vr, c: cell.c })}
                onDoubleClick={() => sheet.begin({ r: cell.vr, c: cell.c })}
              >
                {!editing && <span className="tbled__text">{cell.text}</span>}
              </div>
            );
          })}

          {multi && <div className="tbled__range" style={rect(sheet.range)} />}
          {!sheet.edit && <div className="tbled__focus" style={focusBox} />}
          {sheet.edit && editBox && (
            <textarea
              className="tbled__input"
              autoFocus
              spellCheck={false}
              value={sheet.edit.draft}
              style={{
                ...editBox,
                fontSize: layout.fontSize,
                padding: `${Math.max(0, (editBox.height - layout.fontSize * 1.35) / 2)}px ${layout.padX - 2}px 0`,
                textAlign: M.alignFor(spec, rows[sheet.edit.r] ?? 0, sheet.edit.c),
              }}
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => sheet.setDraft(e.target.value)}
              onKeyDown={sheet.onEditorKeyDown}
              onBlur={() => sheet.commit()}
            />
          )}
        </div>
        <textarea {...sheet.sinkProps} />
      </div>
    </>,
    document.body
  );
};

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
