import { describe, it, expect } from 'vitest';
import { roundCorners, ELBOW_RADIUS, type Point } from './connector';

const dist = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

describe('roundCorners', () => {
  it('leaves the ends exactly where it found them', () => {
    // A connector is bound to two objects. Moving its endpoints to soften a
    // corner would detach it from what it points at.
    const path: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ];
    const out = roundCorners(path);

    expect(out[0]).toEqual({ x: 0, y: 0 });
    expect(out.at(-1)).toEqual({ x: 100, y: 100 });
  });

  it('replaces a sharp corner with a turn', () => {
    const out = roundCorners([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ]);

    // The corner itself is gone, and something rounder is in its place.
    expect(out).not.toContainEqual({ x: 100, y: 0 });
    expect(out.length).toBeGreaterThan(3);
  });

  it('keeps the turn inside the radius it was given', () => {
    const corner = { x: 100, y: 0 };
    const out = roundCorners([{ x: 0, y: 0 }, corner, { x: 100, y: 100 }]);

    // Every inserted point stays within the rounding radius of the corner it
    // replaced -- the connector must not bow out into a shape of its own.
    for (const p of out.slice(1, -1)) {
      expect(dist(p, corner)).toBeLessThanOrEqual(ELBOW_RADIUS + 0.01);
    }
  });

  it('does not turn a short segment inside out', () => {
    /**
     * The failure mode of every naive corner-rounder: two corners on one
     * short segment each eat more than half of it, cross over, and the elbow
     * inverts. The radius is clamped to just under half the shorter side.
     */
    const out = roundCorners(
      [
        { x: 0, y: 0 },
        { x: 6, y: 0 },
        { x: 6, y: 6 },
        { x: 12, y: 6 },
      ],
      ELBOW_RADIUS
    );

    // Monotonic in x: no point doubles back past one before it.
    const xs = out.map((p) => p.x);
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThanOrEqual(xs[i - 1] - 0.01);
  });

  it('leaves a straight run alone', () => {
    const straight: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
    ];
    expect(roundCorners(straight)).toEqual(straight);
  });

  it('is a no-op at zero radius', () => {
    const path: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ];
    expect(roundCorners(path, 0)).toEqual(path);
  });

  it('handles a degenerate corner without producing NaN', () => {
    // A zero-length segment would divide by zero in the direction maths.
    const out = roundCorners([
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
    for (const p of out) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });

  it('rounds every corner of a three-segment route', () => {
    const out = roundCorners([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 100 },
      { x: 100, y: 100 },
    ]);

    expect(out).not.toContainEqual({ x: 50, y: 0 });
    expect(out).not.toContainEqual({ x: 50, y: 100 });
  });
});
