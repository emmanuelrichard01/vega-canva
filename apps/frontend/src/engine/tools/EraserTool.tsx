import React from 'react';
import { Circle } from 'react-konva';
import { nanoid } from 'nanoid';
import { getStroke } from 'perfect-freehand';
import type { Tool, ToolContext } from './Tool';
import { doc, deleteNode } from '../document';
import { useStore } from '../../hooks/useStore';

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

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq > 0 ? ((px - ax) * dx + (py - ay) * dy) / lenSq : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
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
   * The eraser's radius in world units, shared across strokes like the
   * pencil's colour and size. `[` and `]` resize it, which is the convention
   * every raster editor has taught. It was a hardcoded 15 with no way to
   * change it, so erasing a hairline and erasing a wall of stickies were the
   * same gesture at the same scale.
   */
  private static get size(): number {
    return useStore.getState().eraserSize;
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
      const step = Math.max(2, EraserTool.size * 0.25);
      useStore.getState().setEraserSize(EraserTool.size + (e.key === ']' ? step : -step));
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
    const radius = EraserTool.size / ctx.camera.zoom;
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

    // Half the radius per step, so consecutive discs overlap and the swept
    // area has no holes in it.
    const steps = Math.max(1, Math.ceil(distance / Math.max(1, radius * 0.5)));
    /**
     * The whole sweep in one transaction — splits included.
     *
     * Erasing across a pen stroke *rewrites* it rather than deleting it, so a
     * gesture can produce a mix of deletions and geometry edits. Batching only
     * the deletions would still leave every split as its own document change,
     * which is the same undo problem one level down.
     */
    doc.transact(() => {
      for (let i = 1; i <= steps; i += 1) {
        const t = i / steps;
        this.eraseAt(ctx, fromX + dx * t, fromY + dy * t, radius);
      }
      this.pending.forEach((id) => deleteNode(id));
      this.pending = new Set();
    });

    this.lastX = this.currentX;
    this.lastY = this.currentY;
  }

  private eraseAtPointer(ctx: ToolContext) {
    this.pending = new Set();
    doc.transact(() => {
      this.eraseAt(ctx, this.currentX, this.currentY, EraserTool.size / ctx.camera.zoom);
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

  private eraseAt(ctx: ToolContext, cx: number, cy: number, eraserRadius: number) {
    /**
     * Read from the store, not from the CRDT.
     *
     * This walked `objectsMap.entries()` and called `toJSON()` on every object
     * — for every *step* of the sweep. A fast swipe is twenty or more steps, so
     * on a five-hundred-object board one pointer move deserialized ten thousand
     * nodes. The store already holds every node normalized and cached; reading
     * it is a property access.
     */
    const objects = useStore.getState().objects;
    Object.entries(objects).forEach(([id, node]) => {
      const obj = node as any;
      if (obj.locked || obj.hidden) return;
      // Already condemned by an earlier step of this same sweep.
      if (this.pending.has(id)) return;

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

  /** Precise-enough hit test per object kind, instead of always testing the raw bounding box (which erased empty corners of e.g. a circle or a sticky far from its visible content). Returns true if the object should be deleted whole. */
  private hitsObject(obj: any, cx: number, cy: number, radius: number): boolean {
    const w = obj.width;
    const h = obj.height;

    if (obj.type === 'shape' && (obj.geometry?.kind === 'ellipse')) {
      const rx = w / 2, ry = h / 2;
      const centerX = obj.x + rx, centerY = obj.y + ry;
      // Normalized-radius test approximates an ellipse well enough for an eraser cursor.
      const nx = (cx - centerX) / (rx + radius);
      const ny = (cy - centerY) / (ry + radius);
      return nx * nx + ny * ny <= 1;
    }

    const left = obj.x, right = obj.x + w, top = obj.y, bottom = obj.y + h;
    return cx >= left - radius && cx <= right + radius && cy >= top - radius && cy <= bottom + radius;
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

    // Freehand stroke — erase at centerline-point granularity.
    if (obj.geometry?.kind === 'freehand' && obj.geometry.points.length > 0) {
      const absPoints = obj.geometry.points.map((p: any) => ({ x: obj.x + p.x, y: obj.y + p.y }));
      const hitSet = new Set<number>();
      absPoints.forEach((p: any, i: number) => {
        if (Math.hypot(p.x - cx, p.y - cy) <= radius) hitSet.add(i);
      });
      // Consecutive mouse samples can be sparse relative to the eraser radius
      // — also test along each segment, marking both endpoints when hit.
      for (let i = 0; i < absPoints.length - 1; i++) {
        const a = absPoints[i], b = absPoints[i + 1];
        if (distanceToSegment(cx, cy, a.x, a.y, b.x, b.y) <= radius) {
          hitSet.add(i);
          hitSet.add(i + 1);
        }
      }
      if (hitSet.size === 0) return true;

      const runs = splitRuns(absPoints.length, hitSet);
      deleteNode(id);
      runs.forEach(run => {
        if (run.length < 2) return;
        const pts = run.map(i => absPoints[i]);
        this.createFreehandSubPath(ctx, obj, pts);
      });
      return true;
    }

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
    const stroke = getStroke(relPoints.map(p => [p.x, p.y]), {
      size, thinning: 0.5, smoothing: 0.5, streamline: 0.5,
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
      const radius = (overlayState.size ?? EraserTool.size) / overlayState.zoom;
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
