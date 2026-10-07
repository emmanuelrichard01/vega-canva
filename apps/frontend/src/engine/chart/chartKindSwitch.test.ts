import { describe, expect, it } from 'vitest';
import { CHART_KINDS, defaultChartSpec, isPlot, type ChartSpec } from './chartTypes';
import { shapeOf, switchChartKind } from './chartKindSwitch';
import { layoutChart } from './chartLayout';
import { normalizeNode } from '../document/normalize';

const drawsSomething = (spec: ChartSpec) => {
  const l = layoutChart(spec, 480, 320);
  return (
    l.bars.length + l.runs.length + l.dots.length + l.slices.length + l.areas.length > 0 ||
    Boolean(l.mathPlot) ||
    Boolean(l.colorBar) ||
    (l.streamlines?.length ?? 0) > 0
  );
};

describe('switchChartKind', () => {
  it('returns the original values after visiting every kind and coming back', () => {
    const start = defaultChartSpec('bar');
    let spec = start;
    for (const kind of CHART_KINDS) spec = switchChartKind(spec, kind);
    spec = switchChartKind(spec, 'bar');
    expect(spec.categories).toEqual(start.categories);
    expect(spec.series).toEqual(start.series);
    expect(spec.stash?.data).toBeUndefined();
  });

  it('never leaves a chart with nothing to draw', () => {
    for (const from of CHART_KINDS) {
      for (const to of CHART_KINDS) {
        const next = switchChartKind(defaultChartSpec(from), to);
        expect(next.kind).toBe(to);
        if (isPlot(to)) expect(next.functions?.length ?? 0).toBeGreaterThan(0);
        else expect(next.series.length).toBeGreaterThan(0);
      }
    }
  });

  it('keeps a typed formula across a trip through a data kind', () => {
    const plot: ChartSpec = { ...defaultChartSpec('function'), functions: [{ source: 'x^3 - 2x' }], xMin: -3, xMax: 3 };
    const there = switchChartKind(plot, 'line');
    expect(there.functions).toBeUndefined();
    expect(there.stash?.plot?.curve?.functions[0].source).toBe('x^3 - 2x');
    const back = switchChartKind(there, 'function');
    expect(back.functions?.[0].source).toBe('x^3 - 2x');
    expect([back.xMin, back.xMax]).toEqual([-3, 3]);
    expect(back.stash?.plot).toBeUndefined();
    expect(back.stash?.data?.series.length).toBeGreaterThan(0);
  });

  it('keeps data between data kinds, as a comparison', () => {
    const bar = defaultChartSpec('stackedBar');
    const line = switchChartKind(bar, 'line');
    expect(line.series).toEqual(bar.series);
    expect(line.stash).toBeUndefined();
  });

  it('draws something for every switch from a bar chart', () => {
    for (const kind of CHART_KINDS) {
      expect(drawsSomething(switchChartKind(defaultChartSpec('bar'), kind)), kind).toBe(true);
    }
  });

  it('classifies kinds into the families the stash keeps apart', () => {
    expect(shapeOf('bar')).toBe('data');
    expect(shapeOf('function')).toBe('curve');
    expect(shapeOf('vectorField')).toBe('vector');
    expect(shapeOf('contour')).toBe('field');
  });

  it('survives the read boundary with the stash intact', () => {
    const there = switchChartKind(defaultChartSpec('bar'), 'function');
    const node = normalizeNode({
      id: 'c', type: 'chart', x: 0, y: 0, width: 480, height: 320, chart: there,
    } as never) as unknown as { chart: ChartSpec };
    expect(node.chart.stash?.data?.series).toEqual(defaultChartSpec('bar').series);
    expect(switchChartKind(node.chart, 'bar').series).toEqual(defaultChartSpec('bar').series);
  });
});
