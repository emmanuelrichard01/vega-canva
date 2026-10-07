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
/**
 * A search still going after this many expansions is in a crowd where many
 * routes cost nearly the same; from then on it trusts its estimate twice as
 * much again, which bounds the slow tail at the price of, on average, a
 * small fraction of a bend.
 */
const ESCALATE_AFTER = 1000;
const ESCALATE_FACTOR = 2;
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
  /**
   * The widest area the search read obstacles and drawn segments from. A
   * change outside it cannot change this route; one inside it may.
   */
  corridor: Rect;
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
  let read = inflate(core, margin);

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const corridor = inflate(core, margin);
    read = corridor;
    const others = req.obstaclesIn ? req.obstaclesIn(corridor) : [];
    const obstacles = usable([...own, ...others], a1, b1, corridor);
    const segments = req.segmentsIn ? req.segmentsIn(corridor) : [];
    // Only a route found in the first corridor is cached: its inputs are
    // exactly what the key holds, where a wider retry also read obstacles the
    // key does not.
    // The budget is not part of the key: a search that succeeded finds the
    // same route under any budget it fits in, and only successes are kept.
    const cacheKey = attempt === 0 ? keyOf(req.a, req.dirA, req.b, req.dirB, a1, b1, pb, obstacles, segments) : null;
    if (cacheKey !== null) {
      const hit = routeCache.get(cacheKey);
      if (hit) {
        routeCache.delete(cacheKey);
        routeCache.set(cacheKey, hit);
        return cloneResult(hit);
      }
    }
    const found = search(a1, req.dirA, b1, finalDir, obstacles, corridor, segments, pb, budget - expansions);
    expansions += found.expansions;
    if (found.path) {
      const result: OrthogonalResult = {
        points: simplify([req.a, ...found.path, req.b]),
        degraded: false,
        expansions,
        obstacleIds: obstacles.map((o) => o.id).filter((id) => !id.startsWith('\u0000')).sort(),
        obstacles: obstacles.map((o) => o.rect),
        corridor,
      };
      releaseOversized();
      if (cacheKey !== null) {
        routeCache.set(cacheKey, cloneResult(result));
        if (routeCache.size > ROUTE_CACHE_SIZE) routeCache.delete(routeCache.keys().next().value!);
      }
      return result;
    }
    if (found.exhausted) break;
    margin *= 3;
  }

  // Out of budget or boxed in: route around the two ends only. That search is
  // a handful of nodes and always succeeds unless the ends overlap entirely.
  releaseOversized();
  return { ...fallback(req.a, req.dirA, req.b, finalDir, a1, b1, own, pb), expansions, corridor: read };
}

/** Finished routes by everything that decided them, most recently used last. */
const routeCache = new Map<string, OrthogonalResult>();
const ROUTE_CACHE_SIZE = 512;

/** Forget every cached route. For tests and benchmarks that time the search itself. */
export function clearRouteCache(): void {
  routeCache.clear();
}

function cloneResult(r: OrthogonalResult): OrthogonalResult {
  return {
    points: r.points.map((p) => ({ x: p.x, y: p.y })),
    degraded: r.degraded,
    // Nothing was searched for a cached answer.
    expansions: 0,
    obstacleIds: r.obstacleIds.slice(),
    obstacles: r.obstacles.map((o) => ({ ...o })),
    corridor: { ...r.corridor },
  };
}

/**
 * The cache key for one search: both ends, both stub tips, the bend penalty,
 * and every obstacle and drawn segment the search reads, in the
 * order it reads them. Two requests with the same key search the same grid
 * with the same costs, so they find the same route.
 */
function keyOf(
  a: Pt,
  dirA: Dir,
  b: Pt,
  dirB: Dir,
  a1: Pt,
  b1: Pt,
  pb: number,
  obstacles: readonly Obstacle[],
  segments: readonly Segment[]
): string {
  // Two independent 32-bit hashes of every input, rather than a string of
  // them all: a corridor can hold a hundred obstacles and as many segments,
  // and joining them cost a tenth of the search it was meant to save.
  const h = new Hasher();
  h.num(a.x).num(a.y).num(dirA).num(b.x).num(b.y).num(dirB);
  h.num(a1.x).num(a1.y).num(b1.x).num(b1.y).num(pb).num(obstacles.length);
  for (const o of obstacles) h.str(o.id).num(o.rect.minX).num(o.rect.minY).num(o.rect.maxX).num(o.rect.maxY);
  h.num(segments.length);
  for (const g of segments) h.num(g.x1).num(g.y1).num(g.x2).num(g.y2);
  // The ends and counts in the clear, so a hash collision would also have to
  // agree on those before it could hand back the wrong route.
  return `${a.x},${a.y},${b.x},${b.y},${obstacles.length},${segments.length}:${h.digest()}`;
}

const hashView = new DataView(new ArrayBuffer(8));

/** FNV-1a and a multiplicative mix side by side, over the exact bits of each number. */
class Hasher {
  private h1 = 0x811c9dc5;
  private h2 = 0x9e3779b9;

  private word(w: number) {
    this.h1 = Math.imul(this.h1 ^ w, 0x01000193);
    this.h2 = Math.imul(this.h2 ^ (w + 0x7f4a7c15), 0x85ebca6b) ^ (this.h2 >>> 13);
  }

  num(v: number): this {
    hashView.setFloat64(0, v);
    this.word(hashView.getInt32(0));
    this.word(hashView.getInt32(4));
    return this;
  }

  str(s: string): this {
    this.word(s.length);
    for (let i = 0; i < s.length; i += 1) this.word(s.charCodeAt(i));
    return this;
  }

  digest(): string {
    return `${(this.h1 >>> 0).toString(36)}.${(this.h2 >>> 0).toString(36)}`;
  }
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
): Omit<OrthogonalResult, 'expansions' | 'corridor'> {
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
 * Search state shared by every search, grown as needed and never cleared:
 * an entry counts only when its stamp matches the current search's.
 */
let bufG = new Float64Array(0);
let bufParent = new Int32Array(0);
let bufSeen = new Uint32Array(0);
let bufClosed = new Uint32Array(0);
let generation = 0;

/**
 * The most search states the shared buffers keep between searches. One huge
 * search (a long route across a crowded board, widened three times) can grow
 * them to tens of megabytes; past this they are let go once it finishes, and
 * the next search grows them again only as far as it needs.
 */
const SCRATCH_KEEP = 1 << 18;
/** The most grid intervals the cost buffers keep between searches. */
const INTERVALS_KEEP = 1 << 18;

/** Drop any search buffer an unusually large search left oversized. */
export function releaseOversized(): void {
  if (bufG.length > SCRATCH_KEEP) {
    bufG = new Float64Array(0);
    bufParent = new Int32Array(0);
    bufSeen = new Uint32Array(0);
    bufClosed = new Uint32Array(0);
    generation = 0;
  }
  if (bufHCost.length > INTERVALS_KEEP) bufHCost = new Uint8Array(0);
  if (bufVCost.length > INTERVALS_KEEP) bufVCost = new Uint8Array(0);
  if (bufHCross.length > INTERVALS_KEEP) bufHCross = new Uint16Array(0);
  if (bufVCross.length > INTERVALS_KEEP) bufVCross = new Uint16Array(0);
  sharedHeap.shrink(SCRATCH_KEEP);
  if (bufStack.length > SCRATCH_KEEP) {
    bufStack = new Int32Array(1024);
    bufStackF = new Float64Array(1024);
  }
}

/** The sizes of the shared search buffers, for tests. */
export function scratchSizes(): { states: number; intervals: number; heap: number } {
  return {
    states: bufG.length,
    intervals: Math.max(bufHCost.length, bufVCost.length, bufHCross.length, bufVCross.length),
    heap: sharedHeap.capacity,
  };
}

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

/** Per-interval costs and crossing counts, reused across searches. */
let bufHCost = new Uint8Array(0);
let bufVCost = new Uint8Array(0);
let bufHCross = new Uint16Array(0);
let bufVCross = new Uint16Array(0);

/**
 * The cost of every interval of every line, built in one pass over the
 * obstacles rather than line by line.
 *
 * Horizontal line `j` has intervals `xs[i]..xs[i+1]`, stored at
 * `j * (nx - 1) + i`; vertical line `i` has `ys[j]..ys[j+1]` at
 * `i * (ny - 1) + j`. An interval is blocked when its middle lies inside an
 * obstacle and the line passes through the obstacle's interior, and it hugs
 * when the line runs within `HUG_DISTANCE` of the obstacle's edge. Each
 * obstacle touches only the lines and intervals it covers, found by binary
 * search, so the pass costs the area the obstacles cover, not lines times
 * obstacles.
 */
function intervalCosts(obstacles: readonly Obstacle[], xs: Float64Array, ys: Float64Array) {
  const nx = xs.length;
  const ny = ys.length;
  const hSize = ny * Math.max(0, nx - 1);
  const vSize = nx * Math.max(0, ny - 1);
  if (bufHCost.length < hSize) bufHCost = new Uint8Array(Math.max(hSize, bufHCost.length * 2));
  if (bufVCost.length < vSize) bufVCost = new Uint8Array(Math.max(vSize, bufVCost.length * 2));
  const h = bufHCost;
  const v = bufVCost;
  h.fill(0, 0, hSize);
  v.fill(0, 0, vSize);

  for (const o of obstacles) {
    const r = o.rect;
    // Horizontal lines: blocked strictly inside the y-range, hugging near its edges.
    markLines(h, ys, xs, r.minY, r.maxY, r.minX, r.maxX, nx - 1);
    // Vertical lines, the same with the axes swapped.
    markLines(v, xs, ys, r.minX, r.maxX, r.minY, r.maxY, ny - 1);
  }
  return { h, v };
}

/**
 * Mark one obstacle on the lines of one orientation. `lines` are the fixed
 * coordinates of those lines, `values` the coordinates along them.
 */
function markLines(
  out: Uint8Array,
  lines: Float64Array,
  values: Float64Array,
  crossLo: number,
  crossHi: number,
  lo: number,
  hi: number,
  stride: number
): void {
  if (stride <= 0) return;
  // Intervals whose middle is strictly inside (lo, hi).
  let first = upperBound(values, lo) - 1;
  if (first < 0) first = 0;
  while (first < stride && (values[first] + values[first + 1]) / 2 <= lo) first += 1;
  let last = first;
  while (last < stride && (values[last] + values[last + 1]) / 2 < hi) last += 1;
  if (last <= first) return;
  // Lines from just outside the hug band on one side to just outside it on the other.
  let line = upperBound(lines, crossLo - HUG_DISTANCE - 1e-9);
  for (; line < lines.length; line += 1) {
    const c = lines[line];
    if (c > crossHi + HUG_DISTANCE) break;
    const inside = c > crossLo && c < crossHi;
    const mark = inside ? BLOCKED : Math.abs(c - crossLo) <= HUG_DISTANCE || Math.abs(c - crossHi) <= HUG_DISTANCE ? HUG : 0;
    if (mark === 0) continue;
    const base = line * stride;
    for (let k = first; k < last; k += 1) if (out[base + k] < mark) out[base + k] = mark;
  }
}

/**
 * How many drawn segments cross each interval, or null when there are none.
 * A horizontal segment crosses the vertical lines strictly inside its span,
 * in the interval of each that contains its y, and vice versa.
 */
function intervalCrossings(segments: readonly Segment[], xs: Float64Array, ys: Float64Array) {
  if (segments.length === 0) return null;
  const nx = xs.length;
  const ny = ys.length;
  const hSize = ny * Math.max(0, nx - 1);
  const vSize = nx * Math.max(0, ny - 1);
  if (bufHCross.length < hSize) bufHCross = new Uint16Array(Math.max(hSize, bufHCross.length * 2));
  if (bufVCross.length < vSize) bufVCross = new Uint16Array(Math.max(vSize, bufVCross.length * 2));
  const h = bufHCross;
  const v = bufVCross;
  h.fill(0, 0, hSize);
  v.fill(0, 0, vSize);
  let any = false;
  for (const s of segments) {
    if (s.y1 === s.y2 && s.x1 !== s.x2) {
      // Crosses vertical lines in (minX, maxX), in the interval holding y.
      const j = upperBound(ys, s.y1) - 1;
      if (j < 0 || j >= ny - 1 || ys[j] === s.y1) continue;
      const lo = Math.min(s.x1, s.x2);
      const hi = Math.max(s.x1, s.x2);
      for (let i = upperBound(xs, lo); i < nx && xs[i] < hi; i += 1) {
        v[i * (ny - 1) + j] += 1;
        any = true;
      }
    } else if (s.x1 === s.x2 && s.y1 !== s.y2) {
      const i = upperBound(xs, s.x1) - 1;
      if (i < 0 || i >= nx - 1 || xs[i] === s.x1) continue;
      const lo = Math.min(s.y1, s.y2);
      const hi = Math.max(s.y1, s.y2);
      for (let j = upperBound(ys, lo); j < ny && ys[j] < hi; j += 1) {
        h[j * (nx - 1) + i] += 1;
        any = true;
      }
    }
  }
  return any ? { h, v } : null;
}

/**
 * A binary min-heap of state ids keyed by f, ties broken by h, then id.
 *
 * One instance serves every search (emptied at the start of each), so a route
 * allocates nothing here once the arrays have grown to the largest search
 * seen. Sifting moves a hole rather than swapping, which halves the writes.
 */
class Heap {
  private ids = new Int32Array(1024);
  private f = new Float64Array(1024);
  private h = new Float64Array(1024);
  size = 0;

  clear() {
    this.size = 0;
  }

  get capacity(): number {
    return this.ids.length;
  }

  /** Back to the starting size when a search grew it past `keep`. */
  shrink(keep: number) {
    if (this.ids.length <= keep) return;
    this.ids = new Int32Array(1024);
    this.f = new Float64Array(1024);
    this.h = new Float64Array(1024);
    this.size = 0;
  }

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

  push(id: number, fv: number, hv: number) {
    if (this.size === this.ids.length) this.grow();
    const ids = this.ids;
    const f = this.f;
    const h = this.h;
    let i = this.size;
    this.size += 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      const fp = f[p];
      // Stop once the parent orders first: (f, h, id) ascending.
      if (fp < fv || (fp === fv && (h[p] < hv || (h[p] === hv && ids[p] < id)))) break;
      ids[i] = ids[p];
      f[i] = fp;
      h[i] = h[p];
      i = p;
    }
    ids[i] = id;
    f[i] = fv;
    h[i] = hv;
  }

  peekF(): number {
    return this.f[0];
  }

  pop(): number {
    const ids = this.ids;
    const f = this.f;
    const h = this.h;
    const top = ids[0];
    this.size -= 1;
    const n = this.size;
    if (n === 0) return top;
    const id = ids[n];
    const fv = f[n];
    const hv = h[n];
    let i = 0;
    for (;;) {
      let c = i * 2 + 1;
      if (c >= n) break;
      const r = c + 1;
      if (r < n && (f[r] < f[c] || (f[r] === f[c] && (h[r] < h[c] || (h[r] === h[c] && ids[r] < ids[c]))))) c = r;
      const fc = f[c];
      if (fv < fc || (fv === fc && (hv < h[c] || (hv === h[c] && id < ids[c])))) break;
      ids[i] = ids[c];
      f[i] = fc;
      h[i] = h[c];
      i = c;
    }
    ids[i] = id;
    f[i] = fv;
    h[i] = hv;
    return top;
  }
}

const sharedHeap = new Heap();

/** States the search expands next without a trip through the heap; see `search`. */
let bufStack = new Int32Array(1024);
let bufStackF = new Float64Array(1024);

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

  const costs = intervalCosts(obstacles, xs, ys);
  const hCost = costs.h;
  const vCost = costs.v;
  const cross = intervalCrossings(segments, xs, ys);
  const hCross = cross?.h ?? null;
  const vCross = cross?.v ?? null;
  const hStride = nx - 1;
  const vStride = ny - 1;

  const { g, parent, seen, closed, gen } = scratch(nx * ny * 4);
  const heap = sharedHeap;
  heap.clear();
  const tx = b1.x;
  const ty = b1.y;
  const back = opposite(finalDir);
  let weight = heuristicWeight(obstacles.length);

  /**
   * Distance to the target plus a bend for every turn the route still has to
   * make: none when it is already heading straight at the target along the
   * right line, one when it is perpendicular to the final heading, two
   * otherwise.
   */
  const heuristic = (x: number, y: number, d: number): number => {
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
  const h0 = heuristic(xs[ia], ys[ja], dirA);
  heap.push(start, h0 * weight, h0);

  // A successor that is no worse than the state being expanded would be the
  // next one out of the heap anyway, so it is expanded straight away from a
  // stack instead. On a run toward the target that is most of them, and it
  // spares the heap a push and a pop each. Still deterministic: the order
  // depends only on the grid.
  let stack = bufStack;
  let stackF = bufStackF;
  let top = 0;

  let best = Infinity;
  let bestState = -1;
  let expansions = 0;

  for (;;) {
    let s: number;
    let fs: number;
    if (top > 0) {
      top -= 1;
      s = stack[top];
      fs = stackF[top];
      if (fs >= best) continue;
    } else {
      if (heap.size === 0 || heap.peekF() >= best) break;
      fs = heap.peekF();
      s = heap.pop();
    }
    if (closed[s] === gen) continue;
    closed[s] = gen;
    expansions += 1;
    if (expansions === ESCALATE_AFTER) weight *= ESCALATE_FACTOR;
    if (expansions > budget) return { path: null, exhausted: true, expansions };

    const d = s & 3;
    const cell = s >> 2;
    const i = cell % nx;
    const j = (cell - i) / nx;
    const gs = g[s];
    const reverse = d ^ 1;
    const x0 = xs[i];
    const y0 = ys[j];

    for (let nd = 0; nd < 4; nd += 1) {
      if (nd === reverse) continue;
      let ni = i;
      let nj = j;
      let len: number;
      let cost: number;
      let crossings = 0;
      let nx1 = x0;
      let ny1 = y0;
      if (nd < 2) {
        ni = nd === 0 ? i + 1 : i - 1;
        if (ni < 0 || ni >= nx) continue;
        const k = j * hStride + (ni < i ? ni : i);
        cost = hCost[k];
        if (cost === BLOCKED) continue;
        nx1 = xs[ni];
        len = nx1 > x0 ? nx1 - x0 : x0 - nx1;
        if (hCross !== null) crossings = hCross[k];
      } else {
        nj = nd === 2 ? j + 1 : j - 1;
        if (nj < 0 || nj >= ny) continue;
        const k = i * vStride + (nj < j ? nj : j);
        cost = vCost[k];
        if (cost === BLOCKED) continue;
        ny1 = ys[nj];
        len = ny1 > y0 ? ny1 - y0 : y0 - ny1;
        if (vCross !== null) crossings = vCross[k];
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
        const h = heuristic(nx1, ny1, nd);
        const f = ng + h * weight;
        if (f <= fs && nd === d) {
          if (top === stack.length) {
            const grown = new Int32Array(stack.length * 2);
            const grownF = new Float64Array(stack.length * 2);
            grown.set(stack);
            grownF.set(stackF);
            stack = bufStack = grown;
            stackF = bufStackF = grownF;
          }
          stack[top] = ns;
          stackF[top] = f;
          top += 1;
        } else {
          heap.push(ns, f, h);
        }
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
