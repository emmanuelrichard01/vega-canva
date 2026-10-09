import { nanoid } from 'nanoid';
import * as React from 'react';
import { getStroke } from 'perfect-freehand';
import { Group, Path, Rect, Text } from 'react-konva';
import { ThemeService } from '../ThemeService';
import { simplifyPoints } from '../model/simplify';
import { isClosedLoop } from '../model/freehandLoop';
import type { Point } from '../model/schema';
import { undoManager } from '../document';
import type { Tool, ToolContext } from './Tool';
import { useStore } from '../../hooks/useStore';
import { brushPaint, brushWidth, strokeOptions, svgPathFromStroke, type Brush } from './brushes';
import { drawSettings } from './drawSettings';
import { RECOGNIZED_LABEL, recognizeShape, type Recognized } from './shapeRecognition';

/**
 * The most recent pen pressure the browser reported.
 *
 * The stage delivers mouse and touch events, which carry no pressure, so it is
 * recorded from the pointer event the browser fires just before each of them,
 * in the capture phase so it lands before the stage's handlers run.
 */
let penPressure: number | undefined;
let pressureListening = false;

function latestPenPressure(): number | undefined {
  if (!pressureListening && typeof window !== 'undefined') {
    pressureListening = true;
    const record = (ev: PointerEvent) => {
      penPressure = ev.pointerType === 'pen' ? ev.pressure : undefined;
    };
    window.addEventListener('pointerdown', record, true);
    window.addEventListener('pointermove', record, true);
  }
  return penPressure;
}
latestPenPressure();

/** How long the pen has to rest at the end of a stroke before it snaps to a shape. */
const HOLD_MS = 450;
/** Strokes smaller than this, in screen pixels, are never recognised as shapes. */
const MIN_SHAPE_SCREEN = 28;

interface Sample {
  x: number;
  y: number;
  p: number;
}

/**
 * The freehand pen: one tool, three brushes.
 *
 * | gesture                         | result                                     |
 * |---------------------------------|--------------------------------------------|
 * | drag                            | a stroke with the current brush            |
 * | **Shift** while dragging        | a straight line from where the stroke began |
 * | rest at the end of a stroke     | snaps to the shape it was drawn as          |
 * | move again after a snap         | back to freehand                            |
 * | **Escape**                      | abandon the stroke                          |
 * | tap                             | a dot                                       |
 *
 * Each stroke is its own undo step, however quickly the next one follows.
 */
export class PenTool implements Tool {
  id = 'pen';
  cursor = 'crosshair';

  /** The theme's ink: body text colour, so a stroke reads on either board. */
  static get themeInk(): string {
    return ThemeService.getDefaultTextColor();
  }

  /** The ink the next stroke is drawn in, for the brush held. */
  static inkFor(brush: Brush): string {
    const settings = drawSettings.get();
    if (brush === 'highlighter') return settings.highlight;
    return settings.ink ?? PenTool.themeInk;
  }

  /** Kept for callers that ask for the pen's ink without naming a brush. */
  static get currentColor(): string {
    return PenTool.inkFor(drawSettings.get().brush);
  }

  /** The nib setting, from the store so the dock's control and the stroke agree. */
  private static get size(): number {
    return useStore.getState().penSize;
  }

  /** The smoothing setting, 0–1. */
  private static get smoothing(): number {
    return useStore.getState().penSmoothing / 100;
  }

  private isDrawing = false;
  /** The raw input, with pen pressure where the device reports it. */
  private points: Sample[] = [];
  /**
   * Whether anything is actually varying the pressure. A mouse reports a
   * constant 0.5 while held, and trusting it would give a rigidly uniform line.
   */
  private hasRealPressure = false;
  /** The brush for the stroke in progress, fixed when it starts. */
  private brush: Brush = 'pen';
  /** Shift held: the stroke is a straight line from its first point. */
  private straight = false;
  private holdTimer: ReturnType<typeof setTimeout> | null = null;
  /** The shape the stroke snapped to, while the pen is resting. */
  private snapped: Recognized | null = null;
  private zoom = 1;

  private options() {
    return strokeOptions(this.brush, {
      size: PenTool.size,
      smoothing: PenTool.smoothing,
      realPressure: this.hasRealPressure,
      last: !this.isDrawing,
    });
  }

  /**
   * Samples closer than this to the last one are dropped, so a resting pen
   * does not pile points on one spot. In world units, so it is a constant
   * screen distance at any zoom.
   */
  private farEnough(x: number, y: number, zoom: number): boolean {
    const last = this.points[this.points.length - 1];
    if (!last) return true;
    return Math.hypot(x - last.x, y - last.y) >= 1.4 / (zoom || 1);
  }

  onPointerDown(ctx: ToolContext, e: any) {
    const pos = this.getPointerPos(ctx, e);
    if (!pos) return;
    this.isDrawing = true;
    this.hasRealPressure = false;
    this.brush = drawSettings.get().brush;
    this.straight = Boolean(e?.evt?.shiftKey);
    this.snapped = null;
    this.zoom = ctx.camera.zoom || 1;
    this.points = [{ ...pos, p: this.pressureOf(e) }];
    this.armHold(ctx);
    this.publish(ctx);
  }

  onPointerMove(ctx: ToolContext, e: any) {
    if (!this.isDrawing) return;
    const pos = this.getPointerPos(ctx, e);
    if (!pos) return;
    const p = this.pressureOf(e);
    if (!this.hasRealPressure && Math.abs(p - this.points[0].p) > 0.02) {
      this.hasRealPressure = true;
    }
    this.straight = Boolean(e?.evt?.shiftKey);
    if (!this.farEnough(pos.x, pos.y, ctx.camera.zoom)) return;

    // Moving again after a snap takes it back: the hand is still drawing.
    if (this.snapped) this.snapped = null;
    this.points.push({ ...pos, p });
    this.armHold(ctx);
    this.publish(ctx);
  }

  /** Restart the rest timer; when it fires, try to recognise the stroke as a shape. */
  private armHold(ctx: ToolContext) {
    this.clearHold();
    if (!drawSettings.get().recognizeShapes || this.brush === 'highlighter') return;
    this.holdTimer = setTimeout(() => {
      this.holdTimer = null;
      if (!this.isDrawing || this.straight || this.points.length < 6) return;
      const found = recognizeShape(this.points, MIN_SHAPE_SCREEN / this.zoom);
      if (!found) return;
      this.snapped = found;
      this.publish(ctx);
    }, HOLD_MS);
  }

  private clearHold() {
    if (this.holdTimer) clearTimeout(this.holdTimer);
    this.holdTimer = null;
  }

  /**
   * The centreline the stroke will be built from: the snapped shape, a
   * straight line under Shift, or the samples themselves.
   */
  private effectivePoints(): Sample[] {
    if (this.snapped) return this.snapped.points.map((pt) => ({ ...pt, p: 0.5 }));
    if (this.straight && this.points.length > 1) {
      const a = this.points[0];
      const b = this.points[this.points.length - 1];
      return [a, { ...b, p: a.p }];
    }
    return this.points;
  }

  /** Options for a centreline that is already clean: no streamlining, no taper. */
  private cleanOptions() {
    const base = this.options();
    return { ...base, streamline: 0, smoothing: 0.2, thinning: 0, simulatePressure: false, last: true };
  }

  private outline(points: Sample[]): number[][] {
    const clean = Boolean(this.snapped) || (this.straight && points.length === 2);
    return getStroke(
      points.map((pt) => [pt.x, pt.y, pt.p]),
      clean ? this.cleanOptions() : this.options()
    );
  }

  /** Hand the live stroke to the overlay. The array is shared, not copied. */
  private publish(ctx: ToolContext) {
    ctx.setOverlayState?.({
      type: 'pen',
      points: this.points,
      count: this.points.length,
      snapped: this.snapped,
      straight: this.straight,
    });
  }

  private pressureOf(e: any): number {
    const own = e?.evt?.pressure;
    const raw = typeof own === 'number' ? own : latestPenPressure();
    return typeof raw === 'number' && raw > 0 ? raw : 0.5;
  }

  onKeyDown(ctx: ToolContext, e: KeyboardEvent) {
    if (e.key === 'Escape' && this.isDrawing) {
      this.abandon(ctx);
      return;
    }
    if (e.key === 'Shift' && this.isDrawing && !this.straight) {
      this.straight = true;
      this.publish(ctx);
    }
  }

  onKeyUp(ctx: ToolContext, e: KeyboardEvent) {
    if (e.key === 'Shift' && this.isDrawing && this.straight) {
      this.straight = false;
      this.publish(ctx);
    }
  }

  private abandon(ctx: ToolContext) {
    this.clearHold();
    this.isDrawing = false;
    this.points = [];
    this.snapped = null;
    ctx.setOverlayState?.(null);
  }

  onPointerUp(ctx: ToolContext) {
    if (!this.isDrawing) return;
    this.clearHold();
    this.isDrawing = false;
    ctx.setOverlayState?.(null);

    // A tap is a dot: two coincident points close a round cap into one.
    if (this.points.length === 1) this.points.push({ ...this.points[0] });

    const centre = this.effectivePoints();
    if (centre.length >= 2) this.commit(ctx, centre);

    this.points = [];
    this.snapped = null;
  }

  private commit(ctx: ToolContext, centre: Sample[]) {
    const brush = this.brush;
    const width = brushWidth(brush, PenTool.size);
    const outline = this.outline(centre);

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of centre) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    // The ink reaches about half the nib past the centreline.
    const pad = width;
    minX -= pad;
    minY -= pad;
    maxX += pad;
    maxY += pad;

    const svgPath = svgPathFromStroke(outline.map(([x, y]) => [x - minX, y - minY]));

    // The stored centreline is thinned in proportion to the smoothing and the
    // nib, so a heavily smoothed stroke is stored as smoothly as it is drawn.
    // A snapped shape is already clean and is kept as it is.
    const tolerance = this.snapped
      ? 0.25
      : Math.max(0.6, (0.6 + PenTool.smoothing * 1.8) * Math.max(1, width / 6));
    const centerline = simplifyPoints(
      centre.map((p) => ({ x: p.x - minX, y: p.y - minY })),
      tolerance
    );
    const closed = this.snapped ? this.snapped.closed : isClosedLoop(centerline, width);
    const nib = useStore.getState().pencilNib;

    // The previous stroke stays its own undo step, however soon this one starts.
    undoManager.stopCapturing();
    const id = nanoid();
    ctx.editor.createNode({
      id,
      type: 'path',
      x: minX,
      y: minY,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY),
      geometry: {
        kind: 'freehand',
        svgPath,
        points: centerline,
        strokeSize: width,
        ...(closed ? { closed: true } : null),
        ...(brush !== 'pen' ? { brush } : null),
      },
      // The nib (smooth or sketched) is written onto the stroke, because a
      // document has to draw the same on every machine.
      appearance: {
        stroke: { color: PenTool.inkFor(brush), width },
        ...(nib !== 'smooth' && brush !== 'highlighter' ? { sketch: nib } : null),
      },
    });
    undoManager.stopCapturing();

    if (useStore.getState().penKeepSelected) ctx.editor.select(id);
  }

  onCancel(ctx: ToolContext) {
    this.abandon(ctx);
  }

  onDeactivate(ctx: ToolContext) {
    this.abandon(ctx);
  }

  renderOverlay(ctx: ToolContext, overlayState: any) {
    if (overlayState?.type !== 'pen' || !overlayState.points) return null;
    const zoom = ctx.camera.zoom || 1;
    const centre = this.effectivePoints();
    const pathData = svgPathFromStroke(this.outline(centre));
    const paint = brushPaint(this.brush, ThemeService.isDarkMode());
    const snapped: Recognized | null = overlayState.snapped ?? null;

    let chip: React.ReactNode = null;
    if (snapped) {
      const last: Point = this.points[this.points.length - 1] ?? centre[centre.length - 1];
      const label = RECOGNIZED_LABEL[snapped.kind];
      const fontSize = 11 / zoom;
      const padX = 6 / zoom;
      const width = label.length * fontSize * 0.62 + padX * 2;
      const height = fontSize + 8 / zoom;
      const dark = ThemeService.isDarkMode();
      chip = (
        <Group x={last.x + 12 / zoom} y={last.y + 12 / zoom} listening={false}>
          <Rect
            width={width}
            height={height}
            cornerRadius={height / 2}
            fill={dark ? '#F4F4F5' : '#18181B'}
            opacity={0.92}
          />
          <Text
            x={padX}
            y={4 / zoom}
            text={label}
            fontSize={fontSize}
            fontFamily="Inter, system-ui, sans-serif"
            fontStyle="600"
            fill={dark ? '#18181B' : '#FAFAFA'}
          />
        </Group>
      );
    }

    return (
      <>
        <Path
          data={pathData}
          fill={PenTool.inkFor(this.brush)}
          opacity={paint.opacity}
          globalCompositeOperation={paint.globalCompositeOperation}
          listening={false}
        />
        {chip}
      </>
    );
  }

  private getPointerPos(ctx: ToolContext, e: any) {
    const stage = e.target.getStage();
    const pos = stage?.getPointerPosition();
    if (!pos) return null;
    return {
      x: (pos.x - ctx.camera.x) / ctx.camera.zoom,
      y: (pos.y - ctx.camera.y) / ctx.camera.zoom,
    };
  }
}
