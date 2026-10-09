import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type Konva from 'konva';
import { Group, Line, Rect } from 'react-konva';
import { EXPORT_CHROME } from '../../engine/export/chrome';
import { claimCursor } from '../../engine/cursor/cursorOverride';
import { arrangeSession } from '../../engine/arrange/session';
import { CanvasPill } from '../hud/CanvasPill';
import { hudColors } from '../../engine/ui/hudPill';
import { alignKey, arrangeGhost, setAlignKey } from '../../engine/arrange/preview';

/**
 * The arrangement controls, on the board.
 *
 * - **Ghosts.** While an Align, Distribute, Tidy or Match size control is
 *   pointed at, the boxes its plan would produce, dashed, with the box being
 *   aligned to as a guide. Nothing moves until it is pressed.
 * - **The key object.** With "Align to: Key object" chosen and the Align panel
 *   open, the key wears a solid ring and every other selected object can be
 *   clicked to become the key, as in Illustrator.
 * - **The live grid.** Each cell faintly, a handle in every gutter (drag it to
 *   change that gap, as Figma's spacing handles do), and every item can be
 *   dragged to another slot while the rest close up around it.
 *
 * Presses on these handles stop at the board: they neither start a marquee
 * nor close the rail's open panel. A press anywhere else settles the grid.
 * Held at a constant screen size, like every other piece of canvas chrome.
 */

/** The canvas selection colour, as the transformer draws it. */
const SELECTION = '#3B82F6';
const HIT = 'rgba(0,0,0,0.001)';
const HIT_NAME = 'arrange-hit';

interface Props {
  stageScale: number;
  selectedIds: readonly string[];
}

const useGhost = () => useSyncExternalStore(arrangeGhost.subscribe, arrangeGhost.get, arrangeGhost.get);
const useKey = () => useSyncExternalStore(alignKey.subscribe, alignKey.get, alignKey.get);
const useSession = () => useSyncExternalStore(arrangeSession.subscribe, arrangeSession.get, arrangeSession.get);

/** A board point from a client point, through the stage's own transform. */
function worldAt(stage: Konva.Stage, clientX: number, clientY: number): { x: number; y: number } {
  const rect = stage.container().getBoundingClientRect();
  const scale = stage.scaleX() || 1;
  return { x: (clientX - rect.left - stage.x()) / scale, y: (clientY - rect.top - stage.y()) / scale };
}

/** Stop a press at this handle: no marquee under it, no panel closing over it. */
function claimPress(e: Konva.KonvaEventObject<MouseEvent>): void {
  e.cancelBubble = true;
  e.evt.stopPropagation();
  e.evt.preventDefault();
}

/** Follow the pointer until it comes up, then hand back. */
function track(
  stage: Konva.Stage,
  onMove: (at: { x: number; y: number }, e: PointerEvent) => void,
  onUp: (cancelled: boolean) => void
): void {
  const move = (e: PointerEvent) => onMove(worldAt(stage, e.clientX, e.clientY), e);
  const up = () => {
    cleanup();
    onUp(false);
  };
  const cancel = () => {
    cleanup();
    onUp(true);
  };
  const cleanup = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
}

const Ghosts: React.FC<{ hair: number }> = ({ hair }) => {
  const ghost = useGhost();
  const colors = hudColors();
  if (!ghost) return null;
  return (
    <Group listening={false}>
      {ghost.reference && (
        <Rect
          x={ghost.reference.x}
          y={ghost.reference.y}
          width={ghost.reference.width}
          height={ghost.reference.height}
          stroke={colors.line}
          strokeWidth={hair}
          dash={[2 * hair, 3 * hair]}
          perfectDrawEnabled={false}
        />
      )}
      {ghost.boxes.map((b, i) => (
        <Rect
          key={i}
          x={b.x}
          y={b.y}
          width={b.width}
          height={b.height}
          fill="rgba(59, 130, 246, 0.08)"
          stroke={SELECTION}
          strokeWidth={1.5 * hair}
          dash={[6 * hair, 4 * hair]}
          perfectDrawEnabled={false}
        />
      ))}
    </Group>
  );
};

const KeyPicker: React.FC<{ hair: number }> = ({ hair }) => {
  const state = useKey();
  const [hover, setHover] = useState<string | null>(null);
  const active = state.target === 'key' && Boolean(state.picking);
  // The pointer cursor goes with the targets, even when they vanish under it.
  useEffect(() => {
    if (!active) claimCursor('arrange-key', null);
  }, [active]);
  useEffect(() => () => claimCursor('arrange-key', null), []);
  if (!active || !state.picking) return null;
  const key = state.picking.find((p) => p.key === state.key) ?? state.picking[0];
  return (
    <Group>
      {state.picking.map((p) =>
        p.key === key?.key ? null : (
          <Rect
            key={p.key}
            name={HIT_NAME}
            x={p.box.x}
            y={p.box.y}
            width={p.box.width}
            height={p.box.height}
            fill={HIT}
            stroke={hover === p.key ? SELECTION : undefined}
            strokeWidth={hair}
            dash={[4 * hair, 3 * hair]}
            onMouseEnter={() => {
              setHover(p.key);
              claimCursor('arrange-key', 'pointer');
            }}
            onMouseLeave={() => {
              setHover(null);
              claimCursor('arrange-key', null);
            }}
            onMouseDown={(e) => {
              claimPress(e);
              setAlignKey({ key: p.key });
            }}
          />
        )
      )}
      {key && (
        <Group listening={false}>
          <Rect
            x={key.box.x - 2 * hair}
            y={key.box.y - 2 * hair}
            width={key.box.width + 4 * hair}
            height={key.box.height + 4 * hair}
            stroke={SELECTION}
            strokeWidth={2.5 * hair}
            perfectDrawEnabled={false}
          />
          <CanvasPill x={key.box.x - 2 * hair} y={key.box.y - 26 * hair} text="Key" tone="object" zoom={1 / hair} />
        </Group>
      )}
    </Group>
  );
};

type GapDrag = { axis: 'col' | 'row'; index: number; value: number } | null;

const LiveGrid: React.FC<{ hair: number }> = ({ hair }) => {
  const session = useSession();
  const colors = hudColors();
  const groupRef = useRef<Konva.Group>(null);
  const [hot, setHot] = useState<string | null>(null);
  const [gapDrag, setGapDrag] = useState<GapDrag>(null);

  // A press anywhere but on the grid's own handles, the rail or its panels settles the grid.
  useEffect(() => {
    if (!session) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('.ctx-toolbar, .ctx-popover')) return;
      const stage = groupRef.current?.getStage();
      if (stage && stage.container().contains(target)) {
        const rect = stage.container().getBoundingClientRect();
        const shape = stage.getIntersection({ x: e.clientX - rect.left, y: e.clientY - rect.top });
        if (shape?.hasName(HIT_NAME)) return;
      }
      arrangeSession.commit();
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [session !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => claimCursor('arrange-grid', null), []);
  // A grid that ends under the pointer takes its resize cursor with it.
  useEffect(() => {
    if (!session) {
      claimCursor('arrange-grid', null);
      setHot(null);
    }
  }, [session]);

  if (!session) return null;
  const { layout, spec } = session;
  const top = layout.origin.y;
  const left = layout.origin.x;
  const grip = 8 * hair;

  const startGap = (axis: 'col' | 'row', index: number) => (e: Konva.KonvaEventObject<MouseEvent>) => {
    claimPress(e);
    const stage = e.target.getStage();
    if (!stage) return;
    const from = worldAt(stage, e.evt.clientX, e.evt.clientY);
    const start = axis === 'col' ? spec.colGap : spec.rowGap;
    // The grid grows from its top-left, so gutter `index` sits at
    // (index + ½) gaps past the fixed tracks: dividing by that keeps the
    // handle under the pointer for whichever gutter was taken.
    const lever = index + 0.5;
    setGapDrag({ axis, index, value: start });
    track(
      stage,
      (at, ev) => {
        const travel = axis === 'col' ? at.x - from.x : at.y - from.y;
        const step = ev.shiftKey ? 8 : 1;
        const value = Math.max(0, Math.round((start + travel / lever) / step) * step);
        setGapDrag({ axis, index, value });
        arrangeSession.update(axis === 'col' ? { colGap: value } : { rowGap: value });
      },
      () => {
        setGapDrag(null);
        claimCursor('arrange-grid', null);
      }
    );
  };

  const startItem = (key: string) => (e: Konva.KonvaEventObject<MouseEvent>) => {
    claimPress(e);
    const stage = e.target.getStage();
    if (!stage) return;
    const from = worldAt(stage, e.evt.clientX, e.evt.clientY);
    let lifted = false;
    claimCursor('arrange-grid', 'grabbing');
    track(
      stage,
      (at) => {
        if (!lifted) {
          // A few screen pixels before it lifts, so a click is not a drag.
          if (Math.hypot(at.x - from.x, at.y - from.y) < 3 * hair) return;
          lifted = true;
          arrangeSession.beginDrag(key, from);
        }
        arrangeSession.moveDrag(at);
      },
      () => {
        claimCursor('arrange-grid', null);
        if (lifted) arrangeSession.endDrag();
      }
    );
  };

  const hoverCursor = (id: string, cursor: string) => ({
    onMouseEnter: () => {
      setHot(id);
      claimCursor('arrange-grid', cursor);
    },
    onMouseLeave: () => {
      setHot((h) => (h === id ? null : h));
      if (!gapDrag) claimCursor('arrange-grid', null);
    },
  });

  const dragging = session.drag;
  const target = dragging ? layout.cells.find((c) => c.key === dragging.key) : undefined;
  const colGutters = layout.colX.slice(1).map((x, i) => ({ i, at: x - spec.colGap / 2 }));
  const rowGutters = layout.rowY.slice(1).map((y, i) => ({ i, at: y - spec.rowGap / 2 }));
  // Pills sit beside the first row and the first column, so a column's and a
  // row's never meet where the gutters cross.
  const colPillY = layout.rowY[0] + layout.rowHeights[0] / 2;
  const rowPillX = layout.colX[0] + layout.colWidths[0] / 2;
  const showCol = gapDrag?.axis === 'col' || Boolean(hot?.startsWith('col'));
  const showRow = gapDrag?.axis === 'row' || Boolean(hot?.startsWith('row'));
  // The value rides next to the gutter being dragged, or the one under the pointer.
  const hotGutter = /^(col|row)(\d+)$/.exec(hot ?? '');
  const labelAxis = gapDrag?.axis ?? (hotGutter?.[1] as 'col' | 'row' | undefined);
  const labelIndex = gapDrag?.index ?? (hotGutter ? Number(hotGutter[2]) : -1);
  const labelGutter = labelAxis === 'col' ? colGutters[labelIndex] : labelAxis === 'row' ? rowGutters[labelIndex] : undefined;
  const labelled = labelGutter && labelAxis
    ? { axis: labelAxis, at: labelGutter.at, value: gapDrag?.value ?? (labelAxis === 'col' ? spec.colGap : spec.rowGap) }
    : null;

  return (
    <Group ref={groupRef}>
      {/* The cells, faintly: the structure the items are snapping to. */}
      <Group listening={false}>
        {layout.cells.map((c) => (
          <Rect
            key={c.key}
            x={c.cell.x}
            y={c.cell.y}
            width={c.cell.width}
            height={c.cell.height}
            stroke={SELECTION}
            strokeWidth={hair}
            opacity={0.45}
            dash={[3 * hair, 3 * hair]}
            perfectDrawEnabled={false}
          />
        ))}
        {target && (
          <Rect
            x={target.cell.x}
            y={target.cell.y}
            width={target.cell.width}
            height={target.cell.height}
            fill="rgba(59, 130, 246, 0.08)"
            stroke={SELECTION}
            strokeWidth={1.5 * hair}
            perfectDrawEnabled={false}
          />
        )}
      </Group>

      {/* Every item can be picked up and dropped in another slot. */}
      {layout.cells.map((c) =>
        dragging?.key === c.key ? null : (
          <Rect
            key={c.key}
            name={HIT_NAME}
            x={c.place.x}
            y={c.place.y}
            width={c.place.width}
            height={c.place.height}
            fill={HIT}
            {...hoverCursor(`item:${c.key}`, 'grab')}
            onMouseDown={startItem(c.key)}
          />
        )
      )}

      {/* Gutters: a hairline and a pill in each, the whole gutter is the handle. */}
      {colGutters.map(({ i, at }) => (
        <Group key={`col${i}`}>
          {showCol && (
            <Line points={[at, top, at, top + layout.height]} stroke={colors.line} strokeWidth={hair} listening={false} perfectDrawEnabled={false} />
          )}
          <Rect
            x={at - 2 * hair}
            y={colPillY - 12 * hair}
            width={4 * hair}
            height={24 * hair}
            cornerRadius={2 * hair}
            fill={colors.measure}
            stroke="#FFFFFF"
            strokeWidth={hair}
            listening={false}
            perfectDrawEnabled={false}
          />
          <Rect
            name={HIT_NAME}
            x={at - Math.max(grip, spec.colGap / 2)}
            y={top}
            width={Math.max(2 * grip, spec.colGap)}
            height={layout.height}
            fill={HIT}
            {...hoverCursor(`col${i}`, 'ew-resize')}
            onMouseDown={startGap('col', i)}
          />
        </Group>
      ))}
      {rowGutters.map(({ i, at }) => (
        <Group key={`row${i}`}>
          {showRow && (
            <Line points={[left, at, left + layout.width, at]} stroke={colors.line} strokeWidth={hair} listening={false} perfectDrawEnabled={false} />
          )}
          <Rect
            x={rowPillX - 12 * hair}
            y={at - 2 * hair}
            width={24 * hair}
            height={4 * hair}
            cornerRadius={2 * hair}
            fill={colors.measure}
            stroke="#FFFFFF"
            strokeWidth={hair}
            listening={false}
            perfectDrawEnabled={false}
          />
          <Rect
            name={HIT_NAME}
            x={left}
            y={at - Math.max(grip, spec.rowGap / 2)}
            width={layout.width}
            height={Math.max(2 * grip, spec.rowGap)}
            fill={HIT}
            {...hoverCursor(`row${i}`, 'ns-resize')}
            onMouseDown={startGap('row', i)}
          />
        </Group>
      ))}

      {labelled && (
        <CanvasPill
          x={labelled.axis === 'col' ? labelled.at + 6 * hair : rowPillX + 16 * hair}
          y={labelled.axis === 'col' ? colPillY + 16 * hair : labelled.at - 10 * hair}
          text={String(labelled.value)}
          tone="measure"
          zoom={1 / hair}
        />
      )}
    </Group>
  );
};

/** Ends a live grid the moment the selection it was made for is no longer selected. */
function useSettleOnSelectionChange(selectedIds: readonly string[]): void {
  const key = selectedIds.join(',');
  useEffect(() => {
    if (arrangeSession.get() && !arrangeSession.activeFor(selectedIds)) arrangeSession.commit();
    arrangeGhost.set(null);
    // `key` stands for the ids.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

export const ArrangeOverlay: React.FC<Props> = ({ stageScale, selectedIds }) => {
  useSettleOnSelectionChange(selectedIds);
  const hair = 1 / (stageScale || 1);
  return (
    <Group name={EXPORT_CHROME}>
      <LiveGrid hair={hair} />
      <KeyPicker hair={hair} />
      <Ghosts hair={hair} />
    </Group>
  );
};
