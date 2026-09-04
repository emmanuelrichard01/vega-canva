import React from 'react';
import { Circle } from 'react-konva';
import { nanoid } from 'nanoid';
import { getStroke } from 'perfect-freehand';
import type { Tool, ToolContext } from './Tool';
import { doc, deleteNode } from '../document';
import { useStore } from '../../hooks/useStore';
import { clipPolylineByCapsule, erasesObject } from './eraseHit';

function svgPathFromStroke(stroke: number[][]) {
  if (!stroke.length) return '';
  const d = stroke.reduce(
    (acc: any[], [x0, y0]: number[], i: number, arr: number[][]) => {
      const [x1, y1] = arr[(i + 1) % arr.length];
      acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
      return acc;
    },
    ['M', ...stroke[0], 'Q']
  );
  d.push('Z');
  return d.join(' ');
}

function flattenCubic(p0: any, c1: any, c2: any, p1: any, steps = 8) {
  const pts: { x: number; y: number }[] = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, mt = 1 - t;
    pts.push({
      x: mt * mt * mt * p0.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t * t * t * p1.x,
      y: mt * mt * mt * p0.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t * t * t * p1.y,
    });
  }
  return pts;
}

/** Runs of consecutive indices NOT in `hitSet`, e.g. hits={2,3} over 6 points -> [[0,1],[4,5]]. */
function splitRuns(count: number, hitSet: Set<number>): number[][] {
  const runs: number[][] = [];
  let current: number[] = [];
  for (let i = 0; i < count; i++) {
    if (hitSet.has(i)) {
      if (current.length) runs.push(current);
      current = [];
    } else {
      current.push(i);
    }
  }
  if (current.length) runs.push(current);
  return runs;
}

export class EraserTool implements Tool {
  id = 'eraser';
  cursor = 'none';

  /**
   * The eraser's tip **width** in screen pixels, shared across strokes like
   * the pencil's colour and size. `[` and `]` resize it, which is the
   * convention every raster editor has taught. It was a hardcoded 15 with no
   * way to change it, so erasing a hairline and erasing a wall of stickies
   * were the same gesture at the same scale.
   *
   * ## Width, not radius
   *
   * This number was read as a *radius* everywhere it was used, while the
   * control that sets it is the same `NibSize` the pencil uses — where the
   * number is a stroke **width**. So the eraser drew and erased at twice the
   * size it reported: a slider reading 15 wiped a 30px hole, against the
   * pencil's 6px line at 6. The range compounded it, since 4-200 as a radius
   * is an 8-400 tip, and most of that travel was unusable.
   *
   * The conversion now happens in exactly one place -- `radiusFor` -- because
   * the previous arrangement had the division scattered across three call
   * sites and the overlay, which is how the ring and the erase come to
   * disagree about what the tool is about to remove.
   */
  private static get size(): number {
    return useStore.getState().eraserSize;
  }

  /**
   * The tip in world units: half the width, undone by the zoom.
   *
   * Screen-space is the right frame for a *tool* tip -- the eraser should feel
   * the same size under the hand whether the board is at 10% or 400%, which is
   * how every raster editor behaves and the opposite of how an object behaves.
   */
  private static radiusFor(zoom: number): number {
    return EraserTool.size / 2 / zoom;
  }

  private isErasing = false;
  private currentX = 0;
  private currentY = 0;
  /** Where the previous sample landed, so the gap between them is swept. */
  private lastX: number | null = null;
  private lastY: number | null = null;

  onPointerDown(ctx: ToolContext, e: any) {
    if (!this.updatePos(ctx, e)) return;
    this.isErasing = true;
    this.lastX = this.currentX;
    this.lastY = this.currentY;
    this.eraseAtPointer(ctx);
  }

  onPointerMove(ctx: ToolContext, e: any) {
    if (!this.updatePos(ctx, e)) return;
    if (!this.isErasing) return;
    this.eraseSweep(ctx);
  }

  onPointerUp() {
    this.isErasing = false;
    this.lastX = null;
    this.lastY = null;
  }

  onKeyDown(ctx: ToolContext, e: KeyboardEvent) {
    // `[` and `]` resize, as in every raster editor.
    if (e.key === '[' || e.key === ']') {
      /**
       * Geometric, not additive.
       *
       * A flat 25% of the current size floored at 2 was coarse at both ends
       * for opposite reasons: near the minimum the floor dominated and each
       * press was a ~50% jump, and near the maximum a press moved 50px. Going
       * up and down by the same *ratio* makes every press feel like the same
       * adjustment, and makes `[` exactly undo `]`.
       */
      const next = EraserTool.size * (e.key === ']' ? 1.25 : 1 / 1.25);
      // Rounded away from the current value, so the smallest sizes -- where a
      // ratio step lands inside a single pixel -- still move on every press.
      const stepped = e.key === ']' ? Math.ceil(next) : Math.floor(next);
      useStore.getState().setEraserSize(stepped);
      // Repaint the ring at its new size without waiting for a mouse move.
      ctx.setOverlayState?.({
        type: 'eraser',
        x: this.currentX,
        y: this.currentY,
        zoom: ctx.camera.zoom,
        size: EraserTool.size,
      });
    }
  }

  onDeactivate(ctx: ToolContext) {
    // A tool switch triggered by a keyboard shortcut mid-drag never fires
    // onPointerUp (that only happens on mouseup), so isErasing could stay
    // stuck true and the cursor-replacement overlay circle stuck on screen
    // — same class of bug as PenTool's mid-stroke tool switch.
    this.isErasing = false;
    ctx.setOverlayState?.(null);
  }

  /** Returns false (leaving currentX/Y untouched) if the pointer isn't over the stage. */
  private updatePos(ctx: ToolContext, e: any): boolean {
    const stage = e.target.getStage();
    const pos = stage?.getPointerPosition();
    if (!pos) return false;

    this.currentX = (pos.x - ctx.camera.x) / ctx.camera.zoom;
    this.currentY = (pos.y - ctx.camera.y) / ctx.camera.zoom;

    ctx.setOverlayState?.({
      type: 'eraser',
      x: this.currentX,
      y: this.currentY,
      zoom: ctx.camera.zoom,
      size: EraserTool.size,
    });
    return true;
  }

  /**
   * Erase along the whole path travelled since the last sample, not just at
   * the point it ended on.
   *
   * Pointer events arrive at whatever rate the device and the frame budget
   * allow, and a quick swipe can jump a hundred world units between two of
   * them. Testing only the endpoints meant anything lying *between* two
   * samples survived — so erasing fast left a dotted trail of untouched
   * objects, and the fix people reach for is to go over it again slowly,
   * which is the tool telling you to work around it.
   */
  private eraseSweep(ctx: ToolContext) {
    const radius = EraserTool.radiusFor(ctx.camera.zoom);
    // One transaction for the whole sweep. Each `deleteNode` used to be its
    // own, so a single swipe across a dozen objects landed as a dozen document
    // changes — twelve undo presses to put back one gesture, twelve entries in
    // the activity feed, and twelve updates broadcast to the room.
    this.pending = new Set();
    const fromX = this.lastX ?? this.currentX;
    const fromY = this.lastY ?? this.currentY;
    const dx = this.currentX - fromX;
    const dy = this.currentY - fromY;
    const distance = Math.hypot(dx, dy);

    /**
     * How many discs the *whole-object* tests need along the travel.
     *
     * Freehand strokes are no longer tested this way at all -- they are cut
     * against the swept capsule in one pass, below -- but `erasesObject` still
     * asks "does the nib touch this shape", and that question is asked at
     * points. Spacing them by the radius keeps consecutive discs touching, and
     * the cap is what stops the cost from being unbounded: at a 2-unit radius
     * a 300-unit swipe used to ask for 300 passes, each a scan of every object
     * on the board, and the canvas stopped responding.
     *
     * A cap would ordinarily trade that freeze for a dotted trail. It does not
     * here, because the objects it now governs are deleted whole: missing a
     * shape by a few units means the next pointer move catches it, not that it
     * comes back cut into pieces.
     */
    const steps = Math.min(16, Math.max(1, Math.ceil(distance / Math.max(1, radius))));
    /**
     * The whole sweep in one transaction — splits included.
     *
     * Erasing across a pen stroke *rewrites* it rather than deleting it, so a
     * gesture can produce a mix of deletions and geometry edits. Batching only
     * the deletions would still leave every split as its own document change,
     * which is the same undo problem one level down.
     */
    doc.transact(() => {
      /**
       * The board is scanned once for the whole sweep, not once per step.
       *
       * `eraseAt` walks every object, and calling it per step meant a fast
       * swipe with a small nib walked the whole document hundreds of times for
       * a single pointer move. The candidates are the objects whose bounds
       * come within `radius` of the travelled segment, which is a cheap test
       * and throws away nearly everything on a real board.
       */
      const candidates = this.candidatesNear(fromX, fromY, radius);

      // Strokes are cut against the capsule the nib swept -- one exact pass,
      // whatever the speed or the size.
      for (const [id, obj] of candidates) {
        this.eraseFreehand(ctx, id, obj, fromX, fromY, this.currentX, this.currentY, radius);
      }

      for (let i = 1; i <= steps; i += 1) {
        const t = i / steps;
        this.eraseAt(ctx, fromX + dx * t, fromY + dy * t, radius, candidates);
      }
      this.pending.forEach((id) => deleteNode(id));
      this.pending = new Set();
    });

    this.lastX = this.currentX;
    this.lastY = this.currentY;
  }

  /**
   * A press with no travel yet: the capsule is a single disc.
   *
   * `capsuleSpan` handles a zero-length sweep as its two end discs, which are
   * the same disc — so the press and the drag go through one code path and
   * cannot disagree about what the nib covers.
   */
  private eraseAtPointer(ctx: ToolContext) {
    this.pending = new Set();
    const radius = EraserTool.radiusFor(ctx.camera.zoom);
    doc.transact(() => {
      const candidates = this.candidatesNear(this.currentX, this.currentY, radius);
      for (const [id, obj] of candidates) {
        this.eraseFreehand(
          ctx, id, obj, this.currentX, this.currentY, this.currentX, this.currentY, radius
        );
      }
      this.eraseAt(ctx, this.currentX, this.currentY, radius, candidates);
      this.pending.forEach((id) => deleteNode(id));
      this.pending = new Set();
    });
  }

  /**
   * Ids gathered during one sweep, deleted together.
   *
   * A `Set`, because the sweep steps overlap by design — consecutive discs
   * share area so the swept region has no holes — and the same object is
   * therefore found several times in one gesture.
   */
  private pending: Set<string> = new Set();

  /**
   * The objects a sweep could possibly touch, gathered once.
   *
   * Bounds-only and deliberately generous: this decides what is *worth*
   * testing, and the precise answer comes from `erasesObject` afterwards. The
   * box is the segment travelled, inflated by the nib and by a margin for
   * strokes whose ink reaches past their stored box.
   */
  private candidatesNear(fromX: number, fromY: number, radius: number): Array<[string, any]> {
    const pad = radius + 32;
    const left = Math.min(fromX, this.currentX) - pad;
    const right = Math.max(fromX, this.currentX) + pad;
    const top = Math.min(fromY, this.currentY) - pad;
    const bottom = Math.max(fromY, this.currentY) + pad;

    const objects = useStore.getState().objects;
    const out: Array<[string, any]> = [];
    for (const [id, node] of Object.entries(objects)) {
      const obj = node as any;
      if (obj.locked || obj.hidden) continue;
      if (
        obj.x + obj.width < left ||
        obj.x > right ||
        obj.y + obj.height < top ||
        obj.y > bottom
      ) {
        continue;
      }
      out.push([id, obj]);
    }
    return out;
  }

  /**
   * Cut one freehand stroke against the capsule the nib swept.
   *
   * The gap is the nib's own width, computed rather than snapped to samples.
   * This used to mark both endpoints of any segment the disc came near and
   * delete them, so the hole was the *sample spacing* -- twenty or more world
   * units on a fast stroke -- regardless of the size the tool was set to.
   */
  private eraseFreehand(
    ctx: ToolContext,
    id: string,
    obj: any,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    radius: number
  ): void {
    if (obj.geometry?.kind !== 'freehand' || !obj.geometry.points?.length) return;
    if (this.pending.has(id)) return;

    const absPoints = obj.geometry.points.map((p: any) => ({ x: obj.x + p.x, y: obj.y + p.y }));
    const runs = clipPolylineByCapsule(
      absPoints,
      { x: fromX, y: fromY },
      { x: toX, y: toY },
      radius
    );

    // Untouched: nothing to rewrite, and no reason to churn the document.
    if (runs.length === 1 && runs[0].length === absPoints.length) return;
    if (runs.length === 0) {
      this.pending.add(id);
      return;
    }

    deleteNode(id);
    runs.forEach((run) => this.createFreehandSubPath(ctx, obj, run));
  }

  private eraseAt(
    ctx: ToolContext,
    cx: number,
    cy: number,
    eraserRadius: number,
    candidates?: Array<[string, any]>
  ) {
    /**
     * Read from the store, not from the CRDT.
     *
     * This walked `objectsMap.entries()` and called `toJSON()` on every object
     * — for every *step* of the sweep. A fast swipe is twenty or more steps, so
     * on a five-hundred-object board one pointer move deserialized ten thousand
     * nodes. The store already holds every node normalized and cached; reading
     * it is a property access.
     */
    const entries =
      candidates ?? this.candidatesNear(this.currentX, this.currentY, eraserRadius);
    entries.forEach(([id, node]) => {
      const obj = node as any;
      if (obj.locked || obj.hidden) return;
      // Already condemned by an earlier step of this same sweep.
      if (this.pending.has(id)) return;
      // Handled in one exact pass by `eraseFreehand`, before any of the
      // stepping -- testing it again here would cut it twice.
      if (obj.geometry?.kind === 'freehand') return;

      if (obj.type === 'path') {
        if (this.erasePath(ctx, id, obj, cx, cy, eraserRadius)) return;
        // Legacy path data with neither `points` nor `segments` (old
        // documents) falls through to the precise-shape / bbox check below,
        // same as any other object.
      }

      if (this.hitsObject(obj, cx, cy, eraserRadius)) {
        this.pending.add(id);
      }
    });
  }

  /**
   * Whether the disc touches this object's ink.
   *
   * Moved to `eraseHit` and tested there. It was an ellipse special case and,
   * for everything else, the raw axis-aligned bounding box — so a rotated
   * object's empty corners, an unfilled rectangle's empty middle, the two
   * triangles either side of a diagonal line, and *the entire interior of a
   * frame* were all live targets. The last of those deleted the frame and
   * every child in it, from a stroke aimed at something inside.
   *
   * "Which objects did that gesture delete" is invisible to types and to every
   * other test here, and it is destructive, which is why it is twenty
   * assertions in a module rather than a method nobody can check.
   */
  private hitsObject(obj: any, cx: number, cy: number, radius: number): boolean {
    return erasesObject(obj, cx, cy, radius);
  }

  /** Returns true if this was a 'path' object it knew how to precisely erase (and handled deletion/splitting itself). */
  private erasePath(ctx: ToolContext, id: string, obj: any, cx: number, cy: number, radius: number): boolean {
    // Bezier/anchor path from the Pen tool — erase at anchor granularity.
    if (obj.geometry?.kind === 'bezier' && obj.geometry.segments.length > 0) {
      const absPoints = obj.geometry.segments.map((s: any) => ({ x: obj.x + s.x, y: obj.y + s.y }));
      const hitSet = new Set<number>();
      absPoints.forEach((p: any, i: number) => {
        if (Math.hypot(p.x - cx, p.y - cy) <= radius) hitSet.add(i);
      });
      // Anchors can be far apart on a long curve — also test along the
      // flattened curve itself, otherwise erasing the middle of a segment
      // (far from either endpoint) would silently do nothing.
      for (let i = 1; i < absPoints.length; i++) {
        const seg = obj.geometry.segments[i];
        const p0 = absPoints[i - 1], p1 = absPoints[i];
        const c1 = { x: obj.x + seg.cp1x, y: obj.y + seg.cp1y };
        const c2 = { x: obj.x + seg.cp2x, y: obj.y + seg.cp2y };
        if (flattenCubic(p0, c1, c2, p1).some(fp => Math.hypot(fp.x - cx, fp.y - cy) <= radius)) {
          hitSet.add(i - 1);
          hitSet.add(i);
        }
      }
      // Known gap: for a *closed* path, the wrap-around edge from the last
      // anchor back to the first (drawn as a plain SVG "Z", not a stored
      // curve — see BezierPenTool/ObjectRenderer) isn't tested here, so
      // erasing precisely on that edge, away from either endpoint anchor,
      // does nothing. Fixing it means detecting a hit with no anchor
      // removed and reopening the loop rather than splitting it, which is a
      // different code path from the anchor-removal one below — left alone
      // rather than risk getting that subtly wrong.
      if (hitSet.size === 0) return true; // it's a path, just not hit — skip the generic delete-whole-object fallback

      const runs = splitRuns(absPoints.length, hitSet);
      deleteNode(id);
      runs.forEach(run => {
        if (run.length < 2) return;
        const pts = run.map(i => absPoints[i]);
        this.createSubPath(ctx, obj, pts);
      });
      return true;
    }

    /*
      Freehand is not handled here.

      It is cut against the whole capsule the nib swept, once per pointer move,
      in `eraseFreehand`. Doing it here as well would cut the same stroke a
      second time at each stepped disc — the work this rewrite exists to stop.
    */

    return false;
  }

  private createSubPath(ctx: ToolContext, original: any, absAnchors: { x: number; y: number }[]) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of absAnchors) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    const segments = absAnchors.map((p, i) => {
      if (i === 0) return { x: p.x - minX, y: p.y - minY };
      const prev = absAnchors[i - 1];
      // Cutting a curve at an anchor granularity straightens that particular
      // joint (the original control points belonged to the removed anchor);
      // still correct where the cut wasn't made, and avoids re-deriving
      // curve handles from a path that's being severed anyway.
      return {
        x: p.x - minX, y: p.y - minY,
        cp1x: prev.x - minX, cp1y: prev.y - minY,
        cp2x: p.x - minX, cp2y: p.y - minY,
      };
    });

    ctx.editor.createNode({
      ...original,
      id: nanoid(),
      x: minX, y: minY,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY),
      geometry: { kind: 'bezier', segments, closed: false },
    });
  }

  private createFreehandSubPath(ctx: ToolContext, original: any, absPoints: { x: number; y: number }[]) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of absPoints) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    const size = original.geometry?.strokeSize || 6;
    const pad = size;
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;

    const relPoints = absPoints.map(p => ({ x: p.x - minX, y: p.y - minY }));
    /**
     * Re-stroked without smoothing it a second time.
     *
     * This was `smoothing: 0.5, streamline: 0.5`, which is the filter the
     * *pencil* applies to raw pointer samples — and these points are not raw.
     * They are the stored centreline, already streamlined at whatever the tool
     * was set to and then simplified again by Douglas–Peucker before being
     * written. Running the filter over them once more rounds a line that was
     * already rounded, so the two halves of an erased stroke came back visibly
     * softer than the stroke they were cut from.
     *
     * `streamline: 0` keeps every stored point where it is; the small
     * `smoothing` is only what turns a polyline into a curve through them.
     * Thinning is off because the centreline carries no pressure — inventing a
     * taper here would put one where the original had none.
     */
    const stroke = getStroke(relPoints.map(p => [p.x, p.y]), {
      size, thinning: 0, smoothing: 0.2, streamline: 0, simulatePressure: false, last: true,
    });

    ctx.editor.createNode({
      ...original,
      id: nanoid(),
      x: minX, y: minY,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY),
      geometry: { kind: 'freehand', svgPath: svgPathFromStroke(stroke), points: relPoints, strokeSize: size },
    });
  }

  renderOverlay(ctx: ToolContext, overlayState: any) {
    if (overlayState?.type === 'eraser') {
      // The ring is the promise the eraser makes about what it will remove,
      // so it has to be the same number the erase uses — it was a second
      // hardcoded 15, which would have silently started lying the moment the
      // size became adjustable.
      const radius = (overlayState.size ?? EraserTool.size) / 2 / overlayState.zoom;
      return (
        <Circle
          x={overlayState.x}
          y={overlayState.y}
          radius={radius}
          fill="rgba(239, 68, 68, 0.2)"
          stroke="#EF4444"
          strokeWidth={2 / overlayState.zoom}
          listening={false}
        />
      );
    }
    return null;
  }
}
