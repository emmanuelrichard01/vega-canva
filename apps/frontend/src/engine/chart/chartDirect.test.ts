import { describe, expect, it } from 'vitest';
import { layoutChart } from './chartLayout';
import { defaultChartSpec, type ChartSpec } from './chartTypes';
import { dragBlockedReason, draggedValue, nearestHandle, valueHandles, withValue } from './chartHandles';
import { easeOut, morphLayout } from './chartMorph';
import { switchChartKind } from './chartKindSwitch';

const W = 480;
const H = 320;

const twoSeries: ChartSpec = {
  kind: 'bar',
  categories: ['Q1', 'Q2', 'Q3', 'Q4'],
  series: [
    { name: 'Revenue', values: [120, 150, 180, 210] },
    { name: 'Margin %', values: [12, 14, 11, 16] },
  ],
};

describe('hidden series', () => {
  it('leaves a hidden series out of the marks but keeps its neighbours’ colours', () => {
    const all = layoutChart(twoSeries, W, H);
    const hidden = layoutChart({ ...twoSeries, series: [{ ...twoSeries.series[0], hidden: true }, twoSeries.series[1]] }, W, H);
    expect(hidden.bars.every((b) => b.seriesIndex === 1)).toBe(true);
    const colourBefore = all.bars.find((b) => b.seriesIndex === 1)!.color;
    expect(hidden.bars[0].color).toBe(colourBefore);
  });

  it('keeps the hidden entry in the legend only when asked to', () => {
    const spec = { ...twoSeries, series: [{ ...twoSeries.series[0], hidden: true }, twoSeries.series[1]] };
    expect(layoutChart(spec, W, H).legend.map((e) => e.seriesIndex)).toEqual([1]);
    const shown = layoutChart(spec, W, H, undefined, { showHidden: true }).legend;
    expect(shown.map((e) => [e.seriesIndex, Boolean(e.hidden)])).toEqual([
      [0, true],
      [1, false],
    ]);
  });
});

describe('combo and dual axis', () => {
  const combo: ChartSpec = {
    ...twoSeries,
    series: [twoSeries.series[0], { ...twoSeries.series[1], mark: 'line', axis: 'right' }],
  };
  const layout = layoutChart(combo, W, H);

  it('draws bars for one series and a line for the other', () => {
    expect(layout.bars.length).toBe(4);
    expect(layout.bars.every((b) => b.seriesIndex === 0)).toBe(true);
    expect(layout.runs.some((r) => r.seriesIndex === 1)).toBe(true);
  });

  it('scales each axis on its own series', () => {
    expect(layout.rightDomain).toBeDefined();
    expect(layout.domain[1]).toBeGreaterThanOrEqual(210);
    expect(layout.rightDomain![1]).toBeLessThan(100);
  });

  it('keeps every mark inside the plot', () => {
    const p = layout.plot;
    for (const b of layout.bars) {
      expect(b.y).toBeGreaterThanOrEqual(p.y - 0.5);
      expect(b.y + b.height).toBeLessThanOrEqual(p.y + p.height + 0.5);
    }
    for (const r of layout.runs) for (const pt of r.points) {
      expect(pt.y).toBeGreaterThanOrEqual(p.y - 0.5);
      expect(pt.y).toBeLessThanOrEqual(p.y + p.height + 0.5);
    }
  });

  it('puts the right axis labels to the right of the plot', () => {
    const rightLabels = layout.axisLabels.filter((l) => l.x >= layout.plot.x + layout.plot.width);
    expect(rightLabels.length).toBeGreaterThan(1);
  });
});

describe('category axis', () => {
  const crowded: ChartSpec = {
    kind: 'bar',
    categories: Array.from({ length: 24 }, (_, i) => `Department number ${i + 1}`),
    series: [{ name: 'Headcount', values: Array.from({ length: 24 }, (_, i) => 10 + i) }],
  };

  it('turns names that collide', () => {
    const labels = layoutChart(crowded, W, H).categoryLabels;
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.every((l) => l.rotation === -45)).toBe(true);
  });

  it('honours a fixed angle and a fixed interval', () => {
    const labels = layoutChart({ ...crowded, labelAngle: 0, labelEvery: 6 }, W, H).categoryLabels;
    expect(labels.length).toBe(4);
    expect(labels.every((l) => !l.rotation)).toBe(true);
  });

  it('reverses the drawing order without touching the data', () => {
    const l = layoutChart({ ...twoSeries, reverseCategories: true }, W, H);
    expect(l.categoryNames).toEqual(['Q4', 'Q3', 'Q2', 'Q1']);
  });

  it('scales text with the text size', () => {
    const m = layoutChart(twoSeries, W, H).categoryLabels[0].fontSize;
    const l = layoutChart({ ...twoSeries, textSize: 'l' }, W, H).categoryLabels[0].fontSize;
    expect(l).toBeGreaterThan(m);
    // And puts the constants back afterwards.
    expect(layoutChart(twoSeries, W, H).categoryLabels[0].fontSize).toBe(m);
  });
});

describe('drag to set a value', () => {
  const spec = defaultChartSpec('bar');
  const layout = layoutChart(spec, W, H);
  const handles = valueHandles(layout, spec);

  it('offers one handle per reading', () => {
    expect(handles.length).toBe(spec.series[0].values.length);
  });

  it('finds the handle under the pointer', () => {
    const h = handles[2];
    expect(nearestHandle(handles, { x: h.x + 3, y: h.y - 2 }, 10)).toBe(h);
    expect(nearestHandle(handles, { x: -100, y: -100 }, 10)).toBeNull();
  });

  it('moves the value with the pointer and snaps to a nice step', () => {
    const h = handles[0];
    const up = draggedValue(h, { x: h.x, y: h.y }, { x: h.x, y: h.y - layout.plot.height / 4 }, layout.plot);
    const span = h.domain[1] - h.domain[0];
    expect(up).toBeGreaterThan(h.value);
    expect(Math.abs(up - (h.value + span / 4))).toBeLessThanOrEqual(span / 50);
    // Snapped: a whole multiple of the step.
    const step = 10 ** Math.floor(Math.log10(span / 50));
    expect(Math.abs(up / step - Math.round(up / step))).toBeLessThan(1e-9);
  });

  it('writes only the dragged reading', () => {
    const next = withValue(spec, 0, 1, 999);
    expect(next.series[0].values[1]).toBe(999);
    expect(next.series[0].values[0]).toBe(spec.series[0].values[0]);
  });

  it('refuses where dragging would lie', () => {
    expect(dragBlockedReason({ ...spec, link: { tableId: 't', r0: 0, c0: 0, r1: 1, c1: 1 } })).toMatch(/table/);
    expect(dragBlockedReason(defaultChartSpec('stackedBar100'))).not.toBeNull();
    expect(dragBlockedReason(spec)).toBeNull();
  });

  it('offers a linked chart its handles only when the drop will write the table', () => {
    const linked = { ...spec, link: { tableId: 't', r0: 0, c0: 0, r1: 1, c1: 1 } };
    expect(valueHandles(layout, linked)).toEqual([]);
    expect(valueHandles(layout, linked, true).length).toBe(spec.series[0].values.length);
    expect(dragBlockedReason(linked, true)).toBeNull();
    // Everything else that blocks a drag still does.
    expect(dragBlockedReason({ ...linked, sort: 'valueDesc' }, true)).not.toBeNull();
  });
});

describe('morph between kinds', () => {
  const bar = defaultChartSpec('line');
  const from = layoutChart(switchChartKind(bar, 'bar'), W, H);
  const to = layoutChart(bar, W, H);

  it('is the destination at the end', () => {
    expect(morphLayout(from, to, 1)).toBe(to);
  });

  it('starts each point where the same reading stood', () => {
    const start = morphLayout(from, to, 0);
    const run = start.runs.find((r) => r.seriesIndex === 0)!;
    // The line rises out of the bar tops: its point for the second category
    // starts on that bar.
    const bar = from.bars.find((b) => b.seriesIndex === 0 && b.categoryIndex === 1)!;
    expect(run.points[1].y).toBeCloseTo(bar.y);
    expect(run.opacity ?? 1).toBe(1);
  });

  it('opens bars from the points of a line', () => {
    const back = morphLayout(to, from, 0);
    const b = back.bars.find((x) => x.categoryIndex === 1 && x.seriesIndex === 0)!;
    const pt = to.columns[1].entries.find((e) => e.seriesIndex === 0)!;
    expect(b.height).toBeCloseTo(0);
    expect(b.y).toBeCloseTo(pt.y);
    const end = morphLayout(to, from, 0.999999);
    const target = from.bars.find((x) => x.categoryIndex === 1 && x.seriesIndex === 0)!;
    expect(end.bars.find((x) => x.categoryIndex === 1 && x.seriesIndex === 0)!.height).toBeCloseTo(target.height, 2);
  });

  it('eases out between 0 and 1', () => {
    expect(easeOut(0)).toBe(0);
    expect(easeOut(1)).toBe(1);
    expect(easeOut(0.5)).toBeGreaterThan(0.5);
  });
});
