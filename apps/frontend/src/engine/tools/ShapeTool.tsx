import { Rect, Ellipse, Line, RegularPolygon, Star, Group, Label, Tag, Text, Path } from 'react-konva';
import { nanoid } from 'nanoid';
import { useStore } from '../../hooks/useStore';
import { ThemeService } from '../ThemeService';
import type { Tool, ToolContext } from './Tool';
import type { ShapeGeometry } from '../model/schema';
import { PRESET_GEOMETRY, type ShapePreset } from '../../components/workspace/shapePresetTypes';
import { gridSnap } from '../interaction/gridSnap';
import { constrainToAngle, lineNodeFromEndpoints, lineNodeFromVertices } from '../model/lineEnds';
import { contourData } from '../model/pathGeometry';
import { shapeToPath } from '../model/shapeToPath';
import { shapeFeaturePaths } from '../model/shapeOutline';
import {
  addVertex,
  beginSession,
  commitPoints,
  endsRun,
  nextVertex,
  previewPoints,
  undoVertex,
  type PolylineSession,
} from './polylineSession';
import { bindCandidates } from '../model/connectorTargets';
import { snapLineEndpoint } from '../interaction/lineMagneticSnap';
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
  /**
   * A run of corners being placed, click by click.
   *
   * ## Two gestures, and how the tool tells them apart
   *
   * A line can now be drawn either way, and neither needs a mode or a modifier
   * because the pointer has already said which one it is: a **drag** is a press
   * and a move, a **click** is a press and a release in the same place. Drag
   * gives the two-point line — the common case, and the one this tool is
   * fastest at. Click starts a run, and each further click adds a corner.
   *
   * The old gesture was click–move–click, always, committing on the second
   * click. That is what this replaces: it made the two-point line cost two
   * separate clicks, and it left no click free to mean "another corner".
   */
  private session: PolylineSession | null = null;
  /** Where the pointer went down, so a click can be told from a drag. */
  private pressX = 0;
  private pressY = 0;
  private pressed = false;
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
   * The run's two ends, with modifiers and magnetic snapping applied.
   *
   * Shares `box()`'s grid snap and angle constraint but keeps the *direction*,
   * which a box cannot express — a box has a top-left and a size, and both
   * diagonals produce the same one.
   */
  private endpoints(zoom = 1): { a: { x: number; y: number }; b: { x: number; y: number } } {
    let a = { x: this.startX, y: this.startY };
    let b = { x: this.currentX, y: this.currentY };
    if (this.shift) b = constrainToAngle(a, b);
    if (!this.alt) {
      const candidates = bindCandidates(useStore.getState().objects);
      const capKind = this.preset === 'arrow' ? 'arrow' : 'none';
      const snapB = snapLineEndpoint(b, candidates, zoom, {
        anchor: a,
        endType: 'end',
        capKind,
      });
      if (snapB.snapped) b = snapB.point;
      const snapA = snapLineEndpoint(a, candidates, zoom, {
        anchor: b,
        endType: 'start',
        capKind: 'none',
      });
      if (snapA.snapped) a = snapA.point;
    }
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
      const { lineProfile: profile, lineWaves, lineAmplitude } = useStore.getState();
      if (profile !== 'straight') {
        geometry.lineProfile = profile;
        // Only when it disagrees with the default, so the document does not
        // carry a value that just restates the rule.
        if (lineWaves !== 6) geometry.lineWaves = lineWaves;
        if (lineAmplitude && lineAmplitude !== 1.0) geometry.lineAmplitude = lineAmplitude;
      }
    }
    return geometry;
  }

  onPointerDown(ctx: ToolContext, e: any) {
    const pos = this.getPointerPos(ctx, e);
    if (!pos) return;
    this.shift = Boolean(e.evt?.shiftKey);
    this.alt = Boolean(e.evt?.altKey);

    if (this.isOpen()) {
      // Nothing is decided on the way down: whether this is a drag or a click
      // is not known until the pointer either moves or comes back up. The press
      // is recorded so both answers are available when it does.
      this.pressed = true;
      this.pressX = pos.x;
      this.pressY = pos.y;
      this.currentX = pos.x;
      this.currentY = pos.y;
      if (!this.session) {
        this.startX = pos.x;
        this.startY = pos.y;
        this.pending = true;
      }
      this.pushOverlay(ctx);
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

    /**
     * The moment a press becomes a drag.
     *
     * Measured in **screen pixels** — invariant 9. In world units the same
     * hand movement is a drag at 25% zoom and a click at 400%, so the tool
     * would draw a two-point line or start a run depending on how far in the
     * board happened to be. Only before the first vertex is placed: once a run
     * has started, moving the pointer is aiming, not dragging.
     */
    if (this.isOpen() && this.pressed && !this.session && !this.isDragging) {
      const zoom = ctx.camera?.zoom || 1;
      const travelled = Math.hypot(pos.x - this.pressX, pos.y - this.pressY) * zoom;
      if (travelled > MIN_DRAG) this.isDragging = true;
    }

    this.pushOverlay(ctx);
  }

  onPointerUp(ctx: ToolContext) {
    if (this.isOpen()) {
      const wasPressed = this.pressed;
      this.pressed = false;
      if (this.isDragging) {
        // A drag: the two-point line, committed on release like every other
        // shape. This is the gesture the tool did not have.
        this.isDragging = false;
        this.pending = false;
        this.commit(ctx);
        return;
      }
      if (!wasPressed) return;
      this.click(ctx, { x: this.currentX, y: this.currentY });
      return;
    }
    if (!this.isDragging) return;
    this.isDragging = false;
    this.commit(ctx);
  }

  /**
   * A click that did not turn into a drag: start a run, extend it, or end it.
   *
   * Ending by clicking the last vertex again is what makes a **double-click**
   * finish the line without any special handling — the second click of one
   * lands within the same few pixels as the first, which is exactly the test
   * `endsRun` applies.
   */
  private click(ctx: ToolContext, pos: { x: number; y: number }) {
    const zoom = ctx.camera?.zoom || 1;

    if (!this.session) {
      this.session = beginSession(this.snapVertex(pos));
      this.pending = true;
      this.pushOverlay(ctx);
      return;
    }
    if (endsRun(this.session, pos, zoom)) {
      this.finish(ctx);
      return;
    }
    this.session = addVertex(this.session, this.snapVertex(nextVertex(this.session, pos, this.shift)));
    this.pushOverlay(ctx);
  }

  /**
   * A vertex, snapped to the grid if the grid is on.
   *
   * Grid only — **not** the magnetic binding to shape ports that the two-point
   * drag applies. Binding means "this line runs from that box to this one", a
   * statement about two ends; a corner in the middle of a route has no such
   * meaning, and having a corner jump onto a nearby shape's edge while you are
   * drawing past it is the opposite of helpful. See `endpoints`.
   */
  private snapVertex(p: { x: number; y: number }): { x: number; y: number } {
    return gridSnap.shouldSnap() ? gridSnap.snapPoint(p.x, p.y) : { x: p.x, y: p.y };
  }

  /** End the run and store it — or drop it, if there is no line there. */
  private finish(ctx: ToolContext) {
    const session = this.session;
    const zoom = ctx.camera?.zoom || 1;
    this.session = null;
    this.pending = false;
    this.pressed = false;
    if (!session) {
      ctx.setOverlayState?.({ active: false });
      return;
    }
    const points = commitPoints(session, zoom);
    if (!points) {
      // One click and a change of mind. Nothing to store, and inventing a
      // default-length line in an arbitrary direction is worse than nothing.
      ctx.setOverlayState?.({ active: false });
      return;
    }
    this.commitRun(ctx, points);
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
     * A line stores its two endpoints, and its box is what it draws.
     *
     * The endpoints used to *be* the box — corner to corner, with the flip
     * signs recording the diagonal — which is exact for a straight line and
     * wrong for a profiled one, because the run deviates across the diagonal
     * and the box stayed flat while the drawing did not. `lineNodeFromEndpoints`
     * returns both halves: the endpoints for `geometry`, and a box that is the
     * extent of the line and its markers.
     */
    const openGeometry = this.geometry();
    const ends = this.isOpen() ? this.endpoints() : null;
    const run = ends ? lineNodeFromEndpoints(ends.a, ends.b, openGeometry) : null;
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
      // width/height on the base node are the only record of size; `geometry`
      // describes the form alone.
      width,
      height,
      geometry: run ? run.geometry : openGeometry,
      appearance: {
        fill: [{ type: 'solid', color: ThemeService.getDefaultShapeFill(), opacity: 1 }],
        stroke: { color: ThemeService.getDefaultStrokeColor(), width: 2 },
        /**
         * A rectangle is a rectangle.
         *
         * This was 8, so every square anyone drew arrived with rounded
         * corners nobody asked for — a style decision baked into the *tool*,
         * which is the one place it cannot be undone by not choosing it. The
         * corner radius is a control in the panel and on the rail; the default
         * is the shape's own geometry, and rounding is what you add.
         */
        cornerRadius: 0,
      },
    });

    ctx.editor.select(nodeId);
    window.dispatchEvent(new CustomEvent('legacy_tool_change', { detail: 'select' }));
  }

  /**
   * Store a run of vertices as a line.
   *
   * Shares nothing with `commit` above except `geometry()` and the appearance,
   * because a run has no box to negotiate: `lineNodeFromVertices` derives the
   * box from what the line draws, which is the same function `commit` reaches
   * through `lineNodeFromEndpoints`. Two ways *in*, one derivation.
   */
  private commitRun(ctx: ToolContext, points: Array<{ x: number; y: number }>) {
    ctx.setOverlayState?.({ active: false });

    const geometry = this.geometry();
    /**
     * The rounding armed on the dock, applied to the run that was just drawn.
     *
     * Only to a run — a two-point line has no corner to round, and writing the
     * flag anyway would put a field on it that nothing reads. Same rule as the
     * profile above it: the dock decides what the *next* line comes out as, and
     * the line owns it from then on.
     */
    if (points.length > 2 && useStore.getState().lineSmooth) geometry.smooth = true;
    const run = lineNodeFromVertices(points, undefined, geometry);
    const nodeId = nanoid();
    ctx.editor.createNode({
      id: nodeId,
      type: 'shape',
      x: run.x,
      y: run.y,
      width: run.width,
      height: run.height,
      geometry: run.geometry,
      appearance: {
        fill: [{ type: 'solid', color: ThemeService.getDefaultShapeFill(), opacity: 1 }],
        stroke: { color: ThemeService.getDefaultStrokeColor(), width: 2 },
        cornerRadius: 0,
      },
    });

    ctx.editor.select(nodeId);
    window.dispatchEvent(new CustomEvent('legacy_tool_change', { detail: 'select' }));
  }

  onKeyDown(ctx: ToolContext, e: KeyboardEvent) {
    if (this.session) {
      /**
       * Enter and Escape both **finish** the run.
       *
       * Which is what the user asked for and what Excalidraw does, and it
       * differs from the pen tool on purpose — there, Escape discards. The
       * difference is what is in progress. A half-drawn bezier has handles
       * mid-drag and no meaning until it is closed off, so abandoning it is the
       * likely intent; a run of placed corners is already a line, and every
       * click that made it was deliberate. Throwing five of them away on the
       * key people press to mean "I am done" would be the surprising reading.
       *
       * A run with only one point has nothing to finish, so `finish` drops it
       * — which is the same key doing the same thing, seen from the other end.
       */
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        this.finish(ctx);
        return;
      }
      // Backspace takes the last corner back. A misplaced corner is the
      // likeliest thing to happen while drawing one, and starting over is a
      // punishment for a two-pixel slip.
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        const undone = undoVertex(this.session);
        if (undone === this.session) {
          this.finish(ctx);
          return;
        }
        this.session = undone;
        this.pushOverlay(ctx);
        return;
      }
    }
    // Escape cancels an in-progress drag, matching every other tool.
    if (e.key === 'Escape' && (this.isDragging || this.pending)) {
      this.isDragging = false;
      this.pending = false;
      this.pressed = false;
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
    this.pressed = false;
    /**
     * A run in progress is **kept**, not dropped, when the tool goes away.
     *
     * Switching tools mid-run is how somebody reaches for the hand tool to pan
     * to where the next corner goes — on a board wider than the window, that is
     * the ordinary way to draw a long route. Discarding here would make the
     * feature unusable at exactly the scale it is most for. `finish` is
     * reachable from the keyboard, and re-selecting the line tool picks the run
     * back up where it was left.
     */
    this.pending = Boolean(this.session);
    ctx.setOverlayState?.(this.session ? { active: true, box: this.box(), kind: this.preset, run: this.runPreview() } : { active: false });
  }

  private pushOverlay(ctx: ToolContext) {
    ctx.setOverlayState?.({
      active: true,
      box: this.box(),
      kind: this.preset,
      // Only for a run: the two-point gesture is drawn from `endpoints()` in
      // `renderOverlay`, which also applies the magnetic snapping this does not.
      run: this.runPreview(),
    });
  }

  /**
   * The run as it stands, pointer included, flattened for Konva.
   *
   * From `previewPoints`, which is what `commitPoints` reads — so the line that
   * is drawn and the line that is stored come from one list and cannot differ.
   */
  private runPreview(): number[] | null {
    if (!this.session) return null;
    const pointer = nextVertex(this.session, { x: this.currentX, y: this.currentY }, this.shift);
    return previewPoints(this.session, this.snapVertex(pointer)).flatMap((p) => [p.x, p.y]);
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
        <Rect x={x} y={y} width={width} height={height} fill={fill} stroke={stroke} strokeWidth={2} /* Square, like the shape this actually creates. It drew a rounded
             preview and committed a sharp one, which is a preview that lies. */
        cornerRadius={0} listening={false} />
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
      /**
       * A run in progress draws itself; a two-point gesture draws its ends.
       *
       * The run comes from `previewPoints`, the same list `commitPoints` reads,
       * so what is on screen is what will be stored. The placed corners are
       * marked so it is clear which points are committed and which one is still
       * following the pointer — without that, a run reads as a rubber band and
       * there is no sign that clicking again will add to it.
       */
      const run: number[] | null = overlayState.run ?? null;
      if (run && run.length >= 4) {
        const placed: React.ReactNode[] = [];
        for (let i = 0; i + 1 < run.length - 2; i += 2) {
          placed.push(
            <Ellipse
              key={i}
              x={run[i]}
              y={run[i + 1]}
              radiusX={3 / zoom}
              radiusY={3 / zoom}
              fill="#FFFFFF"
              stroke={stroke}
              strokeWidth={1.5 / zoom}
              listening={false}
            />
          );
        }
        return (
          <Group listening={false}>
            <Line points={run} stroke={stroke} strokeWidth={2 / zoom} lineCap="round" lineJoin="round" listening={false} />
            {placed}
          </Group>
        );
      }

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

    if (
      kind === 'triangle' ||
      kind === 'pentagon' ||
      kind === 'hexagon' ||
      kind === 'octagon'
    ) {
      return withReadout(
        <RegularPolygon
          {...center}
          sides={PRESET_GEOMETRY[kind as ShapePreset]?.points ?? 3}
          radius={base / 2}
          scaleX={scaleX}
          scaleY={scaleY}
          fill={fill}
          stroke={stroke}
          strokeWidth={2}
          strokeScaleEnabled={false}
          listening={false}
        />
      );
    }

    const geom = PRESET_GEOMETRY[kind as ShapePreset] ?? { kind: 'rect' };
    const dummyNode = {
      geometry: geom,
      width,
      height,
      appearance: {},
    };
    const pathD = contourData(shapeToPath(dummyNode as any));
    const featurePaths = shapeFeaturePaths(dummyNode as any, 0, 0);
    return withReadout(
      <Group x={x} y={y} listening={false}>
        <Path
          data={pathD}
          fillRule="evenodd"
          fill={fill}
          stroke={stroke}
          strokeWidth={2}
          listening={false}
        />
        {featurePaths.map((featD, i) => (
          <Path
            key={`feat-${i}`}
            data={featD}
            stroke={stroke}
            strokeWidth={1.5}
            listening={false}
          />
        ))}
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
