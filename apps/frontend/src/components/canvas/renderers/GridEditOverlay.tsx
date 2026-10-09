import React from 'react';
import { Group, Line, Rect, Text } from 'react-konva';
import type Konva from 'konva';
import type { GridNode } from '../../../engine/model/schema';
import type { StyledCell } from '../../../engine/grid/gridStyle';
import {
  gridEditMode,
  blockBetween,
  trackPreview,
  useGridEditMode,
  useTrackPreview,
  type CellBlock,
} from '../../../engine/grid/gridEditMode';
import { canEditCells, commitTrackSizes, mergeCells, pinnedRecipe, splitCells } from '../../../engine/grid/gridEdit';
import {
  autoFitTrackSize,
  recipeWithTrackSizes,
  resolveBorderDrag,
  trackRuns,
  type BorderDragMode,
  type BorderDragResult,
} from '../../../engine/grid/gridTrackDrag';
import { cellIndexAt, gridLocalPoint } from '../../../engine/grid/gridSlot';
import { isSlottable, type SlottableNode } from '../../../engine/grid/gridReflow';
import { adoptionSuppressed } from '../../../engine/grid/dropIntent';
import { liveTransformStore } from '../../../engine/model/liveTransformStore';
import { useCameraZoom } from '../../../engine/useCameraZoom';
import { cameraSystem } from '../../../engine/CameraSystem';
import { keyBelongsToFocus } from '../../../engine/interaction/keyTarget';
import { hud } from '../../../engine/ui/hud';
import { ThemeService } from '../../../engine/ThemeService';
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

// The theme class lives on <body>. This read <html>, so in dark mode every
// piece of edit chrome was drawn near-black on a near-black board: the track
// headers and border grips were invisible, which is most of why dragging a
// track edge felt like guessing.
const isDark = () => ThemeService.isDarkMode();
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

type Axis = 'cols' | 'rows';

/** A border between track `index` and `index + 1` on one axis. */
interface BorderRef {
  axis: Axis;
  index: number;
}

/** A border drag in flight. Held in a ref: pointer moves must not wait on React. */
interface BorderDrag extends BorderRef {
  start: number;
  sizes: number[];
  last: { local: number; shift: boolean; alt: boolean; free: boolean };
  result: BorderDragResult;
}

const trackName = (axis: Axis, i: number) => `${axis === 'cols' ? 'C' : 'R'}${i + 1}`;
const px = (n: number) => `${Math.round(n)}`;

/** The HUD text for a border drag: what the person is deciding, in their numbers. */
function readout(d: BorderRef, mode: BorderDragMode, r: BorderDragResult, total: number): string {
  const a = `${trackName(d.axis, d.index)} ${px(r.sizes[d.index])}`;
  if (mode === 'grow') return `${a} · grid ${px(total + r.growth)}`;
  if (mode === 'equalize' && r.sizes.length > 2) return `${a} · others ${px(r.sizes[d.index === 0 ? 1 : 0])} each`;
  return `${a} · ${trackName(d.axis, d.index + 1)} ${px(r.sizes[d.index + 1])}`;
}

/**
 * Edit cells mode for one grid. Mounted only while that grid is being edited.
 *
 * Click a module to pick it, Shift-click to extend the pick to a block, drag
 * the corner handle to span. M merges the block, Shift+M splits it, arrows move
 * the pick, Escape leaves.
 *
 * ## Track borders
 *
 * Every border between two tracks is a resize target along its whole length,
 * over the grid and through its header strip, the way a spreadsheet's column
 * edge is. Hovering one lights the border and the two headers it divides;
 * dragging it re-lays the grid live (a preview, nothing written) with a HUD
 * readout of both sizes, and lets go as one undo step. Shift spreads the
 * rest evenly, Alt grows the grid instead of squeezing the neighbour, Ctrl or
 * ⌘ turns snapping off, Escape cancels. Double-click a border to fit the
 * track before it to its content. The maths is `gridTrackDrag.ts`.
 *
 * The drag is followed with window pointer events and the overlay's own
 * inverse transform rather than Konva's `draggable`, so nothing is dragged
 * at all: the grid cannot be carried along, at any zoom or rotation.
 */
export const GridEditOverlay: React.FC<{ node: GridNode; cells: readonly StyledCell[] }> = ({ node, cells }) => {
  const { block } = useGridEditMode();
  const zoom = useCameraZoom();
  const s = 1 / zoom;
  const spec = node.grid.spec;
  const nCols = Math.max(1, Math.floor(spec.columns));
  const nRows = spec.kind === 'columns' ? 1 : Math.max(1, Math.floor(spec.rows));
  const anchor = React.useRef<CellBlock | null>(null);
  const groupRef = React.useRef<Konva.Group>(null);
  const dragRef = React.useRef<BorderDrag | null>(null);
  const [hover, setHover] = React.useState<BorderRef | null>(null);
  const [active, setActive] = React.useState<(BorderRef & { mode: BorderDragMode }) | null>(null);
  // Subscribed so the chrome repaints when the theme flips mid-edit.
  useStore((st) => st.darkTheme);
  const dark = isDark();

  // Track runs, from the layout's own arithmetic (merged modules cannot hide them).
  // While a border is dragged, the chrome follows the previewed grid.
  const preview = useTrackPreview(node.id);
  const shown = React.useMemo(
    () => (preview ? { ...node, width: preview.width, height: preview.height, grid: preview.grid } : node),
    [node, preview]
  );
  const colRuns = React.useMemo(() => trackRuns(shown, 'cols'), [shown]);
  const rowRuns = React.useMemo(() => trackRuns(shown, 'rows'), [shown]);
  const colStarts = colRuns.map((r) => r.start);
  const colSizes = colRuns.map((r) => r.size);
  const rowStarts = rowRuns.map((r) => r.start);
  const rowSizes = rowRuns.map((r) => r.size);

  const cellAtTrack = React.useCallback(
    (row: number, col: number) =>
      cells.find((c) => {
        const b = blockOf(node, c);
        return row >= b.row && row < b.row + b.rows && col >= b.col && col < b.col + b.cols;
      }),
    [cells, node]
  );

  /** The pointer in the overlay's own (grid) coordinates. */
  const localPointer = React.useCallback((evt?: Event): { x: number; y: number } | null => {
    const group = groupRef.current;
    const stage = group?.getStage();
    if (!group || !stage) return null;
    if (evt) stage.setPointersPositions(evt);
    return group.getRelativePointerPosition();
  }, []);

  const setCursor = React.useCallback((cursor: string) => {
    const c = groupRef.current?.getStage()?.container();
    if (c) c.style.cursor = cursor;
  }, []);

  /** Re-resolve the drag from its last pointer and modifiers, and show the preview. */
  const resolve = React.useCallback(() => {
    const d = dragRef.current;
    if (!d) return;
    const mode: BorderDragMode = d.last.shift ? 'equalize' : d.last.alt ? 'grow' : 'trade';
    const result = resolveBorderDrag({
      sizes: d.sizes,
      index: d.index,
      delta: d.last.local - d.start,
      mode,
      // Six screen pixels of pull, whatever the zoom.
      snap: d.last.free ? 0 : SNAP_PX / Math.max(0.01, cameraSystem.zoom),
    });
    d.result = result;
    const base = node.grid.spec.kind === 'bento' ? pinnedRecipe(node) : node.grid;
    trackPreview.set({
      gridId: node.id,
      grid: recipeWithTrackSizes(base, d.axis, result.sizes),
      width: node.width + (d.axis === 'cols' ? result.growth : 0),
      height: node.height + (d.axis === 'rows' ? result.growth : 0),
    });
    setActive((prev) => (prev && prev.mode === mode && prev.axis === d.axis && prev.index === d.index ? prev : { axis: d.axis, index: d.index, mode }));
    const group = groupRef.current;
    const stage = group?.getStage();
    const pointer = stage?.getPointerPosition();
    if (pointer) {
      const total = d.sizes.reduce((a, b) => a + b, 0);
      hud.show({
        source: HUD_SOURCE,
        kind: 'label',
        value: readout(d, mode, result, d.axis === 'cols' ? node.width : node.height) || px(total),
        at: cameraSystem.screenToWorld(pointer.x, pointer.y),
        placement: 'pointer',
        snapped: result.snapped !== null,
      });
    }
  }, [node]);

  const endDrag = React.useCallback(
    (commit: boolean) => {
      const d = dragRef.current;
      dragRef.current = null;
      setActive(null);
      hud.hide(HUD_SOURCE);
      setCursor('');
      if (d && commit) {
        const moved = d.result.sizes.some((v, i) => Math.abs(v - d.sizes[i]) >= 0.5) || Math.abs(d.result.growth) >= 0.5;
        if (moved) commitTrackSizes(node.id, d.axis, d.result.sizes, d.result.growth);
      }
      // Cleared after the write, so the grid never flashes back to its old tracks.
      trackPreview.set(null);
    },
    [node.id, setCursor]
  );

  const beginDrag = (border: BorderRef, evt: MouseEvent | TouchEvent) => {
    const local = localPointer(evt);
    if (!local) return;
    const sizes = border.axis === 'cols' ? colSizes : rowSizes;
    const at = border.axis === 'cols' ? local.x : local.y;
    const mods = evt as MouseEvent;
    dragRef.current = {
      ...border,
      start: at,
      sizes: sizes.slice(),
      last: { local: at, shift: Boolean(mods.shiftKey), alt: Boolean(mods.altKey), free: Boolean(mods.ctrlKey || mods.metaKey) },
      result: { sizes: sizes.slice(), growth: 0, snapped: null },
    };
    setCursor(border.axis === 'cols' ? 'col-resize' : 'row-resize');
    resolve();
  };

  // Window listeners for the drag, live only while one is in flight.
  React.useEffect(() => {
    if (!active) return;
    const move = (e: PointerEvent | MouseEvent | TouchEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const local = localPointer(e);
      if (!local) return;
      const m = e as MouseEvent;
      d.last = {
        local: d.axis === 'cols' ? local.x : local.y,
        shift: Boolean(m.shiftKey),
        alt: Boolean(m.altKey),
        free: Boolean(m.ctrlKey || m.metaKey),
      };
      resolve();
    };
    const up = () => endDrag(true);
    // Modifiers change the answer without the pointer moving.
    const key = (e: KeyboardEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        endDrag(false);
        return;
      }
      if (e.key === 'Shift' || e.key === 'Alt' || e.key === 'Control' || e.key === 'Meta') {
        e.preventDefault();
        d.last = { ...d.last, shift: e.shiftKey, alt: e.altKey, free: e.ctrlKey || e.metaKey };
        resolve();
      }
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('keyup', key, true);
    return () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('keyup', key, true);
    };
  }, [active, localPointer, resolve, endDrag]);

  // Leaving edit mode mid-drag (or unmounting) drops the preview and the readout.
  React.useEffect(
    () => () => {
      if (dragRef.current) {
        dragRef.current = null;
        trackPreview.set(null);
        hud.hide(HUD_SOURCE);
      }
    },
    []
  );

  /** Double-click a border: fit the track before it to what it holds. */
  const autoFit = (border: BorderRef) => {
    const sizes = border.axis === 'cols' ? colSizes : rowSizes;
    const contents = Object.values(useStore.getState().objects).filter(
      (o): o is SlottableNode => isSlottable(o) && o.gridSlot?.gridId === node.id
    );
    const want = autoFitTrackSize(node, border.axis, border.index, contents);
    // Nothing with a size of its own: even the two tracks out, the way an
    // empty spreadsheet column goes back to the default.
    const pair = sizes[border.index] + sizes[border.index + 1];
    const target = want ?? pair / 2;
    const { sizes: next } = resolveBorderDrag({ sizes, index: border.index, delta: target - sizes[border.index] });
    commitTrackSizes(node.id, border.axis, next);
  };

  // Keys while editing. Window-level, guarded so typing in a field is untouched.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (keyBelongsToFocus(e.key)) return;
      // A border drag owns Escape and the modifiers while it runs.
      if (dragRef.current) return;
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

  const blockRect = block && !active ? rectOfBlock(block, colStarts, colSizes, rowStarts, rowSizes) : null;
  const headerY = -(HEADER + GAP) * s;
  const headerX = -(HEADER + GAP) * s;
  const lit = active ?? hover;
  /** Whether track `i` on `axis` is one the hovered or dragged border divides. */
  const touched = (axis: Axis, i: number) =>
    Boolean(lit && lit.axis === axis && (i === lit.index || (i === lit.index + 1 && !(active?.mode === 'grow'))));

  const borders: (BorderRef & { at: number })[] = [
    ...colSizes.slice(0, -1).map((size, i) => ({
      axis: 'cols' as const,
      index: i,
      at: (colStarts[i] + size + colStarts[i + 1]) / 2,
    })),
    ...(nRows > 1
      ? rowSizes.slice(0, -1).map((size, i) => ({
          axis: 'rows' as const,
          index: i,
          at: (rowStarts[i] + size + rowStarts[i + 1]) / 2,
        }))
      : []),
  ];

  return (
    <Group ref={groupRef}>
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
            fill={dark ? '#18181B' : '#FFFFFF'}
            stroke={ink(0.9)}
            strokeWidth={1.5 * s}
            // A full touch target on a finger, drawn at its compact size.
            hitStrokeWidth={touchHitPad(HANDLE) * s || undefined}
            draggable
            onMouseDown={stop}
            onTouchStart={stop}
            onMouseEnter={() => setCursor('nwse-resize')}
            onMouseLeave={() => setCursor('')}
            // Drag events bubble to the grid's own handlers; keep them here.
            onDragStart={stop}
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
          label={trackName('cols', i)}
          detail={trackDetail(spec.tracks?.cols?.[i], size)}
          scale={s}
          dark={dark}
          selected={Boolean(block && i >= block.col && i < block.col + block.cols)}
          lit={touched('cols', i)}
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
            label={trackName('rows', i)}
            detail={trackDetail(spec.tracks?.rows?.[i], size)}
            scale={s}
            dark={dark}
            vertical
            selected={Boolean(block && i >= block.row && i < block.row + block.rows)}
            lit={touched('rows', i)}
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

      {/* Borders between tracks: a grip in the header strip, a target along the whole edge. */}
      {borders.map((b) => {
        const on = Boolean(lit && lit.axis === b.axis && lit.index === b.index);
        const cols = b.axis === 'cols';
        const gutter = cols ? spec.gutterX : spec.gutterY;
        // At least ten screen pixels (a full touch target on a finger), and
        // the whole gutter when the gutter is wider than that.
        const thickness = Math.max(gutter, (isCoarse() ? TOUCH_TARGET : BORDER_HIT) * s);
        const from = cols ? headerY : headerX;
        const to = cols ? shown.height : shown.width;
        const grip = { long: 10 * s, short: 3 * s };
        return (
          <Group key={`${b.axis}${b.index}`}>
            {on && (
              <Line
                points={cols ? [b.at, from, b.at, to] : [from, b.at, to, b.at]}
                stroke={ink(0.95)}
                strokeWidth={2 * s}
                listening={false}
                perfectDrawEnabled={false}
              />
            )}
            <Rect
              x={cols ? b.at - grip.short / 2 : headerX + (HEADER * s - grip.long) / 2}
              y={cols ? headerY + (HEADER * s - grip.long) / 2 : b.at - grip.short / 2}
              width={cols ? grip.short : grip.long}
              height={cols ? grip.long : grip.short}
              cornerRadius={grip.short / 2}
              fill={ink(on ? 0.95 : 0.4)}
              listening={false}
              perfectDrawEnabled={false}
            />
            <Rect
              x={cols ? b.at - thickness / 2 : from}
              y={cols ? from : b.at - thickness / 2}
              width={cols ? thickness : to - from}
              height={cols ? to - from : thickness}
              fill="rgba(0,0,0,0)"
              perfectDrawEnabled={false}
              onMouseEnter={() => {
                if (dragRef.current) return;
                setHover({ axis: b.axis, index: b.index });
                setCursor(cols ? 'col-resize' : 'row-resize');
              }}
              onMouseLeave={() => {
                if (dragRef.current) return;
                setHover(null);
                setCursor('');
              }}
              onMouseDown={(e) => {
                stop(e);
                if ((e.evt as MouseEvent).button !== 0) return;
                e.evt.preventDefault();
                beginDrag(b, e.evt as MouseEvent);
              }}
              onTouchStart={(e) => {
                stop(e);
                beginDrag(b, e.evt as TouchEvent);
              }}
              onClick={stop}
              onTap={stop}
              // Without this the double-click reaches the grid, which would
              // read it as "type into this module".
              onDblClick={(e) => {
                stop(e);
                autoFit(b);
              }}
              onDblTap={(e) => {
                stop(e);
                autoFit(b);
              }}
            />
          </Group>
        );
      })}
    </Group>
  );
};

const HUD_SOURCE = 'grid-track';
/** How close, in screen pixels, a border has to come to a snap before it takes it. */
const SNAP_PX = 6;
/** A border's hit band, screen pixels, on a mouse. */
const BORDER_HIT = 10;

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
  dark: boolean;
  vertical?: boolean;
  selected: boolean;
  /** One of the two tracks the hovered or dragged border divides. */
  lit: boolean;
  onClick: (extend: boolean) => void;
}> = ({ x, y, width, height, label, detail, scale, dark, vertical, selected, lit, onClick }) => {
  const fontSize = 10 * scale;
  const long = vertical ? height : width;
  // While a border is live the sizes are the point, so they show whenever they fit.
  const text = long > (lit ? 40 : 64) * scale ? `${label} · ${detail}` : label;
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
        fill={selected ? ink(0.85) : lit ? ink(0.16) : ink(0.07)}
        stroke={lit && !selected ? ink(0.5) : undefined}
        strokeWidth={scale}
        perfectDrawEnabled={false}
      />
      <Text
        x={0}
        y={vertical ? height : 0}
        width={vertical ? height : width}
        height={vertical ? width : height}
        rotation={vertical ? -90 : 0}
        text={text}
        fontSize={fontSize}
        fontFamily="Inter, sans-serif"
        fontStyle={lit ? '600' : '500'}
        align="center"
        verticalAlign="middle"
        fill={selected ? (dark ? '#18181B' : '#FFFFFF') : ink(lit ? 0.95 : 0.7)}
        listening={false}
        perfectDrawEnabled={false}
      />
    </Group>
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
