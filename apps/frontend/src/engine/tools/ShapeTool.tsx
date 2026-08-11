import { Rect, Ellipse, Line, RegularPolygon, Star } from 'react-konva';
import { nanoid } from 'nanoid';
import { ThemeService } from '../ThemeService';
import type { Tool, ToolContext } from './Tool';
import type { ShapeGeometry } from '../model/schema';
import { PRESET_GEOMETRY, type ShapePreset } from '../../components/workspace/shapeIcons';
import * as React from 'react';

/** Minimum drag before a shape is sized by the drag rather than dropped at a default size. */
const MIN_DRAG = 5;
const DEFAULT_SIZE = 120;

export class ShapeTool implements Tool {
  id = 'shape';
  cursor = 'crosshair';

  private isDragging = false;
  private startX = 0;
  private startY = 0;
  private currentX = 0;
  private currentY = 0;
  private preset: ShapePreset;

  constructor(preset: ShapePreset = 'rect') {
    this.id = `shape-${preset}`;
    this.preset = preset;
  }

  /**
   * The geometry this preset creates.
   *
   * The dock offers named side counts — triangle, pentagon, octagon — because
   * nobody wants to draw a rectangle and then type "5". The document stores
   * one `polygon` kind with a number, which is what makes the count editable
   * afterwards rather than frozen into the shape's identity.
   */
  private geometry(): ShapeGeometry {
    const preset = PRESET_GEOMETRY[this.preset] ?? PRESET_GEOMETRY.rect;
    const geometry: ShapeGeometry = { kind: preset.kind };
    if (preset.points !== undefined) geometry.points = preset.points;
    if (preset.kind === 'star') geometry.innerRatio = 0.5;
    if (preset.kind === 'arrow') geometry.arrowEnd = true;
    return geometry;
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

    // Shift constrains to a square / circle.
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
    ctx.setOverlayState?.({ active: false });

    let width = Math.abs(this.currentX - this.startX);
    let height = Math.abs(this.currentY - this.startY);
    let x = Math.min(this.startX, this.currentX);
    let y = Math.min(this.startY, this.currentY);

    // A click rather than a drag drops a default-sized shape centred on the point.
    if (width <= MIN_DRAG || height <= MIN_DRAG) {
      width = DEFAULT_SIZE;
      height = DEFAULT_SIZE;
      x = this.startX - DEFAULT_SIZE / 2;
      y = this.startY - DEFAULT_SIZE / 2;
    }

    const nodeId = nanoid();
    ctx.editor.createNode({
      id: nodeId,
      type: 'shape',
      x,
      y,
      // width/height on the base node are the only record of size; `geometry`
      // describes the form alone.
      width,
      height,
      geometry: this.geometry(),
      appearance: {
        fill: [{ type: 'solid', color: ThemeService.getDefaultShapeFill(), opacity: 1 }],
        stroke: { color: ThemeService.getDefaultStrokeColor(), width: 2 },
        cornerRadius: this.preset === 'rect' ? 8 : 0,
      },
    });

    ctx.editor.select(nodeId);
    window.dispatchEvent(new CustomEvent('legacy_tool_change', { detail: 'select' }));
  }

  onKeyDown(ctx: ToolContext, e: KeyboardEvent) {
    // Escape cancels an in-progress drag, matching every other tool.
    if (e.key === 'Escape' && this.isDragging) {
      this.isDragging = false;
      ctx.setOverlayState?.({ active: false });
    }
  }

  onDeactivate(ctx: ToolContext) {
    // A keyboard tool-switch mid-drag never fires onPointerUp, which would
    // otherwise leave the ghost size preview stuck on screen forever.
    this.isDragging = false;
    ctx.setOverlayState?.({ active: false });
  }

  private pushOverlay(ctx: ToolContext) {
    ctx.setOverlayState?.({
      active: true,
      startX: this.startX,
      startY: this.startY,
      currentX: this.currentX,
      currentY: this.currentY,
      kind: this.preset,
    });
  }

  renderOverlay(_ctx: ToolContext, overlayState: any) {
    if (!overlayState?.active) return null;

    const width = Math.abs(overlayState.currentX - overlayState.startX);
    const height = Math.abs(overlayState.currentY - overlayState.startY);
    const x = Math.min(overlayState.startX, overlayState.currentX);
    const y = Math.min(overlayState.startY, overlayState.currentY);
    const kind: ShapePreset = overlayState.kind;

    const fill = 'rgba(59, 130, 246, 0.25)';
    const stroke = '#3B82F6';
    const center = { x: x + width / 2, y: y + height / 2 };

    if (kind === 'rect') {
      return (
        <Rect x={x} y={y} width={width} height={height} fill={fill} stroke={stroke} strokeWidth={2} cornerRadius={8} listening={false} />
      );
    }

    if (kind === 'ellipse') {
      return (
        <Ellipse {...center} radiusX={width / 2} radiusY={height / 2} fill={fill} stroke={stroke} strokeWidth={2} listening={false} />
      );
    }

    // Konva's RegularPolygon/Star take a single radius, so a non-square drag
    // is expressed by stretching the node. This mirrors exactly what the
    // committed shape does, so the silhouette does not change on release.
    const base = Math.min(width, height) || 1;
    const scaleX = width / base;
    const scaleY = height / base;

    if (kind === 'star') {
      return (
        <Star {...center} numPoints={5} innerRadius={base / 4} outerRadius={base / 2} scaleX={scaleX} scaleY={scaleY} fill={fill} stroke={stroke} strokeWidth={2} strokeScaleEnabled={false} listening={false} />
      );
    }

    // A line preview is the run itself, not a filled box around it: the
    // preview has to look like the thing that is about to be created.
    if (kind === 'line' || kind === 'arrow') {
      return (
        <Line points={[x, y, x + width, y + height]} stroke={stroke} strokeWidth={2} lineCap="round" listening={false} />
      );
    }

    return (
      <RegularPolygon {...center} sides={PRESET_GEOMETRY[kind as ShapePreset]?.points ?? 3} radius={base / 2} scaleX={scaleX} scaleY={scaleY} fill={fill} stroke={stroke} strokeWidth={2} strokeScaleEnabled={false} listening={false} />
    );
  }

  private getPointerPos(ctx: ToolContext, e: any) {
    const stage = e.target?.getStage?.();
    const pos = stage?.getPointerPosition();
    if (!pos) return null;
    return ctx.camera.screenToWorld(pos.x, pos.y);
  }
}
