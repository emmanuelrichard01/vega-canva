import * as React from 'react';
import { Circle, Group, Line, Rect } from 'react-konva';
import { nanoid } from 'nanoid';
import type { Tool, ToolContext } from './Tool';
import { useStore } from '../../hooks/useStore';
import { ThemeService } from '../ThemeService';
import {
  connectorPoints,
  portPoint,
  type ConnectorEnd,
  type Port,
} from '../model/connector';
import { anchorPoint } from '../model/connectorAnchor';
import { bindCandidates, boxLookup, boxOfNode, isConnectable } from '../model/connectorTargets';
import { endPoint } from '../model/connectorTargets';
import { bindingAt } from '../model/connectorBinding';

/** Below this the two ends are the same place, and there is no connector. */
const MIN_DRAG = 6;
/**
 * How far a press must travel before it counts as a drag, in screen px.
 *
 * Generous enough to survive the wobble of a real click on a trackpad, which
 * would otherwise turn every click into a one-pixel drag and defeat the
 * click-move-click gesture entirely.
 */
const DRAG_SCREEN = 5;

const SIDES: Array<Exclude<Port, 'auto'>> = ['top', 'right', 'bottom', 'left'];

/**
 * Drawing a connector.
 *
 * ## The gesture
 *
 * **Click one object, then click another** — the route follows the cursor in
 * between, so you can see what you are about to make before you make it.
 * Dragging from one to the other does the same thing, and is the faster of the
 * two over a short hop. See `pending` for why both exist.
 *
 * While the tool is active every connectable object shows its four ports, and
 * the nearest one lights up as you approach — so the thing you are aiming at
 * tells you what it will do before you commit, rather than after. Aim at the
 * middle instead and the whole object lights up: that is `auto`, and the route
 * picks a side. Aim anywhere else on the edge and a dot shows the exact spot
 * it will attach to.
 *
 * ## Why ports are shown for *everything* while drawing
 *
 * The alternative is revealing them only on the object under the pointer,
 * which is what most tools do and which hides the answer to the question you
 * actually have: *what can I connect to?* On a board of mixed content — notes,
 * images, frames, drawings — that is not obvious, and finding out by trial is
 * the slow way. They cost one small ring each and disappear the moment the
 * tool does.
 *
 * ## Ending on empty canvas
 *
 * Allowed, and it makes a loose end at that point. A diagram in progress
 * routinely has an arrow pointing at a box that does not exist yet, and
 * refusing to draw one means holding the shape in your head until you have
 * made somewhere for it to land.
 */
export class ConnectorTool implements Tool {
  id = 'connector';
  cursor = 'crosshair';

  /** A press is down and has travelled far enough to be a drag. */
  private isDragging = false;
  /**
   * A connector whose start is anchored, waiting for the click that ends it.
   *
   * This is the same gesture the line and arrow tool uses, and it is here for
   * the same reason, which `ShapeTool` writes out in full: a connector is
   * often long, and holding a button down across a whole board is an awkward,
   * imprecise gesture that a trackpad makes worse. Two clicks with a live
   * preview between them is steadier, and it leaves the hand free to reach a
   * modifier.
   *
   * It was drag-only until now, which meant the two things in this app that
   * draw a line from one point to another disagreed about how you draw a line
   * from one point to another. That costs more than it sounds: the gesture is
   * the first thing anyone learns about a tool, and having to learn it twice
   * teaches them that the app has no rules.
   *
   * **Dragging still works.** These are not alternatives to choose between — a
   * short hop between two adjacent boxes is genuinely faster as a drag, and
   * removing it would be taking something away in exchange for a consistency
   * nobody asked for. The press decides which gesture it was by whether it
   * moved.
   */
  private pending = false;
  private from: ConnectorEnd | null = null;
  private cursorWorld = { x: 0, y: 0 };
  /** Where the press went down, in screen space, to tell a drag from a click. */
  private pressScreen: { x: number; y: number } | null = null;

  onPointerDown(ctx: ToolContext, e: any) {
    const pos = this.getPointerPos(ctx, e);
    if (!pos) return;
    this.cursorWorld = pos;

    // The second click of a click-move-click. Committed on the press rather
    // than the release, because a connector is ended by the *click* — ending
    // it on release would mean the press that starts the next connector also
    // finishes this one, and the gesture would collapse back into a drag.
    if (this.pending && this.from) {
      this.finish(ctx);
      return;
    }

    this.from = this.endAt(pos, ctx);
    this.pending = true;
    this.isDragging = false;
    this.pressScreen = this.getScreenPos(e);
    this.pushOverlay(ctx);
  }

  onPointerMove(ctx: ToolContext, e: any) {
    const pos = this.getPointerPos(ctx, e);
    if (!pos) return;
    this.cursorWorld = pos;

    // A press that has travelled is a drag, and will commit on release. Judged
    // in *screen* pixels: whether a hand moved is a question about the hand,
    // and at 10% zoom a six-world-unit threshold is most of a screen away.
    if (this.pressScreen && !this.isDragging) {
      const now = this.getScreenPos(e);
      if (now && Math.hypot(now.x - this.pressScreen.x, now.y - this.pressScreen.y) >= DRAG_SCREEN) {
        this.isDragging = true;
      }
    }

    // Pushed even when nothing is in progress: the ports and the hover
    // highlight are the tool's whole affordance, and they have to be live
    // before the gesture starts rather than only during it.
    this.pushOverlay(ctx);
  }

  onPointerUp(ctx: ToolContext) {
    this.pressScreen = null;
    // A press that never moved is the *first* click of a click-move-click, so
    // releasing it has to leave the gesture standing. That is the entire
    // difference between the two gestures, and it is one branch.
    if (!this.isDragging || !this.from) return;
    this.finish(ctx);
  }

  /**
   * End the connector wherever the cursor is now.
   *
   * Shared by both gestures deliberately: a connector drawn by dragging and
   * one drawn by two clicks have to produce the same node, or the tool has two
   * behaviours wearing one name.
   */
  private finish(ctx: ToolContext) {
    if (!this.from) {
      this.reset(ctx);
      return;
    }

    const to = this.endAt(this.cursorWorld, ctx);
    const start = this.resolvePoint(this.from, ctx);
    const end = this.resolvePoint(to, ctx);
    const travelled = Math.hypot(end.x - start.x, end.y - start.y);

    // A loop from an object back to itself describes no relationship, and
    // draws as a degenerate stub inside the shape.
    const sameObject = this.from.nodeId && to.nodeId && this.from.nodeId === to.nodeId;
    if (travelled < MIN_DRAG || sameObject) {
      // A refused *click* leaves the pending gesture standing rather than
      // discarding it. Silently throwing away a connector the user has already
      // started, in answer to a click they meant to make, reads as the tool
      // being broken — the preview is still on screen so the state is legible,
      // and Escape gets out. A refused drag has nothing to stand and resets.
      if (!this.pending || this.isDragging) this.reset(ctx);
      this.isDragging = false;
      this.pushOverlay(ctx);
      return;
    }

    const minX = Math.min(start.x, end.x);
    const minY = Math.min(start.y, end.y);

    const id = nanoid();
    ctx.editor.createNode({
      id,
      type: 'connector',
      // Derived, and kept honest enough for culling — the renderer draws from
      // the live route rather than trusting these.
      x: minX,
      y: minY,
      width: Math.max(1, Math.abs(end.x - start.x)),
      height: Math.max(1, Math.abs(end.y - start.y)),
      from: this.from,
      to,
      routing: 'orthogonal',
      arrowEnd: true,
      // Round caps written explicitly rather than defaulted in the renderer:
      // a connector reads better with them, and stating it in the document is
      // what lets the Cap control show and change it.
      // The tool's own colour when one has been chosen, and the theme's
      // default otherwise — so a board's connectors are not all grey
      // unless that is what was asked for.
      appearance: {
        stroke: {
          color: useStore.getState().connectorColor || ThemeService.getDefaultStrokeColor(),
          width: 2,
          cap: 'round',
        },
      },
    });

    ctx.editor.select(id);
    this.reset(ctx);
  }

  onKeyDown(ctx: ToolContext, e: KeyboardEvent) {
    // Escape has to reach a *pending* gesture too. Gated on `isDragging`
    // alone, a connector anchored by a click and then thought better of had no
    // way out but to finish it and undo it.
    if (e.key === 'Escape' && (this.isDragging || this.pending)) this.reset(ctx);
  }

  onDeactivate(ctx: ToolContext) {
    this.reset(ctx);
  }

  private reset(ctx: ToolContext) {
    this.isDragging = false;
    this.pending = false;
    this.pressScreen = null;
    this.from = null;
    ctx.setOverlayState?.(null);
  }

  /** The pointer in screen space, where "did the hand move" is asked. */
  private getScreenPos(e: any): { x: number; y: number } | null {
    const stage = e.target?.getStage?.();
    return stage?.getPointerPosition?.() ?? null;
  }

  /**
   * What the pointer is over: a port, an exact spot, an object, or nothing.
   *
   * The rule itself is `bindingAt`, shared with the endpoint editor so that
   * drawing an arrow onto a place and dragging an existing arrow to the same
   * place produce the same binding. It used to live here as a private method,
   * which was fine while this was the only thing that asked the question.
   */
  private endAt(world: { x: number; y: number }, ctx: ToolContext): ConnectorEnd {
    return bindingAt(world, bindCandidates(useStore.getState().objects), {
      scale: 1 / (ctx.camera.zoom || 1),
    });
  }

  private resolvePoint(end: ConnectorEnd, _ctx: ToolContext) {
    return endPoint(end, useStore.getState().objects);
  }

  private pushOverlay(ctx: ToolContext) {
    const objects = useStore.getState().objects;
    const ports: Array<{ x: number; y: number; nodeId: string; side: string }> = [];

    for (const node of Object.values(objects)) {
      if (!isConnectable(node)) continue;
      const box = boxOfNode(node);
      for (const side of SIDES) {
        const p = portPoint(box, side);
        ports.push({ x: p.x, y: p.y, nodeId: node.id, side });
      }
    }

    const target = this.endAt(this.cursorWorld, ctx);
    const preview = this.from
      ? connectorPoints(this.from, target, 'orthogonal', boxLookup(objects))
      : null;

    /**
     * Where an exact binding would land, drawn as its own mark.
     *
     * The four rings answer "which side"; they cannot answer "where along it",
     * and without this the anchor binding is invisible until after you commit
     * to it. A tool whose most precise mode gives no feedback is one people do
     * not discover and do not trust when they do.
     */
    const targetNode = target.nodeId ? objects[target.nodeId] : undefined;
    const spot =
      target.anchor && targetNode ? anchorPoint(boxOfNode(targetNode), target.anchor) : null;

    /** The object about to be bound as a whole, so `auto` is not silent either. */
    const bodyBox =
      target.nodeId && target.port === 'auto' && targetNode ? boxOfNode(targetNode) : null;

    ctx.setOverlayState?.({
      type: 'connector',
      ports,
      active: this.pending,
      zoom: ctx.camera.zoom,
      // Which port is armed, so the overlay can light exactly one.
      armed: target.nodeId && target.port ? `${target.nodeId}:${target.port}` : null,
      spot,
      bodyBox,
      preview,
    });
  }

  renderOverlay(_ctx: ToolContext, overlayState: any) {
    if (overlayState?.type !== 'connector') return null;
    const zoom = overlayState.zoom || 1;
    const r = 4 / zoom;

    return (
      <Group listening={false}>
        {/* The whole object lights up when the binding is `auto`, because that
            is what `auto` means — this object, side to be decided — and a
            highlight that named a side would be describing a choice that has
            not been made and will change when things move. */}
        {overlayState.bodyBox && (
          <Rect
            x={overlayState.bodyBox.x}
            y={overlayState.bodyBox.y}
            width={overlayState.bodyBox.width}
            height={overlayState.bodyBox.height}
            stroke="#3B82F6"
            strokeWidth={1.5 / zoom}
            dash={[4 / zoom, 3 / zoom]}
            fill="rgba(59, 130, 246, 0.06)"
          />
        )}
        {overlayState.preview && overlayState.preview.length >= 4 && (
          <Line
            points={overlayState.preview}
            stroke="#3B82F6"
            strokeWidth={2 / zoom}
            dash={[6 / zoom, 4 / zoom]}
            lineJoin="round"
          />
        )}
        {overlayState.ports.map((p: any) => {
          const isArmed = overlayState.armed === `${p.nodeId}:${p.side}`;
          return (
            <Circle
              key={`${p.nodeId}-${p.side}`}
              x={p.x}
              y={p.y}
              // The armed port grows rather than only changing colour, so it
              // is unmistakable at a glance and under `forced-colors`.
              radius={isArmed ? r * 1.9 : r}
              fill={isArmed ? '#3B82F6' : ThemeService.getCanvasPlateFill()}
              stroke="#3B82F6"
              strokeWidth={1.5 / zoom}
            />
          );
        })}
        {/* Drawn last so it sits over the rings it may be standing between. */}
        {overlayState.spot && (
          <Circle
            x={overlayState.spot.x}
            y={overlayState.spot.y}
            radius={5 / zoom}
            fill="#3B82F6"
            stroke="#FFFFFF"
            strokeWidth={1.5 / zoom}
          />
        )}
      </Group>
    );
  }

  private getPointerPos(ctx: ToolContext, e: any) {
    const stage = e.target?.getStage?.();
    const pos = stage?.getPointerPosition?.();
    if (!pos) return null;
    return ctx.camera.screenToWorld(pos.x, pos.y);
  }
}
