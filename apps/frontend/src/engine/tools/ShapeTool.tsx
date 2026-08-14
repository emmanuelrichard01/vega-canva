import { Rect, Ellipse, Line, RegularPolygon, Star, Group, Label, Tag, Text } from 'react-konva';
import { nanoid } from 'nanoid';
import { ThemeService } from '../ThemeService';
import type { Tool, ToolContext } from './Tool';
import type { ShapeGeometry } from '../model/schema';
import { PRESET_GEOMETRY, type ShapePreset } from '../../components/workspace/shapeIcons';
import { gridSnap } from '../interaction/gridSnap';
import * as React from 'react';

/** Minimum drag before a shape is sized by the drag rather than dropped at a default size. */
const MIN_DRAG = 5;
const DEFAULT_SIZE = 120;

export class ShapeTool implements Tool {
  id = 'shape';
  cursor = 'crosshair';

  private isDragging = false;
  /** The raw pointer anchor, before any modifier reinterprets it. */
  private startX = 0;
  private startY = 0;
  /** The raw pointer position, likewise. */
  private currentX = 0;
  private currentY = 0;
  /**
   * The modifiers, held rather than read from the last pointer event.
   *
   * They used to be read off `e.evt.shiftKey` inside `onPointerMove`, which
   * means the preview only answers a modifier when the mouse *also* moves —
   * press Shift while holding still and nothing happens until you jiggle the
   * pointer. Keeping them here, and updating on key events too, makes the
   * constraint respond the instant it is asked for.
   */
  private shift = false;
  private alt = false;
  private preset: ShapePreset;

  /**
   * The box the drag currently describes, with every modifier applied.
   *
   * One place, used by the preview, the commit and the readout — so what you
   * see while dragging is by construction what you get on release. These were
   * three separate calculations before, and the third (the commit) silently
   * did not know about Alt.
   */
  private box() {
    let ax = this.startX;
    let ay = this.startY;
    let bx = this.currentX;
    let by = this.currentY;

    if (this.shift) {
      // Square/circle: the shorter axis wins, so the shape stays inside the
      // gesture rather than growing past where the pointer has reached.
      const size = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
      bx = ax + Math.sign(bx - ax || 1) * size;
      by = ay + Math.sign(by - ay || 1) * size;
    }

    if (this.alt) {
      // Draw from the centre: the anchor becomes the middle and the pointer
      // describes one corner, so the shape grows in both directions at once.
      const dx = bx - ax;
      const dy = by - ay;
      ax = this.startX - dx;
      ay = this.startY - dy;
    }

    if (gridSnap.shouldSnap()) {
      const a = gridSnap.snapPoint(ax, ay);
      const b = gridSnap.snapPoint(bx, by);
      ax = a.x; ay = a.y; bx = b.x; by = b.y;
    }

    return {
      x: Math.min(ax, bx),
      y: Math.min(ay, by),
      width: Math.abs(bx - ax),
      height: Math.abs(by - ay),
    };
  }

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
    this.shift = Boolean(e.evt?.shiftKey);
    this.alt = Boolean(e.evt?.altKey);
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
    this.shift = Boolean(e.evt?.shiftKey);
    this.alt = Boolean(e.evt?.altKey);
    this.pushOverlay(ctx);
  }

  onPointerUp(ctx: ToolContext) {
    if (!this.isDragging) return;
    this.isDragging = false;
    ctx.setOverlayState?.({ active: false });

    let { x, y, width, height } = this.box();

    // A click rather than a drag drops a default-sized shape centred on the point.
    if (width <= MIN_DRAG || height <= MIN_DRAG) {
      width = DEFAULT_SIZE;
      height = DEFAULT_SIZE;
      x = this.startX - DEFAULT_SIZE / 2;
      y = this.startY - DEFAULT_SIZE / 2;
      if (gridSnap.shouldSnap()) {
        const snapped = gridSnap.snapPoint(x, y);
        x = snapped.x;
        y = snapped.y;
      }
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
      return;
    }
    this.syncModifiers(ctx, e);
  }

  onKeyUp(ctx: ToolContext, e: KeyboardEvent) {
    this.syncModifiers(ctx, e);
  }

  /** Repaint the preview the moment a modifier changes, held still or not. */
  private syncModifiers(ctx: ToolContext, e: KeyboardEvent) {
    if (!this.isDragging) return;
    const shift = e.shiftKey;
    const alt = e.altKey;
    if (shift === this.shift && alt === this.alt) return;
    this.shift = shift;
    this.alt = alt;
    this.pushOverlay(ctx);
  }

  onDeactivate(ctx: ToolContext) {
    // A keyboard tool-switch mid-drag never fires onPointerUp, which would
    // otherwise leave the ghost size preview stuck on screen forever.
    this.isDragging = false;
    ctx.setOverlayState?.({ active: false });
  }

  private pushOverlay(ctx: ToolContext) {
    ctx.setOverlayState?.({ active: true, box: this.box(), kind: this.preset });
  }

  renderOverlay(ctx: ToolContext, overlayState: any) {
    if (!overlayState?.active || !overlayState.box) return null;

    const { x, y, width, height } = overlayState.box;
    const kind: ShapePreset = overlayState.kind;
    // Drawn at a constant screen size, so the readout stays legible at 10% and
    // does not become a billboard at 800%.
    const zoom = ctx.camera?.zoom || 1;

    const fill = 'rgba(59, 130, 246, 0.25)';
    const stroke = '#3B82F6';
    const center = { x: x + width / 2, y: y + height / 2 };

    /**
     * What you are about to make, in numbers.
     *
     * A ghost outline says where; it does not say how big, and "how big" is
     * most of what someone drawing a shape deliberately is trying to control.
     * Every tool in this category shows it and this one did not.
     */
    const readout = (
      <Label x={x + width / 2} y={y + height + 10 / zoom} listening={false}>
        <Tag fill="#3B82F6" cornerRadius={3 / zoom} pointerWidth={0} />
        <Text
          text={`${Math.round(width)} x ${Math.round(height)}`}
          fontSize={11 / zoom}
          fontFamily="ui-monospace, monospace"
          fill="#FFFFFF"
          padding={4 / zoom}
        />
      </Label>
    );

    const withReadout = (shape: React.ReactNode) => (
      <Group listening={false}>
        {shape}
        {width > MIN_DRAG && height > MIN_DRAG ? readout : null}
      </Group>
    );

    if (kind === 'rect') {
      return withReadout(
        <Rect x={x} y={y} width={width} height={height} fill={fill} stroke={stroke} strokeWidth={2} cornerRadius={8} listening={false} />
      );
    }

    if (kind === 'ellipse') {
      return withReadout(
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
      return withReadout(
        <Star {...center} numPoints={5} innerRadius={base / 4} outerRadius={base / 2} scaleX={scaleX} scaleY={scaleY} fill={fill} stroke={stroke} strokeWidth={2} strokeScaleEnabled={false} listening={false} />
      );
    }

    // A line preview is the run itself, not a filled box around it: the
    // preview has to look like the thing that is about to be created.
    if (kind === 'line' || kind === 'arrow') {
      return withReadout(
        <Line points={[x, y, x + width, y + height]} stroke={stroke} strokeWidth={2} lineCap="round" listening={false} />
      );
    }

    return withReadout(
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
