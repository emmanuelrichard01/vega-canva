/**
 * Orthogonal connector routing around obstacles.
 *
 * A sparse orthogonal visibility graph searched with a direction-aware A*
 * (after Wybrow, Marriott and Stuckey, the approach libavoid, Lucidchart and
 * draw.io use). The candidate lines are the obstacles' own edges, the
 * midlines of the gaps between them, the two stub tips and the corridor's
 * border, so a route is resolution-independent on an infinite board and its
 * corners land on coordinates that mean something: an edge, or the middle
 * of a channel.
 *
 * Cost is length plus a penalty per bend, per crossing of an already-routed
 * connector, and for running along an obstacle's margin rather than down the
 * middle of a channel. Ties break on grid coordinates, never on input order,
 * so every client in a room derives the same route from the same document.
 *
 * Pure: rectangles in, points out.
 */

import {
  DX,
  DY,
  type Dir,
  type Pt,
  type Rect,
  containsStrict,
  inflate,
  intersects,
  unionRect,
  isHorizontal,
  opposite,
  simplify,
} from './geometry';

/** How far a route leaves a port along its normal before it may turn. */
export const STUB = 16;
/** Clearance kept between a route and any obstacle. */
export const OBSTACLE_MARGIN = 12;
/** Cost of crossing a connector that is already routed. */
export const CROSSING_COST = 24;
/** Search expansions before the router gives up and falls back. */
export const DEFAULT_BUDGET = 6000;

/** Extra length a stub runs past its own box's margin, so the turn is clear of it. */
const STUB_GAP = 4;
/** Extra cost per unit of length run along an obstacle's margin. */
const HUG_FACTOR = 0.5;
/**
 * How much the search trusts its estimate over the cost so far, once a
 * corridor holds more than `EXACT_UP_TO` obstacles. Above 1 it is
 * bounded-suboptimal A*: a route costs at most this factor more than the
 * cheapest, and the search touches a fraction of the grid. A crowded corridor
 * has many near-equal routes, so the difference does not show; on an open one
 * the exact search is cheap and keeps elbows in the middle of their gaps.
 */
const EXACT_UP_TO = 8;
function heuristicWeight(obstacleCount: number): number {
  if (obstacleCount <= EXACT_UP_TO) return 1;
  if (obstacleCount <= 24) return 1.5;
  return 2;
}
/** How close to a margin a line has to run to count as hugging it. */
const HUG_DISTANCE = 6;

export interface Obstacle {
  id: string;
  /** Already inflated by the margin. */
  rect: Rect;
}

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface OrthogonalRequest {
  a: Pt;
  /** The direction the route leaves `a`: the port's outward normal. */
  dirA: Dir;
  b: Pt;
  /** The outward normal at `b`; the route arrives travelling the opposite way. */
  dirB: Dir;
  /** Each end's own box, inflated. The route keeps out of both. */
  ownA?: Rect | null;
  ownB?: Rect | null;
  /** Every other obstacle that may matter inside a corridor. Already inflated. */
  obstaclesIn?: (corridor: Rect) => readonly Obstacle[];
  /** Segments of routes already drawn, for the crossing penalty. */
  segmentsIn?: (corridor: Rect) => readonly Segment[];
  stub?: number;
  /** The smaller side of the endpoint boxes; scales the bend penalty. */
  bendScale?: number;
  maxExpansions?: number;
}

export interface OrthogonalResult {
  points: Pt[];
  /** True when the search ran out of budget and the route ignores third-party obstacles. */
  degraded: boolean;
  expansions: number;
  /** Ids of the obstacles the final search considered, for cache keys and invalidation. */
  obstacleIds: string[];
  /** Every obstacle the route went around, inflated, including both ends' own boxes. */
  obstacles: Rect[];
}

/** The bend penalty for a pair of boxes whose smaller side is `scale`. */
export function bendPenalty(stub: number, scale: number): number {
  return 1.5 * stub + 0.1 * Math.max(0, scale);
}

/**
 * Where the stub ends: at least `stub` along the normal, and always clear of
 * the end's own margin, so an attachment point that sits inside its box (a
 * triangle's slanted side, an anchor) still turns outside it.
 */
export function stubTip(p: Pt, d: Dir, own: Rect | null | undefined, stub: number): Pt {
  let len = stub;
  if (own) {
    const insideX = p.x >= own.minX && p.x <= own.maxX;
    const insideY = p.y >= own.minY && p.y <= own.maxY;
    let exit = -Infinity;
    if (d === 0 && insideY) exit = own.maxX - p.x;
    else if (d === 1 && insideY) exit = p.x - own.minX;
    else if (d === 2 && insideX) exit = own.maxY - p.y;
    else if (d === 3 && insideX) exit = p.y - own.minY;
    if (exit > -STUB_GAP) len = Math.max(len, exit + STUB_GAP);
  }
  return { x: p.x + DX[d] * len, y: p.y + DY[d] * len };
}

export function routeOrthogonalAvoiding(req: OrthogonalRequest): OrthogonalResult {
  const stub = req.stub ?? STUB;
  const a1 = stubTip(req.a, req.dirA, req.ownA, stub);
  const b1 = stubTip(req.b, req.dirB, req.ownB, stub);
  const finalDir = opposite(req.dirB);
  const pb = bendPenalty(stub, req.bendScale ?? 0);
  const budget = req.maxExpansions ?? DEFAULT_BUDGET;

  const own: Obstacle[] = [];
  if (req.ownA) own.push({ id: '\u0000a', rect: req.ownA });
  if (req.ownB) own.push({ id: '\u0000b', rect: req.ownB });

  // The search area: both stub tips and both ends' own boxes, with room to
  // go around. It starts tight, because every obstacle edge inside it is a
  // candidate line, and widens only when nothing inside it connects.
  let core: Rect = {
    minX: Math.min(a1.x, b1.x),
    minY: Math.min(a1.y, b1.y),
    maxX: Math.max(a1.x, b1.x),
    maxY: Math.max(a1.y, b1.y),
  };
  for (const o of own) core = unionRect(core, o.rect);
  let margin = Math.max(40, 0.12 * Math.hypot(b1.x - a1.x, b1.y - a1.y));
  let expansions = 0;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const corridor = inflate(core, margin);
    const others = req.obstaclesIn ? req.obstaclesIn(corridor) : [];
    const obstacles = usable([...own, ...others], a1, b1, corridor);
    const segments = req.segmentsIn ? req.segmentsIn(corridor) : [];
    const found = search(a1, req.dirA, b1, finalDir, obstacles, corridor, segments, pb, budget - expansions);
    expansions += found.expansions;
    if (found.path) {
      return {
        points: simplify([req.a, ...found.path, req.b]),
        degraded: false,
        expansions,
        obstacleIds: obstacles.map((o) => o.id).filter((id) => !id.startsWith('\u0000')).sort(),
        obstacles: obstacles.map((o) => o.rect),
      };
    }
    if (found.exhausted) break;
    margin *= 3;
  }

  // Out of budget or boxed in: route around the two ends only. That search is
  // a handful of nodes and always succeeds unless the ends overlap entirely.
  return { ...fallback(req.a, req.dirA, req.b, finalDir, a1, b1, own, pb), expansions };
}

function fallback(
  a: Pt,
  dirA: Dir,
  b: Pt,
  finalDir: Dir,
  a1: Pt,
  b1: Pt,
  own: Obstacle[],
  pb: number
): Omit<OrthogonalResult, 'expansions'> {
  for (const obstacles of [usable(own, a1, b1, null), []]) {
    const margin = Math.max(48, 0.25 * Math.hypot(b1.x - a1.x, b1.y - a1.y));
    const corridor = inflate(
      { minX: Math.min(a1.x, b1.x), minY: Math.min(a1.y, b1.y), maxX: Math.max(a1.x, b1.x), maxY: Math.max(a1.y, b1.y) },
      margin * 4
    );
    const found = search(a1, dirA, b1, finalDir, obstacles, corridor, [], pb, DEFAULT_BUDGET);
    if (found.path) {
      return {
        points: simplify([a, ...found.path, b]),
        degraded: true,
        obstacleIds: [],
        obstacles: obstacles.map((o) => o.rect),
      };
    }
  }
  const corner = isHorizontal(dirA) ? { x: b1.x, y: a1.y } : { x: a1.x, y: b1.y };
  return { points: simplify([a, a1, corner, b1, b]), degraded: true, obstacleIds: [], obstacles: [] };
}

/**
 * Obstacles the route may legally avoid. One that swallows a stub tip is
 * dropped: overlapping shapes are ordinary, and a route through one of them
 * beats no route at all.
 */
function usable(obstacles: readonly Obstacle[], a1: Pt, b1: Pt, corridor: Rect | null): Obstacle[] {
  return obstacles.filter(
    (o) =>
      !containsStrict(o.rect, a1) &&
      !containsStrict(o.rect, b1) &&
      (!corridor || intersects(o.rect, corridor))
  );
}

interface SearchResult {
  path: Pt[] | null;
  exhausted: boolean;
  expansions: number;
}

/** Rounded so the same coordinate reached two ways is one line, not two. */
function key(v: number): number {
  return Math.round(v * 1e4) / 1e4;
}

/**
 * Candidate lines along one axis: both ends' stub tips, the corridor's
 * border, every obstacle edge inside the corridor, and the midline of each gap
 * that runs from one obstacle's far edge to the next one's near edge.
 */
function buildAxis(
  obstacles: readonly Obstacle[],
  lo: number,
  hi: number,
  fixed: number[],
  horizontal: boolean
): Float64Array {
  const n = obstacles.length;
  // Edges, encoded so one numeric sort orders them: a near edge sorts just
  // before a far edge at the same coordinate.
  const nears = new Float64Array(n);
  const fars = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    const r = obstacles[i].rect;
    nears[i] = key(horizontal ? r.minX : r.minY);
    fars[i] = key(horizontal ? r.maxX : r.maxY);
  }
  nears.sort();
  fars.sort();

  const raw = new Float64Array(n * 3 + fixed.length + 2);
  let count = 0;
  const push = (v: number) => {
    if (v >= lo && v <= hi) raw[count++] = key(v);
  };
  for (const v of fixed) push(v);
  push(lo);
  push(hi);
  for (let i = 0; i < n; i += 1) {
    push(nears[i]);
    push(fars[i]);
  }
  // A channel: some obstacle ends, and the next edge after it is a start.
  // Walk the two sorted lists together to find each far edge's next near edge.
  let k = 0;
  for (let i = 0; i < n; i += 1) {
    const far = fars[i];
    while (k < n && nears[k] <= far) k += 1;
    if (k === n) break;
    const nextNear = nears[k];
    // Only a true gap: no far edge between this one and that near edge.
    if (i + 1 < n && fars[i + 1] < nextNear) continue;
    if (nextNear - far > 2) push((far + nextNear) / 2);
  }
  const sorted = raw.subarray(0, count).sort();
  let unique = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    if (unique === 0 || sorted[i] !== sorted[unique - 1]) sorted[unique++] = sorted[i];
  }
  return Float64Array.from(sorted.subarray(0, unique));
}

function indexOf(values: Float64Array, v: number): number {
  const k = key(v);
  let lo = 0;
  let hi = values.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (values[mid] === k) return mid;
    if (values[mid] < k) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

/** Index of the first value strictly greater than `v`. */
function upperBound(values: Float64Array, v: number): number {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (values[mid] <= v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const HUG = 1;
const BLOCKED = 2;

/**
 * Items bucketed along one axis, so a line at a coordinate finds the few items
 * whose span covers it instead of scanning every one.
 */
class Buckets<T> {
  private lo: number;
  private size: number;
  private cells: T[][];

  constructor(items: readonly T[], span: (item: T) => [number, number], lo: number, hi: number) {
    const count = Math.max(1, Math.min(48, Math.ceil(items.length / 3)));
    this.lo = lo;
    this.size = Math.max(1e-6, (hi - lo) / count);
    this.cells = Array.from({ length: count }, () => []);
    for (const item of items) {
      const [a, b] = span(item);
      const first = Math.max(0, Math.floor((a - lo) / this.size));
      const last = Math.min(count - 1, Math.floor((b - lo) / this.size));
      for (let c = first; c <= last; c += 1) this.cells[c].push(item);
    }
  }

  at(v: number): readonly T[] {
    const c = Math.floor((v - this.lo) / this.size);
    return this.cells[c < 0 ? 0 : c >= this.cells.length ? this.cells.length - 1 : c];
  }
}

/**
 * What it costs to move between consecutive values along one line: free (0),
 * hugging an obstacle's margin, or blocked by its interior.
 */
function lineCosts(
  obstacles: readonly Obstacle[] | Buckets<Obstacle>,
  values: Float64Array,
  fixed: number,
  lineIsVertical: boolean
): Uint8Array {
  const out = new Uint8Array(Math.max(0, values.length - 1));
  const near = obstacles instanceof Buckets ? obstacles.at(fixed) : obstacles;
  for (const o of near) {
    const r = o.rect;
    const crossLo = lineIsVertical ? r.minX : r.minY;
    const crossHi = lineIsVertical ? r.maxX : r.maxY;
    const inside = fixed > crossLo && fixed < crossHi;
    const hugging =
      !inside && (Math.abs(fixed - crossLo) <= HUG_DISTANCE || Math.abs(fixed - crossHi) <= HUG_DISTANCE);
    if (!inside && !hugging) continue;
    const lo = lineIsVertical ? r.minY : r.minX;
    const hi = lineIsVertical ? r.maxY : r.maxX;
    const mark = inside ? BLOCKED : HUG;
    // Interval i spans values[i]..values[i+1]; it is affected when its middle
    // lies strictly inside (lo, hi).
    for (let i = Math.max(0, upperBound(values, lo) - 1); i < out.length; i += 1) {
      const mid = (values[i] + values[i + 1]) / 2;
      if (mid >= hi) break;
      if (mid > lo && out[i] < mark) out[i] = mark;
    }
  }
  return out;
}

/** Crossings of drawn segments per interval along one line, or null for none. */
function lineCrossings(
  segments: readonly Segment[] | Buckets<Segment>,
  values: Float64Array,
  fixed: number,
  lineIsVertical: boolean
): Uint16Array | null {
  let out: Uint16Array | null = null;
  const near = segments instanceof Buckets ? segments.at(fixed) : segments;
  for (const s of near) {
    // A vertical line is crossed by horizontal segments, and vice versa.
    if (lineIsVertical ? s.y1 !== s.y2 : s.x1 !== s.x2) continue;
    const at = lineIsVertical ? s.y1 : s.x1;
    const spanLo = lineIsVertical ? Math.min(s.x1, s.x2) : Math.min(s.y1, s.y2);
    const spanHi = lineIsVertical ? Math.max(s.x1, s.x2) : Math.max(s.y1, s.y2);
    if (!(fixed > spanLo && fixed < spanHi)) continue;
    const i = upperBound(values, at) - 1;
    if (i < 0 || i >= values.length - 1 || values[i] === at) continue;
    out ??= new Uint16Array(values.length - 1);
    out[i] += 1;
  }
  return out;
}

/**
 * Search state shared by every search, grown as needed and never cleared:
 * an entry counts only when its stamp matches the current search's.
 */
let bufG = new Float64Array(0);
let bufParent = new Int32Array(0);
let bufSeen = new Uint32Array(0);
let bufClosed = new Uint32Array(0);
let generation = 0;

function scratch(size: number) {
  if (bufG.length < size) {
    const n = Math.max(size, bufG.length * 2, 4096);
    bufG = new Float64Array(n);
    bufParent = new Int32Array(n);
    bufSeen = new Uint32Array(n);
    bufClosed = new Uint32Array(n);
    generation = 0;
  }
  generation += 1;
  if (generation >= 0xffffffff) {
    bufSeen.fill(0);
    bufClosed.fill(0);
    generation = 1;
  }
  return { g: bufG, parent: bufParent, seen: bufSeen, closed: bufClosed, gen: generation };
}

/** A binary min-heap of state ids keyed by f, ties broken by h, then id. */
class Heap {
  private ids = new Int32Array(256);
  private f = new Float64Array(256);
  private h = new Float64Array(256);
  size = 0;

  private grow() {
    const n = this.ids.length * 2;
    const ids = new Int32Array(n);
    const f = new Float64Array(n);
    const h = new Float64Array(n);
    ids.set(this.ids);
    f.set(this.f);
    h.set(this.h);
    this.ids = ids;
    this.f = f;
    this.h = h;
  }

  private less(i: number, j: number): boolean {
    const f = this.f;
    if (f[i] !== f[j]) return f[i] < f[j];
    const h = this.h;
    if (h[i] !== h[j]) return h[i] < h[j];
    return this.ids[i] < this.ids[j];
  }

  private exchange(i: number, j: number) {
    const id = this.ids[i];
    const f = this.f[i];
    const h = this.h[i];
    this.ids[i] = this.ids[j];
    this.f[i] = this.f[j];
    this.h[i] = this.h[j];
    this.ids[j] = id;
    this.f[j] = f;
    this.h[j] = h;
  }

  push(id: number, f: number, h: number) {
    if (this.size === this.ids.length) this.grow();
    let i = this.size;
    this.size += 1;
    this.ids[i] = id;
    this.f[i] = f;
    this.h[i] = h;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(i, parent)) break;
      this.exchange(i, parent);
      i = parent;
    }
  }

  peekF(): number {
    return this.f[0];
  }

  pop(): number {
    const top = this.ids[0];
    this.size -= 1;
    const n = this.size;
    if (n === 0) return top;
    this.ids[0] = this.ids[n];
    this.f[0] = this.f[n];
    this.h[0] = this.h[n];
    let i = 0;
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let m = i;
      if (l < n && this.less(l, m)) m = l;
      if (r < n && this.less(r, m)) m = r;
      if (m === i) break;
      this.exchange(i, m);
      i = m;
    }
    return top;
  }
}

function search(
  a1: Pt,
  dirA: Dir,
  b1: Pt,
  finalDir: Dir,
  obstacles: readonly Obstacle[],
  corridor: Rect,
  segments: readonly Segment[],
  pb: number,
  budget: number
): SearchResult {
  const xs = buildAxis(obstacles, corridor.minX, corridor.maxX, [a1.x, b1.x], true);
  const ys = buildAxis(obstacles, corridor.minY, corridor.maxY, [a1.y, b1.y], false);
  const nx = xs.length;
  const ny = ys.length;
  const ia = indexOf(xs, a1.x);
  const ja = indexOf(ys, a1.y);
  const ib = indexOf(xs, b1.x);
  const jb = indexOf(ys, b1.y);
  if (ia < 0 || ja < 0 || ib < 0 || jb < 0) return { path: null, exhausted: false, expansions: 0 };

  // Both stubs end at the same spot: a direct hand-over, if the directions allow it.
  if (ia === ib && ja === jb) {
    return dirA === opposite(finalDir)
      ? { path: null, exhausted: false, expansions: 0 }
      : { path: [a1, b1], exhausted: false, expansions: 0 };
  }

  // Per-line costs, built the first time the search reaches each line.
  // Vertical lines sit at an x, so they look obstacles and crossing segments
  // up by x; horizontal lines by y.
  const byX = new Buckets(obstacles, (o) => [o.rect.minX - HUG_DISTANCE, o.rect.maxX + HUG_DISTANCE], corridor.minX, corridor.maxX);
  const byY = new Buckets(obstacles, (o) => [o.rect.minY - HUG_DISTANCE, o.rect.maxY + HUG_DISTANCE], corridor.minY, corridor.maxY);
  const horizontalSegs = segments.filter((g) => g.y1 === g.y2);
  const verticalSegs = segments.filter((g) => g.x1 === g.x2);
  const vCost: Array<Uint8Array | undefined> = new Array(nx);
  const hCost: Array<Uint8Array | undefined> = new Array(ny);
  const vCross: Array<Uint16Array | null | undefined> = new Array(nx);
  const hCross: Array<Uint16Array | null | undefined> = new Array(ny);
  const hasSegments = segments.length > 0;

  const { g, parent, seen, closed, gen } = scratch(nx * ny * 4);
  const heap = new Heap();
  const tx = b1.x;
  const ty = b1.y;
  const back = opposite(finalDir);
  const weight = heuristicWeight(obstacles.length);

  const heuristic = (i: number, j: number, d: number): number => {
    const x = xs[i];
    const y = ys[j];
    let bends: number;
    if (d === back) bends = 2;
    else if (d !== finalDir) bends = 1;
    else if (d < 2) bends = Math.abs(ty - y) < 1e-6 && (tx - x) * DX[d] >= -1e-6 ? 0 : 2;
    else bends = Math.abs(tx - x) < 1e-6 && (ty - y) * DY[d] >= -1e-6 ? 0 : 2;
    return Math.abs(x - tx) + Math.abs(y - ty) + pb * bends;
  };

  const start = ((ja * nx + ia) << 2) | dirA;
  g[start] = 0;
  seen[start] = gen;
  parent[start] = -1;
  const h0 = heuristic(ia, ja, dirA);
  heap.push(start, h0 * weight, h0);

  let best = Infinity;
  let bestState = -1;
  let expansions = 0;

  while (heap.size > 0) {
    if (heap.peekF() >= best) break;
    const s = heap.pop();
    if (closed[s] === gen) continue;
    closed[s] = gen;
    expansions += 1;
    if (expansions > budget) return { path: null, exhausted: true, expansions };

    const d = s & 3;
    const cell = s >> 2;
    const i = cell % nx;
    const j = (cell - i) / nx;
    const gs = g[s];
    const reverse = d ^ 1;

    for (let nd = 0; nd < 4; nd += 1) {
      if (nd === reverse) continue;
      let ni = i;
      let nj = j;
      let len: number;
      let cost: number;
      let crossings = 0;
      if (nd < 2) {
        ni = nd === 0 ? i + 1 : i - 1;
        if (ni < 0 || ni >= nx) continue;
        const k = ni < i ? ni : i;
        const line = (hCost[j] ??= lineCosts(byY, xs, ys[j], false));
        cost = line[k];
        if (cost === BLOCKED) continue;
        len = Math.abs(xs[ni] - xs[i]);
        if (hasSegments) {
          if (hCross[j] === undefined) hCross[j] = lineCrossings(verticalSegs, xs, ys[j], false);
          const cross = hCross[j];
          if (cross) crossings = cross[k];
        }
      } else {
        nj = nd === 2 ? j + 1 : j - 1;
        if (nj < 0 || nj >= ny) continue;
        const k = nj < j ? nj : j;
        const line = (vCost[i] ??= lineCosts(byX, ys, xs[i], true));
        cost = line[k];
        if (cost === BLOCKED) continue;
        len = Math.abs(ys[nj] - ys[j]);
        if (hasSegments) {
          if (vCross[i] === undefined) vCross[i] = lineCrossings(horizontalSegs, ys, xs[i], true);
          const cross = vCross[i];
          if (cross) crossings = cross[k];
        }
      }

      const ns = ((nj * nx + ni) << 2) | nd;
      if (closed[ns] === gen) continue;
      const ng =
        gs + len + (nd !== d ? pb : 0) + (cost === HUG ? HUG_FACTOR * len : 0) + crossings * CROSSING_COST;

      if (ni === ib && nj === jb && nd !== back) {
        const total = ng + (nd === finalDir ? 0 : pb);
        if (total < best || (total === best && ns < bestState)) {
          best = total;
          bestState = ns;
        }
      }
      if (seen[ns] !== gen || ng < g[ns]) {
        seen[ns] = gen;
        g[ns] = ng;
        parent[ns] = s;
        const h = heuristic(ni, nj, nd);
        heap.push(ns, ng + h * weight, h);
      }
    }
  }

  if (bestState < 0) return { path: null, exhausted: false, expansions };

  const path: Pt[] = [];
  for (let s = bestState; s >= 0; s = parent[s]) {
    const cell = s >> 2;
    const i = cell % nx;
    const j = (cell - i) / nx;
    path.push({ x: xs[i], y: ys[j] });
    if (s === start) break;
  }
  path.reverse();
  return { path, exhausted: false, expansions };
}
