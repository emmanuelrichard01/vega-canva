import { describe, it, expect } from 'vitest';
import { simplifyPoints } from './simplify';

describe('simplifyPoints', () => {
  it('collapses a straight run to its two ends', () => {
    const line = Array.from({ length: 50 }, (_, i) => ({ x: i * 4, y: 0 }));
    expect(simplifyPoints(line)).toEqual([{ x: 0, y: 0 }, { x: 196, y: 0 }]);
  });

  it('keeps a corner, which is the whole point', () => {
    const corner = [
      ...Array.from({ length: 20 }, (_, i) => ({ x: i * 5, y: 0 })),
      ...Array.from({ length: 20 }, (_, i) => ({ x: 95, y: i * 5 })),
    ];
    const out = simplifyPoints(corner);
    expect(out.length).toBeLessThan(6);
    // The turn survives.
    expect(out.some((p) => p.x === 95 && p.y === 0)).toBe(true);
  });

  it('never drops the endpoints', () => {
    const wiggle = Array.from({ length: 40 }, (_, i) => ({ x: i, y: Math.sin(i) * 8 }));
    const out = simplifyPoints(wiggle);
    expect(out[0]).toEqual(wiggle[0]);
    expect(out[out.length - 1]).toEqual(wiggle[wiggle.length - 1]);
  });

  it('stays within tolerance of the original path', () => {
    const curve = Array.from({ length: 200 }, (_, i) => ({ x: i, y: Math.sin(i / 12) * 40 }));
    const out = simplifyPoints(curve, 1.2);
    expect(out.length).toBeLessThan(curve.length / 3);
    // Distance to the simplified *polyline*, not to its nearest vertex — the
    // tolerance bounds how far a dropped point strays from the segment that
    // replaced it, and a point mid-segment is legitimately far from both ends.
    const toSegment = (p: {x:number;y:number}, a: {x:number;y:number}, b: {x:number;y:number}) => {
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = dx * dx + dy * dy;
      if (len === 0) return Math.hypot(p.x - a.x, p.y - a.y);
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len));
      return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
    };
    for (const p of curve) {
      let nearest = Infinity;
      for (let i = 1; i < out.length; i++) nearest = Math.min(nearest, toSegment(p, out[i - 1], out[i]));
      expect(nearest).toBeLessThanOrEqual(1.2);
    }
  });

  it('survives a stroke where every point is a corner', () => {
    // Recursion would go one frame deep per point here; the iterative form
    // is what makes this a test rather than a stack overflow.
    const zigzag = Array.from({ length: 5000 }, (_, i) => ({ x: i, y: i % 2 ? 60 : 0 }));
    expect(() => simplifyPoints(zigzag)).not.toThrow();
  });

  it('leaves a two-point stroke alone', () => {
    const pair = [{ x: 0, y: 0 }, { x: 10, y: 10 }];
    expect(simplifyPoints(pair)).toEqual(pair);
  });
});
