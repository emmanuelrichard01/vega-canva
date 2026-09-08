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

/**
 * The kinds that answered nothing.
 *
 * Hit-testing worked off whatever a kind happened to *draw* — bars, or dots.
 * An area chart draws neither: dots are pushed only for `line` and `step`, so
 * hovering an area produced no readout, no highlight and no explanation, on
 * one of the four kinds people use most. A line with its markers switched off
 * had the same hole and said nothing either.
 */
describe('column readings', () => {
  const W = 480;
  const H = 300;

  const spec = (over: Partial<ChartSpec>): ChartSpec => ({
    kind: 'area',
    categories: ['Jan', 'Feb', 'Mar', 'Apr'],
    series: [
      { name: 'Revenue', values: [10, 40, 25, 60] },
      { name: 'Cost', values: [8, 20, 22, 30] },
    ],
    ...over,
  });

  const hitAt = (s: ChartSpec, atCategory: number) => {
    const layout = layoutChart(s, W, H);
    const column = layout.columns.find((c) => c.categoryIndex === atCategory);
    expect(column, 'the layout should carry a column for every category').toBeTruthy();
    return chartHitTest(layout, { x: column!.x, y: column!.entries[0].y }, {
      format: (v) => String(v),
      categories: s.categories,
      seriesNames: s.series.map((x) => x.name),
      keyedOnCategories: false,
    });
  };

  it('answers on an area chart, which draws no dots at all', () => {
    const hit = hitAt(spec({ kind: 'area' }), 1);
    expect(hit).not.toBeNull();
    expect(hit!.label).toBe('Feb');
    expect(hit!.entries.map((e) => e.value)).toEqual([40, 20]);
  });

  it('answers on a line whose markers are switched off', () => {
    const hit = hitAt(spec({ kind: 'line', markerShape: 'none' }), 2);
    expect(hit).not.toBeNull();
    expect(hit!.entries.map((e) => e.value)).toEqual([25, 22]);
  });

  it('reports the whole column, not just the nearest mark', () => {
    const hit = hitAt(spec({ kind: 'line' }), 0);
    expect(hit!.entries).toHaveLength(2);
  });

  /**
   * Both indices, which every highlight in the renderer keys off — the run
   * that thickens, the dots that dim, the band behind the bars. Without them
   * the readout appeared and the chart did not react.
   */
  it('says which category and which series, so the chart can respond', () => {
    const hit = hitAt(spec({ kind: 'area' }), 3);
    expect(hit!.categoryIndex).toBe(3);
    expect(hit!.seriesIndex).toBeTypeOf('number');
  });

  it('keeps a column for a series with a gap in it', () => {
    const withGap = spec({
      kind: 'line',
      series: [
        { name: 'Revenue', values: [10, null, 25, 60] },
        { name: 'Cost', values: [8, 20, 22, 30] },
      ],
    });
    const layout = layoutChart(withGap, W, H);
    // Four categories, four columns -- the gap costs that series its entry at
    // Feb and costs the column nothing.
    expect(layout.columns).toHaveLength(4);
    expect(layout.columns[1].entries).toHaveLength(1);
    expect(layout.columns[1].entries[0].value).toBe(20);
  });

  it('leaves the kinds whose reading is computed without a column table', () => {
    for (const kind of ['function', 'contour', 'heatmap', 'vectorField'] as const) {
      const layout = layoutChart(
        { kind, categories: [], series: [], functions: [{ source: 'x + y' }] },
        W,
        H
      );
      expect(layout.columns, kind).toEqual([]);
    }
  });
});

/**
 * Which way round the chart is, asked once.
 *
 * The hover band asked whether the first bar in a group was wider than it was
 * tall; the hit test asked whether a bar was four times wider than tall. Both
 * are questions about a *rectangle*, and the answer they wanted is a fact
 * about the *chart* — so on a waterfall, where a small step is short and wide
 * and a large one is tall and narrow, the band came out horizontal over some
 * bars and vertical over others and the pointer's distance was measured along
 * a different axis for each. A bar chart with any category near zero did the
 * same thing.
 */
describe('category axis', () => {
  const W = 480;
  const H = 300;

  it('follows the kind, not the proportions of a bar', () => {
    for (const kind of ['bar', 'stackedBar', 'histogram', 'waterfall'] as const) {
      expect(
        layoutChart({ kind, categories: ['a', 'b'], series: [{ name: 'S', values: [1, 2] }] }, W, H)
          .categoryAxis,
        kind
      ).toBe('x');
    }
    for (const kind of ['barHorizontal', 'funnel'] as const) {
      expect(
        layoutChart({ kind, categories: ['a', 'b'], series: [{ name: 'S', values: [1, 2] }] }, W, H)
          .categoryAxis,
        kind
      ).toBe('y');
    }
  });

  /**
   * The failing case, as reported: one waterfall, one tiny step among tall
   * ones. Every bar must be found by moving along the same axis.
   */
  it('reads every bar of a waterfall along the same axis', () => {
    const spec: ChartSpec = {
      kind: 'waterfall',
      categories: ['Start', 'Blip', 'Surge', 'End'],
      // The second delta is a hundredth of the others, so its rectangle is
      // wider than it is tall while its neighbours are the opposite.
      series: [{ name: 'Delta', values: [400, 3, 380, -300] }],
    };
    const layout = layoutChart(spec, W, H);
    expect(layout.categoryAxis).toBe('x');

    const shapes = layout.bars.map((b) => b.width > b.height);
    expect(
      new Set(shapes).size,
      'the fixture needs bars of both proportions or it proves nothing'
    ).toBe(2);

    // Sweeping horizontally across the plot must reach all four categories.
    const seen = new Set<number>();
    for (const bar of layout.bars) {
      const hit = chartHitTest(
        layout,
        { x: bar.x + bar.width / 2, y: layout.plot.y + layout.plot.height / 2 },
        {
          format: (v) => String(v),
          categories: spec.categories,
          seriesNames: ['Delta'],
          keyedOnCategories: false,
        }
      );
      if (hit?.categoryIndex !== undefined) seen.add(hit.categoryIndex);
    }
    expect(seen.size).toBe(4);
  });
});
