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

/** Below this a drag was a click, and a click connects nothing. */
const MIN_DRAG = 6;

const SIDES: Array<Exclude<Port, 'auto'>> = ['top', 'right', 'bottom', 'left'];

/**
 * Drawing a connector.
 *
 * ## The gesture
 *
 * Press on one object, release on another. While the tool is active every
 * connectable object shows its four ports, and the nearest one lights up as
 * you approach — so the thing you are aiming at tells you what it will do
 * before you commit, rather than after.
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

  private isDragging = false;
  private from: ConnectorEnd | null = null;
  private cursorWorld = { x: 0, y: 0 };

  onPointerDown(ctx: ToolContext, e: any) {
    const pos = this.getPointerPos(ctx, e);
    if (!pos) return;
    this.cursorWorld = pos;
    this.from = this.endAt(pos, ctx);
    this.isDragging = true;
    this.pushOverlay(ctx);
  }

  onPointerMove(ctx: ToolContext, e: any) {
    const pos = this.getPointerPos(ctx, e);
    if (!pos) return;
    this.cursorWorld = pos;
    // Pushed even when not dragging: the ports and the hover highlight are the
    // tool's whole affordance, and they have to be live before the gesture
    // starts rather than only during it.
    this.pushOverlay(ctx);
  }

  onPointerUp(ctx: ToolContext) {
    if (!this.isDragging || !this.from) {
      this.reset(ctx);
      return;
    }

    const to = this.endAt(this.cursorWorld, ctx);
    const start = this.resolvePoint(this.from, ctx);
    const end = this.resolvePoint(to, ctx);
    const travelled = Math.hypot(end.x - start.x, end.y - start.y);

    // A click that went nowhere, or a loop from an object back to itself:
    // neither describes a relationship, and both would leave an invisible or
    // degenerate node on the board.
    const sameObject = this.from.nodeId && to.nodeId && this.from.nodeId === to.nodeId;
    if (travelled < MIN_DRAG || sameObject) {
      this.reset(ctx);
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
    if (e.key === 'Escape' && this.isDragging) this.reset(ctx);
  }

  onDeactivate(ctx: ToolContext) {
    this.reset(ctx);
  }

  private reset(ctx: ToolContext) {
    this.isDragging = false;
    this.from = null;
    ctx.setOverlayState?.(null);
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
      active: this.isDragging,
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
