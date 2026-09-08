import { describe, expect, it } from 'vitest';
import { layoutChart } from './chartLayout';
import {
  chartCapabilities,
  CHART_AGENCY_PALETTES,
  CHART_KINDS,
  defaultChartSpec,
  defaultPlotDomain,
  isPlot,
  isPolar,
  resolveChartOptions,
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

/**
 * The palette reaches the marks, not just the legend.
 *
 * `paletteId` was read in exactly one place — `buildLegend` — and by none of
 * the twenty-six calls that colour an actual mark. So choosing a palette
 * recoloured the legend's swatches and left the bars, lines and slices on the
 * default: not a control that did nothing, which would at least have been
 * honest, but one that made the chart and its own key disagree about what
 * colour a series is.
 */
describe('the palette', () => {
  const other = CHART_AGENCY_PALETTES.find((p) => p.id !== 'default')!;

  /** Every colour a layout draws with, from whichever marks the kind uses. */
  const inkOf = (layout: ReturnType<typeof layoutChart>) =>
    new Set(
      [
        ...layout.bars.map((b) => b.color),
        ...layout.runs.map((r) => r.color),
        ...layout.areas.map((a) => a.color),
        ...layout.dots.map((d) => d.color),
        ...layout.slices.map((s) => s.color),
      ].filter(Boolean)
    );

  it('changes the marks, for every kind that draws with a palette', () => {
    for (const kind of CHART_KINDS) {
      // A heatmap paints from its colour *ramp*: the surface is a continuous
      // scale, not a set of series, so the categorical palette has nothing to
      // colour there. That is a different colour source rather than a control
      // being ignored, which is why it is exempt here and `gridLines` was not.
      if (kind === 'heatmap') continue;
      const base = defaultChartSpec(kind);
      // Explicit per-series colours would mask the palette, which is correct
      // behaviour and not what this is testing.
      const spec: ChartSpec = {
        ...base,
        series: base.series.map((s) => ({ ...s, color: undefined })),
        functions: base.functions?.map((f) => ({ ...f, color: undefined })),
      };

      const before = inkOf(layoutChart(spec, W, H));
      const after = inkOf(layoutChart({ ...spec, paletteId: other.id }, W, H));
      if (before.size === 0) continue;

      expect(
        [...after].every((c) => !before.has(c)) || after.size > 0,
        `${kind} ignored the palette`
      ).toBe(true);
      // The strong form: at least one mark actually took a colour from the
      // chosen palette rather than from the default.
      expect([...after].some((c) => other.colors.includes(c)), kind).toBe(true);
    }
  });

  it('keeps the legend and the marks agreeing', () => {
    const spec: ChartSpec = {
      kind: 'bar',
      categories: ['a', 'b'],
      series: [{ name: 'One', values: [1, 2] }, { name: 'Two', values: [3, 4] }],
      paletteId: other.id,
      showLegend: true,
    };
    const layout = layoutChart(spec, W, H);
    const legendInk = new Set(layout.legend.map((e) => e.color));
    for (const colour of legendInk) {
      expect(inkOf(layout).has(colour), `legend colour ${colour} appears on no mark`).toBe(true);
    }
  });

  /**
   * A sentinel, and its whole job is to belong to no palette.
   *
   * If this were a real palette colour the assertion could pass by
   * coincidence — the mark would carry it whether the series' own colour had
   * been honoured or the palette had simply happened to supply it. Being
   * outside every palette is what makes the test mean anything.
   */
  const NOT_IN_ANY_PALETTE = '#123456';

  it('lets a series keep a colour of its own', () => {
    expect(
      CHART_AGENCY_PALETTES.some((p) => p.colors.includes(NOT_IN_ANY_PALETTE)),
      'the sentinel has drifted into a palette and no longer proves anything'
    ).toBe(false);

    const layout = layoutChart(
      {
        kind: 'bar',
        categories: ['a'],
        series: [{ name: 'One', values: [1], color: NOT_IN_ANY_PALETTE }],
        paletteId: other.id,
      },
      W,
      H
    );
    expect(layout.bars[0].color).toBe(NOT_IN_ANY_PALETTE);
  });
});

/**
 * The legend goes where it is told.
 *
 * `legendPosition` was on the spec, offered by the panel and copied across
 * the CRDT boundary — and read by nothing at all. `buildLegend` pinned every
 * entry to the bottom of the chart regardless, so the control moved a value
 * nobody consulted and the legend never went anywhere.
 */
describe('legend placement', () => {
  const base: ChartSpec = {
    kind: 'bar',
    categories: ['a', 'b'],
    series: [
      { name: 'Revenue', values: [1, 2] },
      { name: 'Operating cost', values: [3, 4] },
    ],
    showLegend: true,
  };

  const at = (position: ChartSpec['legendPosition']) =>
    layoutChart({ ...base, legendPosition: position }, W, H);

  it('puts it above the plot for "top"', () => {
    const l = at('top');
    expect(l.legend.length).toBe(2);
    for (const e of l.legend) expect(e.y).toBeLessThan(l.plot.y);
  });

  it('puts it below the plot for "bottom"', () => {
    const l = at('bottom');
    for (const e of l.legend) expect(e.y).toBeGreaterThan(l.plot.y + l.plot.height - 1);
  });

  it('puts it beside the plot for "right", and narrows the plot to fit', () => {
    const right = at('right');
    const bottom = at('bottom');

    for (const e of right.legend) expect(e.x).toBeGreaterThan(right.plot.x + right.plot.width);
    // The gutter has to come out of the plot: a legend placed beside a
    // full-width plot is a legend drawn over the data.
    expect(right.plot.width).toBeLessThan(bottom.plot.width);
  });

  /**
   * Measured from the labels rather than a fixed gutter, so a long series
   * name does not hang off the edge of the chart.
   */
  it('gives a long name the room it needs', () => {
    const long = layoutChart(
      {
        ...base,
        legendPosition: 'right',
        series: [
          { name: 'Revenue, net of returns and allowances', values: [1, 2] },
          { name: 'B', values: [3, 4] },
        ],
      },
      W,
      H
    );
    const short = at('right');
    expect(long.plot.width).toBeLessThan(short.plot.width);
    for (const e of long.legend) expect(e.x).toBeLessThan(W);
  });

  it('reserves nothing when there is no legend', () => {
    const off = layoutChart({ ...base, showLegend: false, legendPosition: 'right' }, W, H);
    const on = at('right');
    expect(off.legend).toEqual([]);
    expect(off.plot.width).toBeGreaterThan(on.plot.width);
  });
});

/**
 * The two ways placing the legend went wrong once it could be placed at all.
 */
describe('legend placement, in detail', () => {
  it('keeps a top legend clear of the title', () => {
    /**
     * `buildLegend` worked its position out from `width` and `height`, so a
     * top legend landed at `y = PAD` — which is exactly where the title is,
     * because the title is also at `PAD`. Only the layout knows what
     * furniture has already been placed, so the layout is what says now.
     */
    const l = layoutChart(
      {
        kind: 'bar',
        categories: ['a'],
        series: [{ name: 'One', values: [1] }, { name: 'Two', values: [2] }],
        title: 'Quarterly revenue',
        titleSize: 24,
        legendPosition: 'top',
        showLegend: true,
      },
      W,
      H
    );
    const titleBottom = l.title!.y + l.title!.fontSize;
    for (const e of l.legend) expect(e.y).toBeGreaterThanOrEqual(titleBottom);
    // And still above the plot, which is what "top" means.
    for (const e of l.legend) expect(e.y).toBeLessThan(l.plot.y);
  });

  it('clears the subtitle too', () => {
    const l = layoutChart(
      {
        kind: 'bar',
        categories: ['a'],
        series: [{ name: 'One', values: [1] }, { name: 'Two', values: [2] }],
        title: 'Revenue',
        subtitle: 'by quarter, net of returns',
        legendPosition: 'top',
        showLegend: true,
      },
      W,
      H
    );
    for (const e of l.legend) expect(e.y).toBeGreaterThanOrEqual(l.subtitle!.y);
  });

  /**
   * The gutter was measured from the labels alone, so one long series name
   * took half the chart and left the plot squeezed into a strip. A legend is
   * furniture: past a third of the width the *name* gives way, not the
   * picture.
   */
  it('never lets the legend take more than a third of the chart', () => {
    const l = layoutChart(
      {
        kind: 'bar',
        categories: ['a'],
        series: [
          { name: 'Revenue, net of returns, allowances and discounts applied', values: [1] },
          { name: 'Cost of goods sold, fully loaded', values: [2] },
        ],
        legendPosition: 'right',
        showLegend: true,
      },
      W,
      H
    );
    /**
     * The *legend's* share is what is capped. The plot also gives up room to
     * the axis gutter and the padding, which it would lose with the legend
     * anywhere — so measuring the plot against the whole width folds three
     * costs into one number and tests none of them.
     */
    expect(l.legend[0].x).toBeGreaterThanOrEqual(W * 0.66 - 1);

    // The names are cut to fit rather than overhanging.
    for (const e of l.legend) {
      expect(e.textX).toBeLessThan(W);
      expect(e.label.length).toBeLessThan(60);
    }
  });

  it('cuts a name with an ellipsis rather than dropping it', () => {
    const l = layoutChart(
      {
        kind: 'bar',
        categories: ['a'],
        series: [
          { name: 'Revenue, net of returns, allowances and discounts applied', values: [1] },
          { name: 'B', values: [2] },
        ],
        legendPosition: 'right',
        showLegend: true,
      },
      W,
      H
    );
    expect(l.legend).toHaveLength(2);
    expect(l.legend[0].label.endsWith('…')).toBe(true);
    // The short one is untouched: truncation is per entry, not a global cut.
    expect(l.legend[1].label).toBe('B');
  });
});

/**
 * Grid lines, and the axis that was hiding among them.
 *
 * The vertical zero rule had no field of its own, so it was pushed into
 * `gridLines` — and the push was not gated on `showGrid`. Two consequences,
 * both visible: turning the grid off left one stray vertical line down the
 * middle of the plot, and while it was on, the y axis was drawn at the grid's
 * opacity, which on a maths plot makes it as faint as the squares behind it.
 */
describe('grid lines', () => {
  const plot: ChartSpec = {
    kind: 'function',
    categories: [],
    series: [],
    functions: [{ source: 'sin(x)' }],
  };

  it('draws none at all when the grid is off', () => {
    expect(layoutChart({ ...plot, showGrid: false }, W, H).gridLines).toEqual([]);
  });

  it('still draws the axes when the grid is off', () => {
    // An axis is not a grid line: it says where zero is, which stays true
    // whether or not you want squares behind the curve.
    const l = layoutChart({ ...plot, showGrid: false }, W, H);
    expect(l.zeroRule).not.toBeNull();
    expect(l.baseline).not.toBeNull();
  });

  it('keeps the axes out of the grid list when the grid is on', () => {
    const l = layoutChart({ ...plot, showGrid: true }, W, H);
    expect(l.gridLines.length).toBeGreaterThan(0);
    // The zero rule is reported once, in its own field — not also as a grid
    // line, which is what made it impossible to draw at a different weight.
    const verticals = l.gridLines.filter((g) => Math.abs(g.x1 - g.x2) < 0.001);
    expect(verticals.some((g) => Math.abs(g.x1 - l.zeroRule!.x1) < 0.001)).toBe(false);
  });

  it('has no zero rule where the axis never crosses zero', () => {
    const l = layoutChart({ ...plot, xMin: 2, xMax: 8 }, W, H);
    expect(l.zeroRule).toBeNull();
  });

  it('gives a category chart no vertical zero, because it has no zero', () => {
    const l = layoutChart(
      { kind: 'bar', categories: ['a', 'b'], series: [{ name: 'S', values: [1, 2] }] },
      W,
      H
    );
    expect(l.zeroRule).toBeNull();
  });
});

/**
 * The radar, which came out a third smaller than it needed to be.
 *
 * The radius was `min(w, h) / 2 - widestLabel`: the widest name's *full width*
 * taken off in every direction, including twelve o'clock where a label needs
 * only its own height. On categories like "Reliability" that is sixty pixels
 * of clearance on all four sides, most of it against nothing.
 */
describe('radar', () => {
  const radar = (categories: string[], over: Partial<ChartSpec> = {}): ChartSpec => ({
    kind: 'radar',
    categories,
    series: [{ name: 'Us', values: categories.map((_, i) => i + 1) }],
    ...over,
  });

  /** The outermost ring's radius, which is what "how big is it" means here. */
  const radiusOf = (spec: ChartSpec, w = W, h = H) => {
    const l = layoutChart(spec, w, h);
    return Math.max(...l.rings.map((r) => r.radius), 0);
  };

  it('fills most of the box when the names are short', () => {
    const r = radiusOf(radar(['A', 'B', 'C', 'D', 'E']));
    const half = Math.min(W, H) / 2;
    // Was under half of the available half-dimension; the labels are two
    // characters wide and were still costing the radius their full width.
    expect(r).toBeGreaterThan(half * 0.62);
  });

  /**
   * On a tall, narrow chart the *width* is what binds, so this is where a long
   * name has to cost something. On a wide one it costs nothing at all — the
   * height runs out first and the names still fit, which is the whole point
   * of solving per direction rather than subtracting a worst case from both.
   */
  it('gives up room to long names where the width is what binds', () => {
    const short = radiusOf(radar(['A', 'B', 'C', 'D', 'E', 'F']), 300, 460);
    const long = radiusOf(
      radar(['Reliability', 'Security', 'Support', 'Price', 'Speed', 'Docs']),
      300,
      460
    );
    expect(long).toBeLessThan(short);
    // ...and not by the whole width of the longest name, which is what made
    // the old radar small.
    expect(long).toBeGreaterThan(short * 0.45);
  });

  it('costs nothing for a long name when the height binds first', () => {
    const short = radiusOf(radar(['A', 'B', 'C', 'D', 'E', 'F']), 700, 300);
    const long = radiusOf(
      radar(['Reliability', 'Security', 'Support', 'Price', 'Speed', 'Docs']),
      700,
      300
    );
    expect(long).toBe(short);
  });

  it('keeps every label inside the chart', () => {
    const l = layoutChart(
      radar(['Reliability and uptime', 'Security', 'Support', 'Price', 'Speed', 'Docs']),
      W,
      H
    );
    for (const label of l.categoryLabels) {
      expect(label.x).toBeGreaterThanOrEqual(-0.5);
      expect(label.x + label.width).toBeLessThanOrEqual(W + 0.5);
      expect(label.y).toBeGreaterThanOrEqual(-0.5);
      expect(label.y + label.fontSize).toBeLessThanOrEqual(H + 0.5);
    }
  });

  /**
   * The domain starts at zero, so `scale` returns a negative length for a
   * negative value — which `pointAt` then drew on the *opposite* spoke,
   * reporting the value against the wrong category.
   */
  it('puts a value below zero at the centre, not on the far side', () => {
    const spec = radar(['A', 'B', 'C', 'D'], {
      series: [{ name: 'Us', values: [10, -10, 10, 10] }],
    });
    const l = layoutChart(spec, W, H);
    const centre = { x: l.rings[0].cx, y: l.rings[0].cy };
    const negative = l.dots.find((d) => d.categoryIndex === 1)!;
    expect(Math.hypot(negative.x - centre.x, negative.y - centre.y)).toBeLessThan(1);
  });

  it('closes the shape over every spoke, even for a short series', () => {
    const l = layoutChart(
      radar(['A', 'B', 'C', 'D', 'E'], { series: [{ name: 'Us', values: [1, 2] }] }),
      W,
      H
    );
    // Five spokes, five points, plus the repeat that closes the ring.
    expect(l.runs[0].points).toHaveLength(6);
  });

  it('refuses to draw fewer than three spokes', () => {
    // Two spokes is a line and one is a point; neither is a radar.
    expect(layoutChart(radar(['A', 'B']), W, H).rings).toEqual([]);
  });
});

/**
 * The switch reports the state of the thing it switches.
 *
 * The reported symptom was "legend is on but nothing shows, and I have to turn
 * it off and on again before it registers". The cause was five answers to one
 * question: the rail and the panel each applied `?? true` to an absent
 * `showLegend`, `resolveChartOptions` applied
 * `?? (namesCategories || series.length > 1)`, the legend-position row applied
 * a fourth rule, and `buildColorBar` a fifth. On a single-series bar chart the
 * switch read *on* and the chart drew none, so the first click wrote `false` —
 * changing nothing visible — and only the second click wrote a value the
 * renderer agreed with.
 *
 * These hold the resolver to what it must answer. Every control now asks it,
 * so a control cannot drift from the drawing again without failing here.
 */
describe('showLegend has one answer', () => {
  const one = (over: Partial<ChartSpec> = {}): ChartSpec => ({
    ...defaultChartSpec('bar'),
    categories: ['Q1', 'Q2'],
    series: [{ name: 'Revenue', values: [1, 2] }],
    ...over,
  });

  it('is off for a single unnamed series, and the toggle agrees', () => {
    const spec = one();
    expect(spec.showLegend).toBeUndefined();
    expect(resolveChartOptions(spec).showLegend).toBe(false);
    // The layout must agree with the switch, which is the whole bug.
    expect(layoutChart(spec, W, H).legend).toEqual([]);
  });

  it('turns on with one click from the resolved state', () => {
    const spec = one();
    // What the control now writes: the negation of what is *drawn*, not of
    // what is stored. Negating the stored `undefined` gave `false` — a click
    // that changed nothing.
    const clicked = { ...spec, showLegend: !resolveChartOptions(spec).showLegend };
    expect(clicked.showLegend).toBe(true);
    expect(layoutChart(clicked, W, H).legend.length).toBeGreaterThan(0);
  });

  it('is on by default wherever the legend names the categories', () => {
    for (const kind of ['pie', 'donut', 'funnel'] as const) {
      const spec = { ...defaultChartSpec(kind) };
      expect(resolveChartOptions(spec).showLegend, kind).toBe(true);
    }
  });

  it('is on by default for a heatmap, whose legend is its colour bar', () => {
    // A heatmap has one series and no named categories, so the old rule made
    // it `false` — which would have taken the colour bar away the moment
    // `buildColorBar` stopped applying its own separate default.
    const spec = defaultChartSpec('heatmap');
    expect(resolveChartOptions(spec).showLegend).toBe(true);
    expect(layoutChart(spec, W, H).colorBar).toBeTruthy();
  });

  it('lets the colour bar be turned off, through the same field', () => {
    const spec = { ...defaultChartSpec('heatmap'), showLegend: false };
    expect(layoutChart(spec, W, H).colorBar).toBeNull();
  });

  it('is on by default once there is more than one series', () => {
    const spec = one({
      series: [
        { name: 'A', values: [1, 2] },
        { name: 'B', values: [2, 3] },
      ],
    });
    expect(resolveChartOptions(spec).showLegend).toBe(true);
  });

  it('lets an explicit value win over every default', () => {
    expect(resolveChartOptions({ ...defaultChartSpec('pie'), showLegend: false }).showLegend).toBe(false);
    expect(resolveChartOptions(one({ showLegend: true })).showLegend).toBe(true);
  });
});

/**
 * `showGrid` had the same shape of fault, found while fixing the legend.
 *
 * The panel's switch read `?? true` while the resolver reads
 * `?? !(radial || polar)`, so a radar and a polar plot showed Grid lit with no
 * grid drawn — the same lie, one control over.
 */
describe('showGrid has one answer', () => {
  /** The field absent, which is the case the panel used to answer `true` to. */
  const absent = (kind: ChartSpec['kind']): ChartSpec => {
    const spec = { ...defaultChartSpec(kind) };
    delete spec.showGrid;
    return spec;
  };

  it('is off with no stored value on the kinds that draw no rules', () => {
    for (const kind of ['radar', 'pie', 'donut'] as const) {
      expect(resolveChartOptions(absent(kind)).showGrid, kind).toBe(false);
    }
  });

  it('is on with no stored value on the kinds that do', () => {
    for (const kind of ['bar', 'line', 'area', 'scatter'] as const) {
      expect(resolveChartOptions(absent(kind)).showGrid, kind).toBe(true);
    }
  });

  it('gives a polar plot a grid, because `isPolar` means radar', () => {
    /**
     * Two different things share the word. `isPolar` is the *chart* drawn on
     * polar axes — one spoke per category, rings for the scale — which is the
     * radar and only the radar. A `polarPlot` is a maths plot of `r(a)`,
     * traced onto a cartesian plane, and a plane has a grid like any other.
     *
     * Worth pinning because the names invite exactly the wrong edit.
     */
    expect(isPolar('polarPlot')).toBe(false);
    expect(resolveChartOptions(absent('polarPlot')).showGrid).toBe(true);
  });
});
