/**
 * Operations on a finished route: user segment nudges, and the one path
 * builder every reader draws from.
 */

import type { Pt } from './geometry';

/** A user's offset of one interior segment, along that segment's normal. */
export interface SegmentNudge {
  /** Index of the segment, counting from the first leg out of the start. */
  seg: number;
  offset: number;
  /** How many segments the route had when the nudge was made. */
  of: number;
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
 * Apply stored nudges to an orthogonal route.
 *
 * Only interior segments move (the first and last legs are bound to their
 * ports), and a nudge recorded against a route of a different shape is
 * ignored: once the topology changes, "the third segment" names a different
 * segment.
 */
export function applyNudges(points: readonly Pt[], nudges: readonly SegmentNudge[] | undefined): Pt[] {
  const out = points.map((p) => ({ ...p }));
  if (!nudges || nudges.length === 0) return out;
  const count = segmentCount(out);
  for (const n of nudges) {
    if (n.of !== count) continue;
    if (n.seg <= 0 || n.seg >= count - 1) continue;
    moveSegment(out, n.seg, n.offset);
  }
  return out;
}

/** Shift segment `seg` along its normal; its neighbours stretch to stay joined. */
export function moveSegment(points: Pt[], seg: number, offset: number): void {
  const p = points[seg];
  const q = points[seg + 1];
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
