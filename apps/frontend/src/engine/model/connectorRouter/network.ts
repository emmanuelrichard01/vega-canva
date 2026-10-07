/**
 * Passes that need every route at once: spreading connectors that share a
 * channel, and deciding where lines jump over one another.
 *
 * Both are deterministic in the routes' ids and stacking order, never in the
 * order routes were published, so clients that can see the same connectors
 * draw the same picture.
 */

import { isAxisSegment, moveSegment, type Hop } from './pathOps';
import type { Pt } from './geometry';

/** Distance between connectors sharing a channel. */
export const CHANNEL_GAP = 8;

export type JumpStyle = 'none' | 'arc' | 'gap';

export interface NetworkRoute {
  id: string;
  points: readonly Pt[];
  /** Orthogonal routes take part in channel spreading; others only in jumps. */
  orthogonal: boolean;
  /** Curved routes are sampled curves and take no part in either pass. */
  curved?: boolean;
  zIndex: number;
  jumps: JumpStyle;
  strokeWidth: number;
}

export interface Adjusted {
  points: Pt[];
  hops: Hop[];
}

function stackCompare(a: NetworkRoute, b: NetworkRoute): number {
  if (a.zIndex !== b.zIndex) return a.zIndex - b.zIndex;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

interface ChannelSeg {
  route: number;
  seg: number;
  axis: 'h' | 'v';
  coord: number;
  lo: number;
  hi: number;
  /** Which side the route comes from and goes to: -2 (both low) … 2 (both high). */
  side: number;
  id: string;
}

/**
 * Spread interior segments that run down the same channel.
 *
 * Segments on one line (within a unit) whose extents overlap are a bundle.
 * A bundle of n segments from different connectors is fanned out `CHANNEL_GAP`
 * apart, centred on the original line. Members are ordered by which side they
 * enter and leave from, so a connector arriving from the left takes the left
 * lane and the fan does not add crossings, then by id.
 */
export function spreadChannels(routes: readonly NetworkRoute[]): Pt[][] {
  const out = routes.map((r) => r.points.map((p) => ({ ...p })));
  const segs: ChannelSeg[] = [];
  routes.forEach((route, r) => {
    if (!route.orthogonal || route.curved) return;
    const pts = route.points;
    // Interior segments only: the first and last legs belong to their ports.
    for (let s = 1; s + 2 < pts.length; s += 1) {
      const p = pts[s];
      const q = pts[s + 1];
      const axis = isAxisSegment(p, q);
      if (!axis) continue;
      const coord = axis === 'h' ? p.y : p.x;
      const lo = axis === 'h' ? Math.min(p.x, q.x) : Math.min(p.y, q.y);
      const hi = axis === 'h' ? Math.max(p.x, q.x) : Math.max(p.y, q.y);
      const before = pts[s - 1];
      const after = pts[s + 2];
      const sideOf = (pt: Pt) => Math.sign(axis === 'h' ? pt.y - coord : pt.x - coord);
      segs.push({ route: r, seg: s, axis, coord, lo, hi, side: sideOf(before) + sideOf(after), id: route.id });
    }
  });

  segs.sort((a, b) => (a.axis !== b.axis ? (a.axis < b.axis ? -1 : 1) : a.coord - b.coord || a.lo - b.lo));

  let i = 0;
  while (i < segs.length) {
    // One line: same axis, coordinates within a unit of the first.
    let j = i + 1;
    while (j < segs.length && segs[j].axis === segs[i].axis && segs[j].coord - segs[i].coord <= 1) j += 1;
    const line = segs.slice(i, j).sort((a, b) => a.lo - b.lo);
    // Bundles: overlapping extents along that line.
    let k = 0;
    while (k < line.length) {
      let reach = line[k].hi;
      let m = k + 1;
      while (m < line.length && line[m].lo < reach - 1) {
        reach = Math.max(reach, line[m].hi);
        m += 1;
      }
      const bundle = line.slice(k, m);
      if (new Set(bundle.map((s) => s.route)).size >= 2) {
        bundle.sort((a, b) => a.side - b.side || (a.id < b.id ? -1 : a.id > b.id ? 1 : a.seg - b.seg));
        const centre = (bundle.length - 1) / 2;
        bundle.forEach((s, index) => {
          const offset = (index - centre) * CHANNEL_GAP;
          if (offset !== 0) moveSegment(out[s.route], s.seg, offset);
        });
      }
      k = m;
    }
    i = j;
  }
  return out;
}

/** Where `p→q` properly crosses `r→s`, as the parameter along each. */
function crossing(p: Pt, q: Pt, r: Pt, s: Pt): { t: number; u: number } | null {
  const dx1 = q.x - p.x;
  const dy1 = q.y - p.y;
  const dx2 = s.x - r.x;
  const dy2 = s.y - r.y;
  const denom = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((r.x - p.x) * dy2 - (r.y - p.y) * dx2) / denom;
  const u = ((r.x - p.x) * dy1 - (r.y - p.y) * dx1) / denom;
  const eps = 1e-6;
  if (t <= eps || t >= 1 - eps || u <= eps || u >= 1 - eps) return null;
  return { t, u };
}

/**
 * Where each route jumps or breaks.
 *
 * At every crossing the connector higher in the stack decides: with `arc` it
 * hops over the one below, with `gap` the one below breaks under it, and with
 * `none` they simply cross. A crossing is therefore drawn once, never twice.
 */
export function findHops(routes: readonly NetworkRoute[], points: readonly (readonly Pt[])[]): Hop[][] {
  const hops: Hop[][] = routes.map(() => []);
  const boxes = points.map((pts) => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    return { minX, minY, maxX, maxY };
  });

  // Sweep along x: only routes whose boxes overlap in x are compared.
  const byX = routes.map((_, i) => i).filter((i) => !routes[i].curved);
  byX.sort((p, q) => boxes[p].minX - boxes[q].minX || p - q);
  for (let ai = 0; ai < byX.length; ai += 1) {
    const a = byX[ai];
    const ba = boxes[a];
    for (let bi = ai + 1; bi < byX.length; bi += 1) {
      const b = byX[bi];
      const bb = boxes[b];
      if (bb.minX > ba.maxX) break;
      if (ba.minY > bb.maxY || bb.minY > ba.maxY) continue;
      const [ha, hb] = pairHops(routes[a], points[a], routes[b], points[b]);
      hops[a].push(...ha);
      hops[b].push(...hb);
    }
  }
  for (const list of hops) list.sort((p, q) => p.seg - q.seg || p.at - q.at);
  return hops;
}

/**
 * The jumps between one pair of routes, for each of the two. The route higher
 * in the stack decides: with `arc` it hops, with `gap` the lower one breaks.
 */
export function pairHops(
  ra: NetworkRoute,
  pa: readonly Pt[],
  rb: NetworkRoute,
  pb: readonly Pt[]
): [Hop[], Hop[]] {
  const out: [Hop[], Hop[]] = [[], []];
  if (ra.curved || rb.curved) return out;
  const aUpper = stackCompare(ra, rb) > 0;
  const upperRoute = aUpper ? ra : rb;
  const style = upperRoute.jumps;
  if (style === 'none') return out;
  const pu = aUpper ? pa : pb;
  const pl = aUpper ? pb : pa;
  const upperHops = aUpper ? out[0] : out[1];
  const lowerHops = aUpper ? out[1] : out[0];
  for (let i = 0; i + 1 < pu.length; i += 1) {
    for (let j = 0; j + 1 < pl.length; j += 1) {
      const hit = crossing(pu[i], pu[i + 1], pl[j], pl[j + 1]);
      if (!hit) continue;
      if (style === 'arc') {
        const len = Math.hypot(pu[i + 1].x - pu[i].x, pu[i + 1].y - pu[i].y);
        upperHops.push({ seg: i, at: hit.t * len, kind: 'arc' });
      } else {
        const len = Math.hypot(pl[j + 1].x - pl[j].x, pl[j + 1].y - pl[j].y);
        lowerHops.push({ seg: j, at: hit.u * len, kind: 'gap', half: upperRoute.strokeWidth + 1 });
      }
    }
  }
  return out;
}

/** An interior leg on an axis line, for finding the bundles a route belongs to. */
interface LineSeg {
  id: string;
  axis: 'h' | 'v';
  coord: number;
  lo: number;
  hi: number;
}

export function interiorSegments(id: string, points: readonly Pt[]): LineSeg[] {
  const out: LineSeg[] = [];
  for (let s = 1; s + 2 < points.length; s += 1) {
    const p = points[s];
    const q = points[s + 1];
    const axis = isAxisSegment(p, q);
    if (!axis) continue;
    out.push({
      id,
      axis,
      coord: axis === 'h' ? p.y : p.x,
      lo: axis === 'h' ? Math.min(p.x, q.x) : Math.min(p.y, q.y),
      hi: axis === 'h' ? Math.max(p.x, q.x) : Math.max(p.y, q.y),
    });
  }
  return out;
}

/**
 * Every route that shares a channel bundle, directly or through others, with
 * the given segments. Spreading only moves segments within their bundle, so
 * re-spreading this set reproduces exactly what a whole-board pass would.
 */
export function bundleClosure(
  routes: ReadonlyMap<string, readonly Pt[]>,
  seeds: readonly LineSeg[]
): Set<string> {
  const index = new Map<string, LineSeg[]>();
  const bucket = (axis: string, coord: number) => `${axis}${Math.round(coord)}`;
  for (const [id, pts] of routes) {
    for (const seg of interiorSegments(id, pts)) {
      const k = bucket(seg.axis, seg.coord);
      const list = index.get(k) ?? [];
      list.push(seg);
      index.set(k, list);
    }
  }
  const members = new Set<string>();
  const queue = [...seeds];
  while (queue.length > 0) {
    const seg = queue.pop()!;
    for (const d of [-1, 0, 1]) {
      for (const other of index.get(bucket(seg.axis, Math.round(seg.coord) + d)) ?? []) {
        if (members.has(other.id) || Math.abs(other.coord - seg.coord) > 1) continue;
        if (other.lo >= seg.hi - 1 || seg.lo >= other.hi - 1) continue;
        members.add(other.id);
        queue.push(...interiorSegments(other.id, routes.get(other.id)!));
      }
    }
  }
  return members;
}

/** Both passes, in order: spread channels, then find crossings on the spread routes. */
export function adjustNetwork(routes: readonly NetworkRoute[]): Adjusted[] {
  const spread = spreadChannels(routes);
  const hops = findHops(routes, spread);
  return spread.map((points, i) => ({ points, hops: hops[i] }));
}
