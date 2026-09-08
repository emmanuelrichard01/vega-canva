import { describe, it, expect } from 'vitest';
import { marchingSquares, stitchSegments } from './marchingSquares';

describe('marchingSquares & stitchSegments', () => {
  it('traces a circle level set and stitches into closed or continuous polylines', () => {
    // x^2 + y^2 - 4 = 0 (circle of radius 2)
    const f = (x: number, y: number) => x * x + y * y - 4;
    const segments = marchingSquares(f, {
      xMin: -3,
      xMax: 3,
      yMin: -3,
      yMax: 3,
      resolution: 30,
    });

    expect(segments.length).toBeGreaterThan(10);

    const stitched = stitchSegments(segments, 0.2);
    expect(stitched.length).toBeGreaterThan(0);

    // Each point in stitched line must be close to radius 2
    for (const line of stitched) {
      for (const p of line) {
        const r = Math.hypot(p.x, p.y);
        expect(r).toBeCloseTo(2, 0.5);
      }
    }
  });

  it('stitches simple connected segments', () => {
    const segments: Array<[{ x: number; y: number }, { x: number; y: number }]> = [
      [{ x: 0, y: 0 }, { x: 1, y: 1 }],
      [{ x: 1, y: 1 }, { x: 2, y: 0 }],
      [{ x: 2, y: 0 }, { x: 3, y: 1 }],
    ];
    const stitched = stitchSegments(segments, 1e-4);
    expect(stitched.length).toBe(1);
    expect(stitched[0].length).toBe(4);
    expect(stitched[0][0]).toEqual({ x: 0, y: 0 });
    expect(stitched[0][3]).toEqual({ x: 3, y: 1 });
  });
});
