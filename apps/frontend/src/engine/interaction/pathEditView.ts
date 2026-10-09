/**
 * What the direct-selection overlay shows, and what a press on it means.
 *
 * Pure, so the rules people feel (which handles are visible, what wins when a
 * handle sits on an anchor, when the point-selection box appears) are tested
 * rather than discovered. `PathEditor` draws from a `PathEditView` in one
 * canvas pass and asks `hitPathEditor` on every press and hover; nothing here
 * allocates per anchor beyond what the index already holds.
 *
 * Every length is in **geometry units**. The caller converts its screen
 * tolerances with `unitsPerPx` once.
 */

import {
  anchorIndexOf,
  boundsOfAnchors,
  flatOf,
  handleBearers,
  nearestAnchorFlat,
  refOf,
  type AnchorIndex,
} from '../model/anchorIndex';
import type { AnchorRef } from '../model/pathEditing';
import { nearestPointOnPath, subpathsOf, type ContourGeometry } from '../model/pathGeometry';
import { boxHandleAt, insideBox, type Box, type BoxHandle } from '../model/pointTransform';
import type { Point } from '../model/schema';

/**
 * Above this many picked anchors, no bezier handles are drawn.
 *
 * A handful of picked points is a curve being shaped and its handles are the
 * tool. Two hundred picked glyph points is a selection being moved, scaled or
 * turned, and two hundred pairs of handles are noise over the artwork that
 * also cost a draw each. The box is the affordance at that scale.
 */
export const HANDLE_CAP = 32;

/** Screen sizes, in CSS pixels. */
export const ANCHOR_PX = 7;
export const KNOB_PX = 4;
export const BOX_PAD_PX = 8;
export const BOX_GRIP_PX = 6;
export const ROTATE_REACH_PX = 20;
export const ANCHOR_HIT_PX = 7;
export const HANDLE_HIT_PX = 7;
export const SEGMENT_HIT_PX = 6;

export interface PathEditView {
  geometry: ContourGeometry;
  index: AnchorIndex;
  /** Flat indices of the picked anchors. */
  picked: Set<number>;
  /** Flat indices of anchors whose handles are drawn and grabbable. */
  bearers: Set<number>;
  /** The picked anchors' box, when there are two or more and it has extent. */
  box: Box | null;
}

export function viewOf(geometry: ContourGeometry, picked: readonly AnchorRef[]): PathEditView {
  const index = anchorIndexOf(geometry);
  const flat = new Set<number>();
  for (const r of picked) {
    const i = flatOf(index, r);
    if (i >= 0) flat.add(i);
  }
  const bearers = flat.size > 0 && flat.size <= HANDLE_CAP ? handleBearers(index, picked) : new Set<number>();
  const raw = flat.size >= 2 ? boundsOfAnchors(index, picked) : null;
  const box = raw && (raw.width > 1e-6 || raw.height > 1e-6) ? raw : null;
  return { geometry, index, picked: flat, bearers, box };
}

/** The point-selection box as drawn: padded so its corners never sit on an anchor. */
export function paddedBox(box: Box, unitsPerPx: number): Box {
  const pad = BOX_PAD_PX * unitsPerPx;
  return { x: box.x - pad, y: box.y - pad, width: box.width + pad * 2, height: box.height + pad * 2 };
}

export type PathEditHit =
  | { kind: 'handle'; ref: AnchorRef; side: 'in' | 'out' }
  | { kind: 'anchor'; ref: AnchorRef }
  | { kind: 'scale'; handle: BoxHandle }
  | { kind: 'rotate'; handle: BoxHandle }
  | { kind: 'segment'; sub: number; curve: number; t: number }
  | { kind: 'body' }
  | { kind: 'none' };

/**
 * What is under `p`, by priority.
 *
 * Handles first, because they are only shown on purpose and are small; then
 * anchors; then the box's own handles and rotation zone; then the outline;
 * then the inside of the box, which moves the picked points as Figma's does.
 */
export function hitPathEditor(
  view: PathEditView,
  p: Point,
  unitsPerPx: number,
  opts: { segments?: boolean } = {}
): PathEditHit {
  const { index } = view;

  // 1. Bezier handles of the bearers.
  const hr = HANDLE_HIT_PX * unitsPerPx;
  let best: { ref: AnchorRef; side: 'in' | 'out'; d: number } | null = null;
  for (const i of view.bearers) {
    const a = index.anchors[i];
    for (const side of ['in', 'out'] as const) {
      const x = side === 'in' ? a.inX : a.outX;
      const y = side === 'in' ? a.inY : a.outY;
      if (x === undefined || y === undefined) continue;
      // A handle retracted onto its anchor is the anchor, for picking.
      if (Math.abs(x - a.x) < 1e-9 && Math.abs(y - a.y) < 1e-9) continue;
      const d = Math.hypot(x - p.x, y - p.y);
      if (d <= hr && (!best || d < best.d)) best = { ref: refOf(index, i), side, d };
    }
  }
  if (best) return { kind: 'handle', ref: best.ref, side: best.side };

  // 2. Anchors, through the spatial index.
  const ai = nearestAnchorFlat(index, p, ANCHOR_HIT_PX * unitsPerPx);
  if (ai >= 0) return { kind: 'anchor', ref: refOf(index, ai) };

  // 3. The point-selection box.
  if (view.box) {
    const drawn = paddedBox(view.box, unitsPerPx);
    const onBox = boxHandleAt(drawn, p, BOX_GRIP_PX * unitsPerPx, ROTATE_REACH_PX * unitsPerPx);
    if (onBox) return onBox;
  }

  // 4. The outline.
  if (opts.segments !== false) {
    const seg = segmentAt(view, p, SEGMENT_HIT_PX * unitsPerPx);
    if (seg) return seg;
  }

  // 5. Inside the box.
  if (view.box && insideBox(paddedBox(view.box, unitsPerPx), p)) return { kind: 'body' };
  return { kind: 'none' };
}

/** The nearest point on the outline within `reach`, skipping contours whose box is out of reach. */
export function segmentAt(
  view: PathEditView,
  p: Point,
  reach: number
): { kind: 'segment'; sub: number; curve: number; t: number } | null {
  const subs = subpathsOf(view.geometry);
  const box = view.index.subBox;
  let best: { sub: number; curve: number; t: number; d: number } | null = null;
  for (let s = 0; s < subs.length; s++) {
    const o = s * 4;
    if (p.x < box[o] - reach || p.y < box[o + 1] - reach || p.x > box[o + 2] + reach || p.y > box[o + 3] + reach) continue;
    const hit = nearestPointOnPath(subs[s], p);
    if (hit && hit.distance <= reach && (!best || hit.distance < best.d)) {
      best = { sub: s, curve: hit.curve, t: hit.t, d: hit.distance };
    }
  }
  return best ? { kind: 'segment', sub: best.sub, curve: best.curve, t: best.t } : null;
}

/**
 * Which anchors to draw, and how, at this zoom.
 *
 * Anchors closer together on screen than a few pixels are drawn once per
 * screen cell: a converted paragraph at 25% has more anchors than the screen
 * has room for, and drawing two thousand overlapping squares costs time and
 * reads as a smear. Picked anchors are always drawn. When the board is that
 * dense the unpicked ones also shrink to dots, and `dense` lets the editor
 * say "zoom in to edit points" rather than pretend they are grabbable one by
 * one.
 *
 * `screen` maps an anchor's flat index to its screen position.
 */
export function anchorDrawPlan(
  view: PathEditView,
  screenX: Float64Array,
  screenY: Float64Array,
  cellPx = 4
): { draw: Int32Array; drawn: number; dense: boolean } {
  const n = view.index.count;
  const draw = new Int32Array(n);
  const seen = new Set<number>();
  let drawn = 0;
  for (let i = 0; i < n; i++) {
    if (view.picked.has(i)) continue;
    const k = Math.floor(screenX[i] / cellPx) * 100003 + Math.floor(screenY[i] / cellPx);
    if (seen.has(k)) continue;
    seen.add(k);
    draw[drawn++] = i;
  }
  // Dense when a third or more of the unpicked anchors share a cell with another.
  const unpicked = n - view.picked.size;
  const dense = unpicked > 40 && drawn < unpicked * 0.67;
  return { draw, drawn, dense };
}
