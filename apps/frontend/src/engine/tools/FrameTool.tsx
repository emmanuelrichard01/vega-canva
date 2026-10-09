import { Group, Rect } from 'react-konva';
import { nanoid } from 'nanoid';
import * as React from 'react';
import type { Tool, ToolContext } from './Tool';
import { finishCreation } from './toolModes';
import { useStore } from '../../hooks/useStore';
import { DEFAULT_FRAME, frameBoxFromDrag, framePreset, nextFrameName } from '../model/frames';
import { captureExistingIntoFrame } from '../interaction/frameMembership';
import { chromeToken } from '../interaction/chromeHalo';
import { hud } from '../ui/hud';

/**
 * Drawing a frame.
 *
 * `FrameNode` has been renderable and exportable since the first commit and no
 * tool has ever made one, so frames could not exist in a real document. This
 * is the tool.
 *
 * One tool instance per preset, the same arrangement `ShapeTool` uses for
 * shape kinds — so the dock's flyout, the tool id and the thing that gets
 * created cannot drift apart, and `activeToolId` alone is enough to say which
 * preset is armed.
 */
export class FrameTool implements Tool {
  id = 'frame';
  cursor = 'crosshair';

  private isDragging = false;
  private startX = 0;
  private startY = 0;
  private currentX = 0;
  private currentY = 0;
  private readonly presetId?: string;

  constructor(presetId?: string) {
    this.presetId = presetId;
    this.id = presetId ? `frame-${presetId}` : 'frame';
  }

  /** The size a click (rather than a drag) should produce. */
  private fallbackSize() {
    const preset = framePreset(this.presetId);
    return preset ? { width: preset.width, height: preset.height } : DEFAULT_FRAME;
  }

  onPointerDown(ctx: ToolContext, e: any) {
    const pos = this.getPointerPos(ctx, e);
    if (!pos) return;
    this.isDragging = true;
    this.startX = pos.x;
    this.startY = pos.y;
    this.currentX = pos.x;
    this.currentY = pos.y;
    this.pushOverlay(ctx);
  }

  onPointerMove(ctx: ToolContext, e: any) {
    if (!this.isDragging) return;
    const pos = this.getPointerPos(ctx, e);
    if (!pos) return;
    this.currentX = pos.x;
    this.currentY = pos.y;

    // Shift constrains to a square, matching ShapeTool.
    if (e.evt?.shiftKey) {
      const dx = this.currentX - this.startX;
      const dy = this.currentY - this.startY;
      const size = Math.max(Math.abs(dx), Math.abs(dy));
      this.currentX = this.startX + Math.sign(dx) * size;
      this.currentY = this.startY + Math.sign(dy) * size;
    }

    this.pushOverlay(ctx);
  }

  onPointerUp(ctx: ToolContext) {
    if (!this.isDragging) return;
    this.isDragging = false;
    this.clearOverlay(ctx);

    const box = frameBoxFromDrag(
      { x: this.startX, y: this.startY },
      { x: this.currentX, y: this.currentY },
      this.fallbackSize()
    );

    // Frames are the one type users refer to *by name*, so they are titled at
    // creation rather than labelled from their content like every other node.
    const objects = useStore.getState().objects;
    const title = nextFrameName(
      Object.values(objects)
        .filter((n) => n.type === 'frame')
        .map((n) => n.title)
    );

    const nodeId = nanoid();
    ctx.editor.createNode({
      id: nodeId,
      type: 'frame',
      ...box,
      title,
      appearance: { fill: [{ type: 'solid', color: '#FFFFFF', opacity: 1 }] },
      // Copied onto the node rather than looked up from the preset when
      // drawing. A frame resized away from 1080x1920 is no longer a story, and
      // a guide re-derived from a size match would either vanish on a
      // one-pixel nudge or keep promising a safe area that no longer means
      // anything. A frame sized by hand gets none, which is right: there is no
      // interface known to be covering part of a rectangle you invented.
      safeArea: framePreset(this.presetId)?.safeArea,
      // Which preset it was, so a size two presets share reads as the one chosen.
      ...(framePreset(this.presetId) ? { preset: this.presetId } : null),
    });

    // Drawing a frame around existing objects means "these belong together" —
    // that is why it was drawn there. Without this the frame appears behind
    // them owning nothing, and the only way to fill it is to drag every object
    // out and back in again.
    captureExistingIntoFrame(nodeId);

    ctx.editor.select(nodeId);
    finishCreation();
  }

  onKeyDown(ctx: ToolContext, e: KeyboardEvent) {
    if (e.key === 'Escape' && this.isDragging) {
      this.isDragging = false;
      this.clearOverlay(ctx);
    }
  }

  onDeactivate(ctx: ToolContext) {
    // A keyboard tool-switch mid-drag never fires onPointerUp, which would
    // leave the size preview stuck on screen.
    this.isDragging = false;
    this.clearOverlay(ctx);
  }

  /** The gesture is over, committed or not: the overlay and the readout go. */
  private clearOverlay(ctx: ToolContext) {
    ctx.setOverlayState?.({ active: false });
    hud.hide('frame');
  }

  private pushOverlay(ctx: ToolContext) {
    // The running dimensions through the board's one HUD, because a frame is a
    // thing you size to a number far more often than you size by eye.
    const box = frameBoxFromDrag(
      { x: this.startX, y: this.startY },
      { x: this.currentX, y: this.currentY },
      this.fallbackSize()
    );
    hud.show({
      source: 'frame',
      kind: 'size',
      value: { width: box.width, height: box.height },
      at: { x: this.currentX, y: this.currentY },
      box,
    });
    ctx.setOverlayState?.({
      active: true,
      kind: 'frame',
      startX: this.startX,
      startY: this.startY,
      currentX: this.currentX,
      currentY: this.currentY,
      fallback: this.fallbackSize(),
    });
  }

  renderOverlay(_ctx: ToolContext, overlayState: any) {
    if (!overlayState?.active || overlayState.kind !== 'frame') return null;

    const box = frameBoxFromDrag(
      { x: overlayState.startX, y: overlayState.startY },
      { x: overlayState.currentX, y: overlayState.currentY },
      overlayState.fallback ?? DEFAULT_FRAME
    );

    // Ink, as the selection is: the preview is the frame-to-be, not an armed state.
    const ink = chromeToken('--text-primary', '#111827');

    return (
      <Group listening={false}>
        <Rect
          x={box.x}
          y={box.y}
          width={box.width}
          height={box.height}
          fill="rgba(255,255,255,0.55)"
          stroke={ink}
          strokeWidth={1.5}
          /* Unscaled, so the preview outline is a hairline at every zoom
             rather than a slab when you are zoomed out drawing a big frame. */
          strokeScaleEnabled={false}
        />
      </Group>
    );
  }

  private getPointerPos(ctx: ToolContext, e: any) {
    const stage = e.target?.getStage?.();
    const pos = stage?.getPointerPosition();
    if (!pos) return null;
    return ctx.camera.screenToWorld(pos.x, pos.y);
  }
}
