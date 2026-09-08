import { describe, expect, it } from 'vitest';
import {
  findRoots,
  refineExtremum,
  findIntersections,
  integrate,
  differentiate,
} from './chartAnalysis';

describe('chartAnalysis', () => {
  it('finds and bisects roots accurately for sin(x)', () => {
    const samples = [];
    for (let x = -4; x <= 4; x += 0.2) {
      samples.push({ x, y: Math.sin(x) });
    }
    const roots = findRoots(samples, (x) => Math.sin(x));
    // Roots of sin(x) in [-4, 4] are -pi, 0, pi
    expect(roots.length).toBeGreaterThanOrEqual(3);
    const zeroRoot = roots.find((r) => Math.abs(r) < 0.05);
    expect(zeroRoot).toBeCloseTo(0, 6);
    const piRoot = roots.find((r) => Math.abs(r - Math.PI) < 0.05);
    expect(piRoot).toBeCloseTo(Math.PI, 6);
  });

  it('refines turning points to floating-point precision using golden-section search', () => {
    // Parabola f(x) = -(x - 1.2345)^2 + 4.5678, maximum at (1.2345, 4.5678)
    const f = (x: number) => -Math.pow(x - 1.2345, 2) + 4.5678;
    // Initial coarse bracket from samples: [1.0, 1.5]
    const refinedMax = refineExtremum(f, 1.0, 1.5, true);
    expect(refinedMax.x).toBeCloseTo(1.2345, 5);
    expect(refinedMax.y).toBeCloseTo(4.5678, 5);

    // Valley f(x) = (x + 2.3456)^2 - 1.789, minimum at (-2.3456, -1.789)
    const g = (x: number) => Math.pow(x + 2.3456, 2) - 1.789;
    const refinedMin = refineExtremum(g, -3.0, -1.5, false);
    expect(refinedMin.x).toBeCloseTo(-2.3456, 5);
    expect(refinedMin.y).toBeCloseTo(-1.789, 5);
  });

  it('finds intersections between two curves', () => {
    // f(x) = x^2, g(x) = 2x + 3 => x^2 - 2x - 3 = 0 => (x - 3)(x + 1) = 0 => x = 3, -1
    const f = (x: number) => x * x;
    const g = (x: number) => 2 * x + 3;
    const samples = [];
    for (let x = -3; x <= 5; x += 0.2) {
      samples.push({ x, y: f(x) });
    }
    const ints = findIntersections(samples, f, g);
    expect(ints.length).toBe(2);
    const int1 = ints.find((p) => Math.abs(p.x - -1) < 0.1);
    expect(int1?.x).toBeCloseTo(-1, 5);
    expect(int1?.y).toBeCloseTo(1, 5);
    const int2 = ints.find((p) => Math.abs(p.x - 3) < 0.1);
    expect(int2?.x).toBeCloseTo(3, 5);
    expect(int2?.y).toBeCloseTo(9, 5);
  });

  it('integrates signed area by trapezium rule', () => {
    // Integral of x from 0 to 2 is [x^2/2] = 2
    const samples = [];
    for (let i = 0; i <= 20; i += 1) {
      const x = i / 10;
      samples.push({ x, y: x });
    }
    const { value, complete } = integrate(samples);
    expect(complete).toBe(true);
    expect(value).toBeCloseTo(2, 4);
  });

  it('differentiates numerical samples via central difference', () => {
    // Derivative of x^2 is 2x
    const samples = [];
    for (let x = 0; x <= 4; x += 0.1) {
      samples.push({ x, y: x * x });
    }
    const deriv = differentiate(samples);
    // At x = 2 (index 20), dy/dx = 4
    const sampleAt2 = deriv.find((s) => Math.abs(s.x - 2) < 1e-4);
    expect(sampleAt2?.y).toBeCloseTo(4, 2);
  });
});
