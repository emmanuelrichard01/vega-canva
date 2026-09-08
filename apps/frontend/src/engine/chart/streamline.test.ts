import { describe, it, expect } from 'vitest';
import { integrateStreamline } from './streamline';

describe('integrateStreamline (RK4)', () => {
  const bounds = { xMin: -10, xMax: 10, yMin: -10, yMax: 10 };

  it('integrates a constant horizontal field into a straight line', () => {
    // dy/dx = 0 -> <1, 0>
    const field = () => ({ dx: 1, dy: 0 });
    const line = integrateStreamline(field, { x: 0, y: 3 }, { bounds });

    expect(line.length).toBeGreaterThan(10);
    for (const p of line) {
      expect(p.y).toBeCloseTo(3, 3);
      expect(p.x).toBeGreaterThanOrEqual(-10);
      expect(p.x).toBeLessThanOrEqual(10);
    }
  });

  it('integrates a diagonal slope field accurately', () => {
    // dy/dx = 1 -> <1, 1>
    const field = () => ({ dx: 1, dy: 1 });
    const line = integrateStreamline(field, { x: 0, y: 0 }, { bounds });

    for (const p of line) {
      expect(p.y).toBeCloseTo(p.x, 2);
    }
  });

  it('integrates circular rotation field preserving radius', () => {
    // < -y, x > circles around origin
    const field = (x: number, y: number) => ({ dx: -y, dy: x });
    const seed = { x: 4, y: 0 };
    const curve = integrateStreamline(field, seed, { bounds, stepSize: 0.05, maxSteps: 200 });

    for (const p of curve) {
      const radius = Math.hypot(p.x, p.y);
      expect(radius).toBeCloseTo(4, 1);
    }
  });

  it('returns empty if seed is outside bounds', () => {
    const field = () => ({ dx: 1, dy: 0 });
    expect(integrateStreamline(field, { x: 50, y: 50 }, { bounds })).toEqual([]);
  });
});
