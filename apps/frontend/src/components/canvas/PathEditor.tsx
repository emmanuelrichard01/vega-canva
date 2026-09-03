import React, { useSyncExternalStore } from 'react';
import type Konva from 'konva';
import { Arc, Circle, Group, Line, Path, Rect, Text } from 'react-konva';
import { deleteNode, updateNode } from '../../engine/document';
import { useStore } from '../../hooks/useStore';
import { pathEdit } from '../../engine/interaction/pathEdit';
import { EXPORT_CHROME } from '../../engine/export/chrome';
import {
  anchorCurvatureRadius,
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
  constrainHandleToAngle,
  contours,
  dragHandle,
  mergeAnchors,
  moveAnchors,
  setAnchorAlignment,
  setAnchorsMode,
  toggleAnchor,
  type AnchorRef,
} from '../../engine/model/pathEditing';
import { claimCursor } from '../../engine/cursor/cursorOverride';
import { curvatureAt } from '../../engine/model/pathGeometry';
import { cursorCss } from '../../engine/cursor/cursorCss';
import { penVisual } from '../../engine/cursor/cursorVisual';

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
/** Curvature arc display: radius below this (in local units) is shown, above is "straight". */
const CURVATURE_MAX_DISPLAY = 10_000;
/** Screen-pixel bounds for the curvature arc indicator. */
const CURVATURE_ARC_MIN_PX = 14;
const CURVATURE_ARC_MAX_PX = 50;
/** Mode badge labels: what the user sees for each handle alignment state. */
const MODE_LABEL: Record<string, string> = { mirrored: '◇', smooth: '○', corner: '□' };
const MODE_TOOLTIP: Record<string, string> = { mirrored: 'Symmetric', smooth: 'Smooth', corner: 'Corner' };

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

  /** Global modifier key tracker to prevent Windows menu hooking on Alt press */
  React.useEffect(() => {
    if (!selection) return;
    const handleGlobalKey = (e: KeyboardEvent) => {
      if (e.key === 'Alt') {
        e.preventDefault();
        altHeld.current = e.type === 'keydown';
      }
      if (e.key === 'Shift') {
        shiftHeld.current = e.type === 'keydown';
      }
    };
    window.addEventListener('keydown', handleGlobalKey);
    window.addEventListener('keyup', handleGlobalKey);
    return () => {
      window.removeEventListener('keydown', handleGlobalKey);
      window.removeEventListener('keyup', handleGlobalKey);
    };
  }, [selection]);

  /**
   * Keyboard shortcuts for anchor alignment modes during path editing.
   * 1 = Symmetric (mirrored), 2 = Smooth, 3 = Disconnected (corner).
   * Only fires when the path editor is active and anchors are picked.
   */
  React.useEffect(() => {
    if (!selection || !node || node.type !== 'path' || node.geometry.kind === 'freehand') return;
    const geo: ContourGeometry = node.geometry;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (selection.anchors.length === 0) return;
      const map: Record<string, 'symmetric' | 'smooth' | 'disconnected'> = {
        '1': 'symmetric',
        '2': 'smooth',
        '3': 'disconnected',
      };
      const alignment = map[e.key];
      if (!alignment) return;
      e.preventDefault();
      e.stopPropagation();
      const next = setAnchorAlignment(geo, selection.anchors, alignment);
      const framed = reframePath(next);
      updateNode(node.id, {
        geometry: framed.geometry,
        x: node.x + framed.dx,
        y: node.y + framed.dy,
        width: framed.width,
        height: framed.height,
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selection, node]);

  if (!selection || !node || node.type !== 'path') return null;
  if (node.geometry.kind === 'freehand') return null;

  const geometry: ContourGeometry = node.geometry;
  const rings = contours(geometry);
  const scale = 1 / stageScale;
  const picked = new Set(selection.anchors.map(anchorKey));

  /**
   * The osculating circle at each picked anchor — the circle the curve *is*.
   *
   * ## Why a handle is not enough to see a curve by
   *
   * A Bézier handle shows the **tangent**: which way the curve sets off. It
   * says almost nothing about how hard it bends, and two handles of very
   * different lengths can look similar on screen while producing curves that
   * are nothing alike. The difference only shows up once the path is stroked,
   * zoomed, or laid beside another — which is late.
   *
   * The osculating circle is the missing half, and it is the one overlay that
   * makes a *run* of anchors legible rather than one at a time: anchors
   * carrying similar circles will read as one continuous sweep, and the odd one
   * out is visible immediately instead of as a flat spot somebody notices
   * afterwards.
   *
   * ## Why only the picked ones
   *
   * Drawing a circle at every anchor turns a path into a spirograph. These
   * appear for what is selected, which is the same rule the handles follow.
   *
   * A circle is skipped where there is none to draw — a straight run, or a
   * tangent that is undefined because the handle sits on its own anchor.
   * `curvatureAt` answers null for both rather than `Infinity`, so there is
   * nothing here to guard against.
   */
  const curvatures = ((): Array<{ key: string; cx: number; cy: number; r: number }> => {
    /**
     * A plain function, not a `useMemo`.
     *
     * This sits after the early returns for a freehand path and a missing
     * node, so a hook here would be called conditionally — and this component
     * has already shipped that bug once: `a605dec`, the hooks-order fault that
     * emptied the canvas on double-click. Moving the memo above the returns
     * would work and would put a hook a long way from what it is for.
     *
     * The work is a handful of curvature calculations over the *picked*
     * anchors — usually none, occasionally a few — so memoising it buys
     * nothing worth a hook.
     */
    const out: Array<{ key: string; cx: number; cy: number; r: number }> = [];
    const subs = subpathsOf(geometry);
    for (const ref of selection.anchors) {
      const sub = subs[ref.sub];
      if (!sub) continue;
      const c = curvatureAt(sub, ref.index);
      if (!c) continue;
      // A circle far larger than the artwork is a straight line as far as the
      // eye is concerned, and drawing it fills the screen with an arc that
      // says nothing. The bound is generous: it only excludes the ones that
      // could not be read anyway.
      if (c.radius > 4000) continue;
      out.push({ key: anchorKey(ref), cx: c.cx, cy: c.cy, r: c.radius });
    }
    return out;
  })();

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

    let rafId: number | null = null;
    let pendingGeo: ContourGeometry | null = null;

    const flushTransientCommit = () => {
      if (pendingGeo) {
        commit(pendingGeo, false);
        pendingGeo = null;
      }
      rafId = null;
    };

    const scheduleTransientCommit = (geo: ContourGeometry) => {
      pendingGeo = geo;
      if (rafId === null) {
        rafId = requestAnimationFrame(flushTransientCommit);
      }
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
        let snapAngleDeg: number | null = null;
        if (shiftHeld.current && s.ref) {
          const a = anchorAt(s.working, s.ref);
          if (a) {
            const snapped = constrainHandleToAngle(a, dest, 15);
            dest = { x: snapped.x, y: snapped.y };
            snapAngleDeg = snapped.angleDeg;
          }
        }
        s.working = dragHandle(
          s.working,
          { ...s.ref, side: s.side },
          dest,
          { break: altHeld.current }
        );

        const anchorPt = anchorAt(s.working, s.ref);
        const hdx = dest.x - (anchorPt?.x ?? 0);
        const hdy = dest.y - (anchorPt?.y ?? 0);
        const freeAngle = ((Math.atan2(hdy, hdx) * 180) / Math.PI + 360) % 360;
        const displayAngle = snapAngleDeg !== null ? snapAngleDeg : freeAngle;
        const isBroken = altHeld.current;
        const isSnapped = shiftHeld.current;

        let modeHint = '';
        if (isBroken) modeHint = ' (Disconnected)';
        else if (isSnapped) {
          const deg = Math.round(displayAngle);
          if (deg % 90 === 0) modeHint = ' (Cardinal)';
          else if (deg % 45 === 0) modeHint = ' (Diagonal)';
          else modeHint = ` (Snap 15°)`;
        }
        setDragBadge({
          x: p.x - node.x,
          y: p.y - node.y,
          text: `Handle · ${Math.round(displayAngle)}°${modeHint}`,
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
      scheduleTransientCommit(s.working);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Alt') {
        e.preventDefault();
        if (!e.repeat && !altHeld.current) {
          altHeld.current = true;
          onMove();
        }
      }
      if (e.key === 'Shift') {
        if (!e.repeat && !shiftHeld.current) {
          shiftHeld.current = true;
          onMove();
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt') {
        e.preventDefault();
        if (altHeld.current) {
          altHeld.current = false;
          onMove();
        }
      }
      if (e.key === 'Shift') {
        if (shiftHeld.current) {
          shiftHeld.current = false;
          onMove();
        }
      }
    };

    const onUp = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
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
            altHeld.current = Boolean((e.evt as MouseEvent).altKey || altHeld.current);
            shiftHeld.current = Boolean((e.evt as MouseEvent).shiftKey || shiftHeld.current);
            const p = worldPointer(e.target.getStage());
            if (p) {
              pathEdit.select([ref]);
              beginSession(e.target.getStage(), 'handle', p, { ref, side: which });
            }
          }}
          onMouseEnter={() => {
            setHoveredHandleKey(handleKeyStr);
            claimCursor('path-anchor', cursorCss(penVisual('remove'), 'grab'));
          }}
          onMouseLeave={() => {
            setHoveredHandleKey(null);
            claimCursor('path-anchor', null);
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
        onMouseEnter={() => claimCursor('path-segment', cursorCss(penVisual('add'), 'copy'))}
        onMouseLeave={() => claimCursor('path-segment', null)}
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
                  const isAlt = Boolean((e.evt as MouseEvent).altKey || altHeld.current);
                  const isShift = Boolean((e.evt as MouseEvent).shiftKey || shiftHeld.current);
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
                onMouseEnter={() => {
                  setHoveredKey(key);
                  claimCursor('path-handle', cursorCss(penVisual('convert'), 'pointer'));
                }}
                onMouseLeave={() => {
                  setHoveredKey(null);
                  claimCursor('path-handle', null);
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

      {/* Handle alignment mode badge on picked anchors */}
      {rings.map((ring) =>
        ring.anchors.map((a, index) => {
          const ref: AnchorRef = { sub: ring.sub, index };
          if (!picked.has(anchorKey(ref))) return null;
          const sub = subpathsOf(geometry)[ring.sub];
          const mode = anchorMode(sub, index);
          const label = MODE_LABEL[mode] ?? '□';
          const tooltip = MODE_TOOLTIP[mode] ?? 'Corner';
          const text = `${label} ${tooltip}`;
          const badgeWidth = (text.length * 5.5 + 10) * scale;
          return (
            <Group key={`mode-${anchorKey(ref)}`} x={a.x} y={a.y + (ANCHOR_SIZE + 6) * scale} listening={false}>
              <Rect
                x={-badgeWidth / 2}
                y={-1 * scale}
                width={badgeWidth}
                height={14 * scale}
                fill="rgba(15, 23, 42, 0.88)"
                cornerRadius={3 * scale}
                shadowColor="rgba(0,0,0,0.25)"
                shadowBlur={3 * scale}
              />
              <Text
                x={-badgeWidth / 2}
                y={1.5 * scale}
                width={badgeWidth}
                align="center"
                text={text}
                fill="#FFFFFF"
                fontSize={8 * scale}
                fontFamily="monospace"
              />
            </Group>
          );
        })
      )}

      {/* Curvature radius arc indicator on picked curved anchors */}
      {rings.map((ring) =>
        ring.anchors.map((a, index) => {
          const ref: AnchorRef = { sub: ring.sub, index };
          if (!picked.has(anchorKey(ref))) return null;
          const sub = subpathsOf(geometry)[ring.sub];
          const radii = anchorCurvatureRadius(sub, index);
          const bestR = Math.min(radii.in, radii.out);
          if (!isFinite(bestR) || bestR > CURVATURE_MAX_DISPLAY) return null;

          // Map curvature radius to a screen-pixel arc size via log scale
          const logMin = Math.log(1);
          const logMax = Math.log(CURVATURE_MAX_DISPLAY);
          const logR = Math.log(Math.max(1, bestR));
          const t = (logR - logMin) / (logMax - logMin);
          const arcScreenPx = CURVATURE_ARC_MIN_PX + t * (CURVATURE_ARC_MAX_PX - CURVATURE_ARC_MIN_PX);
          const arcRadius = arcScreenPx * scale;

          // Tangent direction for the arc orientation
          const dx = (a.outX ?? a.inX ?? a.x) - a.x;
          const dy = (a.outY ?? a.inY ?? a.y) - a.y;
          const tangentAngle = Math.atan2(dy, dx) * (180 / Math.PI);
          const radiusText = `R: ${bestR < 1 ? bestR.toFixed(2) : bestR < 100 ? bestR.toFixed(1) : Math.round(bestR)}`;
          const radiusWidth = (radiusText.length * 6 + 10) * scale;

          return (
            <React.Fragment key={`curv-${anchorKey(ref)}`}>
              <Arc
                x={a.x}
                y={a.y}
                innerRadius={arcRadius - 1 * scale}
                outerRadius={arcRadius}
                angle={90}
                rotation={tangentAngle - 45}
                fill="rgba(37, 99, 235, 0.35)"
                listening={false}
                perfectDrawEnabled={false}
              />
              <Group x={a.x + (ANCHOR_SIZE + 12) * scale} y={a.y - (ANCHOR_SIZE + 2) * scale} listening={false}>
                <Rect
                  width={radiusWidth}
                  height={14 * scale}
                  fill="rgba(15, 23, 42, 0.88)"
                  cornerRadius={3 * scale}
                  shadowColor="rgba(0,0,0,0.25)"
                  shadowBlur={3 * scale}
                />
                <Text
                  x={5 * scale}
                  y={1.5 * scale}
                  text={radiusText}
                  fill="#93C5FD"
                  fontSize={8.5 * scale}
                  fontFamily="monospace"
                />
              </Group>
            </React.Fragment>
          );
        })
      )}

      {/* Drag Delta HUD Tooltip Badge */}
      {/*
        The osculating circles, under everything else.
        Faint and dashed on purpose: this is a *reading* of the curve, not part
        of it, and it must never compete with the handles that are being
        dragged. Drawn beneath the anchors for the same reason.
      */}
      {curvatures.map((c) => (
        <Circle
          key={`k-${c.key}`}
          x={c.cx}
          y={c.cy}
          radius={c.r}
          stroke="#6366F1"
          strokeWidth={1 * scale}
          dash={[4 * scale, 4 * scale]}
          opacity={0.42}
          listening={false}
          perfectDrawEnabled={false}
        />
      ))}

      {/*
        The radius, written once beside a single picked anchor.
        Only for one: a number per anchor across a multi-selection is a wall of
        digits over the artwork, and the circles already carry the comparison
        that matters — which of these bend alike — without anyone reading them.
      */}
      {curvatures.length === 1 && (
        <Group x={curvatures[0].cx} y={curvatures[0].cy} listening={false}>
          <Text
            text={`R ${curvatures[0].r < 10 ? curvatures[0].r.toFixed(1) : Math.round(curvatures[0].r)}`}
            x={4 * scale}
            y={-14 * scale}
            fill="#6366F1"
            fontSize={10 * scale}
            fontFamily="monospace"
          />
        </Group>
      )}

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

