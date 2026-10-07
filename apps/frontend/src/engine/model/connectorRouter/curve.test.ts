import { describe, expect, it } from 'vitest';
import { connectorRoute, type Box } from '../connector';
import { CURVE_CLEARANCE, fitCurve, intrusion } from './curve';
import { inflate, rectOf, type Pt, type Rect } from './geometry';
import { OBSTACLE_MARGIN, type Obstacle } from './router';

const box = (x: number, y: number, width = 100, height = 60): Box => ({ x, y, width, height });

function route(boxes: Record<string, Box>, obstacles: Box[], fromPort = 'right', toPort = 'left', extra = {}) {
  return connectorRoute(
    { nodeId: 'a', port: fromPort as never },
    { nodeId: 'b', port: toPort as never },
    'curved',
    (id) => boxes[id] ?? null,
    null,
    {
      avoid: true,
      obstaclesIn: () =>
        obstacles.map((o, i): Obstacle => ({ id: `o${i}`, rect: inflate(rectOf(o), OBSTACLE_MARGIN) })),
      ...extra,
    }
  ).points;
}

/** Largest change of heading between consecutive samples, in degrees. */
function sharpestTurn(points: Pt[]): number {
  let worst = 0;
  for (let i = 1; i + 1 < points.length; i += 1) {
    const a = Math.atan2(points[i].y - points[i - 1].y, points[i].x - points[i - 1].x);
    const b = Math.atan2(points[i + 1].y - points[i].y, points[i + 1].x - points[i].x);
    let d = Math.abs(b - a);
    if (d > Math.PI) d = 2 * Math.PI - d;
    worst = Math.max(worst, (d * 180) / Math.PI);
  }
  return worst;
}

const clear = (o: Box): Rect => inflate(rectOf(o), CURVE_CLEARANCE);

describe('curved routes that avoid', () => {
  const ends = { a: box(0, 0), b: box(500, 0) };

  it('a straight shot stays straight', () => {
    const pts = route(ends, []);
    expect(pts).toEqual([{ x: 100, y: 30 }, { x: 500, y: 30 }]);
  });

  it('bends around a box in the way, without entering it', () => {
    const blocker = box(220, -40, 80, 140);
    const pts = route(ends, [blocker]);
    expect(intrusion(pts, [clear(blocker)])).toBe(-1);
    expect(pts.length).toBeGreaterThan(10);
    // Smooth: no kink anywhere along the sampled curve.
    expect(sharpestTurn(pts)).toBeLessThan(35);
  });

  it('threads a crowded field with no sample inside any obstacle', () => {
    const field = [box(160, -60, 60, 80), box(260, 30, 70, 90), box(360, -80, 50, 100), box(180, 120, 160, 40)];
    const pts = route({ a: box(0, 0), b: box(520, 60) }, field);
    expect(intrusion(pts, field.map(clear))).toBe(-1);
    expect(sharpestTurn(pts)).toBeLessThan(45);
  });

  it('never loops back through its own ends when the port faces away', () => {
    const pts = route({ a: box(0, 0), b: box(-400, 0) }, [], 'right', 'right');
    const own = [inflate(rectOf(box(0, 0)), -1), inflate(rectOf(box(-400, 0)), -1)];
    expect(intrusion(pts, own)).toBe(-1);
    // It leaves along the port normal.
    expect(pts[1].x).toBeGreaterThan(100);
    expect(Math.abs(pts[1].y - 30)).toBeLessThan(2);
  });

  it('is identical whatever order the obstacles arrive in', () => {
    const field = [box(160, -60, 60, 80), box(260, 30, 70, 90), box(360, -80, 50, 100)];
    const forward = route({ a: box(0, 0), b: box(520, 60) }, field);
    const backward = route({ a: box(0, 0), b: box(520, 60) }, [...field].reverse());
    expect(JSON.stringify(backward)).toBe(JSON.stringify(forward));
  });

  it('fans apart from a parallel curve between the same pair', () => {
    const blocker = box(220, -40, 80, 140);
    const one = route(ends, [blocker], 'right', 'left', { pairShift: -8 });
    const two = route(ends, [blocker], 'right', 'left', { pairShift: 8 });
    expect(one[0].y).not.toBe(two[0].y);
    const mid = (p: Pt[]) => p[Math.floor(p.length / 2)];
    expect(Math.hypot(mid(one).x - mid(two).x, mid(one).y - mid(two).y)).toBeGreaterThan(4);
  });
});

describe('fitCurve', () => {
  it('pins corners until a tight turn clears the box it goes around', () => {
    // An elbow hugging a box corner closely: a free fit would cut into it.
    const skeleton = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: -60 },
      { x: 120, y: -60 },
      { x: 120, y: 0 },
      { x: 140, y: 0 },
    ];
    const tight: Rect = { minX: 24, minY: -56, maxX: 116, maxY: 40 };
    const pts = fitCurve(skeleton, [tight]);
    expect(intrusion(pts, [tight])).toBe(-1);
  });

  it('a curve without obstacles to avoid stays a bare Bézier', () => {
    const pts = connectorRoute(
      { nodeId: 'a', port: 'right' },
      { nodeId: 'b', port: 'left' },
      'curved',
      (id) => ({ a: box(0, 0), b: box(400, 200) } as Record<string, Box>)[id] ?? null
    ).points;
    expect(pts.length).toBe(49);
    expect(pts[0]).toEqual({ x: 100, y: 30 });
    expect(pts[pts.length - 1]).toEqual({ x: 400, y: 230 });
  });
});
