import { describe, expect, it } from 'vitest';
import { layoutChart } from './chartLayout';
import { bucketize, CHART_KINDS, toPercentStack, toStaircase, type ChartSpec } from './chartTypes';

const spec = (over: Partial<ChartSpec> = {}): ChartSpec => ({
  kind: 'bar',
  categories: ['A', 'B', 'C'],
  series: [{ name: 'S', values: [10, 20, 30] }],
  ...over,
});

const W = 480;
const H = 320;

describe('every kind stays inside its box', () => {
  it('holds for all sixteen, with one series and with three', () => {
    /**
     * The invariant that matters most and is cheapest to break when a kind is
     * added: `width`/`height` are a node's only bounds, so a mark outside them
     * is outside the selection box, the culling rectangle and the exported
     * frame. Run across every kind rather than the ones being worked on,
     * because the next kind added inherits this test for free.
     */
    for (const kind of CHART_KINDS) {
      for (const series of [
        [{ name: 'A', values: [10, 20, 30] }],
        [
          { name: 'A', values: [10, 20, 30] },
          { name: 'B', values: [5, 25, 15] },
          { name: 'C', values: [30, 5, 20] },
        ],
      ]) {
        const l = layoutChart(spec({ kind, series }), W, H);
        for (const b of l.bars) {
          expect(b.x).toBeGreaterThanOrEqual(-0.001);
          expect(b.x + b.width).toBeLessThanOrEqual(W + 0.001);
          expect(b.y).toBeGreaterThanOrEqual(-0.001);
          expect(b.y + b.height).toBeLessThanOrEqual(H + 0.001);
          expect(Number.isFinite(b.width)).toBe(true);
          expect(Number.isFinite(b.height)).toBe(true);
        }
        for (const d of l.dots) {
          expect(Number.isFinite(d.x)).toBe(true);
          expect(Number.isFinite(d.radius)).toBe(true);
          expect(d.radius).toBeGreaterThan(0);
        }
        for (const r of [...l.runs, ...l.areas]) {
          for (const p of r.points) {
            expect(Number.isFinite(p.x)).toBe(true);
            expect(Number.isFinite(p.y)).toBe(true);
          }
        }
      }
    }
  });

  it('never produces NaN from negatives or holes, on any kind', () => {
    for (const kind of CHART_KINDS) {
      const l = layoutChart(
        spec({
          kind,
          categories: ['a', 'b', 'c', 'd'],
          series: [{ name: 'S', values: [10, -20, null, 30] }],
        }),
        W,
        H
      );
      for (const b of l.bars) expect(Number.isNaN(b.x + b.y + b.width + b.height)).toBe(false);
      for (const s of l.slices) expect(Number.isNaN(s.startAngle + s.endAngle)).toBe(false);
    }
  });
});

describe('horizontal bars', () => {
  it('runs the value axis across and the categories down', () => {
    const v = layoutChart(spec({ kind: 'bar' }), W, H);
    const h = layoutChart(spec({ kind: 'barHorizontal' }), W, H);

    // Vertical: taller bar for a bigger value. Horizontal: wider.
    expect(v.bars[2].height).toBeGreaterThan(v.bars[0].height);
    expect(h.bars[2].width).toBeGreaterThan(h.bars[0].width);
    expect(h.bars[0].height).toBeCloseTo(h.bars[2].height, 6);
  });

  it('measures the gutter against the category names, not the ticks', () => {
    /**
     * The reason `barHorizontal` exists: long category names. Measuring the
     * tick labels instead would clip exactly the strings the kind was chosen
     * for.
     */
    const short = layoutChart(spec({ kind: 'barHorizontal', categories: ['a', 'b', 'c'] }), W, H);
    const long = layoutChart(
      spec({
        kind: 'barHorizontal',
        categories: ['Enterprise renewals', 'Self-serve signups', 'Partner referrals'],
      }),
      W,
      H
    );
    expect(long.plot.x).toBeGreaterThan(short.plot.x);
  });
});

describe('100% stacked', () => {
  it('makes every category the same total height', () => {
    const l = layoutChart(
      spec({
        kind: 'stackedBar100',
        series: [
          { name: 'A', values: [10, 90, 50] },
          { name: 'B', values: [90, 10, 50] },
        ],
      }),
      W,
      H
    );

    const totalFor = (ci: number) =>
      l.bars.filter((b) => b.categoryIndex === ci).reduce((sum, b) => sum + b.height, 0);

    expect(totalFor(0)).toBeCloseTo(totalFor(1), 4);
    expect(totalFor(1)).toBeCloseTo(totalFor(2), 4);
  });

  it('leaves a category summing to zero empty rather than dividing by it', () => {
    const out = toPercentStack(
      spec({ series: [{ name: 'A', values: [0, 10] }, { name: 'B', values: [0, 10] }] })
    );
    expect(out.series[0].values[0]).toBe(0);
    expect(Number.isNaN(out.series[0].values[0] as number)).toBe(false);
    expect(out.series[0].values[1]).toBeCloseTo(50, 6);
  });
});

describe('step', () => {
  it('holds each value until the next reading', () => {
    const stair = toStaircase([
      { x: 0, y: 10 },
      { x: 10, y: 20 },
    ]);
    expect(stair).toEqual([
      { x: 0, y: 10 },
      { x: 10, y: 10 },
      { x: 10, y: 20 },
    ]);
  });

  it('leaves a single point alone', () => {
    expect(toStaircase([{ x: 1, y: 2 }])).toEqual([{ x: 1, y: 2 }]);
    expect(toStaircase([])).toEqual([]);
  });

  it('produces more drawn points than data points', () => {
    const l = layoutChart(spec({ kind: 'step' }), W, H);
    expect(l.runs[0].points.length).toBeGreaterThan(3);
  });
});

describe('histogram', () => {
  it('buckets samples and counts them', () => {
    const { categories, counts } = bucketize([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 2);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(10);
    expect(categories).toHaveLength(2);
  });

  it('puts the maximum in the last bucket rather than dropping it', () => {
    /**
     * The classic off-by-one: `floor((v - lo) / width)` puts the top sample in
     * bucket `n`, which does not exist, and it vanishes without a trace.
     */
    const { counts } = bucketize([0, 5, 10], 2);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(3);
  });

  it('answers one bucket when every sample is identical', () => {
    const { counts } = bucketize([7, 7, 7], 5);
    expect(counts).toEqual([3]);
  });

  it('ignores holes rather than counting them as zero', () => {
    const { counts } = bucketize([1, null, 2, null], 2);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(2);
  });

  it('draws touching bars, because the categories are a continuum', () => {
    const hist = layoutChart(
      spec({ kind: 'histogram', series: [{ name: 'S', values: [1, 2, 2, 3, 3, 3, 4] }] }),
      W,
      H
    );
    const sorted = [...hist.bars].sort((a, b) => a.x - b.x);
    // Adjacent bars share an edge, give or take the 2% breathing room.
    const gap = sorted[1].x - (sorted[0].x + sorted[0].width);
    expect(gap).toBeLessThan(sorted[0].width * 0.15);
  });
});

describe('waterfall', () => {
  it('floats each bar where the last one finished', () => {
    const l = layoutChart(
      spec({ kind: 'waterfall', categories: ['start', 'up', 'down'], series: [
        { name: 'S', values: [100, 50, -30] },
      ] }),
      W,
      H
    );
    expect(l.bars).toHaveLength(3);
    const [first, second, third] = l.bars;
    // The second starts where the first ended.
    expect(second.y + second.height).toBeCloseTo(first.y, 4);
    // The third is a fall, so it hangs from where the second finished.
    expect(third.y).toBeCloseTo(second.y, 4);
    expect(third.value).toBeLessThan(0);
  });

  it('covers the running total with its axis, not the individual steps', () => {
    const l = layoutChart(
      spec({ kind: 'waterfall', categories: ['a', 'b', 'c'], series: [
        { name: 'S', values: [40, 40, 40] },
      ] }),
      W,
      H
    );
    expect(l.domain[1]).toBeGreaterThanOrEqual(120);
  });
});

describe('funnel', () => {
  it('gives each stage its own colour', () => {
    const l = layoutChart(spec({ kind: 'funnel' }), W, H);
    expect(new Set(l.bars.map((b) => b.color)).size).toBe(3);
  });

  it('names the categories in the legend even with one series', () => {
    const l = layoutChart(spec({ kind: 'funnel' }), W, H);
    expect(l.legend.map((e) => e.label)).toEqual(['A', 'B', 'C']);
  });
});

describe('bubble', () => {
  it('scales by area, not by radius', () => {
    /**
     * A value four times larger must draw a disc of four times the *area*.
     * Scaling the radius squares the difference, which is the standard way a
     * bubble chart overstates its own data.
     */
    const l = layoutChart(
      spec({ kind: 'bubble', categories: ['a', 'b'], series: [{ name: 'S', values: [1, 4] }] }),
      W,
      H
    );
    const [small, large] = l.dots.sort((a, b) => a.radius - b.radius);
    // Radii above the 4px floor should differ by about a factor of two, not four.
    const ratio = (large.radius - 4) / (small.radius - 4);
    expect(ratio).toBeGreaterThan(1.6);
    expect(ratio).toBeLessThan(2.6);
  });
});

describe('radar', () => {
  it('closes the outline, so there is no missing wedge', () => {
    const l = layoutChart(
      spec({ kind: 'radar', categories: ['a', 'b', 'c', 'd', 'e'] , series: [
        { name: 'S', values: [10, 20, 30, 20, 10] },
      ] }),
      W,
      H
    );
    const pts = l.runs[0].points;
    expect(pts[0].x).toBeCloseTo(pts[pts.length - 1].x, 6);
    expect(pts[0].y).toBeCloseTo(pts[pts.length - 1].y, 6);
  });

  it('draws rings as polygons, matching the shape of the data', () => {
    const l = layoutChart(
      spec({ kind: 'radar', categories: ['a', 'b', 'c', 'd'], series: [
        { name: 'S', values: [1, 2, 3, 4] },
      ] }),
      W,
      H
    );
    expect(l.rings.length).toBeGreaterThan(0);
    for (const ring of l.rings) expect(ring.points).toHaveLength(4);
    expect(l.spokes).toHaveLength(4);
  });

  it('refuses to draw with fewer than three spokes', () => {
    /**
     * Two spokes is a line and one is a point. Drawing either anyway produces
     * a shape that reads as a rendering fault rather than as data.
     */
    const l = layoutChart(
      spec({ kind: 'radar', categories: ['a', 'b'], series: [{ name: 'S', values: [1, 2] }] }),
      W,
      H
    );
    expect(l.runs).toHaveLength(0);
    expect(l.spokes).toHaveLength(0);
  });
});

describe('reference line', () => {
  it('draws a rule across the plot at the value given', () => {
    const l = layoutChart(spec({ reference: { value: 25, label: 'Target' } }), W, H);
    expect(l.reference).not.toBeNull();
    expect(l.reference!.y1).toBeGreaterThan(l.plot.y);
    expect(l.reference!.y1).toBeLessThan(l.plot.y + l.plot.height);
    expect(l.reference!.label?.text).toBe('Target');
  });

  it('is dropped, not clamped, when it falls outside the axis', () => {
    /**
     * A target pinned to the top of the plot because the real target is off
     * the scale is a drawing that says the target was met.
     */
    const l = layoutChart(spec({ reference: { value: 9999 } }), W, H);
    expect(l.reference).toBeNull();
  });
});

describe('value formatting', () => {
  it('puts a prefix and suffix on ticks and value labels alike', () => {
    /**
     * One formatter for both, so an axis reading `$1.2k` cannot sit under bars
     * labelled `1200`.
     */
    const l = layoutChart(
      spec({ valuePrefix: '$', showValues: true, series: [{ name: 'S', values: [1000, 2000, 3000] }] }),
      W,
      H
    );
    for (const t of l.axisLabels) expect(t.text.startsWith('$')).toBe(true);
    for (const v of l.valueLabels) expect(v.text.startsWith('$')).toBe(true);
  });

  it('honours a fixed decimal count', () => {
    const l = layoutChart(
      spec({ decimals: 2, showValues: true, series: [{ name: 'S', values: [1.5, 2, 3] }] }),
      W,
      H
    );
    expect(l.valueLabels[0].text).toBe('1.50');
  });
});
