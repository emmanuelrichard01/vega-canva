import { describe, expect, it } from 'vitest';
import { histogramKdeCounts } from './chartStats';
import { samplePlot } from './chartPlot';
import { layoutChart } from './chartLayout';
import { layoutNetwork, networkPlacementStats } from './chartLayoutKinds';
import { defaultChartSpec, type ChartSpec } from './chartTypes';

describe('histogram KDE domain', () => {
  const values = [1, 2, 2, 3, 3, 3, 4, 4, 5, 9];
  it('spans exactly [min, max] and is in counts per bucket', () => {
    const c = histogramKdeCounts(values, 4, 40)!;
    expect(c[0].x).toBe(1);
    expect(c[c.length - 1].x).toBe(9);
    expect(c[0].t).toBe(0);
    expect(c[c.length - 1].t).toBe(1);
    // Integrating count/bucketWidth over the domain approximates N (less tail mass outside).
    const w = 8 / 4;
    const area = c.reduce((s, p) => s + (p.count / w) * (8 / 40), 0);
    expect(area).toBeGreaterThan(values.length * 0.6);
    expect(area).toBeLessThanOrEqual(values.length);
  });
  it('returns null for degenerate input', () => {
    expect(histogramKdeCounts([3, 3, 3], 4)).toBeNull();
    expect(histogramKdeCounts([1], 4)).toBeNull();
  });
  it('lays out inside the plot', () => {
    const spec = { ...defaultChartSpec('histogram'), showKde: true, series: [{ name: 's', values }] } as ChartSpec;
    const l = layoutChart(spec, 480, 320);
    expect(l.kdeCurve!.length).toBe(41);
    for (const p of l.kdeCurve!) {
      expect(p.y).toBeGreaterThanOrEqual(l.plot.y - 1e-6);
      expect(p.y).toBeLessThanOrEqual(l.plot.y + l.plot.height + 1e-6);
    }
  });
});

describe('adaptive edge sampling', () => {
  it('keeps the steep start of sqrt(x) from 0', () => {
    const s = samplePlot(Math.sqrt, { from: 0, to: 4, samples: 40 });
    const near = s.filter((p) => p.y !== null && p.x < 0.01 && p.x > 0);
    expect(near.length).toBeGreaterThan(3);
    expect(s[0]).toEqual({ x: 0, y: 0 });
  });
  it('reaches into ln(x) from a start where the edge is undefined', () => {
    const s = samplePlot(Math.log, { from: 0, to: 5, samples: 40 });
    const first = s.find((p) => p.y !== null)!;
    expect(first.x).toBeLessThan(5 / 40 / 100);
    expect(first.y!).toBeLessThan(-5);
  });
  it('includes the right edge', () => {
    const s = samplePlot((x) => 1 / Math.sqrt(4 - x), { from: 0, to: 4, samples: 40 });
    const last = s.filter((p) => p.y !== null).pop()!;
    expect(last.x).toBeGreaterThan(4 - 0.01);
  });
});

describe('hidden axes', () => {
  it('drops tick labels and axis titles but keeps the marks', () => {
    const base = { ...defaultChartSpec('bar'), xAxisLabel: 'x', yAxisLabel: 'y' } as ChartSpec;
    const shown = layoutChart(base, 480, 320);
    const hidden = layoutChart({ ...base, showAxes: false }, 480, 320);
    expect(shown.categoryLabels.length + shown.axisLabels.length).toBeGreaterThan(0);
    expect(hidden.categoryLabels).toEqual([]);
    expect(hidden.axisLabels).toEqual([]);
    expect(hidden.xAxisTitle).toBeNull();
    expect(hidden.bars.length).toBe(shown.bars.length);
  });
});

describe('network placement cache', () => {
  it('is much cheaper the second time and identical', () => {
    const n = 14;
    const names = Array.from({ length: n }, (_, i) => 'N' + i);
    const spec = {
      kind: 'network',
      categories: names,
      series: names.map((name, i) => ({
        name,
        values: names.map((_, j) => (i !== j && (i * 7 + j * 3) % 5 === 0 ? 1 + ((i + j) % 3) : 0)),
      })),
    } as ChartSpec;
    const before = networkPlacementStats.computed;
    const t0 = performance.now();
    const a = layoutChart(spec, 640, 420);
    const t1 = performance.now();
    const b = layoutChart(spec, 640, 420);
    const t2 = performance.now();
    console.log(`network layout cold ${(t1 - t0).toFixed(1)}ms warm ${(t2 - t1).toFixed(1)}ms`);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(networkPlacementStats.cached).toBeGreaterThanOrEqual(1);
    expect(networkPlacementStats.computed - before).toBe(1);
    expect(typeof layoutNetwork).toBe('function');
  });
});
