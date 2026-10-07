import { describe, expect, it } from 'vitest';
import { settleAxis, MIN_PLANE_SPAN, MAX_PLANE_SPAN } from './planeView';

describe('settleAxis', () => {
  it('rounds away floating-point dust without moving the view', () => {
    expect(settleAxis(-6.500000000000001, 3.5)).toEqual([-6.5, 3.5]);
  });

  it('zooming in a hundred notches never collapses the span, and zooming back out recovers', () => {
    let [lo, hi] = [-10, 10];
    const zoom = (factor: number) => {
      const mid = (lo + hi) / 2;
      const span = (hi - lo) * factor;
      [lo, hi] = settleAxis(mid - span / 2, mid + span / 2);
    };
    for (let i = 0; i < 100; i++) zoom(0.88);
    expect(hi - lo).toBeGreaterThanOrEqual(MIN_PLANE_SPAN * 0.999);
    for (let i = 0; i < 100; i++) zoom(1.15);
    expect(hi - lo).toBeGreaterThan(1);
  });

  it('holds the span below the ceiling and survives non-finite input', () => {
    const [a, b] = settleAxis(-1e300, 1e300);
    expect(b - a).toBeLessThanOrEqual(MAX_PLANE_SPAN * 1.0001);
    expect(settleAxis(NaN, 1)).toEqual([-10, 10]);
  });
});
