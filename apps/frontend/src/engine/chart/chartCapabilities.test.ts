import { describe, expect, it } from 'vitest';
import { layoutChart } from './chartLayout';
import {
  chartCapabilities,
  CHART_KINDS,
  defaultChartSpec,
  defaultPlotDomain,
  isPlot,
  type ChartSpec,
} from './chartTypes';
import { paintLayout } from './chartSvg';

/**
 * Every control the chart panel offers must reach the renderer, for every kind.
 *
 * Invariant 6, applied to a properties panel — which is where it is broken most
 * easily, because a control is offered for every kind on the grounds that it
 * applies to *most* of them and then silently does nothing on the rest. An
 * audit found four at once: a reference line offered on a pie that never drew
 * one, value labels on a scatter, number formatting on a donut whose labels are
 * percentages, and a `curved` field implemented in the layout with no control
 * anywhere.
 *
 * `chartCapabilities` is now the single answer, and this holds it to what
 * `layoutChart` actually produces. The panel gates on the table; the table is
 * checked against the layout; so a control cannot be offered where nothing
 * draws it, and a kind added without teaching the table fails here rather than
 * shipping a panel with dead rows.
 */

const W = 520;
const H = 380;

/** A spec of the kind's own shape, so each is tested with data it can draw. */
const specFor = (kind: (typeof CHART_KINDS)[number]): ChartSpec => defaultChartSpec(kind);

describe('no control is offered where nothing draws it', () => {
  it('draws value labels exactly where the table says it can', () => {
    for (const kind of CHART_KINDS) {
      const can = chartCapabilities(kind);
      const on = layoutChart({ ...specFor(kind), showValues: true }, W, H);
      const off = layoutChart({ ...specFor(kind), showValues: false }, W, H);

      if (can.valueLabels) {
        // Turning it on must add something, or the toggle is inert.
        expect(on.valueLabels.length, `${kind} claims value labels`).toBeGreaterThan(
          off.valueLabels.length
        );
      } else if (!isPlot(kind)) {
        // And where the table denies it, the toggle must genuinely change
        // nothing — otherwise the capability is understated and a real feature
        // is hidden from the panel.
        expect(on.valueLabels.length, `${kind} denies value labels`).toBe(
          off.valueLabels.length
        );
      }
    }
  });

  it('draws a reference line exactly where the table says it can', () => {
    for (const kind of CHART_KINDS) {
      const can = chartCapabilities(kind);
      const base = specFor(kind);
      // Placed inside whatever axis this kind ends up with, so a null result
      // means "not supported" rather than "out of range".
      const probe = layoutChart(base, W, H);
      const mid = (probe.domain[0] + probe.domain[1]) / 2;
      const l = layoutChart({ ...base, reference: { value: mid, label: 'T' } }, W, H);

      if (can.reference) {
        expect(l.reference, `${kind} claims a reference line`).not.toBeNull();
      } else {
        expect(l.reference, `${kind} denies a reference line`).toBeNull();
      }
    }
  });

  it('honours number formatting exactly where the table says it can', () => {
    for (const kind of CHART_KINDS) {
      const can = chartCapabilities(kind);
      if (!can.numberFormat) continue;

      const base = { ...specFor(kind), showValues: true };
      const plain = layoutChart(base, W, H);
      const affixed = layoutChart({ ...base, valuePrefix: '¤' }, W, H);

      const text = (l: typeof plain) =>
        [...l.axisLabels, ...l.valueLabels].map((x) => x.text).join('|');

      // A prefix must appear somewhere it did not before.
      expect(text(affixed).includes('¤'), `${kind} claims number formatting`).toBe(true);
      expect(text(plain).includes('¤')).toBe(false);
    }
  });

  it('smooths a run exactly where the table says it can', () => {
    for (const kind of CHART_KINDS) {
      const can = chartCapabilities(kind);
      const base = specFor(kind);
      const straight = layoutChart({ ...base, curved: false }, W, H);
      const curved = layoutChart({ ...base, curved: true }, W, H);

      const points = (l: typeof straight) =>
        l.runs.reduce((n, r) => n + r.points.length, 0);

      if (can.curved) {
        // Smoothing densifies the run, so the point count has to rise.
        expect(points(curved), `${kind} claims curving`).toBeGreaterThan(points(straight));
      } else {
        expect(points(curved), `${kind} denies curving`).toBe(points(straight));
      }
    }
  });

  it('has a data table exactly where the table says it can', () => {
    for (const kind of CHART_KINDS) {
      const can = chartCapabilities(kind);
      const spec = specFor(kind);
      // A plot carries formulae and no categories; everything else is the
      // other way round. The data grid is offered on exactly the first set.
      expect(spec.categories.length > 0 || spec.series.length > 0, `${kind} data`).toBe(
        can.data
      );
    }
  });

  it('offers a value axis only where one is drawn', () => {
    for (const kind of CHART_KINDS) {
      const can = chartCapabilities(kind);
      const l = layoutChart(specFor(kind), W, H);
      if (can.valueAxis) {
        expect(l.axisLabels.length, `${kind} claims a value axis`).toBeGreaterThan(0);
      }
    }
  });
});

/**
 * The three sections that looked inert, checked end to end.
 *
 * Each was reported as "not functional", and each was working in the layout
 * and being stripped at the CRDT boundary — `normalizeChartSpec` copied twelve
 * fields while `ChartSpec` had grown to thirty. These assert the layout half;
 * `normalize.test.ts` asserts the boundary half. Both are needed, because
 * either one passing alone is exactly the state that produced the report.
 */
describe('the sections that were reported inert', () => {
  it('Order actually reorders the drawn marks', () => {
    const spec: ChartSpec = {
      kind: 'bar',
      categories: ['a', 'b', 'c'],
      series: [{ name: 'S', values: [5, 30, 12] }],
    };
    const entered = layoutChart(spec, W, H);
    const sorted = layoutChart({ ...spec, sort: 'valueDesc' }, W, H);

    const order = (l: typeof entered) =>
      [...l.bars].sort((p, q) => p.x - q.x).map((b) => b.value);

    expect(order(entered)).toEqual([5, 30, 12]);
    expect(order(sorted)).toEqual([30, 12, 5]);
  });

  it('Numbers reaches both the axis and the value labels', () => {
    const spec: ChartSpec = {
      kind: 'bar',
      categories: ['a', 'b'],
      series: [{ name: 'S', values: [1.5, 2.5] }],
      showValues: true,
      valuePrefix: '$',
      valueSuffix: 'k',
      decimals: 2,
    };
    const l = layoutChart(spec, W, H);

    // Both surfaces, because an axis reading `$1.50k` under bars labelled
    // `1.5` is the disagreement `formatValue` exists to prevent.
    expect(l.valueLabels.some((v) => v.text === '$1.50k')).toBe(true);
    expect(l.axisLabels.every((a) => a.text.startsWith('$') && a.text.endsWith('k'))).toBe(true);
  });

  it('a reference line lands where the value says, not where the pixels do', () => {
    const spec: ChartSpec = {
      kind: 'bar',
      categories: ['a', 'b'],
      series: [{ name: 'S', values: [0, 100] }],
      reference: { value: 50, label: 'Half' },
    };
    const small = layoutChart(spec, W, H);
    const large = layoutChart(spec, W, H * 2);

    // Halfway up the plot in both, which is the property a drawn line cannot
    // have: the pixel moves, the value does not.
    const fraction = (l: typeof small) =>
      (l.reference!.y1 - l.plot.y) / l.plot.height;
    expect(fraction(small)).toBeCloseTo(fraction(large), 2);
    expect(fraction(small)).toBeCloseTo(0.5, 1);
  });
});

/**
 * The two capabilities added when the context toolbar was audited.
 *
 * Both were hand-written conditions in two places that disagreed with each
 * other and with the renderer: the toolbar offered a gradient on lines, the
 * panel offered it on bars as well, and `layout.areas` -- the only thing the
 * flag acts on -- is produced by neither.
 */
describe('gridLines and gradient', () => {
  it('offers grid lines exactly where a rule is drawn', () => {
    for (const kind of CHART_KINDS) {
      const spec = { ...defaultChartSpec(kind), showGrid: true };
      const drawn = layoutChart(spec, W, H).gridLines.length > 0;
      if (chartCapabilities(kind).gridLines) {
        expect(drawn, kind).toBe(true);
      } else {
        expect(drawn, kind).toBe(false);
      }
    }
  });

  it('offers a gradient only where there is an area to fade', () => {
    for (const kind of CHART_KINDS) {
      if (!chartCapabilities(kind).gradient) continue;
      const spec = { ...defaultChartSpec(kind), gradient: true };
      const areas = layoutChart(spec, W, H).areas;
      expect(areas.length, kind).toBeGreaterThan(0);
      expect(areas.every((a) => a.gradient), kind).toBe(true);
    }
  });

  /**
   * The defect this whole field was carrying: the renderer faded the fill and
   * the exporter wrote a flat polygon, so the file did not match the board.
   * Asserted against the SVG rather than against the flag, because the flag
   * was always right -- it was the painter that never read it.
   */
  it('paints the fade into the export too', () => {
    const spec = { ...defaultChartSpec('area'), gradient: true };
    const svg = paintLayout(layoutChart(spec, W, H), { id: 'x' });
    expect(svg).toContain('linearGradient');
    expect(svg).toContain('fill="url(#x-areafill-0)"');
  });

  it('leaves a flat area flat in the export', () => {
    const spec = { ...defaultChartSpec('area'), gradient: undefined };
    const svg = paintLayout(layoutChart(spec, W, H), { id: 'x' });
    expect(svg).not.toContain('linearGradient');
  });
});

/**
 * "Reset view" put the plane somewhere no plot had ever opened at: it carried
 * its own -10..10 and -5..5 while a new function plot is -6.5..6.5 and a new
 * two-variable plot is -6..6.
 */
describe('defaultPlotDomain', () => {
  it('is the domain a new plot of that kind actually opens with', () => {
    for (const kind of CHART_KINDS) {
      if (!isPlot(kind)) continue;
      const fresh = defaultChartSpec(kind);
      expect(defaultPlotDomain(kind), kind).toEqual({
        xMin: fresh.xMin,
        xMax: fresh.xMax,
        yPlotMin: fresh.yPlotMin,
        yPlotMax: fresh.yPlotMax,
      });
    }
  });
});
