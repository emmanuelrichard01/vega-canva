import { Rect, Ellipse, Line, RegularPolygon, Star, Group, Label, Tag, Text } from 'react-konva';
import { nanoid } from 'nanoid';
import { useStore } from '../../hooks/useStore';
import { ThemeService } from '../ThemeService';
import type { Tool, ToolContext } from './Tool';
import type { ShapeGeometry } from '../model/schema';
import { PRESET_GEOMETRY, type ShapePreset } from '../../components/workspace/shapeIcons';
import { gridSnap } from '../interaction/gridSnap';
import { boxFromEndpoints, constrainToAngle } from '../model/lineEnds';
import * as React from 'react';

/** Minimum drag before a shape is sized by the drag rather than dropped at a default size. */
const MIN_DRAG = 5;
const DEFAULT_SIZE = 120;

export class ShapeTool implements Tool {
  id = 'shape';
  cursor = 'crosshair';

  private isDragging = false;
  /**
   * A line whose start is anchored, waiting for the click that ends it.
   *
   * Lines are drawn click–move–click rather than by dragging, which is what
   * Excalidraw and Figma both do and for a concrete reason: a line is often
   * long, and holding a button down across a whole board is an awkward,
   * imprecise gesture that a trackpad makes worse. Two clicks with a live
   * preview between them is steadier, and it leaves the hand free to reach a
   * modifier. Every closed shape keeps drag-to-size, where the gesture and the
   * result are the same shape.
   */
  private pending = false;
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
   * The run's two ends, with modifiers applied.
   *
   * Shares `box()`'s grid snap and angle constraint but keeps the *direction*,
   * which a box cannot express — a box has a top-left and a size, and both
   * diagonals produce the same one.
   */
  private endpoints(): { a: { x: number; y: number }; b: { x: number; y: number } } {
    let a = { x: this.startX, y: this.startY };
    let b = { x: this.currentX, y: this.currentY };
    if (this.shift) b = constrainToAngle(a, b);
    if (gridSnap.shouldSnap()) {
      a = gridSnap.snapPoint(a.x, a.y);
      b = gridSnap.snapPoint(b.x, b.y);
    }
    return { a, b };
  }

  /** Whether this preset draws an open run, which is what changes the gesture. */
  private isOpen(): boolean {
    const kind = (PRESET_GEOMETRY[this.preset] ?? PRESET_GEOMETRY.rect).kind;
    return kind === 'line' || kind === 'arrow';
  }

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

    if (this.shift && this.isOpen()) {
      // On a line, Shift means the same thing it means when dragging an
      // endpoint afterwards: fifteen-degree steps from the anchor. Sharing
      // `constrainToAngle` is what keeps drawing a line and editing one from
      // disagreeing about what the key does.
      const snapped = constrainToAngle({ x: ax, y: ay }, { x: bx, y: by });
      bx = snapped.x;
      by = snapped.y;
    } else if (this.shift) {
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
    // The current field, not the boolean it superseded. The normalizer maps
    // the old one across for documents that already hold it, but nothing new
    // should be written in a form marked deprecated.
    if (preset.kind === 'arrow') geometry.endEnd = 'arrow';
    // The profile armed on the dock, written onto the node — a line is
    // finished when the gesture is, so this cannot be a decision made after.
    if (preset.kind === 'line' || preset.kind === 'arrow') {
      const profile = useStore.getState().lineProfile;
      if (profile !== 'straight') geometry.lineProfile = profile;
    }
    return geometry;
  }

  onPointerDown(ctx: ToolContext, e: any) {
    const pos = this.getPointerPos(ctx, e);
    if (!pos) return;
    this.shift = Boolean(e.evt?.shiftKey);
    this.alt = Boolean(e.evt?.altKey);

    if (this.isOpen()) {
      if (!this.pending) {
        // First click: anchor the start and begin following the pointer.
        this.pending = true;
        this.startX = pos.x;
        this.startY = pos.y;
        this.currentX = pos.x;
        this.currentY = pos.y;
        this.pushOverlay(ctx);
        return;
      }
      // Second click ends it — unless it landed essentially on the first, which
      // is a double-click rather than a line, and would otherwise commit a run
      // of no length in an arbitrary direction.
      this.currentX = pos.x;
      this.currentY = pos.y;
      const { width, height } = this.box();
      if (Math.hypot(width, height) < MIN_DRAG) return;
      this.pending = false;
      this.commit(ctx);
      return;
    }

    this.isDragging = true;
    this.startX = pos.x;
    this.startY = pos.y;
    this.currentX = pos.x;
    this.currentY = pos.y;
    this.pushOverlay(ctx);
  }

  onPointerMove(ctx: ToolContext, e: any) {
    // `pending` is the whole point: without it a move with no button held is
    // ignored, and a click–move–click gesture has no preview between its two
    // clicks — which is most of what makes it feel like drawing.
    if (!this.isDragging && !this.pending) return;
    const pos = this.getPointerPos(ctx, e);
    if (!pos) return;
    this.currentX = pos.x;
    this.currentY = pos.y;
    this.shift = Boolean(e.evt?.shiftKey);
    this.alt = Boolean(e.evt?.altKey);
    this.pushOverlay(ctx);
  }

  onPointerUp(ctx: ToolContext) {
    // A line is committed by its second *click*, not by releasing the first —
    // otherwise letting go of the anchoring press would end the line instantly
    // and the whole gesture would collapse back into a drag.
    if (this.isOpen()) return;
    if (!this.isDragging) return;
    this.isDragging = false;
    this.commit(ctx);
  }

  /** Create the node the current gesture describes, and hand back to Select. */
  private commit(ctx: ToolContext) {
    ctx.setOverlayState?.({ active: false });

    let { x, y, width, height } = this.box();

    /**
     * A click that sized nothing drops a default shape — but never a line.
     *
     * A line with no length is not a shape at a default size, it is a mistake:
     * there is no sensible direction to invent for it, and inventing one puts
     * a 120px diagonal on the board that nobody asked for. The open kinds are
     * therefore exempt, and a too-short line is discarded below instead.
     */
    if (!this.isOpen() && (width <= MIN_DRAG || height <= MIN_DRAG)) {
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

    /**
     * An open run records which diagonal it takes; a box cannot.
     *
     * `boxFromEndpoints` returns the same `x`/`y`/`width`/`height` a box would,
     * plus the `scaleX`/`scaleY` signs that say which way the line actually
     * runs. Without them every line committed as the top-left to bottom-right
     * diagonal whatever direction it was drawn in — which is what made the tool
     * look like it was stuck at one angle.
     */
    const run = this.isOpen() ? boxFromEndpoints(this.endpoints().a, this.endpoints().b) : null;
    if (run) {
      x = run.x;
      y = run.y;
      width = run.width;
      height = run.height;
    }

    const nodeId = nanoid();
    ctx.editor.createNode({
      id: nodeId,
      type: 'shape',
      x,
      y,
      ...(run ? { scaleX: run.scaleX, scaleY: run.scaleY } : {}),
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
    if (e.key === 'Escape' && (this.isDragging || this.pending)) {
      this.isDragging = false;
      this.pending = false;
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
    if (!this.isDragging && !this.pending) return;
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

    /**
     * A line preview is the run itself — from where it was anchored to where
     * the pointer is now.
     *
     * It used to draw the *box's* diagonal, `[x, y, x + width, y + height]`,
     * which is only the right line when you happen to draw down and to the
     * right. Drawn any other way the preview showed the opposite diagonal, so
     * the line appeared to snap to a fixed angle no matter where you moved —
     * and because the commit had the same defect, the object you got matched
     * the wrong preview rather than the gesture.
     */
    if (kind === 'line' || kind === 'arrow') {
      const ends = this.endpoints();
      return withReadout(
        <Line
          points={[ends.a.x, ends.a.y, ends.b.x, ends.b.y]}
          stroke={stroke}
          strokeWidth={2}
          lineCap="round"
          listening={false}
        />
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
