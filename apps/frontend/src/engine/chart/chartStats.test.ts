import { describe, it, expect } from 'vitest';
import { linearRegression, optimalBinCount, kernelDensityEstimation } from './chartStats';

describe('chartStats', () => {
  describe('linearRegression', () => {
    it('computes exact slope and intercept for a straight line', () => {
      // y = 2x + 1
      const points = [
        { x: 1, y: 3 },
        { x: 2, y: 5 },
        { x: 3, y: 7 },
        { x: 4, y: 9 },
      ];
      const res = linearRegression(points);
      expect(res).not.toBeNull();
      expect(res!.slope).toBeCloseTo(2, 5);
      expect(res!.intercept).toBeCloseTo(1, 5);
      expect(res!.r2).toBeCloseTo(1, 5);
      expect(res!.predict(5)).toBeCloseTo(11, 5);
    });

    it('handles noisy correlation gracefully', () => {
      const points = [
        { x: 0, y: 0 },
        { x: 1, y: 2 },
        { x: 2, y: 1 },
        { x: 3, y: 4 },
      ];
      const res = linearRegression(points);
      expect(res).not.toBeNull();
      expect(res!.slope).toBeGreaterThan(0);
      expect(res!.r2).toBeGreaterThan(0.5);
    });

    it('returns null for single point or vertical line', () => {
      expect(linearRegression([{ x: 1, y: 1 }])).toBeNull();
      expect(linearRegression([{ x: 1, y: 1 }, { x: 1, y: 5 }])).toBeNull();
    });
  });

  describe('optimalBinCount', () => {
    it('returns reasonable bin counts for uniform and normal samples', () => {
      const uniform = Array.from({ length: 100 }, (_, i) => i);
      const k = optimalBinCount(uniform);
      expect(k).toBeGreaterThanOrEqual(4);
      expect(k).toBeLessThanOrEqual(30);
    });

    it('handles constant values', () => {
      const constant = [5, 5, 5, 5, 5];
      expect(optimalBinCount(constant)).toBe(1);
    });
  });

  describe('kernelDensityEstimation', () => {
    it('evaluates probability density peaks near distribution center', () => {
      // Bimodal distribution centered at 0 and 10
      const samples = [-1, 0, 0, 1, 9, 10, 10, 11];
      const evalPts = [-5, 0, 5, 10, 15];
      const kde = kernelDensityEstimation(samples, evalPts);

      expect(kde.length).toBe(evalPts.length);
      // Density at centers (0 and 10) must be higher than at tails (-5, 15) and valley (5)
      const densMap = new Map(kde.map((k) => [k.x, k.density]));
      expect(densMap.get(0)!).toBeGreaterThan(densMap.get(-5)!);
      expect(densMap.get(10)!).toBeGreaterThan(densMap.get(15)!);
      expect(densMap.get(0)!).toBeGreaterThan(densMap.get(5)!);
    });
  });
});
