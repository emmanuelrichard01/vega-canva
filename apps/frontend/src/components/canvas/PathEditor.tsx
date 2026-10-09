import React, { useSyncExternalStore } from 'react';
import type Konva from 'konva';
import { Group, Shape } from 'react-konva';
import { deleteNode, undoManager, updateNode } from '../../engine/document';
import { useStore } from '../../hooks/useStore';
import { pathEdit } from '../../engine/interaction/pathEdit';
import { EXPORT_CHROME } from '../../engine/export/chrome';
import {
  contourData,
  curvatureAt,
  insertAnchor,
  reframePath,
  subpathsOf,
  type ContourGeometry,
} from '../../engine/model/pathGeometry';
import {
  anchorKey,
  constrainDeltaToAxis,
  constrainHandleToAngle,
  dragHandle,
  mergeAnchors,
  setAnchorAlignment,
  setAnchorsMode,
  toggleAnchor,
  type AnchorRef,
} from '../../engine/model/pathEditing';
import { anchorsInBox, contourMates, type AnchorIndex } from '../../engine/model/anchorIndex';
import {
  rotationAbout,
  rotationFromDrag,
  scaleFromHandle,
  transformAnchors,
  translation,
  handlePoint,
  BOX_HANDLES,
  type Box,
  type BoxHandle,
} from '../../engine/model/pointTransform';
import {
  ANCHOR_PX,
  KNOB_PX,
  anchorDrawPlan,
  hitPathEditor,
  paddedBox,
  viewOf,
  type PathEditHit,
  type PathEditView,
} from '../../engine/interaction/pathEditView';
import { bendSegment } from '../../engine/model/pathBend';
import { reboxedPosition } from '../../engine/model/rebox';
import { claimCursor } from '../../engine/cursor/cursorOverride';
import { cursorCss } from '../../engine/cursor/cursorCss';
import { penVisual } from '../../engine/cursor/cursorVisual';
import { hud } from '../../engine/ui/hud';
import type { AnyNode, PathNode } from '../../engine/model/schema';

/** The HUD channel the path editor writes to: one readout, never one per point. */
const PATH_HUD = 'path';
const CURSOR_KEY = 'path-editor';

/** The selection blue the object transformer uses, so editing points reads as the same kind of selection. */
const SELECT = '#3B82F6';
const MARQUEE_FILL = 'rgba(59, 130, 246, 0.08)';
/** Pointer travel, in screen px, before a press counts as a drag rather than a click. */
const DRAG_SLOP = 3;
/** Beyond this many anchors, hovering does not hunt for the outline under the pointer. */
const HOVER_SEGMENT_LIMIT = 3000;

interface Props {
  /** Stage zoom. Sizes are taken from the live transform; this keeps the overlay in step with zoom renders. */
  stageScale: number;
}

interface Live {
  node: PathNode | null;
  /** What the document holds, as a view for the current selection. */
  base: PathEditView | null;
  /** What a drag in progress shows instead of `base`. */
  working: PathEditView | null;
  hover: PathEditHit | null;
  /** The marquee in progress, in geometry units, and the anchors it currently covers. */
  marquee: Box | null;
  marqueeHits: Set<number> | null;
  /** Whether the last draw found the anchors too dense to show one by one. */
  dense: boolean;
}

/** `Konva.Context` wraps the 2D context; the editor draws on the real one in screen space. */
const raw = (ctx: Konva.Context) => (ctx as unknown as { _context: CanvasRenderingContext2D })._context;

/** Geometry units per CSS pixel under this node's full transform. */
function unitsPerPx(shape: Konva.Node): number {
  const m = shape.getAbsoluteTransform().getMatrix();
  const s = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
  return s > 1e-9 ? 1 / s : 1;
}

/** Per index, whether each anchor is smooth (drawn round) or a corner (drawn square). */
const smoothCache = new WeakMap<AnchorIndex, Uint8Array>();
function smoothFlags(index: AnchorIndex): Uint8Array {
  const hit = smoothCache.get(index);
  if (hit) return hit;
  const out = new Uint8Array(index.count);
  for (let i = 0; i < index.count; i++) {
    const a = index.anchors[i];
    if (a.inX === undefined || a.inY === undefined || a.outX === undefined || a.outY === undefined) continue;
    const ix = a.inX - a.x;
    const iy = a.inY - a.y;
    const ox = a.outX - a.x;
    const oy = a.outY - a.y;
    const li = Math.hypot(ix, iy);
    const lo = Math.hypot(ox, oy);
    if (li < 1e-6 || lo < 1e-6) continue;
    const cross = (ix * oy - iy * ox) / (li * lo);
    const dot = (ix * ox + iy * oy) / (li * lo);
    if (Math.abs(cross) < 0.02 && dot < 0) out[i] = 1;
  }
  smoothCache.set(index, out);
  return out;
}

/** Write an edited geometry back as one step, keeping a turned node where it was on screen. */
function commitGeometry(node: AnyNode, next: ContourGeometry | null): void {
  if (!next) {
    deleteNode(node.id);
    pathEdit.exit();
    return;
  }
  const framed = reframePath(next);
  const at = reboxedPosition(node, framed);
  undoManager.stopCapturing();
  updateNode(node.id, {
    geometry: framed.geometry,
    x: at.x,
    y: at.y,
    width: framed.width,
    height: framed.height,
  });
  undoManager.stopCapturing();
}

const BOX_CURSOR: Record<BoxHandle, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
};

function cursorFor(hit: PathEditHit | null): string | null {
  switch (hit?.kind) {
    case 'anchor':
      return 'default';
    case 'handle':
      return 'grab';
    case 'scale':
      return BOX_CURSOR[hit.handle];
    case 'rotate':
      return 'alias';
    case 'segment':
      return cursorCss(penVisual('add'), 'copy');
    case 'body':
      return 'move';
    default:
      return null;
  }
}

/**
 * Direct selection: reshaping part of a path rather than all of it.
 *
 * ## One node, one pass
 *
 * Every anchor, handle, the outline, the point-selection box and the marquee
 * are drawn by a single Konva `Shape` in one `sceneFunc`, in screen space so
 * every mark is crisp and the same size at any zoom or node rotation. Picking
 * is arithmetic against a spatial index (`anchorIndex`), not a hit canvas per
 * anchor. Hover and drags update a ref and redraw the layer; React renders
 * only when the document or the picked set changes. Outlined text with two
 * thousand anchors costs what a rectangle does.
 *
 * ## What is drawn
 *
 * - Anchors: squares for corners, circles for smooth points, filled when
 *   picked. Where they crowd closer than a few pixels on screen they are
 *   drawn once per cell and shrink to dots, and the HUD says to zoom in.
 * - Handles: only for picked anchors and their neighbours (Illustrator's
 *   rule), and not at all past `HANDLE_CAP` picked points.
 * - With two or more points picked, a box around them: drag inside to move,
 *   pull a handle to scale (Shift keeps proportions, Alt scales from the
 *   centre), press just outside a corner to rotate (Shift snaps to 15°).
 * - One HUD readout for the gesture in progress.
 *
 * ## Gestures
 *
 * Click an anchor to pick it; Shift or Cmd/Ctrl to add or remove; drag to move
 * the picked set (Shift locks the axis). Drag on empty space to marquee
 * (Shift adds). Click the outline to add a point, drag it to bend the curve.
 * Double-click an anchor to switch corner and smooth (Alt-click does the
 * same); double-click the outline to pick its whole contour; double-click
 * empty space to finish. 1, 2, 3 set symmetric, smooth, disconnected handles.
 * Arrows nudge, Delete removes and heals, Enter or Escape finishes.
 *
 * The drag preview is applied to the path's own Konva node and the document
 * is written once, on release, so a gesture is one undo step and peers are
 * not sent sixty geometries a second.
 */
export const PathEditor: React.FC<Props> = ({ stageScale }) => {
  const selection = useSyncExternalStore(pathEdit.subscribe, pathEdit.getSnapshot, pathEdit.getSnapshot);
  const node = useStore((s) => (selection ? s.objects[selection.nodeId] : undefined));
  const shapeRef = React.useRef<Konva.Shape>(null);
  const live = React.useRef<Live>({
    node: null,
    base: null,
    working: null,
    hover: null,
    marquee: null,
    marqueeHits: null,
    dense: false,
  });
  /** Ends the live session: `true` cancels it and puts the path back. */
  const endSession = React.useRef<((cancel: boolean) => void) | null>(null);

  const editable = node && node.type === 'path' && node.geometry.kind !== 'freehand' ? (node as PathNode) : null;
  const geometry = editable ? (editable.geometry as ContourGeometry) : null;
  const anchors = selection?.anchors;

  const base = React.useMemo(
    () => (geometry && anchors ? viewOf(geometry, anchors) : null),
    [geometry, anchors]
  );
  live.current.node = editable;
  live.current.base = base;

  const redraw = React.useCallback(() => shapeRef.current?.getLayer()?.batchDraw(), []);

  // Leaving the editor mid-drag cancels the drag rather than committing it on the next release.
  React.useEffect(() => {
    if (!selection) endSession.current?.(true);
  }, [selection]);
  React.useEffect(
    () => () => {
      endSession.current?.(true);
      hud.hide(PATH_HUD);
      claimCursor(CURSOR_KEY, null);
    },
    []
  );

  /** The "zoom in" hint, raised after a draw finds the anchors too crowded to pick one by one. */
  const syncDenseHint = React.useCallback(() => {
    const L = live.current;
    const n = L.node;
    if (!n || !L.dense || endSession.current) {
      if (!endSession.current) hud.hide(PATH_HUD);
      return;
    }
    hud.show({
      source: PATH_HUD,
      kind: 'label',
      value: 'Zoom in to edit points one by one',
      at: { x: n.x + n.width / 2, y: n.y + n.height },
      box: { x: n.x, y: n.y, width: n.width, height: n.height },
      placement: 'below',
    });
  }, []);

  /**
   * 1 = symmetric, 2 = smooth, 3 = disconnected, on the picked anchors.
   */
  React.useEffect(() => {
    if (!editable || !geometry || !anchors || anchors.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const map: Record<string, 'symmetric' | 'smooth' | 'disconnected'> = {
        '1': 'symmetric',
        '2': 'smooth',
        '3': 'disconnected',
      };
      const alignment = map[e.key];
      if (!alignment) return;
      e.preventDefault();
      e.stopPropagation();
      commitGeometry(editable, setAnchorAlignment(geometry, anchors, alignment));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editable, geometry, anchors]);

  // Redraw when the zoom or the view changes; the Shape's props do not carry the view.
  React.useEffect(() => {
    redraw();
    queueMicrotask(syncDenseHint);
  }, [base, stageScale, redraw, syncDenseHint]);

  // ---------------------------------------------------------------------------
  // Drawing
  // ---------------------------------------------------------------------------

  const sceneFunc = React.useCallback((ctx: Konva.Context, shape: Konva.Shape) => {
    const L = live.current;
    const view = L.working ?? L.base;
    if (!view) return;
    const c = raw(ctx);
    const m = shape.getAbsoluteTransform().getMatrix();
    const canvas = (ctx as unknown as { canvas?: { getPixelRatio?: () => number } }).canvas;
    const pr = canvas?.getPixelRatio?.() ?? 1;
    const sx = (x: number, y: number) => m[0] * x + m[2] * y + m[4];
    const sy = (x: number, y: number) => m[1] * x + m[3] * y + m[5];
    const { index } = view;

    c.save();
    c.setTransform(pr, 0, 0, pr, 0, 0);
    c.lineJoin = 'round';

    // The outline, one path for every contour.
    c.beginPath();
    for (const sub of subpathsOf(view.geometry)) {
      const segs = sub.segments;
      if (segs.length === 0) continue;
      c.moveTo(sx(segs[0].x, segs[0].y), sy(segs[0].x, segs[0].y));
      const curve = (from: (typeof segs)[number], to: (typeof segs)[number]) => {
        const c1x = to.cp1x ?? from.x;
        const c1y = to.cp1y ?? from.y;
        const c2x = to.cp2x ?? to.x;
        const c2y = to.cp2y ?? to.y;
        c.bezierCurveTo(sx(c1x, c1y), sy(c1x, c1y), sx(c2x, c2y), sy(c2x, c2y), sx(to.x, to.y), sy(to.x, to.y));
      };
      for (let i = 1; i < segs.length; i++) curve(segs[i - 1], segs[i]);
      if (sub.closed && segs.length > 1) {
        curve(segs[segs.length - 1], segs[0]);
        c.closePath();
      }
    }
    c.strokeStyle = SELECT;
    c.lineWidth = 1;
    c.stroke();

    // The osculating circle at a single picked anchor: how hard the curve
    // bends there, which a handle alone does not show. One only, faint.
    if (view.picked.size === 1 && !L.working) {
      const [only] = view.picked;
      const sub = subpathsOf(view.geometry)[index.subs[only]];
      const k = sub ? curvatureAt(sub, index.idx[only]) : null;
      if (k && k.radius < 4000) {
        const r = k.radius / unitsPerPx(shape);
        if (r > 6 && r < 4000) {
          c.beginPath();
          c.arc(sx(k.cx, k.cy), sy(k.cx, k.cy), r, 0, Math.PI * 2);
          c.setLineDash([4, 4]);
          c.strokeStyle = 'rgba(99, 102, 241, 0.45)';
          c.stroke();
          c.setLineDash([]);
        }
      }
    }

    // Screen positions, once.
    const n = index.count;
    const px = new Float64Array(n);
    const py = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      px[i] = sx(index.xs[i], index.ys[i]);
      py[i] = sy(index.xs[i], index.ys[i]);
    }

    // The point-selection box, under the anchors it surrounds.
    if (view.box && L.marquee === null) {
      const b = paddedBox(view.box, unitsPerPx(shape));
      const corners = [
        [b.x, b.y],
        [b.x + b.width, b.y],
        [b.x + b.width, b.y + b.height],
        [b.x, b.y + b.height],
      ];
      c.beginPath();
      corners.forEach(([x, y], i) => (i === 0 ? c.moveTo(sx(x, y), sy(x, y)) : c.lineTo(sx(x, y), sy(x, y))));
      c.closePath();
      c.strokeStyle = SELECT;
      c.lineWidth = 1;
      c.stroke();
      if (!L.working) {
        c.beginPath();
        const h = 3.5;
        for (const handle of BOX_HANDLES) {
          const p = handlePoint(b, handle);
          c.rect(Math.round(sx(p.x, p.y) - h) + 0.5, Math.round(sy(p.x, p.y) - h) + 0.5, h * 2, h * 2);
        }
        c.fillStyle = '#FFFFFF';
        c.fill();
        c.strokeStyle = SELECT;
        c.stroke();
      }
    }

    // Handles of the bearers: stems in one path, knobs in another.
    if (view.bearers.size > 0) {
      c.beginPath();
      for (const i of view.bearers) {
        const a = index.anchors[i];
        if (a.inX !== undefined && a.inY !== undefined) {
          c.moveTo(px[i], py[i]);
          c.lineTo(sx(a.inX, a.inY), sy(a.inX, a.inY));
        }
        if (a.outX !== undefined && a.outY !== undefined) {
          c.moveTo(px[i], py[i]);
          c.lineTo(sx(a.outX, a.outY), sy(a.outX, a.outY));
        }
      }
      c.strokeStyle = SELECT;
      c.lineWidth = 1;
      c.globalAlpha = 0.8;
      c.stroke();
      c.globalAlpha = 1;

      c.beginPath();
      for (const i of view.bearers) {
        const a = index.anchors[i];
        for (const [x, y] of [
          [a.inX, a.inY],
          [a.outX, a.outY],
        ]) {
          if (x === undefined || y === undefined) continue;
          if (Math.abs(x - a.x) < 1e-9 && Math.abs(y - a.y) < 1e-9) continue;
          const hx = sx(x, y);
          const hy = sy(x, y);
          c.moveTo(hx + KNOB_PX / 2 + 0.5, hy);
          c.arc(hx, hy, KNOB_PX / 2 + 0.5, 0, Math.PI * 2);
        }
      }
      c.fillStyle = '#FFFFFF';
      c.fill();
      c.strokeStyle = SELECT;
      c.stroke();
    }

    // Unpicked anchors, decimated to one per screen cell.
    const plan = anchorDrawPlan(view, px, py);
    const smooth = smoothFlags(index);
    const half = ANCHOR_PX / 2;
    const marked = L.marqueeHits;
    const trace = (i: number, r: number) => {
      const x = Math.round(px[i]) + 0.5;
      const y = Math.round(py[i]) + 0.5;
      if (smooth[i]) {
        c.moveTo(x + r, y);
        c.arc(x, y, r, 0, Math.PI * 2);
      } else {
        c.rect(x - r, y - r, r * 2, r * 2);
      }
    };
    if (plan.dense) {
      c.beginPath();
      for (let k = 0; k < plan.drawn; k++) {
        const i = plan.draw[k];
        if (marked?.has(i)) continue;
        c.rect(Math.round(px[i]) - 1, Math.round(py[i]) - 1, 2, 2);
      }
      c.fillStyle = SELECT;
      c.fill();
    } else {
      c.beginPath();
      for (let k = 0; k < plan.drawn; k++) {
        const i = plan.draw[k];
        if (marked?.has(i)) continue;
        trace(i, half - 0.5);
      }
      c.fillStyle = '#FFFFFF';
      c.fill();
      c.strokeStyle = SELECT;
      c.lineWidth = 1;
      c.stroke();
    }

    // Picked anchors, and the ones a marquee in progress would pick.
    c.beginPath();
    let any = false;
    for (const i of view.picked) {
      trace(i, plan.dense ? 2.5 : half - 0.5);
      any = true;
    }
    if (marked) {
      for (const i of marked) {
        if (view.picked.has(i)) continue;
        trace(i, plan.dense ? 2.5 : half - 0.5);
        any = true;
      }
    }
    if (any) {
      c.fillStyle = SELECT;
      c.fill();
      c.strokeStyle = '#FFFFFF';
      c.lineWidth = 1;
      c.stroke();
    }

    // Hover ring.
    const hover = L.hover;
    if (hover && (hover.kind === 'anchor' || hover.kind === 'handle') && !L.working) {
      const at = index.offsets[hover.ref.sub] + hover.ref.index;
      const a = index.anchors[at];
      if (a) {
        const x = hover.kind === 'handle' ? (hover.side === 'in' ? a.inX : a.outX) ?? a.x : a.x;
        const y = hover.kind === 'handle' ? (hover.side === 'in' ? a.inY : a.outY) ?? a.y : a.y;
        c.beginPath();
        c.arc(sx(x, y), sy(x, y), hover.kind === 'handle' ? 6 : 7, 0, Math.PI * 2);
        c.fillStyle = 'rgba(59, 130, 246, 0.22)';
        c.fill();
      }
    }

    // The marquee.
    if (L.marquee) {
      const b = L.marquee;
      const pts = [
        [b.x, b.y],
        [b.x + b.width, b.y],
        [b.x + b.width, b.y + b.height],
        [b.x, b.y + b.height],
      ];
      c.beginPath();
      pts.forEach(([x, y], i) => (i === 0 ? c.moveTo(sx(x, y), sy(x, y)) : c.lineTo(sx(x, y), sy(x, y))));
      c.closePath();
      c.fillStyle = MARQUEE_FILL;
      c.fill();
      c.setLineDash([4, 3]);
      c.strokeStyle = SELECT;
      c.stroke();
      c.setLineDash([]);
    }

    c.restore();

    if (plan.dense !== L.dense) {
      L.dense = plan.dense;
      queueMicrotask(syncDenseHint);
    }
  }, [syncDenseHint]);

  /** The hit region: the path's reach plus room for the box's rotation zone. */
  const hitFunc = React.useCallback((ctx: Konva.Context, shape: Konva.Shape) => {
    const L = live.current;
    const view = L.working ?? L.base;
    if (!view) return;
    const upp = unitsPerPx(shape);
    const sb = view.index.subBox;
    let x1 = Infinity;
    let y1 = Infinity;
    let x2 = -Infinity;
    let y2 = -Infinity;
    for (let o = 0; o < sb.length; o += 4) {
      x1 = Math.min(x1, sb[o]);
      y1 = Math.min(y1, sb[o + 1]);
      x2 = Math.max(x2, sb[o + 2]);
      y2 = Math.max(y2, sb[o + 3]);
    }
    if (!Number.isFinite(x1)) return;
    const pad = (view.box ? 32 : 12) * upp;
    ctx.beginPath();
    ctx.rect(x1 - pad, y1 - pad, x2 - x1 + pad * 2, y2 - y1 + pad * 2);
    ctx.closePath();
    ctx.fillStrokeShape(shape);
  }, []);

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------

  const hitAt = (shape: Konva.Shape, segments: boolean): { hit: PathEditHit; p: { x: number; y: number } } | null => {
    const view = live.current.base;
    const p = shape.getRelativePointerPosition();
    if (!view || !p) return null;
    return { hit: hitPathEditor(view, p, unitsPerPx(shape), { segments }), p };
  };

  const onHover = () => {
    const shape = shapeRef.current;
    if (!shape || endSession.current) return;
    const view = live.current.base;
    const found = hitAt(shape, (view?.index.count ?? 0) <= HOVER_SEGMENT_LIMIT);
    const hit = found?.hit ?? null;
    const prev = live.current.hover;
    live.current.hover = hit;
    claimCursor(CURSOR_KEY, cursorFor(hit));
    const changed =
      prev?.kind !== hit?.kind ||
      ((hit?.kind === 'anchor' || hit?.kind === 'handle') &&
        (prev?.kind === 'anchor' || prev?.kind === 'handle') &&
        anchorKey(prev.ref) !== anchorKey(hit.ref));
    if (changed) redraw();
  };

  const onLeave = () => {
    if (endSession.current) return;
    live.current.hover = null;
    claimCursor(CURSOR_KEY, null);
    redraw();
  };

  /**
   * Run one gesture to completion.
   *
   * `step` receives the pointer in geometry units and the pointer on the
   * board, and returns the geometry to preview (or null for a marquee, which
   * previews nothing on the path). `done` receives whether the pointer moved
   * past the slop and whether the gesture was cancelled.
   */
  const run = (
    shape: Konva.Shape,
    start: { x: number; y: number },
    step: (p: { x: number; y: number }, world: { x: number; y: number }, mods: { shift: boolean; alt: boolean }) => ContourGeometry | null,
    done: (moved: boolean, cancel: boolean, working: ContourGeometry | null) => void
  ) => {
    const stage = shape.getStage();
    const startNode = live.current.node;
    if (!stage || !startNode) return;
    const startGeometry = startNode.geometry as ContourGeometry;
    let moved = false;
    let working: ContourGeometry | null = null;
    let lastEvt: PointerEvent | null = null;
    const mods = { shift: false, alt: false };

    /**
     * The path's own Konva node, previewed directly while dragging.
     *
     * Found by its drawn data, so a renderer that draws the outline more than
     * once (a sketch pass, a stroke over a fill) has every copy follow. If
     * none is found the preview falls back to writing the document each frame.
     */
    const originalData = contourData(startGeometry);
    const group = stage.findOne(`#${startNode.id}`) as Konva.Container | undefined;
    const targets = (group?.find('Path') ?? []).filter((p) => (p as Konva.Path).data() === originalData) as Konva.Path[];
    let raf: number | null = null;

    const paint = () => {
      raf = null;
      if (!working) return;
      if (targets.length > 0) {
        const d = contourData(working);
        for (const t of targets) t.data(d);
        targets[0].getLayer()?.batchDraw();
      } else {
        updateNode(startNode.id, { geometry: working });
      }
      redraw();
    };

    const onMove = (evt: PointerEvent) => {
      lastEvt = evt;
      mods.shift = evt.shiftKey;
      mods.alt = evt.altKey;
      stage.setPointersPositions(evt);
      update();
    };

    const update = () => {
      const p = shape.getRelativePointerPosition();
      const world = stage.getRelativePointerPosition();
      if (!p || !world) return;
      if (!moved) {
        const upp = unitsPerPx(shape);
        if (Math.hypot(p.x - start.x, p.y - start.y) / upp < DRAG_SLOP) return;
        moved = true;
        live.current.hover = null;
      }
      const next = step(p, world, mods);
      if (next) {
        working = next;
        live.current.working = viewOf(next, pathEdit.getSnapshot()?.anchors ?? []);
        if (raf === null) raf = requestAnimationFrame(paint);
      } else {
        redraw();
      }
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        finish(true);
        return;
      }
      // Shift and Alt change the gesture mid-drag (axis lock, proportions,
      // from-centre, break handles) without waiting for the pointer to move.
      if ((e.key === 'Shift' || e.key === 'Alt') && lastEvt) {
        if (e.key === 'Alt') e.preventDefault();
        const down = e.type === 'keydown';
        if (e.key === 'Shift') mods.shift = down;
        else mods.alt = down;
        update();
      }
    };

    const finish = (cancel: boolean) => {
      if (raf !== null) cancelAnimationFrame(raf);
      raf = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('blur', onCancel);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
      endSession.current = null;
      hud.hide(PATH_HUD);
      const result = working;
      if (cancel || !moved) {
        // Put the previewed node back exactly as the document has it.
        if (targets.length > 0) {
          for (const t of targets) t.data(originalData);
          targets[0].getLayer()?.batchDraw();
        } else if (working) {
          updateNode(startNode.id, { geometry: startGeometry });
        }
      }
      live.current.working = null;
      live.current.marquee = null;
      live.current.marqueeHits = null;
      done(moved, cancel, result);
      redraw();
      queueMicrotask(syncDenseHint);
    };
    const onUp = () => finish(false);
    const onCancel = () => finish(true);

    endSession.current = finish;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('blur', onCancel);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
  };

  const onDown = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    const shape = shapeRef.current;
    const L = live.current;
    const n = L.node;
    const view = L.base;
    if (!shape || !n || !view || endSession.current) return;
    const evt = e.evt as MouseEvent;
    if ('button' in evt && evt.button !== 0) return;
    const found = hitAt(shape, true);
    if (!found) return;
    e.cancelBubble = true;
    const { hit, p: start } = found;
    const shift = Boolean(evt.shiftKey);
    const alt = Boolean(evt.altKey);
    const additive = shift || Boolean(evt.ctrlKey || evt.metaKey);
    const geo = n.geometry as ContourGeometry;
    const picked = pathEdit.getSnapshot()?.anchors ?? [];

    const moveStep = (refs: AnchorRef[]) => (p: { x: number; y: number }, world: { x: number; y: number }, mods: { shift: boolean }) => {
      const raw = { dx: p.x - start.x, dy: p.y - start.y };
      const d = mods.shift ? constrainDeltaToAxis(raw.dx, raw.dy) : raw;
      hud.show({
        source: PATH_HUD,
        kind: 'delta',
        value: { dx: d.dx, dy: d.dy, count: refs.length, noun: 'points' },
        at: world,
        placement: 'pointer',
        snapped: mods.shift,
      });
      return transformAnchors(geo, refs, translation(d.dx, d.dy));
    };
    const commitIfMoved = (moved: boolean, cancel: boolean, working: ContourGeometry | null) => {
      if (moved && !cancel && working) commitGeometry(n, working);
    };

    switch (hit.kind) {
      case 'handle': {
        pathEdit.select(picked.some((r) => anchorKey(r) === anchorKey(hit.ref)) ? picked : [hit.ref]);
        run(
          shape,
          start,
          (p, world, mods) => {
            let dest = p;
            let snappedDeg: number | null = null;
            const anchor = L.base?.index.anchors[L.base.index.offsets[hit.ref.sub] + hit.ref.index];
            if (mods.shift && anchor) {
              const s = constrainHandleToAngle(anchor, dest, 15);
              dest = { x: s.x, y: s.y };
              snappedDeg = s.angleDeg;
            }
            const deg = anchor ? ((Math.atan2(dest.y - anchor.y, dest.x - anchor.x) * 180) / Math.PI + 360) % 360 : 0;
            hud.show({ source: PATH_HUD, kind: 'angle', value: snappedDeg ?? deg, at: world, placement: 'pointer', snapped: snappedDeg !== null });
            return dragHandle(geo, { ...hit.ref, side: hit.side }, dest, { break: mods.alt });
          },
          commitIfMoved
        );
        return;
      }
      case 'anchor': {
        const key = anchorKey(hit.ref);
        const wasPicked = picked.some((r) => anchorKey(r) === key);
        if (alt) {
          const i = view.index.offsets[hit.ref.sub] + hit.ref.index;
          const to = smoothFlags(view.index)[i] ? 'corner' : 'smooth';
          commitGeometry(n, setAnchorsMode(geo, wasPicked ? picked : [hit.ref], to));
          return;
        }
        const next = additive ? toggleAnchor(picked, hit.ref, true) : wasPicked ? picked : [hit.ref];
        pathEdit.select(next);
        // Toggling a point off is the whole gesture: there is nothing to drag.
        if (!next.some((r) => anchorKey(r) === key)) return;
        run(shape, start, moveStep(next), (moved, cancel, working) => {
          commitIfMoved(moved, cancel, working);
          // A plain click on one of several picked points narrows to it.
          if (!moved && !cancel && !additive && wasPicked && next.length > 1) pathEdit.select([hit.ref]);
        });
        return;
      }
      case 'body': {
        if (additive) break;
        run(shape, start, moveStep(picked), commitIfMoved);
        return;
      }
      case 'scale': {
        const box = view.box;
        if (!box) return;
        run(
          shape,
          start,
          (p, world, mods) => {
            const s = scaleFromHandle(box, hit.handle, start, p, { uniform: mods.shift, fromCentre: mods.alt });
            hud.show({
              source: PATH_HUD,
              kind: 'size',
              value: { width: Math.abs(box.width * s.sx), height: Math.abs(box.height * s.sy), count: picked.length, noun: 'points' },
              at: world,
              placement: 'pointer',
            });
            return transformAnchors(geo, picked, s.matrix);
          },
          commitIfMoved
        );
        return;
      }
      case 'rotate': {
        const box = view.box;
        if (!box) return;
        const pivot = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        run(
          shape,
          start,
          (p, world, mods) => {
            const angle = rotationFromDrag(pivot, start, p, mods.shift ? 15 : 0);
            hud.show({
              source: PATH_HUD,
              kind: 'angle',
              value: (angle * 180) / Math.PI,
              at: world,
              placement: 'pointer',
              snapped: mods.shift,
            });
            return transformAnchors(geo, picked, rotationAbout(pivot, angle));
          },
          commitIfMoved
        );
        return;
      }
      case 'segment': {
        const grab = { sub: hit.sub, curve: hit.curve, t: hit.t };
        run(
          shape,
          start,
          (p) => {
            const subs = subpathsOf(geo);
            const target = subs[grab.sub];
            if (!target) return null;
            const bent = bendSegment(target, grab.curve, grab.t, p);
            return geo.kind === 'compound'
              ? { ...geo, subpaths: subs.map((s, i) => (i === grab.sub ? bent : s)) }
              : bent;
          },
          (moved, cancel, working) => {
            if (cancel) return;
            if (moved) {
              commitIfMoved(moved, cancel, working);
              return;
            }
            // A click without travel adds an anchor there, exactly on the curve.
            const subs = subpathsOf(geo);
            const target = subs[grab.sub];
            if (!target) return;
            const edited = insertAnchor(target, grab);
            commitGeometry(
              n,
              geo.kind === 'compound' ? { ...geo, subpaths: subs.map((s, i) => (i === grab.sub ? edited : s)) } : edited
            );
            pathEdit.select([{ sub: grab.sub, index: grab.curve + 1 }]);
          }
        );
        return;
      }
      default:
        break;
    }

    // Marquee.
    const startPicked = picked;
    let lastBox: Box | null = null;
    run(
      shape,
      start,
      (p) => {
        const box = { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), width: Math.abs(p.x - start.x), height: Math.abs(p.y - start.y) };
        L.marquee = box;
        lastBox = box;
        const idx = L.base?.index;
        if (idx) {
          const hits = new Set<number>();
          for (const r of anchorsInBox(idx, box)) hits.add(idx.offsets[r.sub] + r.index);
          L.marqueeHits = hits;
          const world = shape.getStage()?.getRelativePointerPosition();
          if (world) {
            hud.show({
              source: PATH_HUD,
              kind: 'label',
              value: `${hits.size} ${hits.size === 1 ? 'point' : 'points'}`,
              at: world,
              placement: 'pointer',
            });
          }
        }
        return null;
      },
      (moved, cancel) => {
        if (cancel) return;
        if (!moved) {
          if (!additive) pathEdit.select([]);
          return;
        }
        const idx = L.base?.index;
        if (!idx) return;
        const found = lastBox ? anchorsInBox(idx, lastBox) : [];
        pathEdit.select(additive ? mergeAnchors(startPicked, found) : found);
      }
    );
  };

  const onDouble = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const shape = shapeRef.current;
    const n = live.current.node;
    const view = live.current.base;
    if (!shape || !n || !view) return;
    const found = hitAt(shape, true);
    if (!found) return;
    e.cancelBubble = true;
    const { hit } = found;
    const geo = n.geometry as ContourGeometry;
    const picked = pathEdit.getSnapshot()?.anchors ?? [];
    if (hit.kind === 'anchor') {
      const i = view.index.offsets[hit.ref.sub] + hit.ref.index;
      const to = smoothFlags(view.index)[i] ? 'corner' : 'smooth';
      const wasPicked = picked.some((r) => anchorKey(r) === anchorKey(hit.ref));
      commitGeometry(n, setAnchorsMode(geo, wasPicked ? picked : [hit.ref], to));
    } else if (hit.kind === 'segment') {
      // The whole contour: one letter's outline, one counter, one piece.
      pathEdit.select(contourMates(view.index, [{ sub: hit.sub, index: 0 }]));
    } else if (hit.kind === 'none') {
      pathEdit.exit();
    }
  };

  if (!selection || !editable || !base) return null;

  const cx = editable.width / 2;
  const cy = editable.height / 2;
  return (
    <Group
      x={editable.x + cx}
      y={editable.y + cy}
      offsetX={cx}
      offsetY={cy}
      rotation={editable.rotation ?? 0}
      scaleX={editable.scaleX ?? 1}
      scaleY={editable.scaleY ?? 1}
      skewX={editable.skewX ? Math.tan((editable.skewX * Math.PI) / 180) : 0}
      skewY={editable.skewY ? Math.tan((editable.skewY * Math.PI) / 180) : 0}
      name={EXPORT_CHROME}
    >
      <Shape
        ref={shapeRef}
        sceneFunc={sceneFunc}
        hitFunc={hitFunc}
        // Never painted (the sceneFunc draws everything itself); it is what
        // makes Konva paint the hit region `hitFunc` traces.
        fill="transparent"
        perfectDrawEnabled={false}
        onMouseDown={onDown}
        onTouchStart={onDown}
        onMouseMove={onHover}
        onMouseLeave={onLeave}
        onDblClick={onDouble}
        onDblTap={onDouble as never}
      />
    </Group>
  );
};
