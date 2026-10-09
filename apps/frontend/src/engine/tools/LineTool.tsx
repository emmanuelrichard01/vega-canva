import * as React from 'react';
import { Circle, Group, Label, Line, Tag, Text } from 'react-konva';
import { nanoid } from 'nanoid';
import { useStore } from '../../hooks/useStore';
import { ThemeService } from '../ThemeService';
import type { Tool, ToolContext } from './Tool';
import { finishCreation } from './toolModes';
import { recordRecentShape } from './recentShapes';
import { gridSnap } from '../interaction/gridSnap';
import { snapLineEndpoint } from '../interaction/lineMagneticSnap';
import { presetGeometry } from '../../components/workspace/shapeCatalog';
import type { AnyNode, Point, ShapeGeometry } from '../model/schema';
import { lineNodeFromVertices } from '../model/lineEnds';
import { defaultEndAlign, linePoints } from '../model/linePath';
import { polylinePoints } from '../model/polyline';
import { terminateRun, type EndCapKind, type EndCapShape } from '../model/connectorEnds';
import { connectorPoints, type ConnectorEnd, type Routing } from '../model/connector';
import { bindingAt, type BindCandidate } from '../model/connectorBinding';
import { attachLookup, bodyOutlinePoints, boxLookup } from '../model/connectorTargets';
import { connectorFromLine, lineBindCandidates, promotion } from '../model/lineBinding';
import { connectorDefaults } from './connectorDefaults';
import { nextVertex, previewPoints, type PolylineSession } from './polylineSession';
import { IDLE, formatMeasure, lineGesture, measureRun, segmentEnds, type LineEffect, type LineEvent, type LinePhase } from './lineGesture';
import { lineReadout } from './lineReadout';

/** Canvas chrome blue, shared with the transformer and the endpoint editors. */
const CHROME = '#3B82F6';
/** Default weight of a new line, from the shared stroke scale's second step. */
const NEW_LINE_WIDTH = 2;

type Mods = { shift: boolean; alt: boolean; free: boolean };

/** One end of the preview, and what it is attached to. */
interface PreviewEnd {
  at: Point;
  /** `bound` ends become a connector's; `snapped` ones sit flush on an edge. */
  state: 'bound' | 'snapped' | 'free';
}

/** Everything the overlay draws, computed once per pointer event. */
interface LinePreview {
  active: true;
  kind: 'line-tool';
  zoom: number;
  /** The run, world space, with heads already placed. */
  run: number[];
  caps: Array<EndCapShape | null>;
  stroke: string;
  width: number;
  /** Corners placed so far in a click-by-click run. */
  placed: Point[];
  ends: PreviewEnd[];
  /** Outlines of the objects about to be connected. */
  targets: number[][];
  reading: { text: string; at: Point } | null;
}

/**
 * The line and arrow tool.
 *
 * Gestures live in `lineGesture`, the binding rule in `lineBinding`; this
 * turns pointer events into the one and asks the other what a finished
 * gesture becomes. The preview is drawn as the object will be — its stroke,
 * its weight, its heads — so nothing changes on release except the colour of
 * the chrome around it.
 *
 * ## Modifiers
 *
 * - **Shift** steps the angle to 15°.
 * - **Alt** draws from the centre.
 * - **Ctrl / ⌘** draws a plain line: no snapping, no binding.
 *
 * Modifiers are held here and refreshed on key events as well as pointer
 * events, so pressing Shift while the pointer is still repaints at once.
 */
export class LineTool implements Tool {
  id: string;
  cursor = 'crosshair';

  private phase: LinePhase = IDLE;
  private pointer: Point = { x: 0, y: 0 };
  private mods: Mods = { shift: false, alt: false, free: false };
  /**
   * Bind targets, built once per board state rather than once per pointer
   * move. Objects do not move under a gesture except by collaborators, and a
   * new `objects` record from the store is what invalidates this.
   */
  private candidates: { objects: Record<string, AnyNode>; list: BindCandidate[] } | null = null;

  private readonly preset: 'line' | 'arrow';

  constructor(preset: 'line' | 'arrow') {
    this.preset = preset;
    this.id = `shape-${preset}`;
  }

  // ------------------------------------------------------------ events

  onPointerDown(ctx: ToolContext, e: any) {
    const pos = this.pointerOf(ctx, e);
    if (!pos) return;
    this.readMods(e.evt);
    this.pointer = pos;
    this.step(ctx, { type: 'down', at: pos });
  }

  onPointerMove(ctx: ToolContext, e: any) {
    const pos = this.pointerOf(ctx, e);
    if (!pos) return;
    this.readMods(e.evt);
    this.pointer = pos;
    if (this.phase.kind === 'idle') return;
    this.step(ctx, { type: 'move', at: pos });
  }

  onPointerUp(ctx: ToolContext, e: any) {
    const pos = this.pointerOf(ctx, e) ?? this.pointer;
    this.pointer = pos;
    this.step(ctx, { type: 'up', at: pos });
  }

  onKeyDown(ctx: ToolContext, e: KeyboardEvent) {
    const live = this.phase.kind !== 'idle';
    if (live && e.key === 'Enter') {
      e.preventDefault();
      this.step(ctx, { type: 'finish' });
      return;
    }
    if (live && e.key === 'Escape') {
      e.preventDefault();
      this.step(ctx, { type: 'cancel' });
      return;
    }
    if (this.phase.kind === 'run' && (e.key === 'Backspace' || e.key === 'Delete')) {
      e.preventDefault();
      this.step(ctx, { type: 'undo' });
      return;
    }
    this.syncMods(ctx, e);
  }

  onKeyUp(ctx: ToolContext, e: KeyboardEvent) {
    this.syncMods(ctx, e);
  }

  onDeactivate(ctx: ToolContext) {
    /**
     * A run in progress is kept when the tool goes away.
     *
     * Switching to the hand tool to pan to where the next corner goes is the
     * ordinary way to draw a long route; re-arming the line tool picks the
     * run back up. A drag or an unresolved press has nothing worth keeping.
     */
    if (this.phase.kind === 'run') this.phase = { ...this.phase, pressed: false };
    else this.phase = IDLE;
    lineReadout.current()?.hide();
    ctx.setOverlayState?.({ active: false });
  }

  // ------------------------------------------------------------ gesture

  private step(ctx: ToolContext, event: LineEvent) {
    const zoom = ctx.camera?.zoom || 1;
    const result = lineGesture(this.phase, event, {
      zoom,
      place: (raw, session) => this.placeVertex(raw, session),
    });
    this.phase = result.phase;
    if (result.effect.type !== 'none') {
      this.apply(ctx, result.effect);
      return;
    }
    this.push(ctx);
  }

  private apply(ctx: ToolContext, effect: LineEffect) {
    ctx.setOverlayState?.({ active: false });
    lineReadout.current()?.hide();
    if (effect.type === 'segment') {
      this.commitTwoPoint(ctx, this.resolveSegment(effect.from, effect.to, ctx.camera?.zoom || 1, this.mods));
    } else if (effect.type === 'run') {
      if (effect.points.length === 2) {
        // Two clicks are a two-point line, and get everything a drag gets
        // except the modifiers, which were applied as each point was placed.
        const plain = { shift: false, alt: false, free: this.mods.free };
        this.commitTwoPoint(ctx, this.resolveSegment(effect.points[0], effect.points[1], ctx.camera?.zoom || 1, plain));
      } else {
        this.commitRun(ctx, effect.points);
      }
    }
    this.candidates = null;
  }

  /** Where a click places a corner: Shift's 15° from the last one, then the grid. */
  private placeVertex(raw: Point, session: PolylineSession | null): Point {
    const constrained = session ? nextVertex(session, raw, this.mods.shift) : raw;
    return gridSnap.shouldSnap() ? gridSnap.snapPoint(constrained.x, constrained.y) : { ...constrained };
  }

  // ------------------------------------------------------------ resolution

  private candidateList(): { objects: Record<string, AnyNode>; list: BindCandidate[] } {
    const objects = useStore.getState().objects;
    if (this.candidates?.objects !== objects) this.candidates = { objects, list: lineBindCandidates(objects) };
    return this.candidates;
  }

  /**
   * What a two-point gesture becomes: its ends, and whether they connect.
   *
   * One function for the preview and the commit, so the object that lands is
   * the one that was on screen.
   */
  private resolveSegment(anchor: Point, pointer: Point, zoom: number, mods: Mods): Resolved {
    let { a, b } = segmentEnds(anchor, pointer, mods);
    const grid = (p: Point) => (gridSnap.shouldSnap() ? gridSnap.snapPoint(p.x, p.y) : p);

    if (mods.free) return { kind: 'line', a: grid(a), b: grid(b), aState: 'free', bState: 'free' };

    const { objects, list } = this.candidateList();
    const scale = 1 / Math.max(zoom, 1e-6);
    const from = bindingAt(a, list, { scale });
    const to = bindingAt(b, list, { scale });
    const routing = promotion(from, to, {
      profile: useStore.getState().lineProfile,
      vertexCount: 2,
      suppressed: false,
    });
    if (routing) {
      const flat = connectorPoints(from, to, routing, boxLookup(objects), attachLookup(objects));
      if (flat.length >= 4) {
        return {
          kind: 'connector',
          from,
          to,
          routing,
          flat,
          a: { x: flat[0], y: flat[1] },
          b: { x: flat[flat.length - 2], y: flat[flat.length - 1] },
        };
      }
    }

    // A plain line whose ends sit flush on whatever edge they reach.
    const caps = this.caps();
    const snapB = snapLineEndpoint(b, list, zoom, { anchor: a, endType: 'end', capKind: caps.end, strokeWidth: NEW_LINE_WIDTH });
    if (snapB.snapped) b = snapB.point;
    const snapA = snapLineEndpoint(a, list, zoom, { anchor: b, endType: 'start', capKind: caps.start, strokeWidth: NEW_LINE_WIDTH });
    if (snapA.snapped) a = snapA.point;
    return {
      kind: 'line',
      a: snapA.snapped ? a : grid(a),
      b: snapB.snapped ? b : grid(b),
      aState: snapA.snapped ? 'snapped' : 'free',
      bState: snapB.snapped ? 'snapped' : 'free',
    };
  }

  // ------------------------------------------------------------ commit

  private commitTwoPoint(ctx: ToolContext, resolved: Resolved) {
    const zoom = ctx.camera?.zoom || 1;
    const length = Math.hypot(resolved.b.x - resolved.a.x, resolved.b.y - resolved.a.y);
    // A line shorter than a few screen pixels is a slip, not a line, and
    // inventing a direction for it is worse than drawing nothing.
    if (resolved.kind === 'line' && length * zoom < 4) return;

    const caps = this.caps();
    if (resolved.kind === 'connector') {
      const id = nanoid();
      ctx.editor.createNode(
        connectorFromLine({
          id,
          from: resolved.from,
          to: resolved.to,
          a: resolved.a,
          b: resolved.b,
          routing: resolved.routing,
          endStart: caps.start,
          endEnd: caps.end,
          stroke: { color: ThemeService.getDefaultStrokeColor(), width: NEW_LINE_WIDTH },
          avoid: connectorDefaults.getSnapshot().avoid,
        })
      );
      recordRecentShape(this.preset);
      ctx.editor.select(id);
      finishCreation();
      return;
    }
    this.createLine(ctx, [resolved.a, resolved.b]);
  }

  private commitRun(ctx: ToolContext, points: Point[]) {
    this.createLine(ctx, points);
  }

  private createLine(ctx: ToolContext, points: Point[]) {
    const geometry = this.geometry();
    // Rounding is for a run of corners; a two-point line has none to round.
    if (points.length > 2 && useStore.getState().lineSmooth) geometry.smooth = true;
    const run = lineNodeFromVertices(points, undefined, geometry, NEW_LINE_WIDTH);
    const id = nanoid();
    recordRecentShape(this.preset);
    ctx.editor.createNode({
      id,
      type: 'shape',
      x: run.x,
      y: run.y,
      width: run.width,
      height: run.height,
      geometry: run.geometry,
      appearance: {
        // A fill so the line keeps one if it is ever converted to a closed shape.
        fill: [{ type: 'solid', color: ThemeService.getDefaultShapeFill(), opacity: 1 }],
        // Round caps, written down rather than defaulted, so the Cap control
        // shows what the line draws and the exporter writes the same ends.
        stroke: { color: ThemeService.getDefaultStrokeColor(), width: NEW_LINE_WIDTH, cap: 'round' },
        cornerRadius: 0,
      },
    });
    ctx.editor.select(id);
    finishCreation();
  }

  /** The geometry this preset creates, with the profile armed on the dock. */
  private geometry(): ShapeGeometry {
    const geometry = presetGeometry(this.preset);
    if (geometry.kind === 'arrow') geometry.endEnd = 'arrow';
    const { lineProfile: profile, lineWaves, lineAmplitude } = useStore.getState();
    if (profile && profile !== 'straight') {
      geometry.lineProfile = profile;
      // Only when it disagrees with the default, so the document does not
      // carry a value that restates the rule.
      if (lineWaves !== 6) geometry.lineWaves = lineWaves;
      if (lineAmplitude && lineAmplitude !== 1.0) geometry.lineAmplitude = lineAmplitude;
    }
    return geometry;
  }

  private caps(): { start: EndCapKind; end: EndCapKind } {
    return { start: 'none', end: this.preset === 'arrow' ? 'arrow' : 'none' };
  }

  // ------------------------------------------------------------ preview

  private readMods(evt: { shiftKey?: boolean; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean } | undefined) {
    this.mods = {
      shift: Boolean(evt?.shiftKey),
      alt: Boolean(evt?.altKey),
      free: Boolean(evt?.ctrlKey || evt?.metaKey),
    };
  }

  private syncMods(ctx: ToolContext, e: KeyboardEvent) {
    const next = { shift: e.shiftKey, alt: e.altKey, free: e.ctrlKey || e.metaKey };
    if (next.shift === this.mods.shift && next.alt === this.mods.alt && next.free === this.mods.free) return;
    this.mods = next;
    if (this.phase.kind !== 'idle') this.push(ctx);
  }

  private push(ctx: ToolContext) {
    const preview = this.preview(ctx.camera?.zoom || 1);
    const sink = lineReadout.current();
    if (!preview) {
      sink?.hide();
      ctx.setOverlayState?.({ active: false });
      return;
    }
    if (sink) {
      const reading = this.reading(preview);
      if (reading) sink.show(reading);
      else sink.hide();
    }
    ctx.setOverlayState?.(preview);
  }

  private reading(preview: LinePreview) {
    const ends = preview.ends;
    if (ends.length < 2) return null;
    const a = ends[ends.length - 2].at;
    const b = ends[ends.length - 1].at;
    const m = measureRun(a, b);
    return { ...m, at: b, mode: preview.targets.length > 0 ? ('connect' as const) : ('measure' as const) };
  }

  private preview(zoom: number): LinePreview | null {
    const stroke = ThemeService.getDefaultStrokeColor();
    const caps = this.caps();
    const profile = useStore.getState().lineProfile;
    const base = { active: true as const, kind: 'line-tool' as const, zoom, stroke, width: NEW_LINE_WIDTH };

    if (this.phase.kind === 'run') {
      const session = this.phase.session;
      const pointer = this.placeVertex(this.pointer, session);
      const pts = previewPoints(session, pointer);
      const drawn = pts.length > 2 ? polylinePoints(pts, undefined, useStore.getState().lineSmooth) : pts;
      const placed = session.points;
      const last = placed[placed.length - 1];
      const m = measureRun(last, pointer);
      const term = this.terminate(drawn, caps, profile, true);
      return {
        ...base,
        run: term.run,
        caps: term.caps,
        placed,
        ends: [
          { at: last, state: 'free' },
          { at: pointer, state: 'free' },
        ],
        targets: [],
        reading: m.length > 0 ? { text: formatMeasure(m), at: pointer } : null,
      };
    }

    if (this.phase.kind !== 'dragging') return null;

    const resolved = this.resolveSegment(this.phase.anchor, this.pointer, zoom, this.mods);
    if (resolved.kind === 'connector') {
      const objects = this.candidateList().objects;
      const targets = [resolved.from.nodeId, resolved.to.nodeId]
        .map((id) => (id ? objects[id] : undefined))
        .filter((n): n is AnyNode => Boolean(n))
        .map((n) => bodyOutlinePoints(n));
      const run: Point[] = [];
      for (let i = 0; i + 1 < resolved.flat.length; i += 2) run.push({ x: resolved.flat[i], y: resolved.flat[i + 1] });
      const term = this.terminate(run, caps, 'straight', false);
      return {
        ...base,
        run: term.run,
        caps: term.caps,
        placed: [],
        ends: [
          { at: resolved.a, state: 'bound' },
          { at: resolved.b, state: 'bound' },
        ],
        targets,
        reading: { text: 'Connect', at: resolved.b },
      };
    }

    const path = linePoints(resolved.a, resolved.b, profile, useStore.getState().lineWaves, useStore.getState().lineAmplitude);
    const term = this.terminate(path, caps, profile, false);
    const m = measureRun(resolved.a, resolved.b);
    return {
      ...base,
      run: term.run,
      caps: term.caps,
      placed: [],
      ends: [
        { at: resolved.a, state: resolved.aState },
        { at: resolved.b, state: resolved.bState },
      ],
      targets: [],
      reading: m.length > 0 ? { text: formatMeasure(m), at: resolved.b } : null,
    };
  }

  /** Heads placed exactly as the renderer places them. */
  private terminate(points: Point[], caps: { start: EndCapKind; end: EndCapKind }, profile: ShapeGeometry['lineProfile'], run: boolean) {
    const flat = points.flatMap((p) => [p.x, p.y]);
    const result = terminateRun(flat, {
      start: caps.start,
      end: caps.end,
      strokeWidth: NEW_LINE_WIDTH,
      align: run ? 'inside' : defaultEndAlign(profile),
    });
    return { run: result.run, caps: [result.start, result.end] };
  }

  renderOverlay(_ctx: ToolContext, state: any) {
    if (!state?.active || state.kind !== 'line-tool') return null;
    const preview = state as LinePreview;
    const zoom = preview.zoom || 1;
    const dark = ThemeService.isDarkMode();

    const cap = (shape: EndCapShape | null, key: string) => {
      if (!shape) return null;
      if (shape.circle) {
        return (
          <Circle
            key={key}
            x={shape.circle.x}
            y={shape.circle.y}
            radius={shape.circle.radius}
            fill={shape.filled ? preview.stroke : undefined}
            stroke={preview.stroke}
            strokeWidth={preview.width}
            listening={false}
          />
        );
      }
      return (
        <Line
          key={key}
          points={shape.points ?? []}
          closed={shape.filled}
          fill={shape.filled ? preview.stroke : undefined}
          stroke={preview.stroke}
          strokeWidth={preview.width}
          lineCap="round"
          lineJoin="round"
          listening={false}
        />
      );
    };

    return (
      <Group listening={false}>
        {/* The objects about to be joined, by their own silhouettes. */}
        {preview.targets.map((outline, i) => (
          <Line
            key={`target-${i}`}
            points={outline}
            closed
            stroke={CHROME}
            strokeWidth={1.5 / zoom}
            dash={[4 / zoom, 3 / zoom]}
            fill="rgba(59, 130, 246, 0.06)"
            listening={false}
          />
        ))}
        <Line
          points={preview.run}
          stroke={preview.stroke}
          strokeWidth={preview.width}
          lineCap="round"
          lineJoin="round"
          listening={false}
        />
        {preview.caps.map((shape, i) => cap(shape, `cap-${i}`))}
        {/* Placed corners, so it is clear which points are fixed and which one
            is still following the pointer. */}
        {preview.placed.map((p, i) => (
          <Circle
            key={`placed-${i}`}
            x={p.x}
            y={p.y}
            radius={3 / zoom}
            fill="#FFFFFF"
            stroke={CHROME}
            strokeWidth={1.5 / zoom}
            listening={false}
          />
        ))}
        {/* Filled means bound, hollow means flush on an edge: the vocabulary
            the endpoint editors use. Free ends draw nothing. */}
        {preview.ends.map((end, i) =>
          end.state === 'free' ? null : (
            <Circle
              key={`end-${i}`}
              x={end.at.x}
              y={end.at.y}
              radius={4 / zoom}
              fill={end.state === 'bound' ? CHROME : '#FFFFFF'}
              stroke={end.state === 'bound' ? '#FFFFFF' : CHROME}
              strokeWidth={1.5 / zoom}
              listening={false}
            />
          )
        )}
        {preview.reading && !lineReadout.current() && (
          <Label x={preview.reading.at.x + 12 / zoom} y={preview.reading.at.y + 12 / zoom} listening={false}>
            <Tag fill={dark ? '#F4F4F5' : '#18181B'} cornerRadius={4 / zoom} />
            <Text
              text={preview.reading.text}
              fontSize={11 / zoom}
              fontFamily="Inter, system-ui, sans-serif"
              fontStyle="500"
              fill={dark ? '#18181B' : '#FAFAFA'}
              padding={4 / zoom}
            />
          </Label>
        )}
      </Group>
    );
  }

  private pointerOf(ctx: ToolContext, e: any): Point | null {
    const stage = e?.target?.getStage?.();
    const pos = stage?.getPointerPosition?.();
    if (!pos) return null;
    return ctx.camera.screenToWorld(pos.x, pos.y);
  }
}

type Resolved =
  | { kind: 'line'; a: Point; b: Point; aState: PreviewEnd['state']; bState: PreviewEnd['state'] }
  | { kind: 'connector'; from: ConnectorEnd; to: ConnectorEnd; routing: Routing; flat: number[]; a: Point; b: Point };
