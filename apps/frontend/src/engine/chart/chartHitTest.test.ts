import { describe, expect, it } from 'vitest';
import { chartHitTest, placeReadout } from './chartHitTest';
import { layoutChart } from './chartLayout';
import type { ChartSpec } from './chartTypes';

describe('chartHitTest', () => {
  const barSpec: ChartSpec = {
    kind: 'bar',
    categories: ['Mon', 'Tue', 'Wed'],
    series: [
      { name: 'Revenue', values: [100, 200, 300] },
      { name: 'Cost', values: [80, 150, 210] },
    ],
  };

  const heatmapSpec: ChartSpec = {
    kind: 'heatmap',
    categories: [],
    series: [],
    functions: [{ source: 'x + y' }],
    resolution: 16,
  };

  const layoutBar = layoutChart(barSpec, 400, 300, (t, s) => t.length * s * 0.5);
  const layoutHeatmap = layoutChart(heatmapSpec, 400, 300, (t, s) => t.length * s * 0.5);

  it('identifies nearest category column on bar chart', () => {
    const hit = chartHitTest(
      layoutBar,
      { x: layoutBar.bars[0].x + 5, y: layoutBar.bars[0].y + 5 },
      {
        categories: barSpec.categories,
        seriesNames: barSpec.series.map((s) => s.name),
        format: (v) => String(v),
        keyedOnCategories: false,
      }
    );

    expect(hit).not.toBeNull();
    expect(hit?.label).toBe('Mon');
    expect(hit?.entries.length).toBe(2);
    expect(hit?.entries[0].name).toBe('Revenue');
    expect(hit?.entries[1].name).toBe('Cost');
  });

  it('evaluates 2D surface coordinate and value on heatmaps without categories', () => {
    expect(layoutHeatmap.bars.length).toBeGreaterThan(0);
    const hit = chartHitTest(
      layoutHeatmap,
      { x: 200, y: 150 },
      {
        categories: heatmapSpec.categories,
        seriesNames: [],
        format: (v) => String(v),
        keyedOnCategories: false,
      }
    );

    // Heatmaps evaluate the 2D surface coordinate z = f(x, y) rather than categorical columns
    expect(hit).not.toBeNull();
    expect(hit?.entries[0].text).toContain('z =');
    expect(hit?.label).toMatch(/\(-?\d+\.\d+,\s*-?\d+\.\d+\)/);
  });

  it('returns null when pointer is outside the plot bounds', () => {
    const hit = chartHitTest(
      layoutBar,
      { x: -50, y: -50 },
      {
        categories: barSpec.categories,
        seriesNames: barSpec.series.map((s) => s.name),
        format: (v) => String(v),
        keyedOnCategories: false,
      }
    );

    expect(hit).toBeNull();
  });

  it('evaluates slope field derivatives and angles under the pointer', () => {
    const slopeSpec: ChartSpec = {
      kind: 'slopeField',
      categories: [],
      series: [],
      functions: [{ source: 'x - y' }],
      xMin: -5,
      xMax: 5,
      yPlotMin: -5,
      yPlotMax: 5,
    };
    const layoutSlope = layoutChart(slopeSpec, 400, 300, (t, s) => t.length * s * 0.5);
    const hit = chartHitTest(
      layoutSlope,
      { x: 200, y: 150 },
      {
        categories: [],
        seriesNames: [],
        format: (v) => String(v),
        keyedOnCategories: false,
      }
    );

    expect(hit).not.toBeNull();
    expect(hit?.entries.some((e) => e.name === 'dy/dx')).toBe(true);
    expect(hit?.entries.some((e) => e.name === 'θ')).toBe(true);
    expect(hit?.mathTrace?.fieldVector).toBeDefined();
  });

  it('evaluates vector field components, magnitude, and direction angle', () => {
    const vecSpec: ChartSpec = {
      kind: 'vectorField',
      categories: [],
      series: [],
      functions: [{ source: 'x' }, { source: 'y' }],
      xMin: -5,
      xMax: 5,
      yPlotMin: -5,
      yPlotMax: 5,
    };
    const layoutVec = layoutChart(vecSpec, 400, 300, (t, s) => t.length * s * 0.5);
    const hit = chartHitTest(
      layoutVec,
      { x: 200, y: 150 },
      {
        categories: [],
        seriesNames: [],
        format: (v) => String(v),
        keyedOnCategories: false,
      }
    );

    expect(hit).not.toBeNull();
    expect(hit?.entries.some((e) => e.name === 'F(x,y)')).toBe(true);
    expect(hit?.entries.some((e) => e.name === '|F|')).toBe(true);
    expect(hit?.mathTrace?.fieldVector?.magnitude).toBeDefined();
  });

  it('evaluates 1D function plot with tangent equation entry', () => {
    const funcSpec: ChartSpec = {
      kind: 'function',
      categories: [],
      series: [],
      functions: [{ source: 'x^2' }],
      xMin: -5,
      xMax: 5,
    };
    const layoutFunc = layoutChart(funcSpec, 400, 300, (t, s) => t.length * s * 0.5);
    // Move to x ≈ 2 on the plot
    const hit = chartHitTest(
      layoutFunc,
      { x: layoutFunc.plot.x + layoutFunc.plot.width * 0.7, y: 150 },
      {
        categories: [],
        seriesNames: [],
        format: (v) => String(v),
        keyedOnCategories: false,
      }
    );

    expect(hit).not.toBeNull();
    expect(hit?.entries.some((e) => e.name === 'Tangent')).toBe(true);
  });

  it('evaluates parametric plot with parameter t, coordinates, velocity vector, and tangent', () => {
    const paramSpec: ChartSpec = {
      kind: 'parametric',
      categories: [],
      series: [],
      functions: [{ source: 'cos(t)' }, { source: 'sin(t)' }],
      xMin: 0,
      xMax: Math.PI * 2,
    };
    const layoutParam = layoutChart(paramSpec, 400, 300, (t, s) => t.length * s * 0.5);
    expect(layoutParam.runs.length).toBeGreaterThan(0);
    const targetPt = layoutParam.runs[0].points[20];
    expect(targetPt).toBeDefined();

    const hit = chartHitTest(
      layoutParam,
      { x: targetPt.x, y: targetPt.y },
      {
        categories: [],
        seriesNames: [],
        format: (v) => String(v),
        keyedOnCategories: false,
      }
    );

    expect(hit).not.toBeNull();
    expect(hit?.label).toContain('t =');
    expect(hit?.entries.some((e) => e.name === 'P(t)')).toBe(true);
    expect(hit?.entries.some((e) => e.name === 'v(t)')).toBe(true);
    expect(hit?.entries.some((e) => e.name === 'dy/dx')).toBe(true);
    expect(hit?.entries.some((e) => e.name === 'Tangent')).toBe(true);
    expect(hit?.mathTrace?.parametricVelocity).toBeDefined();
  });

  it('evaluates polar plot with radius r(θ), coordinates, and polar ray', () => {
    const polarSpec: ChartSpec = {
      kind: 'polarPlot',
      categories: [],
      series: [],
      functions: [{ source: '1 + cos(a)' }],
      xMin: 0,
      xMax: Math.PI * 2,
    };
    const layoutPolar = layoutChart(polarSpec, 400, 300, (t, s) => t.length * s * 0.5);
    expect(layoutPolar.runs.length).toBeGreaterThan(0);
    const targetPt = layoutPolar.runs[0].points[20];
    expect(targetPt).toBeDefined();

    const hit = chartHitTest(
      layoutPolar,
      { x: targetPt.x, y: targetPt.y },
      {
        categories: [],
        seriesNames: [],
        format: (v) => String(v),
        keyedOnCategories: false,
      }
    );

    expect(hit).not.toBeNull();
    expect(hit?.label).toContain('θ =');
    expect(hit?.entries.some((e) => e.name === 'r(θ)')).toBe(true);
    expect(hit?.entries.some((e) => e.name === '(x, y)')).toBe(true);
    expect(hit?.entries.some((e) => e.name === 'Tangent')).toBe(true);
    expect(hit?.mathTrace?.polarRadius).toBeDefined();
  });
});

describe('placeReadout', () => {
  it('places tooltip near anchor without overflowing bounds', () => {
    const bounds = { width: 400, height: 300 };
    const size = { width: 120, height: 60 };

    // In the middle
    const p1 = placeReadout({ x: 200, y: 150 }, size, bounds);
    expect(p1.x).toBeGreaterThanOrEqual(0);
    expect(p1.x + size.width).toBeLessThanOrEqual(bounds.width);
    expect(p1.y).toBeGreaterThanOrEqual(0);

    // Near top-right corner
    const p2 = placeReadout({ x: 390, y: 10 }, size, bounds);
    expect(p2.x + size.width).toBeLessThanOrEqual(bounds.width);
    expect(p2.y).toBeGreaterThanOrEqual(0);
  });
});
