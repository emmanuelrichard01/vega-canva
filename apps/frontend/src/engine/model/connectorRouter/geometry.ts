/**
 * Shared geometry for connector routing: axis-aligned rectangles, the four
 * travel directions, and flat point helpers. Pure and allocation-light,
 * because the router runs inside drag frames.
 */

export interface Pt {
  x: number;
  y: number;
}

/** An axis-aligned rectangle by its extremes, the shape rbush and the router share. */
export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Travel directions: +x, -x, +y, -y. */
export type Dir = 0 | 1 | 2 | 3;

export const DX: readonly number[] = [1, -1, 0, 0];
export const DY: readonly number[] = [0, 0, 1, -1];

export function opposite(d: Dir): Dir {
  return (d ^ 1) as Dir;
}

export function isHorizontal(d: Dir): boolean {
  return d < 2;
}

/** The direction a unit vector points along; ties go to the horizontal axis. */
export function dirOf(v: Pt): Dir {
  if (Math.abs(v.x) >= Math.abs(v.y)) return v.x >= 0 ? 0 : 1;
  return v.y >= 0 ? 2 : 3;
}

export function portDir(port: 'top' | 'right' | 'bottom' | 'left'): Dir {
  switch (port) {
    case 'right': return 0;
    case 'left': return 1;
    case 'bottom': return 2;
    case 'top': return 3;
  }
}

export function inflate(r: Rect, m: number): Rect {
  return { minX: r.minX - m, minY: r.minY - m, maxX: r.maxX + m, maxY: r.maxY + m };
}

export function rectOf(box: { x: number; y: number; width: number; height: number }): Rect {
  return { minX: box.x, minY: box.y, maxX: box.x + box.width, maxY: box.y + box.height };
}

export function containsStrict(r: Rect, p: Pt): boolean {
  return p.x > r.minX && p.x < r.maxX && p.y > r.minY && p.y < r.maxY;
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
}

export function unionRect(a: Rect, b: Rect): Rect {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

export function boundsOfPoints(points: readonly Pt[]): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

export function toPairs(flat: readonly number[]): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push({ x: flat[i], y: flat[i + 1] });
  return out;
}

export function toFlat(points: readonly Pt[]): number[] {
  const out: number[] = new Array(points.length * 2);
  for (let i = 0; i < points.length; i += 1) {
    out[i * 2] = points[i].x;
    out[i * 2 + 1] = points[i].y;
  }
  return out;
}

const EPS = 1e-6;

/**
 * Drop repeated points and the middle of any three collinear ones.
 *
 * Works for any polyline, but it is written for orthogonal routes, where the
 * search produces a vertex at every grid line it crosses and only the turns
 * mean anything.
 */
export function simplify(points: readonly Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < EPS && Math.abs(last.y - p.y) < EPS) continue;
    if (out.length >= 2) {
      const a = out[out.length - 2];
      const b = out[out.length - 1];
      const cross = (b.x - a.x) * (p.y - b.y) - (b.y - a.y) * (p.x - b.x);
      const dot = (b.x - a.x) * (p.x - b.x) + (b.y - a.y) * (p.y - b.y);
      // Collinear and continuing forward: the middle point is not a turn.
      if (Math.abs(cross) < EPS && dot >= 0) {
        out[out.length - 1] = p;
        continue;
      }
    }
    out.push(p);
  }
  return out;
}
