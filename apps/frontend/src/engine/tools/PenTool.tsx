import { nanoid } from 'nanoid';
import { ThemeService } from '../ThemeService';
import { simplifyPoints } from '../model/simplify';
import type { Tool, ToolContext } from './Tool';
import * as React from 'react';
import { getStroke } from 'perfect-freehand';
import { Path } from 'react-konva';
import { useStore } from '../../hooks/useStore';

function getSvgPathFromStroke(stroke: number[][]) {
  if (!stroke.length) return '';
  const d = stroke.reduce(
    (acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length];
      acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
      return acc;
    },
    ['M', ...stroke[0], 'Q']
  );
  d.push('Z');
  return d.join(' ');
}

export class PenTool implements Tool {
  id = 'pen';
  cursor = 'crosshair';

  /**
   * The ink the pencil draws in, from the theme.
   *
   * ## Why this was wrong
   *
   * It was `static currentColor = DEFAULT_INK` — `#1F2937`, a near-black —
   * and, unusually, **nothing anywhere ever assigned it**. There is no colour
   * control for the pencil, so that constant was the colour of every freehand
   * stroke this product has ever drawn. On a dark board it is a near-black
   * line on a near-black surface: the tool appeared to do nothing, and the
   * stroke was there all along.
   *
   * `BezierPenTool` one file over already asks `ThemeService` for its stroke,
   * so the pencil was the odd one out rather than the rule.
   *
   * ## Why the body text colour, and not the shape stroke
   *
   * `getDefaultStrokeColor` is blue in light mode — right for a shape's edge,
   * wrong for ink. A pencil draws the same mark a sentence is made of, so it
   * takes the same pair, and `penInkContrast.test.ts` holds both ends of that
   * pair against the board they are drawn on.
   *
   * ## Why a getter, and what it does not solve
   *
   * Read at draw time, so a stroke started after a theme change uses the new
   * ink. A stroke already *committed* keeps the colour it was drawn with —
   * switching to light does not repaint a white line — which is inherent to
   * storing a colour and is what every editor does. This sets the default at
   * creation, exactly as `getDefaultShapeFill` does for a new rectangle.
   */
  static get currentColor(): string {
    return ThemeService.getDefaultTextColor();
  }

  /** The nib, from the store so the dock's control and the stroke agree. */
  private static get size(): number {
    return useStore.getState().penSize;
  }

  private isDrawing = false;
  /**
   * The raw input, with pen pressure where the device reports it.
   *
   * `perfect-freehand` takes `[x, y, pressure]` and will thin the line for
   * you. It was being handed `[x, y]` only, so a graphics tablet drew exactly
   * the same dead-weight line as a mouse — the one input that has something to
   * say about how hard you pressed was the one thing thrown away.
   */
  private points: { x: number; y: number; p: number }[] = [];
  /**
   * Whether anything is actually varying the pressure.
   *
   * A mouse reports a constant 0.5 while held (and 0 otherwise), so trusting
   * it would produce a line of rigidly uniform width. When nothing real is
   * arriving, `simulatePressure` lets the library infer weight from velocity,
   * which is what makes a mouse-drawn stroke look drawn rather than extruded.
   */
  private hasRealPressure = false;

  /**
   * One set of options, used by the preview and by the committed stroke.
   *
   * These were written out twice — here and in `renderOverlay` — so the ghost
   * you drew against and the mark you got were two independent definitions of
   * the same line, free to drift apart at the next edit.
   */
  private strokeOptions() {
    return {
      size: PenTool.size,
      /**
       * How much the line narrows with speed or pressure.
       *
       * A stylus earns the full effect — that variation is the whole reason
       * to hold one. A **mouse** has no pressure to report, so this was being
       * inferred from cursor velocity at the same strength, and mouse velocity
       * is not a smooth signal: it arrives in bursts shaped by the OS, the
       * frame budget and the surface under your hand. Every one of those
       * bursts became a bulge in the line. That is the lumpiness — the tool
       * was faithfully drawing noise nobody produced.
       */
      thinning: this.hasRealPressure ? 0.5 : 0.12,
      // Both raised for the mouse. `streamline` is the low-pass filter on the
      // input itself, and it is what turns a jittery sample stream into one
      // continuous line.
      smoothing: this.hasRealPressure ? 0.5 : 0.7,
      streamline: this.hasRealPressure ? 0.5 : 0.72,
      simulatePressure: !this.hasRealPressure,
      last: !this.isDrawing,
    };
  }

  /**
   * Ignore samples that have barely moved.
   *
   * A pointer at rest still emits events, and every one of them used to be
   * recorded — so pausing mid-stroke piled dozens of near-identical points on
   * one spot, which the smoother then had to average its way out of, leaving a
   * visible knot exactly where the hand hesitated. Sampling by distance rather
   * than by event also means the stored path does not grow with how long the
   * gesture took.
   *
   * The threshold is in world units, so it is a constant *screen* distance at
   * any zoom — a stroke drawn at 400% should not be recorded four times as
   * finely as the same gesture at 100%.
   */
  private farEnough(x: number, y: number, zoom: number): boolean {
    const last = this.points[this.points.length - 1];
    if (!last) return true;
    const minimum = 1.4 / (zoom || 1);
    return Math.hypot(x - last.x, y - last.y) >= minimum;
  }

  onPointerDown(ctx: ToolContext, e: any) {
    const pos = this.getPointerPos(ctx, e);
    if (!pos) return;
    this.isDrawing = true;
    this.hasRealPressure = false;
    this.points = [{ ...pos, p: this.pressureOf(e) }];
    ctx.setOverlayState?.({ type: 'pen', points: [...this.points] });
  }

  onPointerMove(ctx: ToolContext, e: any) {
    if (!this.isDrawing) return;
    const pos = this.getPointerPos(ctx, e);
    if (!pos) return;
    const p = this.pressureOf(e);
    // A pen is only "real" once it varies. A mouse pins 0.5 for the whole
    // stroke, and treating that as pressure gives a line of constant weight.
    if (!this.hasRealPressure && Math.abs(p - this.points[0].p) > 0.02) {
      this.hasRealPressure = true;
    }
    if (!this.farEnough(pos.x, pos.y, ctx.camera.zoom)) return;
    this.points.push({ ...pos, p });
    ctx.setOverlayState?.({ type: 'pen', points: [...this.points] });
  }

  /** Pointer pressure, defaulted to the middle of the range for a mouse. */
  private pressureOf(e: any): number {
    const raw = e?.evt?.pressure;
    return typeof raw === 'number' && raw > 0 ? raw : 0.5;
  }

  onKeyDown(ctx: ToolContext, e: KeyboardEvent) {
    // Escape abandons the stroke, matching every other drawing gesture here.
    if (e.key === 'Escape' && this.isDrawing) {
      this.isDrawing = false;
      this.points = [];
      ctx.setOverlayState?.(null);
    }
  }

  onPointerUp(ctx: ToolContext) {
    if (!this.isDrawing) return;
    this.isDrawing = false;
    ctx.setOverlayState?.(null);

    // A tap is a dot. `>= 2` silently discarded it, so pressing the pencil
    // down without moving produced nothing at all — which reads as the tool
    // being broken rather than as a deliberate refusal. Two coincident points
    // are what `getStroke` needs to close a round cap into a dot.
    if (this.points.length === 1) {
      this.points.push({ ...this.points[0] });
    }

    if (this.points.length >= 2) {
      const strokePoints = getStroke(
        this.points.map((pt) => [pt.x, pt.y, pt.p]),
        this.strokeOptions()
      );

      // Storing the svgPath in absolute canvas coordinates (with x/y always 0)
      // meant every freehand stroke reported a phantom 100x100 bounding box to
      // anything that reads obj.width/height (marquee-select, the eraser, the
      // minimap) — a scribble spanning half the canvas would still register
      // as "at the origin, 100x100" for hit-testing. Normalize to the actual
      // bounds and store the path relative to them, matching every other
      // object type's (x, y) + relative-content convention.
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of this.points) {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
      }
      const pad = PenTool.size; // the stroke itself extends ~size/2 beyond the raw points
      minX -= pad; minY -= pad; maxX += pad; maxY += pad;

      const svgPath = getSvgPathFromStroke(strokePoints.map(([x, y]) => [x - minX, y - minY]));
      // The outline blob (svgPath) is what renders, but it's a filled polygon
      // traced around the stroke — not the stroke itself, so there's no way
      // to tell where along it you clicked. Keeping the original centerline
      // points (relative to the same origin) is what lets the Eraser cut an
      // actual gap in a freehand stroke instead of only being able to delete
      // the whole thing.
      /**
       * Thinned before it is stored.
       *
       * The raw samples are what the pointer reported — hundreds for a short
       * stroke, and nearly all of them on straight runs where the neighbours
       * already say everything. They are replicated to every client, written
       * into every snapshot and serialized into every export. Douglas–Peucker
       * at just over a unit keeps every corner and drops the rest; the drawn
       * outline is unaffected because it comes from `svgPath`, which
       * `perfect-freehand` has already produced from the full-rate input.
       */
      const nib = useStore.getState().pencilNib;
      const centerline = simplifyPoints(
        this.points.map(p => ({ x: p.x - minX, y: p.y - minY })),
        1.2
      );

      ctx.editor.createNode({
        id: nanoid(),
        type: 'path',
        x: minX,
        y: minY,
        width: Math.max(1, maxX - minX),
        height: Math.max(1, maxY - minY),
        geometry: {
          kind: 'freehand',
          svgPath,
          points: centerline,
          strokeSize: PenTool.size,
        },
        /**
         * The nib in the pencil, written onto the stroke.
         *
         * A stroke is finished the moment the pen lifts, so this cannot be a
         * decision made afterwards without drawing, selecting and editing every
         * single line. It is stored on the node rather than read from the store
         * at render time for the ordinary reason: a document has to draw the
         * same on every machine, and a tool setting is a property of *this*
         * browser.
         *
         * The fill is what a smooth stroke is made of — perfect-freehand emits
         * a filled outline polygon, not a stroked line — and the stroke colour
         * is what a sketched one uses, so both are written and the renderer
         * takes whichever its branch needs.
         */
        appearance: {
          fill: [{ type: 'solid', color: PenTool.currentColor, opacity: 1 }],
          stroke: { color: PenTool.currentColor, width: PenTool.size },
          ...(nib !== 'smooth' ? { sketch: nib } : null),
        },
      });
    }
    
    this.points = [];
  }

  onDeactivate(ctx: ToolContext) {
    // Switching tools mid-stroke (e.g. a keyboard shortcut while still
    // dragging) left the in-progress preview permanently stuck on screen —
    // nothing else clears overlayState, and this tool only ever cleared it
    // from onPointerUp. BezierPenTool already resets on deactivate; this one
    // didn't.
    this.isDrawing = false;
    this.points = [];
    ctx.setOverlayState?.(null);
  }

  renderOverlay(ctx: ToolContext, overlayState: any) {
    if (overlayState?.type === 'pen' && overlayState.points) {
      const strokePoints = getStroke(
        overlayState.points.map((pt: any) => [pt.x, pt.y, pt.p ?? 0.5]),
        this.strokeOptions()
      );
      const pathData = getSvgPathFromStroke(strokePoints);
      
      return (
        <Path
          data={pathData}
          fill={PenTool.currentColor}
          listening={false}
        />
      );
    }
    return null;
  }

  private getPointerPos(ctx: ToolContext, e: any) {
    const stage = e.target.getStage();
    const pos = stage?.getPointerPosition();
    if (!pos) return null;
    return {
      x: (pos.x - ctx.camera.x) / ctx.camera.zoom,
      y: (pos.y - ctx.camera.y) / ctx.camera.zoom
    };
  }
}
