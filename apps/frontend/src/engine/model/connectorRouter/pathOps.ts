/**
 * Operations on a finished route: user segment nudges, and the one path
 * builder every reader draws from.
 */

import type { Pt, Rect } from './geometry';

/**
 * A user's offset of one interior leg of an elbow route, along its normal.
 *
 * Keyed by the leg itself, not by its position in the list: `axis` is the
 * way the leg runs and `at` its coordinate across that axis where the router
 * puts it, rounded to a unit. A nudge applies to the interior leg the router
 * still puts on that line, and to nothing once no leg runs there.
 */
export interface SegmentNudge {
  axis: 'h' | 'v';
  at: number;
  offset: number;
}

/** What one segment of a drawn elbow route is, for the editor's grips. */
export interface LegRef {
  axis: 'h' | 'v';
  /** The leg's coordinate before any nudge, rounded: its key. */
  at: number;
  /** How far a nudge moved it, after clamping. */
  nudge: number;
}

/** The document key a nudge is stored under, one per leg. */
export function nudgeKey(n: Pick<SegmentNudge, 'axis' | 'at'>): string {
  return `nudge:${n.axis}:${n.at}`;
}

/** The leg a stored key names, or null for any other key. */
export function parseNudgeKey(key: string): Pick<SegmentNudge, 'axis' | 'at'> | null {
  const m = /^nudge:([hv]):(-?\d+)$/.exec(key);
  return m ? { axis: m[1] as 'h' | 'v', at: Number(m[2]) } : null;
}

export function segmentCount(points: readonly Pt[]): number {
  return Math.max(0, points.length - 1);
}

export function isAxisSegment(p: Pt, q: Pt): 'h' | 'v' | null {
  if (Math.abs(p.y - q.y) < 1e-6 && Math.abs(p.x - q.x) >= 1e-6) return 'h';
  if (Math.abs(p.x - q.x) < 1e-6 && Math.abs(p.y - q.y) >= 1e-6) return 'v';
  return null;
}

/**
 * The interior legs of an elbow route, by segment index: each leg's axis and
 * key coordinate, or null for an end leg (bound to its port) and any slanted
 * segment.
 */
export function interiorLegs(points: readonly Pt[]): Array<Pick<SegmentNudge, 'axis' | 'at'> | null> {
  const count = segmentCount(points);
  const out: Array<Pick<SegmentNudge, 'axis' | 'at'> | null> = new Array(count).fill(null);
  for (let seg = 1; seg < count - 1; seg += 1) {
    const axis = isAxisSegment(points[seg], points[seg + 1]);
    if (!axis) continue;
    out[seg] = { axis, at: Math.round(axis === 'h' ? points[seg].y : points[seg].x) };
  }
  return out;
}

/**
 * How far a leg can move toward `offset` before it, or the legs either side
 * stretching to meet it, enters an obstacle. `obstacles` are already
 * inflated by the router's margin, so a clamped leg keeps that clearance. An
 * obstacle the leg already runs through does not stop it.
 */
export function clampNudge(points: readonly Pt[], seg: number, offset: number, obstacles: readonly Rect[]): number {
  const p = points[seg];
  const q = points[seg + 1];
  const axis = isAxisSegment(p, q);
  if (!axis || offset === 0) return offset;
  const h = axis === 'h';
  const c = h ? p.y : p.x;
  const lo = h ? Math.min(p.x, q.x) : Math.min(p.y, q.y);
  const hi = h ? Math.max(p.x, q.x) : Math.max(p.y, q.y);
  let limit = offset;
  for (const r of obstacles) {
    const rLo = h ? r.minX : r.minY;
    const rHi = h ? r.maxX : r.maxY;
    if (!(rLo < hi && rHi > lo)) continue;
    const near = h ? r.minY : r.minX;
    const far = h ? r.maxY : r.maxX;
    if (near < c && far > c) continue;
    if (limit > 0 && near >= c) limit = Math.min(limit, near - c);
    else if (limit < 0 && far <= c) limit = Math.max(limit, far - c);
  }
  return limit;
}

/**
 * Apply stored nudges to an elbow route.
 *
 * Each nudge moves the interior leg its key names, clamped so the leg stays
 * out of `obstacles`. A nudge whose leg the route no longer has is ignored;
 * the first and last legs belong to their ports and never move. Returns the
 * moved points and, per segment, what each interior leg is and how far it
 * moved.
 */
export function applyNudges(
  points: readonly Pt[],
  nudges: readonly SegmentNudge[] | undefined,
  obstacles: readonly Rect[] = []
): { points: Pt[]; legs: Array<LegRef | null> } {
  const out = points.map((p) => ({ ...p }));
  const keys = interiorLegs(points);
  const legs: Array<LegRef | null> = keys.map((k) => (k ? { ...k, nudge: 0 } : null));
  if (!nudges || nudges.length === 0) return { points: out, legs };
  for (const n of nudges) {
    if (!Number.isFinite(n.offset) || n.offset === 0) continue;
    const seg = keys.findIndex((k) => k !== null && k.axis === n.axis && k.at === n.at);
    if (seg < 0 || legs[seg]!.nudge !== 0) continue;
    const offset = clampNudge(out, seg, n.offset, obstacles);
    if (offset === 0) continue;
    moveSegment(out, seg, offset);
    legs[seg]!.nudge = offset;
  }
  return { points: out, legs };
}

/** Shift segment `seg` along its normal; its neighbours stretch to stay joined. */
export function moveSegment(points: Pt[], seg: number, offset: number): void {
  const p = points[seg];
  const q = points[seg + 1];
  if (!p || !q) return;
  const axis = isAxisSegment(p, q);
  if (!axis || !Number.isFinite(offset)) return;
  if (axis === 'h') {
    p.y += offset;
    q.y += offset;
  } else {
    p.x += offset;
    q.x += offset;
  }
}

/** A crossing drawn on one segment: a hop over another line, or a break under it. */
export interface Hop {
  seg: number;
  /** Distance from the segment's start to the crossing. */
  at: number;
  kind: 'arc' | 'gap';
  /** For a gap: the half-width of the break. Arcs use the builder's radius. */
  half?: number;
}

export interface PathOptions {
  /** Elbow radius; each corner takes as much as its legs allow. */
  cornerRadius?: number;
  hops?: readonly Hop[];
  /** Radius of an arc hop, in the path's own units. */
  hopRadius?: number;
  /** No hop is placed closer than this to either end of its segment's straight run. */
  hopClearance?: number;
}

const r1 = (n: number) => Math.round(n * 100) / 100;

/**
 * The SVG path for a route: rounded elbows and line jumps in one string.
 *
 * The renderer, its hit area and the SVG exporter all draw from this, so the
 * line you click is the line you see and the line in the file.
 */
export function connectorPathData(points: readonly Pt[], options: PathOptions = {}): string {
  const n = points.length;
  if (n < 2) return '';
  const radius = Math.max(0, options.cornerRadius ?? 0);
  const hopR = Math.max(0, options.hopRadius ?? 0);
  const clearance = Math.max(0, options.hopClearance ?? 0);

  // How much of each end of every segment a corner takes.
  const trim: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < n - 1; i += 1) trim.push({ start: 0, end: 0 });
  const corners: Array<{ enter: Pt; leave: Pt; corner: Pt } | null> = new Array(n).fill(null);
  if (radius > 0) {
    for (let i = 1; i < n - 1; i += 1) {
      const prev = points[i - 1];
      const corner = points[i];
      const next = points[i + 1];
      const inLen = Math.hypot(corner.x - prev.x, corner.y - prev.y);
      const outLen = Math.hypot(next.x - corner.x, next.y - corner.y);
      if (inLen === 0 || outLen === 0) continue;
      const ix = (prev.x - corner.x) / inLen;
      const iy = (prev.y - corner.y) / inLen;
      const ox = (next.x - corner.x) / outLen;
      const oy = (next.y - corner.y) / outLen;
      if (ix * ox + iy * oy < -0.9999) continue;
      const r = Math.min(radius, inLen / 2, outLen / 2);
      if (!(r > 0)) continue;
      corners[i] = {
        corner,
        enter: { x: corner.x + ix * r, y: corner.y + iy * r },
        leave: { x: corner.x + ox * r, y: corner.y + oy * r },
      };
      trim[i - 1].end = r;
      trim[i].start = r;
    }
  }

  const hopsBySeg = new Map<number, Hop[]>();
  for (const hop of options.hops ?? []) {
    const list = hopsBySeg.get(hop.seg) ?? [];
    list.push(hop);
    hopsBySeg.set(hop.seg, list);
  }

  const parts: string[] = [`M${r1(points[0].x)} ${r1(points[0].y)}`];
  for (let i = 0; i < n - 1; i += 1) {
    const p = points[i];
    const q = points[i + 1];
    const len = Math.hypot(q.x - p.x, q.y - p.y);
    const ux = len === 0 ? 0 : (q.x - p.x) / len;
    const uy = len === 0 ? 0 : (q.y - p.y) / len;

    const hops = (hopsBySeg.get(i) ?? [])
      .filter((h) => {
        const reach = h.kind === 'arc' ? hopR : h.half ?? 0;
        return h.at - reach >= trim[i].start + clearance && h.at + reach <= len - trim[i].end - clearance;
      })
      .sort((a, b) => a.at - b.at);

    let cursor = trim[i].start;
    for (const h of hops) {
      const reach = h.kind === 'arc' ? hopR : h.half ?? 0;
      if (reach <= 0 || h.at - reach < cursor) continue;
      const before = { x: p.x + ux * (h.at - reach), y: p.y + uy * (h.at - reach) };
      const after = { x: p.x + ux * (h.at + reach), y: p.y + uy * (h.at + reach) };
      parts.push(`L${r1(before.x)} ${r1(before.y)}`);
      if (h.kind === 'arc') {
        // A semicircle bowing to the left of travel, which is "up" on a
        // rightward run, the way jumps are drawn on wiring diagrams.
        parts.push(`A${r1(reach)} ${r1(reach)} 0 0 1 ${r1(after.x)} ${r1(after.y)}`);
      } else {
        parts.push(`M${r1(after.x)} ${r1(after.y)}`);
      }
      cursor = h.at + reach;
    }

    const c = corners[i + 1];
    if (c) {
      parts.push(`L${r1(c.enter.x)} ${r1(c.enter.y)}`);
      parts.push(`Q${r1(c.corner.x)} ${r1(c.corner.y)} ${r1(c.leave.x)} ${r1(c.leave.y)}`);
    } else {
      parts.push(`L${r1(q.x)} ${r1(q.y)}`);
    }
  }
  return parts.join(' ');
}
