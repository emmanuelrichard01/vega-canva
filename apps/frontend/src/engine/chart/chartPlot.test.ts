import { describe, expect, it } from 'vitest';
import { samplePlot } from './chartPlot';
import { layoutChart } from './chartLayout';
import { defaultChartSpec } from './chartTypes';

describe('samplePlot', () => {
  it('keeps the steep start of a saturating curve', () => {
    const f = (x: number) => (38 * x) / (0.23 + x);
    const pts = samplePlot(f, { from: 0, to: 10, samples: 160 });
    expect(pts.some((p) => p.y === null)).toBe(false);
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    // The rise from 0 towards the plateau is drawn, not cut off.
    expect(pts.filter((p) => p.x < 1).length).toBeGreaterThan(3);
  });

  it('does not break a steep sinusoid at a low base sample count', () => {
    const pts = samplePlot((x) => Math.sin(50 * x), { from: 0, to: 2, samples: 16 });
    expect(pts.some((p) => p.y === null)).toBe(false);
  });

  it('still breaks at an asymptote', () => {
    const pts = samplePlot(Math.tan, { from: -3, to: 3, samples: 200 });
    expect(pts.some((p) => p.y === null)).toBe(true);
  });

  it('still breaks at a step discontinuity', () => {
    const pts = samplePlot((x) => x + (x < 0 ? -5 : 5), { from: -1, to: 1, samples: 64 });
    expect(pts.some((p) => p.y === null)).toBe(true);
  });
});

describe('histogram density curve', () => {
  it('follows the sample range, not the count axis', () => {
    // Two clusters far from zero: a curve evaluated over the counts' domain
    // would see neither of them.
    const values = [...Array(30).fill(0).map((_, i) => 200 + (i % 5)), ...Array(30).fill(0).map((_, i) => 300 + (i % 5))];
    const spec = { ...defaultChartSpec('histogram'), series: [{ name: 'S', values }], showKde: true, buckets: 12 };
    const layout = layoutChart(spec, 520, 380);
    const curve = layout.kdeCurve!;
    expect(curve).not.toBeNull();
    const ys = curve.map((p) => p.y);
    const top = Math.min(...ys);
    const mid = ys[Math.floor(ys.length / 2)];
    // Lowest on screen = densest. Both ends are humps and the middle is the trough.
    expect(ys[0]).toBeLessThan(mid);
    expect(ys[ys.length - 1]).toBeLessThan(mid);
    expect(top).toBeLessThan(mid);
  });
});
