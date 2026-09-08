import { describe, it, expect } from 'vitest';
import { monotoneSplinePoints } from './monotoneSpline';

describe('monotoneSplinePoints', () => {
  it('returns short point arrays without modification', () => {
    expect(monotoneSplinePoints([])).toEqual([]);
    expect(monotoneSplinePoints([{ x: 10, y: 20 }])).toEqual([{ x: 10, y: 20 }]);
    expect(monotoneSplinePoints([{ x: 10, y: 20 }, { x: 30, y: 40 }])).toEqual([
      { x: 10, y: 20 },
      { x: 30, y: 40 },
    ]);
  });

  it('preserves strict monotonicity without overshoot on monotone steps', () => {
    // Strictly increasing sequence
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 5 },
      { x: 20, y: 20 },
      { x: 30, y: 50 },
      { x: 40, y: 100 },
    ];
    const spline = monotoneSplinePoints(points);
    expect(spline.length).toBeGreaterThan(points.length);

    // Every point must be non-decreasing in y
    for (let i = 1; i < spline.length; i += 1) {
      expect(spline[i].y).toBeGreaterThanOrEqual(spline[i - 1].y - 1e-9);
    }
  });

  it('guarantees zero overshoot on flat plateaus', () => {
    // Flat top peak at 100
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 100 },
      { x: 20, y: 100 },
      { x: 30, y: 0 },
    ];
    const spline = monotoneSplinePoints(points);

    // No point should exceed 100 or dip below 0
    for (const p of spline) {
      expect(p.y).toBeLessThanOrEqual(100.0001);
      expect(p.y).toBeGreaterThanOrEqual(-0.0001);
    }
  });

  it('handles transposed coordinates correctly', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 20 },
      { x: 30, y: 40 },
    ];
    const spline = monotoneSplinePoints(points, true);
    expect(spline[0]).toEqual({ x: 0, y: 0 });
    expect(spline[spline.length - 1]).toEqual({ x: 30, y: 40 });
  });
});
