import React, { useSyncExternalStore } from 'react';
import type Konva from 'konva';
import { Circle, Group, Line, Path, Rect, Text } from 'react-konva';
import { deleteNode, updateNode } from '../../engine/document';
import { useStore } from '../../hooks/useStore';
import { pathEdit } from '../../engine/interaction/pathEdit';
import { EXPORT_CHROME } from '../../engine/export/chrome';
import {
  anchorMode,
  contourData,
  insertAnchor,
  nearestPointOnPath,
  reframePath,
  subpathsOf,
  type Anchor,
  type ContourGeometry,
} from '../../engine/model/pathGeometry';
import {
  anchorAt,
  anchorKey,
  anchorsInRect,
  constrainDeltaToAxis,
  contours,
  dragHandle,
  mergeAnchors,
  moveAnchors,
  setAnchorsMode,
  toggleAnchor,
  type AnchorRef,
} from '../../engine/model/pathEditing';

interface Props {
  /** Stage zoom, so every handle stays the same size on screen. */
  stageScale: number;
}

const ACCENT = '#2563EB';
const ACCENT_GLOW = 'rgba(37, 99, 235, 0.25)';
/** Anchor square, in screen pixels. Matches the transformer's handles. */
const ANCHOR_SIZE = 8;
const HANDLE_RADIUS = 4.5;
/** How near the outline a click has to land to insert an anchor there, in screen pixels. */
const INSERT_SLOP = 8;
/** Pointer travel, in screen px, before a press counts as a drag rather than a click. */
const DRAG_SLOP = 3;

/**
 * Direct selection: reshaping part of a path rather than all of it.
 *
 * ## Features:
 * - Direct anchor picking, shift multi-selection & marquee.
 * - Shift axis constraint (0°, 45°, 90°, 135°) for precision vector drafting.
 * - Alt/Option-click to convert anchors and retract bezier handles.
 * - Smooth vs corner mode visual cues and double-click conversion.
 * - Real-time delta coordinate HUD badges during manipulation.
 * - Non-destructive outline anchor insertion.
 */
export const PathEditor: React.FC<Props> = ({ stageScale }) => {
  const selection = useSyncExternalStore(pathEdit.subscribe, pathEdit.getSnapshot, pathEdit.getSnapshot);
  const node = useStore((s) => (selection ? s.objects[selection.nodeId] : undefined));
  const [marquee, setMarquee] = React.useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [hoveredKey, setHoveredKey] = React.useState<string | null>(null);
  const [hoveredHandleKey, setHoveredHandleKey] = React.useState<string | null>(null);
  const [dragBadge, setDragBadge] = React.useState<{ x: number; y: number; text: string } | null>(null);

  /**
   * The live drag session.
   */
  const session = React.useRef<{
    kind: 'anchor' | 'handle' | 'marquee';
    ref?: AnchorRef;
    side?: 'in' | 'out';
    working: ContourGeometry;
    origin: { x: number; y: number };
    start: { x: number; y: number };
    last: { x: number; y: number };
    appliedDelta: { dx: number; dy: number };
    moved: boolean;
    anchors: AnchorRef[];
  } | null>(null);

  /** Modifier keys tracked during pointer movement */
  const altHeld = React.useRef(false);
  const shiftHeld = React.useRef(false);
  const marqueeAdditive = React.useRef(false);

  if (!selection || !node || node.type !== 'path') return null;
  if (node.geometry.kind === 'freehand') return null;

  const geometry: ContourGeometry = node.geometry;
  const rings = contours(geometry);
  const scale = 1 / stageScale;
  const picked = new Set(selection.anchors.map(anchorKey));

  /**
   * Write geometry back.
   */
  const commit = (next: ContourGeometry | null, reframe = true) => {
    if (!next) {
      deleteNode(node.id);
      pathEdit.exit();
      return;
    }
    if (!reframe) {
      updateNode(node.id, { geometry: next });
      return;
    }
    const framed = reframePath(next);
    updateNode(node.id, {
      geometry: framed.geometry,
      x: node.x + framed.dx,
      y: node.y + framed.dy,
      width: framed.width,
      height: framed.height,
    });
  };

  /** Pointer position in world coordinates. */
  const worldPointer = (stage: Konva.Stage | null): { x: number; y: number } | null =>
    stage?.getRelativePointerPosition() ?? null;

  /** Pointer position in the node's own coordinates. */
  const localPointer = (e: Konva.KonvaEventObject<unknown>): { x: number; y: number } | null => {
    const p = worldPointer(e.target.getStage());
    return p ? { x: p.x - node.x, y: p.y - node.y } : null;
  };

  /**
   * Run a session to completion, on the stage and on the window.
   */
  const beginSession = (
    stage: Konva.Stage | null,
    kind: 'anchor' | 'handle' | 'marquee',
    at: { x: number; y: number },
    extra: { ref?: AnchorRef; side?: 'in' | 'out'; anchors?: AnchorRef[] } = {}
  ) => {
    if (!stage) return;
    session.current = {
      kind,
      working: geometry,
      origin: { x: node.x, y: node.y },
      start: at,
      last: at,
      appliedDelta: { dx: 0, dy: 0 },
      moved: false,
      anchors: extra.anchors ?? [],
      ref: extra.ref,
      side: extra.side,
    };

    const onMove = (evt?: any) => {
      const s = session.current;
      const p = worldPointer(stage);
      if (!s || !p) return;

      if (evt?.evt) {
        altHeld.current = Boolean(evt.evt.altKey);
        shiftHeld.current = Boolean(evt.evt.shiftKey);
      }

      if (!s.moved && Math.hypot(p.x - s.start.x, p.y - s.start.y) * stageScale < DRAG_SLOP) return;
      s.moved = true;

      if (s.kind === 'marquee') {
        const startX = s.start.x - s.origin.x;
        const startY = s.start.y - s.origin.y;
        const currX = p.x - s.origin.x;
        const currY = p.y - s.origin.y;
        setMarquee({
          x: Math.min(startX, currX),
          y: Math.min(startY, currY),
          w: Math.abs(currX - startX),
          h: Math.abs(currY - startY),
        });
        return;
      }

      if (s.kind === 'handle' && s.ref && s.side) {
        let dest = { x: p.x - s.origin.x, y: p.y - s.origin.y };
        if (shiftHeld.current && s.ref) {
          const a = anchorAt(s.working, s.ref);
          if (a) {
            const relDx = dest.x - a.x;
            const relDy = dest.y - a.y;
            const snapped = constrainDeltaToAxis(relDx, relDy);
            dest = { x: a.x + snapped.dx, y: a.y + snapped.dy };
          }
        }
        s.working = dragHandle(
          s.working,
          { ...s.ref, side: s.side },
          dest,
          { break: altHeld.current }
        );

        const dx = p.x - s.start.x;
        const dy = p.y - s.start.y;
        const angle = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
        const isBroken = altHeld.current;
        const isSnapped = shiftHeld.current;
        setDragBadge({
          x: p.x - node.x,
          y: p.y - node.y,
          text: `Handle · ${angle.toFixed(0)}°${isBroken ? ' (Broken Cusp)' : ''}${isSnapped ? ' (Snapped)' : ''}`,
        });
      } else {
        const rawDx = p.x - s.start.x;
        const rawDy = p.y - s.start.y;
        const constrained = shiftHeld.current
          ? constrainDeltaToAxis(rawDx, rawDy)
          : { dx: rawDx, dy: rawDy };

        const stepDx = constrained.dx - s.appliedDelta.dx;
        const stepDy = constrained.dy - s.appliedDelta.dy;
        s.appliedDelta = constrained;
        s.working = moveAnchors(s.working, s.anchors, stepDx, stepDy);

        setDragBadge({
          x: p.x - node.x,
          y: p.y - node.y,
          text: `Δx: ${Math.round(constrained.dx)} Δy: ${Math.round(constrained.dy)}${shiftHeld.current ? ' (Snapping)' : ''}`,
        });
      }

      s.last = p;
      commit(s.working, false);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Alt') {
        altHeld.current = true;
        onMove();
      }
      if (e.key === 'Shift') {
        shiftHeld.current = true;
        onMove();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt') {
        altHeld.current = false;
        onMove();
      }
      if (e.key === 'Shift') {
        shiftHeld.current = false;
        onMove();
      }
    };

    const onUp = () => {
      const s = session.current;
      session.current = null;
      setDragBadge(null);
      stage.off('mousemove.patheditor');
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      if (!s) return;

      if (s.kind === 'marquee') {
        finishMarquee(s.moved);
        return;
      }
      if (s.moved) commit(s.working, true);
    };

    stage.on('mousemove.patheditor', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
  };

  const finishMarquee = (moved: boolean) => {
    setMarquee((box) => {
      if (!moved || !box) {
        if (!moved) pathEdit.select([]);
        return null;
      }
      const found = anchorsInRect(geometry, { x: box.x, y: box.y, width: box.w, height: box.h });
      pathEdit.select(marqueeAdditive.current ? mergeAnchors(selection.anchors, found) : found);
      return null;
    });
  };

  const handleLine = (a: Anchor, hx: number, hy: number, ref: AnchorRef, which: 'in' | 'out') => {
    const handleKeyStr = `${which}-${anchorKey(ref)}`;
    const isHovered = hoveredHandleKey === handleKeyStr;
    const isActive =
      session.current?.kind === 'handle' &&
      session.current.side === which &&
      session.current.ref &&
      anchorKey(session.current.ref) === anchorKey(ref);

    return (
      <React.Fragment key={handleKeyStr}>
        {/* Handle stem line */}
        <Line
          points={[a.x, a.y, hx, hy]}
          stroke={ACCENT}
          strokeWidth={scale * 1.25}
          opacity={0.85}
          listening={false}
          perfectDrawEnabled={false}
        />
        {/* Hover glow ring */}
        {isHovered && !isActive && (
          <Circle
            x={hx}
            y={hy}
            radius={(HANDLE_RADIUS + 3) * scale}
            fill={ACCENT_GLOW}
            listening={false}
            perfectDrawEnabled={false}
          />
        )}
        {/* Handle control knob endpoint */}
        <Circle
          x={hx}
          y={hy}
          radius={HANDLE_RADIUS * scale}
          hitStrokeWidth={HANDLE_RADIUS * 4 * scale}
          fill={isActive ? ACCENT : '#FFFFFF'}
          stroke={ACCENT}
          strokeWidth={scale * 1.5}
          shadowColor="rgba(0,0,0,0.22)"
          shadowBlur={3 * scale}
          shadowOffsetY={1 * scale}
          onMouseDown={(e) => {
            e.cancelBubble = true;
            altHeld.current = Boolean((e.evt as MouseEvent).altKey);
            shiftHeld.current = Boolean((e.evt as MouseEvent).shiftKey);
            const p = worldPointer(e.target.getStage());
            if (p) {
              pathEdit.select([ref]);
              beginSession(e.target.getStage(), 'handle', p, { ref, side: which });
            }
          }}
          onMouseEnter={(e) => {
            setHoveredHandleKey(handleKeyStr);
            const stage = e.target.getStage();
            if (stage) stage.container().style.cursor = 'grab';
          }}
          onMouseLeave={(e) => {
            setHoveredHandleKey(null);
            const stage = e.target.getStage();
            if (stage) stage.container().style.cursor = '';
          }}
          perfectDrawEnabled={false}
        />
      </React.Fragment>
    );
  };

  return (
    <Group x={node.x} y={node.y} name={EXPORT_CHROME}>
      {/* Marquee catcher */}
      <Rect
        x={-INSERT_SLOP * scale}
        y={-INSERT_SLOP * scale}
        width={(node.width || 0) + INSERT_SLOP * 2 * scale}
        height={(node.height || 0) + INSERT_SLOP * 2 * scale}
        fill="transparent"
        onMouseDown={(e) => {
          e.cancelBubble = true;
          const stage = e.target.getStage();
          const p = worldPointer(stage);
          if (!p) return;
          marqueeAdditive.current = Boolean(
            (e.evt as MouseEvent).shiftKey || (e.evt as MouseEvent).ctrlKey || (e.evt as MouseEvent).metaKey
          );
          beginSession(stage, 'marquee', p);
        }}
        perfectDrawEnabled={false}
      />

      {/* Interactive Path Outline */}
      <Path
        data={contourData(geometry)}
        stroke={ACCENT}
        strokeWidth={scale}
        fillEnabled={false}
        hitStrokeWidth={INSERT_SLOP * 2 * scale}
        onClick={(e) => {
          const p = localPointer(e);
          if (!p) return;
          const subs = subpathsOf(geometry);
          type Best = { sub: number; hit: NonNullable<ReturnType<typeof nearestPointOnPath>> };
          let best: Best | null = null;
          subs.forEach((sub, i) => {
            const hit = nearestPointOnPath(sub, p);
            if (hit && (best === null || hit.distance < best.hit.distance)) best = { sub: i, hit };
          });
          const found = best as Best | null;
          if (!found || found.hit.distance > INSERT_SLOP * scale) return;
          e.cancelBubble = true;

          const edited = insertAnchor(subs[found.sub], found.hit);
          const next: ContourGeometry =
            geometry.kind === 'compound'
              ? { kind: 'compound', subpaths: subs.map((s, i) => (i === found.sub ? edited : s)) }
              : edited;
          commit(next);
          pathEdit.select([{ sub: found.sub, index: found.hit.curve + 1 }]);
        }}
        onMouseEnter={(e) => {
          const stage = e.target.getStage();
          if (stage) stage.container().style.cursor = 'copy';
        }}
        onMouseLeave={(e) => {
          const stage = e.target.getStage();
          if (stage) stage.container().style.cursor = '';
        }}
        perfectDrawEnabled={false}
      />

      {/* Anchor Points */}
      {rings.map((ring) =>
        ring.anchors.map((a, index) => {
          const ref: AnchorRef = { sub: ring.sub, index };
          const key = anchorKey(ref);
          const isPicked = picked.has(key);
          const isHovered = hoveredKey === key;
          const sub = subpathsOf(geometry)[ring.sub];
          const isCorner = anchorMode(sub, index) === 'corner';
          const size = ANCHOR_SIZE * scale;

          return (
            <React.Fragment key={key}>
              {/* Subtle hover glow ring on unselected */}
              {isHovered && !isPicked && (
                <Circle
                  x={a.x}
                  y={a.y}
                  radius={(ANCHOR_SIZE + 2) * scale}
                  fill={ACCENT_GLOW}
                  listening={false}
                  perfectDrawEnabled={false}
                />
              )}
              <Rect
                x={a.x - size / 2}
                y={a.y - size / 2}
                width={size}
                height={size}
                hitStrokeWidth={size * 1.5}
                fill={isPicked ? ACCENT : '#FFFFFF'}
                stroke={isPicked ? '#FFFFFF' : ACCENT}
                strokeWidth={scale * (isPicked ? 1.5 : 1.25)}
                cornerRadius={isCorner ? 0 : size}
                shadowColor="rgba(0,0,0,0.22)"
                shadowBlur={isPicked ? 3 * scale : 2 * scale}
                shadowOffsetY={isPicked ? 1 * scale : 0.5 * scale}
                onMouseDown={(e) => {
                  e.cancelBubble = true;
                  const isAlt = Boolean((e.evt as MouseEvent).altKey);
                  const isShift = Boolean((e.evt as MouseEvent).shiftKey);
                  const isCtrlOrCmd = Boolean((e.evt as MouseEvent).ctrlKey || (e.evt as MouseEvent).metaKey);
                  const isAdditive = isShift || isCtrlOrCmd;
                  altHeld.current = isAlt;
                  shiftHeld.current = isShift;

                  // Alt-click converts/retracts handles
                  if (isAlt) {
                    const to = isCorner ? 'smooth' : 'corner';
                    commit(setAnchorsMode(geometry, isPicked ? selection.anchors : [ref], to));
                    return;
                  }

                  const stage = e.target.getStage();
                  const p = worldPointer(stage);
                  if (!p) return;

                  const next = !isAdditive && isPicked
                    ? selection.anchors
                    : toggleAnchor(selection.anchors, ref, isAdditive);
                  pathEdit.select(next);

                  const moving = next.some((r) => anchorKey(r) === key) ? next : [ref];
                  beginSession(stage, 'anchor', p, { anchors: moving });
                }}
                onDblClick={(e) => {
                  e.cancelBubble = true;
                  const to = isCorner ? 'smooth' : 'corner';
                  commit(setAnchorsMode(geometry, isPicked ? selection.anchors : [ref], to));
                }}
                onMouseEnter={(e) => {
                  setHoveredKey(key);
                  const stage = e.target.getStage();
                  if (stage) stage.container().style.cursor = 'pointer';
                }}
                onMouseLeave={(e) => {
                  setHoveredKey(null);
                  const stage = e.target.getStage();
                  if (stage) stage.container().style.cursor = '';
                }}
                perfectDrawEnabled={false}
              />
            </React.Fragment>
          );
        })
      )}

      {/* Control Handles for Anchors (visible for picked anchors, or all curved anchors when none are picked yet) */}
      {rings.map((ring) =>
        ring.anchors.map((a, index) => {
          const ref: AnchorRef = { sub: ring.sub, index };
          const isPicked = picked.has(anchorKey(ref));
          const showHandles = isPicked || picked.size === 0;
          if (!showHandles) return null;
          return (
            <React.Fragment key={`h-${anchorKey(ref)}`}>
              {a.inX !== undefined && handleLine(a, a.inX, a.inY!, ref, 'in')}
              {a.outX !== undefined && handleLine(a, a.outX, a.outY!, ref, 'out')}
            </React.Fragment>
          );
        })
      )}

      {/* Drag Delta HUD Tooltip Badge */}
      {dragBadge && (
        <Group x={dragBadge.x + 10 * scale} y={dragBadge.y - 20 * scale} listening={false}>
          <Rect
            width={dragBadge.text.length * 6 * scale + 14 * scale}
            height={18 * scale}
            fill="rgba(15, 23, 42, 0.88)"
            cornerRadius={4 * scale}
            shadowColor="rgba(0,0,0,0.3)"
            shadowBlur={6 * scale}
          />
          <Text
            text={dragBadge.text}
            x={7 * scale}
            y={4 * scale}
            fill="#FFFFFF"
            fontSize={9 * scale}
            fontFamily="monospace"
          />
        </Group>
      )}

      {/* Marquee Selection Box */}
      {marquee && (
        <Rect
          x={marquee.x}
          y={marquee.y}
          width={marquee.w}
          height={marquee.h}
          stroke={ACCENT}
          strokeWidth={scale}
          dash={[4 * scale, 3 * scale]}
          fill="rgba(37, 99, 235, 0.12)"
          cornerRadius={2 * scale}
          listening={false}
          perfectDrawEnabled={false}
        />
      )}
    </Group>
  );
};

