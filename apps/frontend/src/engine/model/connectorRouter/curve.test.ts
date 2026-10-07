import { describe, expect, it } from 'vitest';
import { connectorRoute, type Box } from '../connector';
import { CURVE_CLEARANCE, fitCurve, intrusion } from './curve';
import { inflate, rectOf, type Pt, type Rect } from './geometry';
import { OBSTACLE_MARGIN, STUB, type Obstacle } from './router';

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

function rng(seed: number) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

/** A field of boxes between two ends, none overlapping either end's box. */
function field(seed: number): { ends: Record<string, Box>; obstacles: Box[] } {
  const r = rng(seed);
  const a = box(0, r() * 300);
  const b = box(700, r() * 300);
  const obstacles: Box[] = [];
  const near = (o: Box, e: Box) =>
    o.x < e.x + e.width + 30 && o.x + o.width > e.x - 30 && o.y < e.y + e.height + 30 && o.y + o.height > e.y - 30;
  while (obstacles.length < 8) {
    const o = box(140 + r() * 440, -120 + r() * 520, 40 + r() * 80, 30 + r() * 70);
    if (!near(o, a) && !near(o, b)) obstacles.push(o);
  }
  return { ends: { a, b }, obstacles };
}

describe('curved routes across random fields', () => {
  const seeds = Array.from({ length: 40 }, (_, i) => i + 1);

  it('never puts a sampled point inside an obstacle grown by the clearance', () => {
    for (const seed of seeds) {
      const { ends, obstacles } = field(seed);
      const pts = route(ends, obstacles);
      expect(intrusion(pts, obstacles.map(clear)), `seed ${seed}`).toBe(-1);
    }
  });

  it('keeps its tangent continuous: no kink between consecutive samples', () => {
    for (const seed of seeds) {
      const { ends, obstacles } = field(seed);
      const pts = route(ends, obstacles);
      expect(sharpestTurn(pts), `seed ${seed}`).toBeLessThan(30);
    }
  });

  it('leaves and arrives along the port normals', () => {
    for (const seed of seeds.slice(0, 10)) {
      const { ends, obstacles } = field(seed);
      const pts = route(ends, obstacles);
      expect(Math.abs(pts[1].y - pts[0].y), `seed ${seed}`).toBeLessThan(1e-3);
      expect(pts[1].x).toBeGreaterThan(pts[0].x);
      const n = pts.length;
      expect(Math.abs(pts[n - 1].y - pts[n - 2].y), `seed ${seed}`).toBeLessThan(1e-3);
      expect(pts[n - 2].x).toBeLessThan(pts[n - 1].x);
    }
  });

  it('is identical whatever order the obstacles arrive in', () => {
    for (const seed of seeds.slice(0, 10)) {
      const { ends, obstacles } = field(seed);
      const shuffled = [...obstacles].sort((p, q) => (p.x * 7 + p.y) % 13 - (q.x * 7 + q.y) % 13);
      const forward = route(ends, obstacles);
      const again = connectorRoute(
        { nodeId: 'a', port: 'right' },
        { nodeId: 'b', port: 'left' },
        'curved',
        (id) => ends[id] ?? null,
        null,
        {
          avoid: true,
          obstaclesIn: () =>
            shuffled.map((o): Obstacle => ({ id: `o${obstacles.indexOf(o)}`, rect: inflate(rectOf(o), OBSTACLE_MARGIN) })),
        }
      ).points;
      expect(JSON.stringify(again)).toBe(JSON.stringify(forward));
    }
  });
});

describe('fitCurve shape', () => {
  it('keeps a long straight run straight between two turns', () => {
    const skeleton = [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 400 },
      { x: 80, y: 400 },
    ];
    const pts = fitCurve(skeleton, []);
    // Points on the long vertical leg, away from both turns, sit exactly on it.
    const onLeg = pts.filter((p) => p.y > 120 && p.y < 280);
    for (const p of onLeg) expect(p.x).toBeCloseTo(40, 6);
  });

  it('turns a short jog between two long runs into a gentle S, not a wiggle', () => {
    const skeleton = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 10 },
      { x: 400, y: 10 },
    ];
    const pts = fitCurve(skeleton, []);
    expect(sharpestTurn(pts)).toBeLessThan(12);
  });
});

describe('curved ends when a port faces away', () => {
  /** Heading changes, signed, over the first `reach` units from one end. */
  function headings(points: Pt[], fromEnd: boolean, reach: number): { steps: number[]; minRadius: number } {
    const pts = fromEnd ? [...points].reverse() : points;
    const steps: number[] = [];
    let minRadius = Infinity;
    let walked = 0;
    let prev: number | null = null;
    for (let i = 0; i + 1 < pts.length && walked < reach; i += 1) {
      const dx = pts[i + 1].x - pts[i].x;
      const dy = pts[i + 1].y - pts[i].y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-9) continue;
      const a = Math.atan2(dy, dx);
      if (prev !== null) {
        let d = a - prev;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        steps.push((d * 180) / Math.PI);
        if (Math.abs(d) > 1e-3) minRadius = Math.min(minRadius, len / Math.abs(d));
      }
      prev = a;
      walked += len;
    }
    return { steps, minRadius };
  }

  // The target sits beside the source, its port on the far side: the route
  // has to pass it and come back into the port, a U a short stub long.
  const cases: Array<{ name: string; b: Box; fromPort: string; toPort: string }> = [];
  for (const dy of [-40, -20, 20, 40]) {
    cases.push({ name: `right of it, port away, dy ${dy}`, b: box(130, dy), fromPort: 'auto', toPort: 'right' });
    cases.push({ name: `left of it, port away, dy ${dy}`, b: box(-130, dy), fromPort: 'auto', toPort: 'left' });
  }
  cases.push({ name: 'above it, entered from the side', b: box(0, -60), fromPort: 'auto', toPort: 'right' });
  cases.push({ name: 'source port facing away', b: box(-220, 10), fromPort: 'right', toPort: 'auto' });

  it('reaches the port along its normal, turning one way, with no teardrop', () => {
    for (const c of cases) {
      for (const avoid of [true, false]) {
        const boxes = { a: box(0, 0), b: c.b };
        const r = connectorRoute(
          { nodeId: 'a', port: c.fromPort as never },
          { nodeId: 'b', port: c.toPort as never },
          'curved',
          (id) => boxes[id as 'a' | 'b'] ?? null,
          null,
          { avoid }
        );
        const pts = r.points;
        const label = `${c.name}, avoid ${avoid}`;
        expect(sharpestTurn(pts), label).toBeLessThan(30);
        const skeleton = r.skeleton ?? pts;
        for (const fromEnd of [false, true]) {
          const sk = fromEnd ? [...skeleton].reverse() : skeleton;
          const p = fromEnd ? [...pts].reverse() : pts;
          // Leaves (or arrives) along the stub the router gave the port.
          const sx = Math.sign(sk[1].x - sk[0].x);
          const sy = Math.sign(sk[1].y - sk[0].y);
          expect(Math.sign(p[1].x - p[0].x), label).toBe(sx);
          expect(Math.sign(p[1].y - p[0].y), label).toBe(sy);
          if (sk.length < 4) continue;
          const stub = { x: sk[1].x - sk[0].x, y: sk[1].y - sk[0].y };
          const far = { x: sk[3].x - sk[2].x, y: sk[3].y - sk[2].y };
          // Only a U (the leg after the turn runs back the way the stub came).
          if (stub.x * far.x + stub.y * far.y >= 0) continue;
          const width = Math.hypot(sk[2].x - sk[1].x, sk[2].y - sk[1].y);
          const { steps, minRadius } = headings(p, false, Math.hypot(stub.x, stub.y) + width + 20);
          const net = steps.reduce((s, d) => s + d, 0);
          // Turns steadily one way round the U, never back on itself...
          const back = steps.filter((d) => Math.sign(d) !== Math.sign(net) && Math.abs(d) > 1);
          expect(back, label).toEqual([]);
          // ...and round, not pinched into a teardrop at the port: a U as
          // wide as a stub or less is a half circle, a wider one turns at
          // least a stub's radius.
          expect(minRadius, label).toBeGreaterThan(0.8 * Math.min(width / 2, STUB));
        }
      }
    }
  });
});
