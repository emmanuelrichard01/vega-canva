import { describe, it, expect } from 'vitest';
import { roughEllipse, roughLoop, roughPolyline, isSampledCurve, ellipseRing, profileFor } from './rough';
import { roughShape } from './roughShape';
import { shapeToPath } from './shapeToPath';
import { flattenPath, subpathsOf } from './pathGeometry';
import type { Point, ShapeNode } from './schema';

type Seg = { from: Point; c1: Point; c2: Point; to: Point } | { from: Point; to: Point };

/** Every subpath of an M/C/L path, as segments. */
function parse(d: string): Seg[][] {
  const out: Seg[][] = [];
  const tokens = d.trim().split(/\s+/);
  let i = 0;
  let cur: Point = { x: 0, y: 0 };
  const take = (count: number) => {
    const v = tokens.slice(i, i + count).map(Number);
    i += count;
    return v;
  };
  while (i < tokens.length) {
    const cmd = tokens[i++];
    if (cmd === 'M') {
      const [x, y] = take(2);
      cur = { x, y };
      out.push([]);
    } else if (cmd === 'C') {
      const v = take(6);
      const to = { x: v[4], y: v[5] };
      out[out.length - 1].push({ from: cur, c1: { x: v[0], y: v[1] }, c2: { x: v[2], y: v[3] }, to });
      cur = to;
    } else if (cmd === 'L') {
      const [x, y] = take(2);
      const to = { x, y };
      out[out.length - 1].push({ from: cur, to });
      cur = to;
    } else if (cmd === 'Z') {
      // closes; nothing to sample beyond the last segment
    } else {
      throw new Error(`unexpected command ${cmd}`);
    }
  }
  return out;
}

/** Dense points along one subpath, including inside each cubic. */
function sample(segs: Seg[], per = 12): Point[] {
  const pts: Point[] = [];
  for (const s of segs) {
    for (let k = 0; k <= per; k += 1) {
      const t = k / per;
      if ('c1' in s) {
        const u = 1 - t;
        pts.push({
          x: u * u * u * s.from.x + 3 * u * u * t * s.c1.x + 3 * u * t * t * s.c2.x + t * t * t * s.to.x,
          y: u * u * u * s.from.y + 3 * u * u * t * s.c1.y + 3 * u * t * t * s.c2.y + t * t * t * s.to.y,
        });
      } else {
        pts.push({ x: s.from.x + (s.to.x - s.from.x) * t, y: s.from.y + (s.to.y - s.from.y) * t });
      }
    }
  }
  return pts;
}

function distToPolyline(p: Point, ring: readonly Point[], closed: boolean): number {
  let best = Infinity;
  const count = closed ? ring.length : ring.length - 1;
  for (let i = 0; i < count; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
    best = Math.min(best, Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)));
  }
  return best;
}

/** Total absolute turning along a polyline, in radians. */
function absTurning(pts: readonly Point[]): number {
  let sum = 0;
  let prev: { x: number; y: number } | null = null;
  for (let i = 1; i < pts.length; i += 1) {
    const dx = pts[i].x - pts[i - 1].x;
    const dy = pts[i].y - pts[i - 1].y;
    if (Math.hypot(dx, dy) < 0.05) continue;
    if (prev) sum += Math.abs(Math.atan2(prev.x * dy - prev.y * dx, prev.x * dx + prev.y * dy));
    prev = { x: dx, y: dy };
  }
  return sum;
}

const shape = (id: string, kind: string, width: number, height: number, extra: Record<string, unknown> = {}) =>
  ({
    id,
    type: 'shape',
    x: 0,
    y: 0,
    width,
    height,
    geometry: { kind },
    appearance: { sketch: 'heavy', stroke: { width: 2 }, ...extra },
  }) as unknown as ShapeNode;

describe('sketched curves are continuous strokes', () => {
  for (const level of ['light', 'medium', 'heavy'] as const) {
    it(`an ellipse is one unbroken lap per pass that stays near the curve (${level})`, () => {
      const d = roughEllipse(100, 70, 100, 70, { seed: 42, level, width: 2 });
      const laps = parse(d);
      expect(laps.length).toBe(profileFor(level).passes);
      for (const lap of laps) {
        for (const p of sample(lap)) {
          const k = Math.hypot((p.x - 100) / 100, (p.y - 70) / 70);
          expect(Math.abs(k - 1) * 70).toBeLessThan(6);
        }
      }
    });
  }

  it('is deterministic for a seed and varies across seeds', () => {
    const a = roughEllipse(0, 0, 80, 50, { seed: 3, level: 'medium' });
    expect(roughEllipse(0, 0, 80, 50, { seed: 3, level: 'medium' })).toBe(a);
    expect(roughEllipse(0, 0, 80, 50, { seed: 4, level: 'medium' })).not.toBe(a);
  });

  it('keeps a lap within a point budget', () => {
    const d = roughEllipse(0, 0, 2000, 1500, { seed: 1, level: 'heavy', width: 8 });
    for (const lap of parse(d)) expect(lap.length).toBeLessThanOrEqual(200);
  });

  it('an open run starts and ends on its endpoints', () => {
    const run: Point[] = [];
    for (let i = 0; i <= 40; i += 1) run.push({ x: i * 6, y: Math.sin(i / 6) * 40 });
    for (const lap of parse(roughLoop(run, { seed: 9, level: 'heavy', width: 2, closed: false }))) {
      const first = lap[0].from;
      const end = lap[lap.length - 1].to;
      expect(Math.hypot(first.x - run[0].x, first.y - run[0].y)).toBeLessThan(0.2);
      expect(Math.hypot(end.x - run[run.length - 1].x, end.y - run[run.length - 1].y)).toBeLessThan(0.2);
    }
  });
});

describe('cusps are drawn without hooks or curls', () => {
  // Every seed, including the ones that used to curl at the seam.
  const seeds = Array.from({ length: 60 }, (_, i) => i + 1);
  for (const kind of ['heart', 'cloud']) {
    it(`${kind}: every lap follows the outline and turns no more than it does`, { timeout: 60000 }, () => {
      const base = shape('x', kind, 160, 140);
      const outline = subpathsOf(shapeToPath(base)).map((s) => flattenPath(s))[0];
      const outlineTurn = absTurning([...outline, outline[0], outline[1]]);
      for (const seed of seeds) {
        const node = shape(`${kind}-${seed}`, kind, 160, 140, { sketchSeed: seed });
        for (const lap of parse(roughShape(node, false).outline)) {
          const pts = sample(lap, 6);
          const far = Math.max(...pts.map((p) => distToPolyline(p, outline, true)));
          expect(far, `${kind} seed ${seed}`).toBeLessThan(6);
          // A hook or a curl adds a turn of π or more; a wobble adds very little.
          expect(absTurning(pts), `${kind} seed ${seed}`).toBeLessThan(outlineTurn + Math.PI * 0.6);
        }
      }
    });
  }
});

describe('tight curves are followed, not cut across', () => {
  it('a thin capsule and a thin ellipse stay on their outline at the ends', () => {
    for (const [kind, w, h] of [['capsule', 130, 14], ['ellipse', 200, 8]] as const) {
      const node = shape(`${kind}-thin`, kind, w, h);
      const ring = subpathsOf(shapeToPath(node)).map((s) => flattenPath(s))[0];
      // The ends, where the outline turns hardest; the straight sides may wander.
      const atEnd = (p: Point) => Math.abs(p.x - w / 2) > w / 2 - h / 2;
      for (const lap of parse(roughShape(node, false).outline)) {
        for (const p of sample(lap).filter(atEnd)) expect(distToPolyline(p, ring, true), kind).toBeLessThan(1.5);
      }
    }
  });

  it('a small ring stays round', () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      for (const lap of parse(roughEllipse(0, 0, 12, 12, { seed, level: 'heavy', width: 2 }))) {
        const dev = sample(lap).map((p) => Math.hypot(p.x, p.y) - 12);
        expect(Math.max(...dev) - Math.min(...dev)).toBeLessThan(2.4);
      }
    }
  });
});

describe('curve treatment is the caller\'s decision', () => {
  const arc: Point[] = [];
  for (let i = 0; i <= 40; i += 1) {
    const a = (Math.PI * i) / 40;
    arc.push({ x: 120 - 110 * Math.cos(a), y: 120 - 100 * Math.sin(a) });
  }

  it('an arc marked asCurve is one subpath per pass; unmarked it is drawn edge by edge', () => {
    const passes = profileFor('medium').passes;
    expect(parse(roughPolyline(arc, { seed: 11, level: 'medium', width: 2, closed: false, asCurve: true })).length).toBe(passes);
    expect(parse(roughPolyline(arc, { seed: 11, level: 'medium', width: 2, closed: false })).length).toBe(40 * passes);
  });

  it('a dense data line keeps every vertex on the stroke', () => {
    // Smooth, densely sampled, with narrow peaks: the kind of run that looks
    // like a curve and is not one. Resampled as a curve its peaks are shaved by
    // three to four units; drawn edge by edge every vertex stays on the line.
    const data: Point[] = [];
    for (let i = 0; i < 200; i += 1) {
      const peak = Math.exp(-(((i % 50) - 25) ** 2) / 18) * -40;
      data.push({ x: i * 3, y: 120 + Math.sin(i / 14) * 30 + peak });
    }
    for (const level of ['light', 'medium', 'heavy'] as const) {
      const stroke = parse(roughPolyline(data, { seed: 5, level, width: 2, closed: false })).flatMap((lap) => sample(lap, 24));
      for (const v of data.slice(1, -1)) {
        const nearest = Math.min(...stroke.map((p) => Math.hypot(p.x - v.x, p.y - v.y)));
        expect(nearest, `${level} at ${v.x}`).toBeLessThan(1);
      }
    }
  });

  it('classifies a 20-gon the same at any size', () => {
    const gon = (r: number) =>
      Array.from({ length: 20 }, (_, i) => ({ x: r * Math.cos((i / 20) * Math.PI * 2), y: r * Math.sin((i / 20) * Math.PI * 2) }));
    expect(isSampledCurve(gon(30), true)).toBe(isSampledCurve(gon(600), true));
    expect(isSampledCurve(ellipseRing(0, 0, 20, 14), true)).toBe(isSampledCurve(ellipseRing(0, 0, 900, 640), true));
  });

  it('a large ring\'s fill boundary is as smooth as its outline', () => {
    for (const level of ['medium', 'heavy'] as const) {
      const node = shape('big', 'ellipse', 900, 900, { sketch: level, fill: [{ type: 'solid', color: '#fff' }] });
      const [ring] = parse(roughShape(node, true).silhouette);
      const pts = ring.map((s) => s.to);
      const dev = pts.map((p) => Math.hypot(p.x - 450, p.y - 450) - 450);
      for (let i = 1; i + 1 < dev.length; i += 1) {
        expect(Math.abs(dev[i - 1] - 2 * dev[i] + dev[i + 1]), `${level} vertex ${i}`).toBeLessThan(0.5);
      }
    }
  });

  it('a dashed stroke is drawn in one lap', () => {
    const node = shape('dashed', 'ellipse', 200, 120, { sketch: 'medium', stroke: { width: 2, dash: [8, 6] } });
    expect(parse(roughShape(node, false).outline).length).toBe(1);
  });
});
