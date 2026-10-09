import { describe, expect, it } from 'vitest';
import { findCorners, fitClosedRing, isSliver } from './curveFit';
import { flattenPath } from './pathGeometry';
import type { Point } from './schema';

function circle(cx: number, cy: number, r: number, n: number): Point[] {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });
}

/** Largest distance from any fitted point to the circle. */
function radialError(points: Point[], cx: number, cy: number, r: number): number {
  return Math.max(...points.map((p) => Math.abs(Math.hypot(p.x - cx, p.y - cy) - r)));
}

describe('fitClosedRing', () => {
  it('gives a rectangle back as four straight segments', () => {
    const rect = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 40 },
      { x: 0, y: 40 },
      { x: 0, y: 20 },
    ];
    const fitted = fitClosedRing(rect)!;
    expect(fitted.segments).toHaveLength(4);
    expect(fitted.segments.every((s) => s.cp1x === undefined)).toBe(true);
  });

  it('fits a finely flattened circle with a handful of smooth curves', () => {
    const ring = circle(0, 0, 50, 240);
    const fitted = fitClosedRing(ring)!;
    expect(fitted.segments.length).toBeLessThanOrEqual(12);
    expect(fitted.segments.every((s) => s.cp1x !== undefined)).toBe(true);
    expect(radialError(flattenPath(fitted), 0, 0, 50)).toBeLessThan(0.5);
  });

  it('does not mistake the facets of a small circle for corners', () => {
    expect(findCorners(circle(0, 0, 3, 16))).toEqual([]);
  });

  it('keeps the corner where two outlines meet', () => {
    // A half-disc: a diameter and an arc, cornered at both ends.
    const arc = Array.from({ length: 60 }, (_, i) => {
      const a = Math.PI + (i / 59) * Math.PI;
      return { x: 50 * Math.cos(a), y: 50 * Math.sin(a) };
    });
    const corners = findCorners(arc);
    expect(corners).toContain(0);
    expect(corners).toContain(59);
  });

  it('refuses a degenerate ring', () => {
    expect(fitClosedRing([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBeNull();
  });
});

describe('isSliver', () => {
  it('flags a hairline and keeps a real shape', () => {
    expect(isSliver([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 0.001 }, { x: 0, y: 0.001 }])).toBe(true);
    expect(isSliver([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }])).toBe(false);
  });
});
