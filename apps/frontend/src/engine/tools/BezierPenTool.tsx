import { nanoid } from 'nanoid';
import { useStore } from '../../hooks/useStore';
import type { Tool, ToolContext } from './Tool';
import { gridSnap } from '../interaction/gridSnap';
import * as React from 'react';
import { Path, Circle, Line } from 'react-konva';
import { ThemeService } from '../ThemeService';
import { pathData, toAnchors, type Anchor } from '../model/pathGeometry';
import { undoManager, updateNode } from '../document';
import {
  commitPath,
  constrainToAngle,
  continuationFrom,
  isClosable,
  isHandleDrag,
  previewGeometry,
  pullHandle,
  retractOutgoing,
  withinTarget,
} from './penSession';

/** Ink for the drawing chrome, matching the selection accent the canvas uses elsewhere. */
const ACCENT = '#3B82F6';
const HANDLE_ARM = '#93C5FD';

/**
 * The bezier pen.
 *
 * ## What it owns and what it does not
 *
 * The gesture: which anchor is being placed, whether the pointer is over the
 * start, whether Alt is down. Every question with a *right answer* — where a
 * pulled handle goes, what the path looks like so far, what box it occupies —
 * lives in `penSession`, where it can be tested without a stage.
 *
 * That split is not tidiness. The three defects this rewrite fixes were all in
 * arithmetic that had nowhere to be tested: an incoming handle defined as the
 * mirror of the outgoing one, so a cusp could not be drawn; a preview built by
 * a different function from the commit, so the two could disagree; and a box
 * measured over the control handles rather than the curve, so every path was
 * stored bigger than its own ink.
 *
 * ## The gestures
 *
 * | gesture                     | result                                    |
 * |-----------------------------|-------------------------------------------|
 * | click                       | a corner anchor                           |
 * | click and drag              | a smooth anchor, handles either side      |
 * | **Alt** while dragging      | a cusp: the incoming handle is left alone |
 * | click the last anchor       | retract its outgoing handle                |
 * | click the first anchor      | close the path                            |
 * | Shift                       | the segment locks to 45°                  |
 * | Backspace                   | undo the last anchor                      |
 * | Enter or Escape             | finish, open (Escape discards a lone anchor) |
 * | press an open path's end     | continue that path from there             |
 * | Shift while pulling         | the handle locks to 45°                   |
 */
export class BezierPenTool implements Tool {
  id = 'bezier-pen';
  cursor = 'crosshair';

  private anchors: Anchor[] = [];
  private isActive = false;
  /** Where the press landed, so a drag can be measured from it. */
  private pressAt: { x: number; y: number } | null = null;
  private previewPos: { x: number; y: number } | null = null;
  private hoverStart = false;
  /** True once the press has travelled far enough to be shaping a curve. */
  private pulling = false;
  /** The open path being continued, when the first press landed on one of its ends. */
  private extending: string | null = null;

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
    this.pressAt = null;
    this.previewPos = null;
    this.hoverStart = false;
    this.pulling = false;
    this.extending = null;
  }

  onPointerDown(ctx: ToolContext, e: any) {
    const raw = this.getPointerPos(ctx, e);
    if (!raw) return;
    const pos = this.place(ctx, raw, Boolean(e.evt?.shiftKey));
    this.pressAt = pos;
    this.pulling = false;

    if (!this.isActive) {
      const resumed = this.resumeAt(raw, ctx.camera.zoom);
      if (resumed) {
        this.anchors = resumed.anchors;
        this.extending = resumed.id;
        this.isActive = true;
        this.pressAt = null;
        this.updateOverlay(ctx);
        return;
      }
      this.anchors = [{ x: pos.x, y: pos.y }];
      this.isActive = true;
      this.updateOverlay(ctx);
      return;
    }

    if (isClosable(this.anchors, pos, ctx.camera.zoom)) {
      this.finalize(ctx, true);
      return;
    }

    /**
     * Clicking the anchor you just placed retracts its outgoing handle.
     *
     * The other half of drawing a shape that is part arc and part edge: the
     * curve arrives bent and leaves straight. Without it, one curved anchor
     * forces every segment after it to curve out of the same handle.
     */
    const last = this.anchors[this.anchors.length - 1];
    if (last.outX !== undefined && withinTarget(last, pos, ctx.camera.zoom)) {
      this.anchors[this.anchors.length - 1] = retractOutgoing(last);
      this.pressAt = null;
      this.updateOverlay(ctx);
      return;
    }

    this.anchors.push({ x: pos.x, y: pos.y });
    this.updateOverlay(ctx);
  }

  onPointerMove(ctx: ToolContext, e: any) {
    const raw = this.getPointerPos(ctx, e);
    if (!raw) return;
    const down = Boolean(this.pressAt) && e.evt?.buttons === 1;
    // The preview has to show the constrained point, or the line you are
    // aiming with is not the line you will get. A drag is shaping a handle
    // rather than aiming a segment, so it is not angle-locked.
    const pos = this.place(ctx, raw, Boolean(e.evt?.shiftKey) && !down);
    this.previewPos = pos;

    if (this.isActive && down && this.pressAt) {
      const last = this.anchors[this.anchors.length - 1];
      if (this.pulling || isHandleDrag(this.pressAt, pos, ctx.camera.zoom)) {
        this.pulling = true;
        // Alt breaks the pair, which is how a cusp is drawn. Read every frame
        // rather than at the press, so the key can be taken and released
        // part-way through shaping the curve.
        const target = e.evt?.shiftKey ? constrainToAngle(last, raw) : pos;
        this.anchors[this.anchors.length - 1] = pullHandle(last, target, Boolean(e.evt?.altKey));
      }
    }

    this.hoverStart = isClosable(this.anchors, pos, ctx.camera.zoom);
    this.updateOverlay(ctx);
  }

  onPointerUp() {
    this.pressAt = null;
    this.pulling = false;
  }

  onKeyDown(ctx: ToolContext, e: KeyboardEvent) {
    if (!this.isActive) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      this.finalize(ctx, false);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      // Escape keeps the work, as in every vector editor; a lone anchor is not a path.
      if (this.anchors.length >= 2) {
        this.finalize(ctx, false);
      } else {
        this.reset();
        ctx.setOverlayState?.(null);
      }
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
      // Undo the last anchor rather than the whole path. Misplacing one point
      // in a ten-point outline used to mean Escape and start again, which is
      // the difference between a tool you draw with and one you fight.
      e.preventDefault();
      this.anchors.pop();
      // The handle that reached forward to the anchor just removed is now
      // reaching at nothing, and would bend the rubber band towards a point
      // that is no longer on the path.
      const last = this.anchors[this.anchors.length - 1];
      if (last) this.anchors[this.anchors.length - 1] = retractOutgoing(last);

      if (this.anchors.length === 0) {
        this.reset();
        ctx.setOverlayState?.(null);
      } else {
        this.updateOverlay(ctx);
      }
    }
  }

  private finalize(ctx: ToolContext, closed: boolean) {
    const path = commitPath(this.anchors, closed);
    if (!path) {
      this.reset();
      ctx.setOverlayState?.(null);
      return;
    }

    undoManager.stopCapturing();
    if (this.extending && useStore.getState().objects[this.extending]) {
      const id = this.extending;
      updateNode(id, {
        x: path.x,
        y: path.y,
        width: path.width,
        height: path.height,
        geometry: path.geometry,
      });
      undoManager.stopCapturing();
      ctx.editor.select(id);
      this.reset();
      ctx.setOverlayState?.(null);
      return;
    }

    const id = nanoid();
    ctx.editor.createNode({
      id,
      type: 'path',
      x: path.x,
      y: path.y,
      width: path.width,
      height: path.height,
      geometry: path.geometry,
      appearance: {
        fill: closed ? [{ type: 'solid', color: 'transparent', opacity: 1 }] : undefined,
        // The pen's own weight, not a fixed 2 — see `penStrokeWidth`.
        stroke: { color: ThemeService.getDefaultStrokeColor(), width: useStore.getState().penStrokeWidth },
      },
    });
    undoManager.stopCapturing();
    ctx.editor.select(id);

    this.reset();
    ctx.setOverlayState?.(null);
  }

  private updateOverlay(ctx: ToolContext) {
    ctx.setOverlayState?.({
      type: 'bezier-pen',
      anchors: this.anchors.map((a) => ({ ...a })),
      previewPos: this.previewPos,
      hoverStart: this.hoverStart,
    });
  }

  renderOverlay(ctx: ToolContext, overlayState: any) {
    if (overlayState?.type !== 'bezier-pen') return null;
    const anchors: Anchor[] = overlayState.anchors || [];
    if (anchors.length === 0) return null;

    const zoom = ctx.camera.zoom || 1;
    // The same function that will build the committed path, so what you aim
    // with and what you get cannot disagree.
    const d = pathData(previewGeometry(anchors, overlayState.previewPos, overlayState.hoverStart));

    return (
      <>
        <Path data={d} stroke={ACCENT} strokeWidth={1.5 / zoom} listening={false} />
        {anchors.map((a, i) => {
          // Drawn from the anchor's own handles rather than from a mirror, so a
          // cusp is shown as the cusp it is: two arms at different angles, and
          // the curve visibly leaving in a direction it did not arrive from.
          const arms: Array<[number, number]> = [];
          if (a.inX !== undefined && a.inY !== undefined) arms.push([a.inX, a.inY]);
          if (a.outX !== undefined && a.outY !== undefined) arms.push([a.outX, a.outY]);

          return (
            <React.Fragment key={i}>
              {arms.map(([hx, hy], k) => (
                <React.Fragment key={k}>
                  <Line points={[a.x, a.y, hx, hy]} stroke={HANDLE_ARM} strokeWidth={1 / zoom} listening={false} />
                  <Circle x={hx} y={hy} radius={3 / zoom} fill={ACCENT} listening={false} />
                </React.Fragment>
              ))}
              {/* The first anchor grows a ring once a click there would close the path. */}
              <Circle
                x={a.x}
                y={a.y}
                radius={(i === 0 && overlayState.hoverStart ? 7 : 4) / zoom}
                fill={i === 0 ? '#FFFFFF' : ACCENT}
                stroke={ACCENT}
                strokeWidth={1.5 / zoom}
                listening={false}
              />
            </React.Fragment>
          );
        })}
      </>
    );
  }

  /**
   * An open path whose end is under the pointer, as anchors to continue from.
   * The topmost one wins, so the path you can see is the one you extend.
   */
  private resumeAt(pointer: { x: number; y: number }, zoom: number): { id: string; anchors: Anchor[] } | null {
    const nodes = Object.values(useStore.getState().objects) as any[];
    nodes.sort((a, b) => (b.zIndex || 0) - (a.zIndex || 0));
    for (const node of nodes) {
      if (node.type !== 'path' || node.locked || node.hidden) continue;
      const geo = node.geometry;
      if (geo?.kind !== 'bezier' || geo.closed) continue;
      if (node.rotation || (node.scaleX ?? 1) !== 1 || (node.scaleY ?? 1) !== 1) continue;
      const anchors = continuationFrom(toAnchors(geo), { x: node.x, y: node.y }, pointer, zoom);
      if (anchors) return { id: node.id, anchors };
    }
    return null;
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
      y: (pos.y - ctx.camera.y) / ctx.camera.zoom,
    };
  }

  /**
   * Where the next anchor actually lands.
   *
   * Shift locks the segment to 45° from the previous anchor; grid snapping
   * applies afterwards, matching the shape and text tools.
   */
  private place(ctx: ToolContext, pos: { x: number; y: number }, shift: boolean) {
    const last = this.anchors[this.anchors.length - 1];
    let point = shift && last ? constrainToAngle(last, pos) : pos;
    if (gridSnap.shouldSnap()) point = gridSnap.snapPoint(point.x, point.y);
    return point;
  }
}
