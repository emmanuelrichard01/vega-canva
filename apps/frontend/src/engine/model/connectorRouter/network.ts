/**
 * Passes that need every route at once: spreading connectors that share a
 * channel, and deciding where lines jump over one another.
 *
 * Both are deterministic in the routes' ids and stacking order, never in the
 * order routes were published, so clients that can see the same connectors
 * draw the same picture.
 */

import { isAxisSegment, moveSegment, type Hop } from './pathOps';
import type { Pt, Rect } from './geometry';
import { fitCurve } from './curve';

/** Distance between connectors sharing a channel. */
export const CHANNEL_GAP = 8;

export type JumpStyle = 'none' | 'arc' | 'gap';

export interface NetworkRoute {
  id: string;
  points: readonly Pt[];
  /** Orthogonal routes take part in channel spreading; others only in jumps. */
  orthogonal: boolean;
  /** Curved routes take no part in jumps; with a skeleton they spread by it. */
  curved?: boolean;
  /** A curve's elbow skeleton and the boxes it keeps clear of; see `ConnectorRoute`. */
  skeleton?: readonly Pt[];
  clearance?: readonly Rect[];
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

/** One interior leg of an elbow route, as channel spreading sees it. */
export interface ChannelSeg {
  /** The route's id. */
  id: string;
  /** Index of the leg in the route, counting from the first leg out of the start. */
  seg: number;
  axis: 'h' | 'v';
  coord: number;
  lo: number;
  hi: number;
  /** Which side the route comes from and goes to: -2 (both low) … 2 (both high). */
  side: number;
}

/** The interior legs of a route that lie on an axis line. The first and last legs belong to their ports. */
export function channelSegments(id: string, pts: readonly Pt[]): ChannelSeg[] {
  const out: ChannelSeg[] = [];
  for (let s = 1; s + 2 < pts.length; s += 1) {
    const p = pts[s];
    const q = pts[s + 1];
    const axis = isAxisSegment(p, q);
    if (!axis) continue;
    const coord = axis === 'h' ? p.y : p.x;
    const lo = axis === 'h' ? Math.min(p.x, q.x) : Math.min(p.y, q.y);
    const hi = axis === 'h' ? Math.max(p.x, q.x) : Math.max(p.y, q.y);
    const sideOf = (pt: Pt) => Math.sign(axis === 'h' ? pt.y - coord : pt.x - coord);
    out.push({ id, seg: s, axis, coord, lo, hi, side: sideOf(pts[s - 1]) + sideOf(pts[s + 2]) });
  }
  return out;
}

/** The channel line a leg runs down: its axis and its coordinate to the nearest unit. */
export function lineKeyOf(seg: Pick<ChannelSeg, 'axis' | 'coord'>): number {
  return Math.round(seg.coord) * 2 + (seg.axis === 'h' ? 0 : 1);
}

function segCompare(a: ChannelSeg, b: ChannelSeg): number {
  return a.lo - b.lo || a.hi - b.hi || (a.id < b.id ? -1 : a.id > b.id ? 1 : a.seg - b.seg);
}

/**
 * The offset of every leg on one channel line, in the order given.
 *
 * Legs whose extents overlap are a bundle. A bundle of legs from two or more
 * connectors is fanned out `CHANNEL_GAP` apart, centred on the original line.
 * Members are ordered by which side they enter and leave from, so a connector
 * arriving from the left takes the left lane and the fan adds no crossings,
 * then by id. A line's offsets depend only on the legs on it, so a change
 * re-spreads the lines it touches and nothing else.
 */
export function lineOffsets(segs: readonly ChannelSeg[]): number[] {
  const out = new Array<number>(segs.length).fill(0);
  const order = segs.map((_, i) => i).sort((p, q) => segCompare(segs[p], segs[q]));
  let k = 0;
  while (k < order.length) {
    let reach = segs[order[k]].hi;
    let m = k + 1;
    while (m < order.length && segs[order[m]].lo < reach - 1) {
      reach = Math.max(reach, segs[order[m]].hi);
      m += 1;
    }
    const bundle = order.slice(k, m);
    if (new Set(bundle.map((i) => segs[i].id)).size >= 2) {
      bundle.sort((p, q) => {
        const a = segs[p];
        const b = segs[q];
        return a.side - b.side || (a.id < b.id ? -1 : a.id > b.id ? 1 : a.seg - b.seg);
      });
      const centre = (bundle.length - 1) / 2;
      bundle.forEach((i, index) => {
        out[i] = (index - centre) * CHANNEL_GAP;
      });
    }
    k = m;
  }
  return out;
}

/** A route's points with each leg moved by its offset. */
export function applyOffsets(points: readonly Pt[], offsets: ReadonlyMap<number, number> | undefined): Pt[] {
  const out = points.map((p) => ({ ...p }));
  if (offsets) for (const [seg, offset] of offsets) if (offset !== 0) moveSegment(out, seg, offset);
  return out;
}

/**
 * Spread interior segments that run down the same channel, for a whole set
 * of routes at once. See `lineOffsets`.
 */
export function spreadChannels(routes: readonly NetworkRoute[]): Pt[][] {
  const lines = new Map<number, ChannelSeg[]>();
  const index = new Map<string, number>();
  routes.forEach((route, r) => {
    index.set(route.id, r);
    const legs = spreadSource(route);
    if (!legs) return;
    for (const seg of channelSegments(route.id, legs)) {
      const k = lineKeyOf(seg);
      const line = lines.get(k);
      if (line) line.push(seg);
      else lines.set(k, [seg]);
    }
  });
  const offsets = routes.map(() => new Map<number, number>());
  for (const line of lines.values()) {
    const offs = lineOffsets(line);
    line.forEach((seg, i) => {
      if (offs[i] !== 0) offsets[index.get(seg.id)!].set(seg.seg, offs[i]);
    });
  }
  return routes.map((route, r) => spreadRoute(route, offsets[r]));
}

/** The legs a route spreads by: an elbow route's own, a curve's skeleton, or none. */
export function spreadSource(route: Pick<NetworkRoute, 'orthogonal' | 'curved' | 'points' | 'skeleton'>): readonly Pt[] | null {
  if (route.curved) return route.skeleton ?? null;
  return route.orthogonal ? route.points : null;
}

/** A route's drawing after spreading: its legs moved, and a curve refitted over its moved skeleton. */
export function spreadRoute(
  route: Pick<NetworkRoute, 'orthogonal' | 'curved' | 'points' | 'skeleton' | 'clearance'>,
  offsets: ReadonlyMap<number, number> | undefined
): Pt[] {
  if (route.curved) {
    if (!route.skeleton || !offsets || offsets.size === 0) return route.points.map((p) => ({ ...p }));
    return fitCurve(applyOffsets(route.skeleton, offsets), route.clearance ?? []);
  }
  return applyOffsets(route.points, offsets);
}

/**
 * Every elbow route's interior legs, by channel line, kept between frames.
 *
 * The canvas updates it per route as routes change, and re-spreads only the
 * lines a change touches.
 */
export class ChannelIndex {
  private lines = new Map<number, ChannelSeg[]>();
  private byRoute = new Map<string, ChannelSeg[]>();

  /** The lines a route currently runs down. */
  keysOf(id: string): number[] {
    return (this.byRoute.get(id) ?? []).map(lineKeyOf);
  }

  line(key: number): readonly ChannelSeg[] {
    return this.lines.get(key) ?? [];
  }

  /** Record a route's legs, replacing whatever it had. */
  set(id: string, points: readonly Pt[]): void {
    this.delete(id);
    const list = channelSegments(id, points);
    if (list.length === 0) return;
    this.byRoute.set(id, list);
    for (const seg of list) {
      const k = lineKeyOf(seg);
      const line = this.lines.get(k);
      if (line) line.push(seg);
      else this.lines.set(k, [seg]);
    }
  }

  delete(id: string): void {
    const list = this.byRoute.get(id);
    if (!list) return;
    this.byRoute.delete(id);
    for (const seg of list) {
      const k = lineKeyOf(seg);
      const line = this.lines.get(k);
      if (!line) continue;
      const i = line.indexOf(seg);
      if (i >= 0) line.splice(i, 1);
      if (line.length === 0) this.lines.delete(k);
    }
  }
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
    const p = pu[i];
    const q = pu[i + 1];
    const pMinX = p.x < q.x ? p.x : q.x;
    const pMaxX = p.x < q.x ? q.x : p.x;
    const pMinY = p.y < q.y ? p.y : q.y;
    const pMaxY = p.y < q.y ? q.y : p.y;
    for (let j = 0; j + 1 < pl.length; j += 1) {
      const r = pl[j];
      const t = pl[j + 1];
      // Boxes first: most pairs of legs are nowhere near each other.
      if ((r.x < pMinX && t.x < pMinX) || (r.x > pMaxX && t.x > pMaxX)) continue;
      if ((r.y < pMinY && t.y < pMinY) || (r.y > pMaxY && t.y > pMaxY)) continue;
      const hit = crossing(p, q, r, t);
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

/** Both passes, in order: spread channels, then find crossings on the spread routes. */
export function adjustNetwork(routes: readonly NetworkRoute[]): Adjusted[] {
  const spread = spreadChannels(routes);
  const hops = findHops(routes, spread);
  return spread.map((points, i) => ({ points, hops: hops[i] }));
}
