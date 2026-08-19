import { nanoid } from 'nanoid';
import { useStore } from '../../hooks/useStore';
import type { Tool, ToolContext } from './Tool';
import { gridSnap } from '../interaction/gridSnap';
import * as React from 'react';
import { Path, Circle, Line } from 'react-konva';
import { ThemeService } from '../ThemeService';

interface Anchor {
  x: number;
  y: number;
  /** Forward-facing control point, set only when the anchor was placed with a drag. */
  handleOut: { x: number; y: number } | null;
}

/** The backward-facing control point is always the mirror of handleOut around the anchor itself. */
function incomingHandle(a: Anchor): { x: number; y: number } | null {
  if (!a.handleOut) return null;
  return { x: 2 * a.x - a.handleOut.x, y: 2 * a.y - a.handleOut.y };
}

function buildPathData(anchors: Anchor[], closed: boolean, previewPos: { x: number; y: number } | null): string {
  if (anchors.length === 0) return '';
  let d = `M ${anchors[0].x} ${anchors[0].y}`;
  for (let i = 1; i < anchors.length; i++) {
    const prev = anchors[i - 1];
    const cur = anchors[i];
    const c1 = prev.handleOut || { x: prev.x, y: prev.y };
    const c2 = incomingHandle(cur) || { x: cur.x, y: cur.y };
    d += ` C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${cur.x} ${cur.y}`;
  }
  if (closed && anchors.length > 1) {
    const last = anchors[anchors.length - 1];
    const first = anchors[0];
    const c1 = last.handleOut || { x: last.x, y: last.y };
    const c2 = incomingHandle(first) || { x: first.x, y: first.y };
    d += ` C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${first.x} ${first.y} Z`;
  } else if (previewPos && anchors.length > 0) {
    // Rubber-band preview of the segment that would be created by the next click.
    const last = anchors[anchors.length - 1];
    const c1 = last.handleOut || { x: last.x, y: last.y };
    d += ` C ${c1.x} ${c1.y} ${previewPos.x} ${previewPos.y} ${previewPos.x} ${previewPos.y}`;
  }
  return d;
}

/** Bounding box of the raw anchor/handle positions, so tiny or huge paths get a correct width/height instead of every hand-drawn path silently reporting as 100x100 (which broke marquee-select, the eraser, and the minimap for anything freehand). */
function boundsOf(anchors: Anchor[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const a of anchors) {
    minX = Math.min(minX, a.x); maxX = Math.max(maxX, a.x);
    minY = Math.min(minY, a.y); maxY = Math.max(maxY, a.y);
    if (a.handleOut) {
      minX = Math.min(minX, a.handleOut.x); maxX = Math.max(maxX, a.handleOut.x);
      minY = Math.min(minY, a.handleOut.y); maxY = Math.max(maxY, a.handleOut.y);
    }
  }
  return { minX, minY, maxX, maxY };
}

const CLOSE_RADIUS_SCREEN = 9; // px, constant regardless of zoom — matches how every pro vector tool snaps to close a path
const DRAG_THRESHOLD = 3; // world px of movement before a click-drag counts as pulling a curve handle

export class BezierPenTool implements Tool {
  id = 'bezier-pen';
  cursor = 'crosshair';

  private anchors: Anchor[] = [];
  private isActive = false;
  private isMouseDown = false;
  private previewPos: { x: number; y: number } | null = null;
  private hoverStart = false;

  onActivate() {
    this.reset();
  }

  onDeactivate(ctx: ToolContext) {
    // Switching tools mid-path discards the in-progress path rather than
    // silently committing a possibly-accidental partial shape.
    this.reset();
    ctx.setOverlayState?.(null);
  }

  private reset() {
    this.anchors = [];
    this.isActive = false;
    this.isMouseDown = false;
    this.previewPos = null;
    this.hoverStart = false;
  }

  onPointerDown(ctx: ToolContext, e: any) {
    const raw = this.getPointerPos(ctx, e);
    if (!raw) return;
    const pos = this.constrain(ctx, raw, Boolean(e.evt?.shiftKey));
    this.isMouseDown = true;

    if (!this.isActive) {
      this.anchors = [{ x: pos.x, y: pos.y, handleOut: null }];
      this.isActive = true;
      this.updateOverlay(ctx);
      return;
    }

    if (this.anchors.length >= 2 && this.isNearFirstAnchor(ctx, pos)) {
      this.finalize(ctx, true);
      return;
    }

    this.anchors.push({ x: pos.x, y: pos.y, handleOut: null });
    this.updateOverlay(ctx);
  }

  onPointerMove(ctx: ToolContext, e: any) {
    const raw = this.getPointerPos(ctx, e);
    if (!raw) return;
    // The preview has to show the constrained point, or the line you are
    // aiming with is not the line you will get.
    const pos = this.constrain(ctx, raw, Boolean(e.evt?.shiftKey) && !this.isMouseDown);
    this.previewPos = pos;

    if (this.isActive && this.isMouseDown && e.evt?.buttons === 1) {
      const last = this.anchors[this.anchors.length - 1];
      const dx = pos.x - last.x;
      const dy = pos.y - last.y;
      if (Math.sqrt(dx * dx + dy * dy) > DRAG_THRESHOLD) {
        last.handleOut = { x: pos.x, y: pos.y };
      }
    }

    this.hoverStart = this.anchors.length >= 2 && this.isNearFirstAnchor(ctx, pos);
    this.updateOverlay(ctx);
  }

  onPointerUp() {
    this.isMouseDown = false;
  }

  onKeyDown(ctx: ToolContext, e: KeyboardEvent) {
    if (!this.isActive) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      this.finalize(ctx, false);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.reset();
      ctx.setOverlayState?.(null);
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
      // Undo the last anchor rather than the whole path. Misplacing one point
      // in a ten-point outline used to mean Escape and start again, which is
      // the difference between a tool you draw with and one you fight.
      e.preventDefault();
      this.anchors.pop();
      if (this.anchors.length === 0) {
        this.reset();
        ctx.setOverlayState?.(null);
      } else {
        this.updateOverlay(ctx);
      }
    }
  }

  private finalize(ctx: ToolContext, closed: boolean) {
    if (this.anchors.length < 2) {
      this.reset();
      ctx.setOverlayState?.(null);
      return;
    }

    const { minX, minY, maxX, maxY } = boundsOf(this.anchors);
    // Store segments relative to the bounding box's top-left, matching every
    // other object type's (x, y) + relative-content convention — an absolute-
    // coordinate path made resizing and hit-testing silently wrong (see
    // boundsOf's doc comment).
    const segments = this.anchors.map((a, i) => {
      if (i === 0) return { x: a.x - minX, y: a.y - minY };
      const prev = this.anchors[i - 1];
      const c1 = prev.handleOut || { x: prev.x, y: prev.y };
      const c2 = incomingHandle(a) || { x: a.x, y: a.y };
      return {
        x: a.x - minX, y: a.y - minY,
        cp1x: c1.x - minX, cp1y: c1.y - minY,
        cp2x: c2.x - minX, cp2y: c2.y - minY,
      };
    });
    if (closed) {
      const last = this.anchors[this.anchors.length - 1];
      const first = this.anchors[0];
      const c1 = last.handleOut || { x: last.x, y: last.y };
      const c2 = incomingHandle(first) || { x: first.x, y: first.y };
      segments.push({
        x: first.x - minX, y: first.y - minY,
        cp1x: c1.x - minX, cp1y: c1.y - minY,
        cp2x: c2.x - minX, cp2y: c2.y - minY,
      });
    }

    ctx.editor.createNode({
      id: nanoid(),
      type: 'path',
      x: minX,
      y: minY,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY),
      geometry: { kind: 'bezier', segments, closed },
      appearance: {
        fill: closed ? [{ type: 'solid', color: 'transparent', opacity: 1 }] : undefined,
        // The pen's own weight, not a fixed 2 — see `penStrokeWidth`.
        stroke: { color: ThemeService.getDefaultStrokeColor(), width: useStore.getState().penStrokeWidth },
      },
    });

    this.reset();
    ctx.setOverlayState?.(null);
  }

  private isNearFirstAnchor(ctx: ToolContext, pos: { x: number; y: number }) {
    const first = this.anchors[0];
    const screenDist = Math.hypot(pos.x - first.x, pos.y - first.y) * ctx.camera.zoom;
    return screenDist <= CLOSE_RADIUS_SCREEN;
  }

  private updateOverlay(ctx: ToolContext) {
    ctx.setOverlayState?.({
      type: 'bezier-pen',
      anchors: this.anchors.map(a => ({ ...a })),
      previewPos: this.previewPos,
      hoverStart: this.hoverStart,
    });
  }

  renderOverlay(ctx: ToolContext, overlayState: any) {
    if (overlayState?.type !== 'bezier-pen') return null;
    const anchors: Anchor[] = overlayState.anchors || [];
    if (anchors.length === 0) return null;

    const zoom = ctx.camera.zoom || 1;
    const pathData = buildPathData(anchors, false, overlayState.previewPos);

    return (
      <>
        <Path data={pathData} stroke="#3B82F6" strokeWidth={1.5 / zoom} listening={false} />
        {anchors.map((a, i) => (
          <React.Fragment key={i}>
            {/* Handle arms + control-point dots, shown only for anchors that have a curve handle */}
            {a.handleOut && (
              <>
                <Line
                  points={[incomingHandle(a)!.x, incomingHandle(a)!.y, a.handleOut.x, a.handleOut.y]}
                  stroke="#93C5FD" strokeWidth={1 / zoom} listening={false}
                />
                <Circle x={a.handleOut.x} y={a.handleOut.y} radius={3 / zoom} fill="#3B82F6" listening={false} />
                <Circle x={incomingHandle(a)!.x} y={incomingHandle(a)!.y} radius={3 / zoom} fill="#3B82F6" listening={false} />
              </>
            )}
            {/* Anchor point itself — the first anchor grows a highlight ring once a close-click is in range */}
            <Circle
              x={a.x} y={a.y}
              radius={(i === 0 && overlayState.hoverStart ? 7 : 4) / zoom}
              fill={i === 0 ? '#FFFFFF' : '#3B82F6'}
              stroke="#3B82F6"
              strokeWidth={1.5 / zoom}
              listening={false}
            />
          </React.Fragment>
        ))}
      </>
    );
  }

  private getPointerPos(ctx: ToolContext, e: any) {
    // Guarded, like every other tool here. `getPointerPosition()` returns null
    // whenever the pointer is not over the stage — which happens routinely on
    // the event that leaves it — and this dereferenced `.x` straight into a
    // TypeError.
    const stage = e.target?.getStage?.();
    const pos = stage?.getPointerPosition?.();
    if (!pos) return null;
    return {
      x: (pos.x - ctx.camera.x) / ctx.camera.zoom,
      y: (pos.y - ctx.camera.y) / ctx.camera.zoom
    };
  }

  /**
   * Where the next anchor actually lands.
   *
   * Shift locks the segment to 45 degrees from the previous anchor, which is
   * how every pen tool draws a clean horizontal, vertical or diagonal run —
   * and the reason people can lay out a flowchart outline by hand at all. Grid
   * snapping applies afterwards, matching the shape and text tools.
   */
  private constrain(ctx: ToolContext, pos: { x: number; y: number }, shift: boolean) {
    let { x, y } = pos;
    const last = this.anchors[this.anchors.length - 1];

    if (shift && last) {
      const dx = x - last.x;
      const dy = y - last.y;
      const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
      const distance = Math.hypot(dx, dy);
      x = last.x + Math.cos(angle) * distance;
      y = last.y + Math.sin(angle) * distance;
    }

    if (gridSnap.shouldSnap()) {
      const snapped = gridSnap.snapPoint(x, y);
      x = snapped.x;
      y = snapped.y;
    }
    return { x, y };
  }
}
