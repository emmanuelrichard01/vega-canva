import { describe, expect, it } from 'vitest';
import { routeOrthogonalAvoiding, OBSTACLE_MARGIN, STUB, type Obstacle } from './router';
import { inflate, type Pt, type Rect } from './geometry';

const box = (x: number, y: number, w: number, h: number): Rect => ({ minX: x, minY: y, maxX: x + w, maxY: y + h });
const obstacle = (id: string, r: Rect): Obstacle => ({ id, rect: inflate(r, OBSTACLE_MARGIN) });

/** True when any segment of the polyline passes through the rectangle's interior. */
function crossesInterior(points: Pt[], r: Rect): boolean {
  for (let i = 0; i + 1 < points.length; i += 1) {
    const p = points[i];
    const q = points[i + 1];
    const steps = 64;
    for (let s = 1; s < steps; s += 1) {
      const t = s / steps;
      const x = p.x + (q.x - p.x) * t;
      const y = p.y + (q.y - p.y) * t;
      if (x > r.minX + 1e-6 && x < r.maxX - 1e-6 && y > r.minY + 1e-6 && y < r.maxY - 1e-6) return true;
    }
  }
  return false;
}

function isOrthogonal(points: Pt[]): boolean {
  for (let i = 0; i + 1 < points.length; i += 1) {
    if (points[i].x !== points[i + 1].x && points[i].y !== points[i + 1].y) return false;
  }
  return true;
}

function bends(points: Pt[]): number {
  return Math.max(0, points.length - 2);
}

describe('routeOrthogonalAvoiding', () => {
  const A = box(0, 0, 100, 60);
  const C = box(400, 0, 100, 60);

  it('runs straight when nothing is in the way', () => {
    const r = routeOrthogonalAvoiding({
      a: { x: 100, y: 30 },
      dirA: 0,
      b: { x: 400, y: 30 },
      dirB: 1,
      ownA: inflate(A, OBSTACLE_MARGIN),
      ownB: inflate(C, OBSTACLE_MARGIN),
    });
    expect(r.points).toEqual([{ x: 100, y: 30 }, { x: 400, y: 30 }]);
    expect(r.degraded).toBe(false);
  });

  it('avoids a box centred between the ends, bending only because it must', () => {
    const B = box(200, -20, 100, 100);
    const r = routeOrthogonalAvoiding({
      a: { x: 100, y: 30 },
      dirA: 0,
      b: { x: 400, y: 30 },
      dirB: 1,
      ownA: inflate(A, OBSTACLE_MARGIN),
      ownB: inflate(C, OBSTACLE_MARGIN),
      obstaclesIn: () => [obstacle('B', B)],
    });
    expect(isOrthogonal(r.points)).toBe(true);
    expect(crossesInterior(r.points, inflate(B, OBSTACLE_MARGIN))).toBe(false);
    expect(bends(r.points)).toBeGreaterThanOrEqual(2);
    expect(r.points[0]).toEqual({ x: 100, y: 30 });
    expect(r.points[r.points.length - 1]).toEqual({ x: 400, y: 30 });
    expect(r.obstacleIds).toEqual(['B']);
  });

  it('wraps its own box when the port faces away from the target', () => {
    // Leaves A's right side, target is to A's left.
    const T = box(-400, 0, 100, 60);
    const r = routeOrthogonalAvoiding({
      a: { x: 100, y: 30 },
      dirA: 0,
      b: { x: -300, y: 30 },
      dirB: 0,
      ownA: inflate(A, OBSTACLE_MARGIN),
      ownB: inflate(T, OBSTACLE_MARGIN),
    });
    expect(isOrthogonal(r.points)).toBe(true);
    // First move is to the right, by at least the stub.
    expect(r.points[1].y).toBe(30);
    expect(r.points[1].x).toBeGreaterThanOrEqual(100 + STUB);
    expect(crossesInterior(r.points, A)).toBe(false);
    // Arrives travelling left into the target's right port.
    const last = r.points[r.points.length - 1];
    const prev = r.points[r.points.length - 2];
    expect(prev.y).toBe(last.y);
    expect(prev.x).toBeGreaterThan(last.x);
  });

  it('still routes when an obstacle overlaps an endpoint', () => {
    const overlapping = box(80, 10, 60, 40); // covers A's right port
    const r = routeOrthogonalAvoiding({
      a: { x: 100, y: 30 },
      dirA: 0,
      b: { x: 400, y: 30 },
      dirB: 1,
      ownA: inflate(A, OBSTACLE_MARGIN),
      ownB: inflate(C, OBSTACLE_MARGIN),
      obstaclesIn: () => [obstacle('over', overlapping)],
    });
    expect(r.degraded).toBe(false);
    expect(r.points.length).toBeGreaterThanOrEqual(2);
  });

  it('is identical whatever order the obstacles arrive in', () => {
    const obstacles = [
      obstacle('p', box(180, -60, 60, 80)),
      obstacle('q', box(260, 40, 60, 80)),
      obstacle('r', box(200, 140, 120, 40)),
      obstacle('s', box(330, -120, 40, 160)),
    ];
    const run = (list: Obstacle[]) =>
      routeOrthogonalAvoiding({
        a: { x: 100, y: 30 },
        dirA: 0,
        b: { x: 400, y: 30 },
        dirB: 1,
        ownA: inflate(A, OBSTACLE_MARGIN),
        ownB: inflate(C, OBSTACLE_MARGIN),
        obstaclesIn: () => list,
      }).points;
    const forward = run(obstacles);
    const reversed = run([...obstacles].reverse());
    const shuffled = run([obstacles[2], obstacles[0], obstacles[3], obstacles[1]]);
    expect(JSON.stringify(reversed)).toBe(JSON.stringify(forward));
    expect(JSON.stringify(shuffled)).toBe(JSON.stringify(forward));
    for (const o of obstacles) expect(crossesInterior(forward, o.rect)).toBe(false);
  });

  it('falls back to a stubbed route, flagged degraded, when the budget runs out', () => {
    const walls: Obstacle[] = [];
    for (let i = 0; i < 12; i += 1) walls.push(obstacle(`w${i}`, box(150 + i * 20, -200 + (i % 2) * 60, 10, 380)));
    const r = routeOrthogonalAvoiding({
      a: { x: 100, y: 30 },
      dirA: 0,
      b: { x: 400, y: 30 },
      dirB: 1,
      ownA: inflate(A, OBSTACLE_MARGIN),
      ownB: inflate(C, OBSTACLE_MARGIN),
      obstaclesIn: () => walls,
      maxExpansions: 5,
    });
    expect(r.degraded).toBe(true);
    expect(isOrthogonal(r.points)).toBe(true);
    // The stub survives the fallback: it still leaves along the port normal.
    expect(r.points[1].y).toBe(30);
    expect(r.points[1].x).toBeGreaterThanOrEqual(100 + STUB);
  });

  it('prefers the middle of a channel over hugging a box', () => {
    // Two boxes stacked with a wide gap; the route must pass between them.
    const top = box(200, -200, 100, 190);
    const bottom = box(200, 110, 100, 190);
    const r = routeOrthogonalAvoiding({
      a: { x: 100, y: 30 },
      dirA: 0,
      b: { x: 400, y: 70 },
      dirB: 1,
      ownA: inflate(A, OBSTACLE_MARGIN),
      ownB: inflate(box(400, 40, 100, 60), OBSTACLE_MARGIN),
      obstaclesIn: () => [obstacle('top', top), obstacle('bottom', bottom)],
    });
    for (const o of [top, bottom]) expect(crossesInterior(r.points, inflate(o, OBSTACLE_MARGIN))).toBe(false);
  });
});
