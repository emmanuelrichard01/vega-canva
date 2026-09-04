import { describe, expect, it } from 'vitest';
import { layoutChart } from './chartLayout';
import {
  chartCapabilities,
  CHART_KINDS,
  defaultChartSpec,
  isPlot,
  type ChartSpec,
} from './chartTypes';

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
