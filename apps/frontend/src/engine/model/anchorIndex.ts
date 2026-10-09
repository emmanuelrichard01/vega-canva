/**
 * Every anchor of a path, flattened and bucketed for constant-time picking.
 *
 * ## Why the editor needs this
 *
 * A converted paragraph is several hundred contours and a few thousand
 * anchors. Asking "which anchor is under the pointer" by walking them all is
 * fine once per click and wasteful on every hover; asking it by giving each
 * anchor its own Konva node (one hit region, one listener, one React element
 * each) is what made multi-point editing on outlined text crawl.
 *
 * So the anchors are laid out once per geometry in flat typed arrays and
 * bucketed into a uniform grid. A pick looks at the handful of cells around the
 * pointer; a marquee looks at the cells it covers. Both answer in microseconds
 * at any anchor count, and the editor draws every anchor in one canvas pass
 * from the same arrays.
 *
 * The index is cached per geometry *object*: the document hands out a fresh
 * object on every write and the same one otherwise, so identity is exactly the
 * invalidation rule.
 */

import type { Point } from './schema';
import type { AnchorRef } from './pathEditing';
import { subpathsOf, toAnchors, type Anchor, type ContourGeometry } from './pathGeometry';

export interface AnchorIndex {
  /** Total anchors across every contour. */
  count: number;
  /** Anchor positions, flat. Entry `i` belongs to contour `subs[i]` at position `idx[i]`. */
  xs: Float64Array;
  ys: Float64Array;
  subs: Int32Array;
  idx: Int32Array;
  /** Where each contour starts in the flat arrays. */
  offsets: Int32Array;
  /** Whether each contour is closed. */
  closed: boolean[];
  /** Every anchor with its handles, in the same flat order. */
  anchors: Anchor[];
  /** Grid cell edge, in geometry units. */
  cell: number;
  /** Bucket key → flat indices in that cell. */
  grid: Map<number, number[]>;
  /**
   * Per contour, the box of its anchors *and handles* as `[x1, y1, x2, y2]`
   * at `4·sub`. A cubic lies inside the hull of its control points, so this
   * box always contains the drawn contour: an outline hit test can skip every
   * contour whose box is out of reach.
   */
  subBox: Float64Array;
  /** Extent of the anchors. */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Cells are keyed as one integer; this keeps both halves apart for any realistic board. */
const KEY_SPAN = 1 << 20;
const cellKey = (cx: number, cy: number) => (cx + KEY_SPAN / 2) * KEY_SPAN + (cy + KEY_SPAN / 2);

const cache = new WeakMap<ContourGeometry, AnchorIndex>();

/** The index for a geometry, built once per geometry object. */
export function anchorIndexOf(geo: ContourGeometry): AnchorIndex {
  const hit = cache.get(geo);
  if (hit) return hit;
  const built = buildAnchorIndex(geo);
  cache.set(geo, built);
  return built;
}

export function buildAnchorIndex(geo: ContourGeometry): AnchorIndex {
  const subs = subpathsOf(geo);
  const offsets = new Int32Array(subs.length + 1);
  const closed: boolean[] = [];
  const anchors: Anchor[] = [];
  subs.forEach((sub, s) => {
    offsets[s] = anchors.length;
    closed.push(sub.closed);
    for (const a of toAnchors(sub)) anchors.push(a);
  });
  offsets[subs.length] = anchors.length;

  const count = anchors.length;
  const xs = new Float64Array(count);
  const ys = new Float64Array(count);
  const subArr = new Int32Array(count);
  const idxArr = new Int32Array(count);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let s = 0; s < subs.length; s++) {
    for (let i = offsets[s]; i < offsets[s + 1]; i++) {
      const a = anchors[i];
      xs[i] = a.x;
      ys[i] = a.y;
      subArr[i] = s;
      idxArr[i] = i - offsets[s];
      if (a.x < minX) minX = a.x;
      if (a.y < minY) minY = a.y;
      if (a.x > maxX) maxX = a.x;
      if (a.y > maxY) maxY = a.y;
    }
  }
  if (count === 0) {
    minX = minY = maxX = maxY = 0;
  }

  const subBox = new Float64Array(subs.length * 4);
  for (let s = 0; s < subs.length; s++) {
    let x1 = Infinity;
    let y1 = Infinity;
    let x2 = -Infinity;
    let y2 = -Infinity;
    const grow = (x: number | undefined, y: number | undefined) => {
      if (x === undefined || y === undefined) return;
      if (x < x1) x1 = x;
      if (y < y1) y1 = y;
      if (x > x2) x2 = x;
      if (y > y2) y2 = y;
    };
    for (let i = offsets[s]; i < offsets[s + 1]; i++) {
      const a = anchors[i];
      grow(a.x, a.y);
      grow(a.inX, a.inY);
      grow(a.outX, a.outY);
    }
    subBox.set([x1, y1, x2, y2], s * 4);
  }

  // About two anchors per occupied cell on an even spread: small enough that a
  // pick inspects a few dozen candidates, large enough that the map stays small.
  const area = Math.max(1, (maxX - minX) * (maxY - minY));
  const cell = Math.max(0.5, Math.sqrt((area / Math.max(1, count)) * 2));

  const grid = new Map<number, number[]>();
  for (let i = 0; i < count; i++) {
    const k = cellKey(Math.floor(xs[i] / cell), Math.floor(ys[i] / cell));
    const bucket = grid.get(k);
    if (bucket) bucket.push(i);
    else grid.set(k, [i]);
  }

  return {
    count,
    xs,
    ys,
    subs: subArr,
    idx: idxArr,
    offsets,
    closed,
    anchors,
    cell,
    grid,
    subBox,
    minX,
    minY,
    maxX,
    maxY,
  };
}

/** The flat position of a ref, or -1 when it names nothing. */
export function flatOf(index: AnchorIndex, ref: AnchorRef): number {
  if (ref.sub < 0 || ref.sub >= index.closed.length) return -1;
  const at = index.offsets[ref.sub] + ref.index;
  return ref.index >= 0 && at < index.offsets[ref.sub + 1] ? at : -1;
}

export function refOf(index: AnchorIndex, flat: number): AnchorRef {
  return { sub: index.subs[flat], index: index.idx[flat] };
}

/**
 * The flat index of the nearest anchor within `radius`, or -1.
 *
 * Ties go to the anchor drawn last, which is the one on top on screen.
 */
export function nearestAnchorFlat(index: AnchorIndex, p: Point, radius: number): number {
  if (index.count === 0 || !(radius > 0)) return -1;
  const { cell, grid, xs, ys } = index;
  const reach = Math.ceil(radius / cell);
  // A radius that spans more cells than there are anchors is cheaper as a scan.
  if ((2 * reach + 1) ** 2 > index.count) return scanNearest(index, p, radius);
  const cx = Math.floor(p.x / cell);
  const cy = Math.floor(p.y / cell);
  let best = -1;
  let bestD = radius * radius;
  for (let gx = cx - reach; gx <= cx + reach; gx++) {
    for (let gy = cy - reach; gy <= cy + reach; gy++) {
      const bucket = grid.get(cellKey(gx, gy));
      if (!bucket) continue;
      for (const i of bucket) {
        const dx = xs[i] - p.x;
        const dy = ys[i] - p.y;
        const d = dx * dx + dy * dy;
        if (d < bestD || (d === bestD && i > best)) {
          bestD = d;
          best = i;
        }
      }
    }
  }
  return best;
}

function scanNearest(index: AnchorIndex, p: Point, radius: number): number {
  let best = -1;
  let bestD = radius * radius;
  for (let i = 0; i < index.count; i++) {
    const dx = index.xs[i] - p.x;
    const dy = index.ys[i] - p.y;
    const d = dx * dx + dy * dy;
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** The nearest anchor within `radius`, as a ref. */
export function nearestAnchor(index: AnchorIndex, p: Point, radius: number): AnchorRef | null {
  const flat = nearestAnchorFlat(index, p, radius);
  return flat < 0 ? null : refOf(index, flat);
}

/** Every anchor inside a box (either corner order), in drawing order. */
export function anchorsInBox(
  index: AnchorIndex,
  box: { x: number; y: number; width: number; height: number }
): AnchorRef[] {
  const x1 = Math.min(box.x, box.x + box.width);
  const x2 = Math.max(box.x, box.x + box.width);
  const y1 = Math.min(box.y, box.y + box.height);
  const y2 = Math.max(box.y, box.y + box.height);
  const { cell, grid, xs, ys } = index;
  const gx1 = Math.floor(x1 / cell);
  const gx2 = Math.floor(x2 / cell);
  const gy1 = Math.floor(y1 / cell);
  const gy2 = Math.floor(y2 / cell);

  const found: number[] = [];
  const inside = (i: number) => xs[i] >= x1 && xs[i] <= x2 && ys[i] >= y1 && ys[i] <= y2;
  if ((gx2 - gx1 + 1) * (gy2 - gy1 + 1) > grid.size) {
    for (let i = 0; i < index.count; i++) if (inside(i)) found.push(i);
  } else {
    for (let gx = gx1; gx <= gx2; gx++) {
      for (let gy = gy1; gy <= gy2; gy++) {
        const bucket = grid.get(cellKey(gx, gy));
        if (!bucket) continue;
        for (const i of bucket) if (inside(i)) found.push(i);
      }
    }
    found.sort((a, b) => a - b);
  }
  return found.map((i) => refOf(index, i));
}

/** Every anchor on the contours the given anchors belong to: "select the whole subpath". */
export function contourMates(index: AnchorIndex, refs: readonly AnchorRef[]): AnchorRef[] {
  const subs = [...new Set(refs.map((r) => r.sub))].sort((a, b) => a - b);
  const out: AnchorRef[] = [];
  for (const s of subs) {
    if (s < 0 || s >= index.closed.length) continue;
    const n = index.offsets[s + 1] - index.offsets[s];
    for (let i = 0; i < n; i++) out.push({ sub: s, index: i });
  }
  return out;
}

/** Every anchor, as refs. */
export function allAnchors(index: AnchorIndex): AnchorRef[] {
  const out: AnchorRef[] = new Array(index.count);
  for (let i = 0; i < index.count; i++) out[i] = refOf(index, i);
  return out;
}

/** The box the given anchors occupy, in one linear pass. */
export function boundsOfAnchors(
  index: AnchorIndex,
  refs: readonly AnchorRef[]
): { x: number; y: number; width: number; height: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of refs) {
    const i = flatOf(index, r);
    if (i < 0) continue;
    if (index.xs[i] < minX) minX = index.xs[i];
    if (index.ys[i] < minY) minY = index.ys[i];
    if (index.xs[i] > maxX) maxX = index.xs[i];
    if (index.ys[i] > maxY) maxY = index.ys[i];
  }
  if (minX === Infinity) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * The anchors whose handles are worth showing: the picked ones and their
 * immediate neighbours on the same contour.
 *
 * The neighbours matter because the curve between a picked anchor and the next
 * is shaped by *both* ends; Illustrator and Figma show the far handle of each
 * adjacent segment for the same reason. Everything else keeps its handles
 * hidden, which is what keeps a few hundred picked glyph points readable.
 */
export function handleBearers(index: AnchorIndex, picked: readonly AnchorRef[]): Set<number> {
  const out = new Set<number>();
  for (const r of picked) {
    const i = flatOf(index, r);
    if (i < 0) continue;
    out.add(i);
    const start = index.offsets[r.sub];
    const n = index.offsets[r.sub + 1] - start;
    if (n < 2) continue;
    const closed = index.closed[r.sub];
    const prev = r.index - 1;
    const next = r.index + 1;
    if (prev >= 0) out.add(start + prev);
    else if (closed) out.add(start + n - 1);
    if (next < n) out.add(start + next);
    else if (closed) out.add(start);
  }
  return out;
}
