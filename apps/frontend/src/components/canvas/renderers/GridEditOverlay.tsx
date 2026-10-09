import React from 'react';
import { Group, Line, Rect, Text } from 'react-konva';
import type Konva from 'konva';
import type { GridNode } from '../../../engine/model/schema';
import type { StyledCell } from '../../../engine/grid/gridStyle';
import { gridEditMode, blockBetween, useGridEditMode, type CellBlock } from '../../../engine/grid/gridEditMode';
import { canEditCells, currentTrackSizes, mergeCells, moveTrackBorder, splitCells } from '../../../engine/grid/gridEdit';
import { cellIndexAt, gridLocalPoint } from '../../../engine/grid/gridSlot';
import { isSlottable } from '../../../engine/grid/gridReflow';
import { adoptionSuppressed } from '../../../engine/grid/dropIntent';
import { liveTransformStore } from '../../../engine/model/liveTransformStore';
import { useCameraZoom } from '../../../engine/useCameraZoom';
import { keyBelongsToFocus } from '../../../engine/interaction/keyTarget';
import { useStore } from '../../../hooks/useStore';
import { TOUCH_TARGET, isCoarse, touchHitPad } from '../../../engine/ui/device';

/**
 * Board chrome for grids: the drop highlight while something is dragged over
 * a module, and the Edit cells mode (track headers, module selection, merge,
 * split, span and track resizing).
 *
 * Drawn inside the grid's own group, so everything is in grid coordinates and
 * turns with the grid. Chrome keeps its screen size: every length below is
 * divided by the zoom.
 */

const isDark = () =>
  typeof document !== 'undefined' && document.documentElement.classList.contains('dark-theme');
const ink = (alpha: number) => (isDark() ? `rgba(250, 250, 250, ${alpha})` : `rgba(17, 24, 39, ${alpha})`);

const HEADER = 18; // screen px
const GAP = 6; // screen px between grid and headers
const HANDLE = 8; // screen px

/**
 * The module a dragged object would be adopted into, or null.
 *
 * Read from the live transform store, which carries every in-flight drag, so
 * the highlight follows the pointer without touching the document.
 */
function useAdoptionTarget(node: GridNode, cells: readonly StyledCell[]): number | null {
  const [target, setTarget] = React.useState<number | null>(null);
  React.useEffect(() => {
    const update = () => {
      let found: number | null = null;
      if (liveTransformStore.active && !adoptionSuppressed()) {
        const objects = useStore.getState().objects;
        for (const [id, live] of liveTransformStore.entries()) {
          if (id === node.id || live.fromTransform || live.x === undefined || live.y === undefined) continue;
          const dragged = objects[id];
          if (!isSlottable(dragged) || dragged.locked) continue;
          const w = live.width ?? dragged.width;
          const h = live.height ?? dragged.height;
          const centre = { x: live.x + w / 2, y: live.y + h / 2 };
          const local = gridLocalPoint(node, centre);
          if (local.x < 0 || local.y < 0 || local.x > node.width || local.y > node.height) continue;
          found = cellIndexAt(cells, local);
          if (found !== null) break;
        }
      }
      setTarget((prev) => (prev === found ? prev : found));
    };
    update();
    return liveTransformStore.subscribeGlobal(update);
  }, [node, cells]);
  return target;
}

export const GridDropHighlight: React.FC<{ node: GridNode; cells: readonly StyledCell[] }> = ({ node, cells }) => {
  const target = useAdoptionTarget(node, cells);
  const zoom = useCameraZoom();
  const cell = target === null ? null : cells.find((c) => c.index === target);
  if (!cell) return null;
  return (
    <Rect
      x={cell.x}
      y={cell.y}
      width={cell.width}
      height={cell.height}
      fill={ink(0.08)}
      stroke={ink(0.55)}
      strokeWidth={1.5 / zoom}
      dash={[4 / zoom, 3 / zoom]}
      listening={false}
      perfectDrawEnabled={false}
    />
  );
};

/** A module's place as a block of tracks, reading its span off the spec. */
function blockOf(node: GridNode, cell: StyledCell): CellBlock {
  const span = node.grid.spec.spans?.[`${cell.row}:${cell.col}`];
  return { row: cell.row, col: cell.col, rows: span?.rows ?? 1, cols: span?.cols ?? 1 };
}

const stop = (e: Konva.KonvaEventObject<Event>) => {
  e.cancelBubble = true;
};

/**
 * Edit cells mode for one grid. Mounted only while that grid is being edited.
 *
 * Click a module to pick it, Shift-click to extend the pick to a block, drag
 * the corner handle to span. M merges the block, Shift+M splits it, arrows move
 * the pick, Escape leaves. Dragging the border between two track headers trades
 * size between those two tracks.
 */
export const GridEditOverlay: React.FC<{ node: GridNode; cells: readonly StyledCell[] }> = ({ node, cells }) => {
  const { block } = useGridEditMode();
  const zoom = useCameraZoom();
  const s = 1 / zoom;
  const spec = node.grid.spec;
  const nCols = Math.max(1, Math.floor(spec.columns));
  const nRows = spec.kind === 'columns' ? 1 : Math.max(1, Math.floor(spec.rows));
  const anchor = React.useRef<CellBlock | null>(null);
  const [borderDrag, setBorderDrag] = React.useState<{ axis: 'cols' | 'rows'; index: number; delta: number } | null>(null);

  // Track extents, read off single-track modules.
  const colSizes = React.useMemo(() => currentTrackSizes(node, 'cols'), [node]);
  const rowSizes = React.useMemo(() => currentTrackSizes(node, 'rows'), [node]);
  const colStarts = React.useMemo(() => starts(cells, 'col', nCols), [cells, nCols]);
  const rowStarts = React.useMemo(() => starts(cells, 'row', nRows), [cells, nRows]);

  const cellAtTrack = React.useCallback(
    (row: number, col: number) =>
      cells.find((c) => {
        const b = blockOf(node, c);
        return row >= b.row && row < b.row + b.rows && col >= b.col && col < b.col + b.cols;
      }),
    [cells, node]
  );

  // Keys while editing. Window-level, guarded so typing in a field is untouched.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (keyBelongsToFocus(e.key)) return;
      const current = gridEditMode.get().block;
      if (e.key === 'Escape') {
        e.preventDefault();
        gridEditMode.exit();
        return;
      }
      if (!current || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) splitCells(node.id, current);
        else mergeCells(node.id, current);
        return;
      }
      const moves: Record<string, [number, number]> = {
        ArrowLeft: [0, -1],
        ArrowRight: [0, 1],
        ArrowUp: [-1, 0],
        ArrowDown: [1, 0],
      };
      const d = moves[e.key];
      if (!d) return;
      e.preventDefault();
      e.stopPropagation();
      const row = Math.min(nRows - 1, Math.max(0, (d[0] > 0 ? current.row + current.rows - 1 : current.row) + d[0]));
      const col = Math.min(nCols - 1, Math.max(0, (d[1] > 0 ? current.col + current.cols - 1 : current.col) + d[1]));
      const cell = cellAtTrack(row, col);
      if (!cell) return;
      const next = blockOf(node, cell);
      if (e.shiftKey && anchor.current) gridEditMode.select(blockBetween(anchor.current, next));
      else {
        anchor.current = next;
        gridEditMode.select(next);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [node.id, nRows, nCols, cellAtTrack, node]);

  const pick = (cell: StyledCell, extend: boolean) => {
    const b = blockOf(node, cell);
    if (extend && anchor.current) gridEditMode.select(blockBetween(anchor.current, b));
    else {
      anchor.current = b;
      gridEditMode.select(b);
    }
  };

  const blockRect = block ? rectOfBlock(block, colStarts, colSizes, rowStarts, rowSizes) : null;
  const headerY = -(HEADER + GAP) * s;
  const headerX = -(HEADER + GAP) * s;

  return (
    <Group>
      {/* Module outlines and hit targets. */}
      {cells.map((cell) => (
        <Rect
          key={`edit-${cell.index}`}
          x={cell.x}
          y={cell.y}
          width={cell.width}
          height={cell.height}
          fill="rgba(0,0,0,0)"
          stroke={ink(0.35)}
          strokeWidth={s}
          dash={[3 * s, 3 * s]}
          perfectDrawEnabled={false}
          onMouseDown={stop}
          onTouchStart={stop}
          onClick={(e) => {
            stop(e);
            pick(cell, Boolean((e.evt as MouseEvent).shiftKey));
          }}
          onTap={(e) => {
            stop(e);
            pick(cell, false);
          }}
        />
      ))}

      {blockRect && (
        <>
          <Rect
            {...blockRect}
            fill={ink(0.1)}
            stroke={ink(0.9)}
            strokeWidth={1.5 * s}
            listening={false}
            perfectDrawEnabled={false}
          />
          {/* Span handle: drag to grow the pick, release to merge it. */}
          <Rect
            x={blockRect.x + blockRect.width - (HANDLE / 2) * s}
            y={blockRect.y + blockRect.height - (HANDLE / 2) * s}
            width={HANDLE * s}
            height={HANDLE * s}
            fill={isDark() ? '#111827' : '#FFFFFF'}
            stroke={ink(0.9)}
            strokeWidth={1.5 * s}
            // A full touch target on a finger, drawn at its compact size.
            hitStrokeWidth={touchHitPad(HANDLE) * s || undefined}
            draggable
            onMouseDown={stop}
            onTouchStart={stop}
            onMouseEnter={(e) => {
              const c = e.target.getStage()?.container();
              if (c) c.style.cursor = 'nwse-resize';
            }}
            onMouseLeave={(e) => {
              const c = e.target.getStage()?.container();
              if (c) c.style.cursor = '';
            }}
            onDragMove={(e) => {
              stop(e);
              const local = e.target.getParent()?.getRelativePointerPosition();
              if (!local || !block) return;
              const cell = cells.find(
                (c) => local.x >= c.x && local.x <= c.x + c.width && local.y >= c.y && local.y <= c.y + c.height
              );
              if (cell) gridEditMode.select(blockBetween(anchor.current ?? block, blockOf(node, cell)));
            }}
            onDragEnd={(e) => {
              stop(e);
              const current = gridEditMode.get().block;
              if (current && (current.rows > 1 || current.cols > 1)) mergeCells(node.id, current);
              e.target.position({ x: 0, y: 0 });
            }}
            dragBoundFunc={(pos) => pos}
          />
        </>
      )}

      {/* Column headers above, row headers to the left. */}
      {colSizes.map((size, i) => (
        <TrackHeader
          key={`c${i}`}
          x={colStarts[i]}
          y={headerY}
          width={size}
          height={HEADER * s}
          label={`C${i + 1}`}
          detail={trackDetail(spec.tracks?.cols?.[i], size)}
          scale={s}
          selected={Boolean(block && i >= block.col && i < block.col + block.cols)}
          onClick={(extend) => {
            const top = cellAtTrack(0, i);
            const bottom = cellAtTrack(nRows - 1, i);
            if (!top || !bottom) return;
            const column = blockBetween(blockOf(node, top), blockOf(node, bottom));
            if (extend && anchor.current) gridEditMode.select(blockBetween(anchor.current, column));
            else {
              anchor.current = column;
              gridEditMode.select(column);
            }
          }}
        />
      ))}
      {nRows > 1 &&
        rowSizes.map((size, i) => (
          <TrackHeader
            key={`r${i}`}
            x={headerX}
            y={rowStarts[i]}
            width={HEADER * s}
            height={size}
            label={`R${i + 1}`}
            detail={trackDetail(spec.tracks?.rows?.[i], size)}
            scale={s}
            vertical
            selected={Boolean(block && i >= block.row && i < block.row + block.rows)}
            onClick={(extend) => {
              const left = cellAtTrack(i, 0);
              const right = cellAtTrack(i, nCols - 1);
              if (!left || !right) return;
              const row = blockBetween(blockOf(node, left), blockOf(node, right));
              if (extend && anchor.current) gridEditMode.select(blockBetween(anchor.current, row));
              else {
                anchor.current = row;
                gridEditMode.select(row);
              }
            }}
          />
        ))}

      {/* Borders between tracks, draggable in the header strips. */}
      {colSizes.slice(0, -1).map((size, i) => (
        <BorderHandle
          key={`cb${i}`}
          axis="cols"
          at={colStarts[i] + size + spec.gutterX / 2}
          cross={headerY}
          length={HEADER * s}
          scale={s}
          onMove={(delta) => setBorderDrag({ axis: 'cols', index: i, delta })}
          onEnd={(delta) => {
            setBorderDrag(null);
            if (Math.abs(delta) >= 1) moveTrackBorder(node.id, 'cols', i, delta);
          }}
        />
      ))}
      {nRows > 1 &&
        rowSizes.slice(0, -1).map((size, i) => (
          <BorderHandle
            key={`rb${i}`}
            axis="rows"
            at={rowStarts[i] + size + spec.gutterY / 2}
            cross={headerX}
            length={HEADER * s}
            scale={s}
            onMove={(delta) => setBorderDrag({ axis: 'rows', index: i, delta })}
            onEnd={(delta) => {
              setBorderDrag(null);
              if (Math.abs(delta) >= 1) moveTrackBorder(node.id, 'rows', i, delta);
            }}
          />
        ))}

      {/* Where the border will land, across the whole grid. */}
      {borderDrag &&
        (borderDrag.axis === 'cols' ? (
          <Line
            points={(() => {
              const x = colStarts[borderDrag.index] + colSizes[borderDrag.index] + spec.gutterX / 2 + borderDrag.delta;
              return [x, headerY, x, node.height];
            })()}
            stroke={ink(0.9)}
            strokeWidth={s}
            listening={false}
          />
        ) : (
          <Line
            points={(() => {
              const y = rowStarts[borderDrag.index] + rowSizes[borderDrag.index] + spec.gutterY / 2 + borderDrag.delta;
              return [headerX, y, node.width, y];
            })()}
            stroke={ink(0.9)}
            strokeWidth={s}
            listening={false}
          />
        ))}
    </Group>
  );
};

/** Where each track starts, from the single-track modules on it. */
function starts(cells: readonly StyledCell[], key: 'row' | 'col', n: number): number[] {
  const out: (number | null)[] = new Array(n).fill(null);
  for (const c of cells) {
    const v = key === 'col' ? c.x : c.y;
    const at = c[key];
    if (out[at] === null || v < (out[at] as number)) out[at] = v;
  }
  // A track no module starts on (inside a span) is interpolated from its neighbours.
  for (let i = 0; i < n; i += 1) {
    if (out[i] !== null) continue;
    const prev = i > 0 ? out[i - 1] : 0;
    out[i] = prev ?? 0;
  }
  return out as number[];
}

function rectOfBlock(
  b: CellBlock,
  colStarts: number[],
  colSizes: number[],
  rowStarts: number[],
  rowSizes: number[]
): { x: number; y: number; width: number; height: number } {
  const lastCol = Math.min(colStarts.length - 1, b.col + b.cols - 1);
  const lastRow = Math.min(rowStarts.length - 1, b.row + b.rows - 1);
  const x = colStarts[b.col] ?? 0;
  const y = rowStarts[b.row] ?? 0;
  return {
    x,
    y,
    width: (colStarts[lastCol] ?? 0) + (colSizes[lastCol] ?? 0) - x,
    height: (rowStarts[lastRow] ?? 0) + (rowSizes[lastRow] ?? 0) - y,
  };
}

function trackDetail(track: import('../../../engine/grid/gridLayout').GridTrack | undefined, size: number): string {
  if (track === 'auto') return 'Auto';
  if (track && 'px' in track) return `${Math.round(track.px)}px`;
  if (track && 'fr' in track) return `${Math.round(size)}`;
  return `${Math.round(size)}`;
}

const TrackHeader: React.FC<{
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  detail: string;
  scale: number;
  vertical?: boolean;
  selected: boolean;
  onClick: (extend: boolean) => void;
}> = ({ x, y, width, height, label, detail, scale, vertical, selected, onClick }) => {
  const fontSize = 10 * scale;
  const long = vertical ? height : width;
  const text = long > 64 * scale ? `${label} · ${detail}` : label;
  return (
    <Group
      x={x}
      y={y}
      onMouseDown={stop}
      onTouchStart={stop}
      onClick={(e) => {
        stop(e);
        onClick(Boolean((e.evt as MouseEvent).shiftKey));
      }}
      onTap={(e) => {
        stop(e);
        onClick(false);
      }}
    >
      <Rect
        width={width}
        height={height}
        cornerRadius={3 * scale}
        fill={selected ? ink(0.85) : ink(0.06)}
        perfectDrawEnabled={false}
      />
      <Text
        x={vertical ? 0 : 0}
        y={vertical ? height : 0}
        width={vertical ? height : width}
        height={vertical ? width : height}
        rotation={vertical ? -90 : 0}
        text={text}
        fontSize={fontSize}
        fontFamily="Inter, sans-serif"
        fontStyle="500"
        align="center"
        verticalAlign="middle"
        fill={selected ? (isDark() ? '#111827' : '#FFFFFF') : ink(0.7)}
        listening={false}
        perfectDrawEnabled={false}
      />
    </Group>
  );
};

const BorderHandle: React.FC<{
  axis: 'cols' | 'rows';
  at: number;
  cross: number;
  length: number;
  scale: number;
  onMove: (delta: number) => void;
  onEnd: (delta: number) => void;
}> = ({ axis, at, cross, length, scale, onMove, onEnd }) => {
  // Invisible, so on a finger it can simply be a full touch target wide.
  const thickness = (isCoarse() ? TOUCH_TARGET : 8) * scale;
  const origin = axis === 'cols' ? { x: at - thickness / 2, y: cross } : { x: cross, y: at - thickness / 2 };
  const setCursor = (e: Konva.KonvaEventObject<Event>, cursor: string) => {
    const c = e.target.getStage()?.container();
    if (c) c.style.cursor = cursor;
  };
  return (
    <Rect
      {...origin}
      width={axis === 'cols' ? thickness : length}
      height={axis === 'cols' ? length : thickness}
      fill="rgba(0,0,0,0)"
      draggable
      dragBoundFunc={function (this: Konva.Node, pos) {
        // Locked to its own axis.
        const abs = this.getAbsolutePosition();
        return axis === 'cols' ? { x: pos.x, y: abs.y } : { x: abs.x, y: pos.y };
      }}
      onMouseDown={stop}
      onTouchStart={stop}
      onMouseEnter={(e) => setCursor(e, axis === 'cols' ? 'col-resize' : 'row-resize')}
      onMouseLeave={(e) => setCursor(e, '')}
      onDragMove={(e) => {
        stop(e);
        const p = e.target.position();
        onMove(axis === 'cols' ? p.x - origin.x : p.y - origin.y);
      }}
      onDragEnd={(e) => {
        stop(e);
        const p = e.target.position();
        const delta = axis === 'cols' ? p.x - origin.x : p.y - origin.y;
        e.target.position(origin);
        onEnd(delta);
      }}
    />
  );
};

/**
 * Enter edit mode on double-click or on the board's "edit this" request
 * (Enter on a selected grid), for the kinds whose cells can be edited.
 */
export function useGridEditEntry(node: GridNode): () => void {
  const enter = React.useCallback(() => {
    if (canEditCells(node.grid.spec.kind) && !node.locked) gridEditMode.enter(node.id);
  }, [node.id, node.grid.spec.kind, node.locked]);
  React.useEffect(() => {
    const onRequest = (e: Event) => {
      if ((e as CustomEvent<{ id: string }>).detail?.id === node.id) enter();
    };
    document.addEventListener('requestEditNode', onRequest);
    return () => document.removeEventListener('requestEditNode', onRequest);
  }, [node.id, enter]);
  return enter;
}
