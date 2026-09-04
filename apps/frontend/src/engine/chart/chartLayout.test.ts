import { describe, expect, it } from 'vitest';
import { layoutChart } from './chartLayout';
import type { ChartSpec } from './chartTypes';
import { CHART_KINDS } from './chartTypes';

const spec = (over: Partial<ChartSpec> = {}): ChartSpec => ({
  kind: 'bar',
  categories: ['A', 'B', 'C'],
  series: [{ name: 'S', values: [10, 20, 30] }],
  ...over,
});

const W = 480;
const H = 320;

describe('layoutChart — the frame', () => {
  it('keeps every mark inside the node box', () => {
    /**
     * The whole-object invariant. A chart is a node like any other, so
     * `width`/`height` are its only bounds — anything drawn outside them is
     * drawn outside the selection box, outside the culling rectangle and
     * outside the exported frame.
     */
    for (const kind of CHART_KINDS) {
      const l = layoutChart(spec({ kind, series: [
        { name: 'A', values: [10, 20, 30] },
        { name: 'B', values: [5, 25, 15] },
      ] }), W, H);

      for (const b of l.bars) {
        expect(b.x).toBeGreaterThanOrEqual(-0.001);
        expect(b.x + b.width).toBeLessThanOrEqual(W + 0.001);
        expect(b.y).toBeGreaterThanOrEqual(-0.001);
        expect(b.y + b.height).toBeLessThanOrEqual(H + 0.001);
      }
      for (const r of [...l.runs, ...l.areas]) {
        for (const p of r.points) {
          expect(p.x).toBeGreaterThanOrEqual(-0.001);
          expect(p.x).toBeLessThanOrEqual(W + 0.001);
        }
      }
      for (const s of l.slices) {
        expect(s.cx - s.outerRadius).toBeGreaterThanOrEqual(-0.001);
        expect(s.cx + s.outerRadius).toBeLessThanOrEqual(W + 0.001);
      }
    }
  });

  it('draws nothing rather than something inverted at a tiny size', () => {
    /**
     * Konva renders a negative-width rect without complaint, so a chart
     * shrunk below its own furniture would draw the axes on top of each other
     * rather than showing nothing.
     */
    const l = layoutChart(spec(), 20, 20);
    expect(l.bars).toHaveLength(0);
    expect(l.plot.width).toBe(0);
  });

  it('gives the title its space back when there is no title', () => {
    const withTitle = layoutChart(spec({ title: 'Hello' }), W, H);
    const without = layoutChart(spec(), W, H);
    expect(withTitle.title).not.toBeNull();
    expect(without.title).toBeNull();
    expect(without.plot.height).toBeGreaterThan(withTitle.plot.height);
  });
});

describe('layoutChart — the gutter is measured, not assumed', () => {
  it('widens the axis gutter for wider tick labels', () => {
    /**
     * A constant gutter clips `1200` at one end and leaves dead space beside
     * `0` at the other. This is the rule the diagram engine already follows —
     * every column as wide as its own name.
     */
    const small = layoutChart(spec({ series: [{ name: 'S', values: [1, 2, 3] }] }), W, H);
    const large = layoutChart(
      spec({ series: [{ name: 'S', values: [100_000, 200_000, 300_000] }] }),
      W,
      H
    );
    expect(large.plot.x).toBeGreaterThan(small.plot.x);
  });

  it('uses the measurer it is given', () => {
    const wide = layoutChart(spec(), W, H, (t, s) => t.length * s * 2);
    const narrow = layoutChart(spec(), W, H, (t, s) => t.length * s * 0.2);
    expect(wide.plot.x).toBeGreaterThan(narrow.plot.x);
  });
});

describe('layoutChart — bars', () => {
  it('measures every bar from the zero baseline', () => {
    const l = layoutChart(spec({ series: [{ name: 'S', values: [10, 20, 30] }] }), W, H);
    expect(l.baseline).not.toBeNull();

    // Three bars, and the tallest value is the tallest bar.
    expect(l.bars).toHaveLength(3);
    const heights = l.bars.map((b) => b.height);
    expect(heights[2]).toBeGreaterThan(heights[1]);
    expect(heights[1]).toBeGreaterThan(heights[0]);

    // And each one actually reaches the baseline.
    for (const b of l.bars) {
      expect(b.y + b.height).toBeCloseTo(l.baseline!.y1, 6);
    }
  });

  it('hangs a negative bar below the baseline', () => {
    const l = layoutChart(spec({ series: [{ name: 'S', values: [10, -20, 30] }] }), W, H);
    const negative = l.bars.find((b) => b.value === -20)!;
    expect(negative.negative).toBe(true);
    expect(negative.y).toBeCloseTo(l.baseline!.y1, 6);
  });

  it('places grouped series side by side without overlapping', () => {
    const l = layoutChart(
      spec({
        series: [
          { name: 'A', values: [10, 20, 30] },
          { name: 'B', values: [15, 25, 5] },
        ],
      }),
      W,
      H
    );

    for (let c = 0; c < 3; c += 1) {
      const inCategory = l.bars
        .filter((b) => b.categoryIndex === c)
        .sort((a, b) => a.x - b.x);
      expect(inCategory).toHaveLength(2);
      expect(inCategory[0].x + inCategory[0].width).toBeLessThanOrEqual(inCategory[1].x + 0.001);
    }
  });

  it('stacks against the sum, so a stack never leaves the plot', () => {
    /**
     * An axis topping out at the largest single component would put every
     * stack through the roof of the plot. The domain has to be the totals.
     */
    const l = layoutChart(
      spec({
        kind: 'stackedBar',
        series: [
          { name: 'A', values: [50, 50, 50] },
          { name: 'B', values: [50, 50, 50] },
        ],
      }),
      W,
      H
    );
    expect(l.domain[1]).toBeGreaterThanOrEqual(100);
    for (const b of l.bars) {
      expect(b.y).toBeGreaterThanOrEqual(l.plot.y - 0.001);
    }

    // And the two series genuinely sit on top of one another.
    const first = l.bars.filter((b) => b.categoryIndex === 0).sort((a, b) => a.y - b.y);
    expect(first).toHaveLength(2);
    expect(first[0].y + first[0].height).toBeCloseTo(first[1].y, 6);
  });
});

describe('layoutChart — runs', () => {
  it('breaks a line at a hole instead of drawing across it', () => {
    /**
     * A missing reading and a measured zero are different claims. Joining
     * across a gap presents a sensor outage as a smooth decline to nothing.
     */
    const l = layoutChart(
      spec({ kind: 'line', categories: ['a', 'b', 'c', 'd'], series: [
        { name: 'S', values: [10, null, 30, 40] },
      ] }),
      W,
      H
    );
    expect(l.runs).toHaveLength(2);
    expect(l.runs[0].points).toHaveLength(1);
    expect(l.runs[1].points).toHaveLength(2);
  });

  it('closes an area down to the baseline', () => {
    const l = layoutChart(spec({ kind: 'area' }), W, H);
    const area = l.areas[0];
    expect(area.polygon[0].y).toBeCloseTo(l.baseline!.y1, 6);
    expect(area.polygon[area.polygon.length - 1].y).toBeCloseTo(l.baseline!.y1, 6);
  });

  it('scatter draws dots and no connecting run', () => {
    const l = layoutChart(spec({ kind: 'scatter' }), W, H);
    expect(l.dots.length).toBe(3);
    expect(l.runs).toHaveLength(0);
  });
});

describe('layoutChart — pie and donut', () => {
  it('sweeps exactly one full turn', () => {
    const l = layoutChart(spec({ kind: 'pie' }), W, H);
    const swept = l.slices.reduce((a, s) => a + (s.endAngle - s.startAngle), 0);
    expect(swept).toBeCloseTo(Math.PI * 2, 9);
  });

  it('starts at twelve o\'clock, so the painters cannot disagree', () => {
    /**
     * Konva and SVG both put zero radians at three o'clock. Applying the
     * quarter turn here rather than in each painter is what stops the two
     * rendering the same pie rotated differently.
     */
    const l = layoutChart(spec({ kind: 'pie' }), W, H);
    expect(l.slices[0].startAngle).toBeCloseTo(-Math.PI / 2, 9);
  });

  it('gives a donut a hole and a pie none', () => {
    const donut = layoutChart(spec({ kind: 'donut' }), W, H);
    const pie = layoutChart(spec({ kind: 'pie' }), W, H);
    expect(donut.slices[0].innerRadius).toBeGreaterThan(0);
    expect(pie.slices[0].innerRadius).toBe(0);
  });

  it('drops a negative rather than drawing it as a positive share', () => {
    /**
     * A negative has no meaning as a fraction of a whole. Clamping it to a
     * visible slice would state something the data does not.
     */
    const l = layoutChart(
      spec({ kind: 'pie', series: [{ name: 'S', values: [10, -5, 30] }] }),
      W,
      H
    );
    expect(l.slices).toHaveLength(2);
    const swept = l.slices.reduce((a, s) => a + (s.endAngle - s.startAngle), 0);
    expect(swept).toBeCloseTo(Math.PI * 2, 9);
  });

  it('survives a set of values that sum to zero', () => {
    const l = layoutChart(spec({ kind: 'pie', series: [{ name: 'S', values: [0, 0] }] }), W, H);
    expect(l.slices).toHaveLength(0);
  });
});

describe('layoutChart — data hygiene', () => {
  it('pads a short series rather than shifting values under wrong labels', () => {
    /**
     * The bug this forecloses: a series one element short putting every later
     * value under its neighbour's category.
     */
    const l = layoutChart(
      spec({ categories: ['a', 'b', 'c', 'd'], series: [{ name: 'S', values: [1, 2] }] }),
      W,
      H
    );
    expect(l.bars).toHaveLength(2);
    expect(l.bars.map((b) => b.categoryIndex)).toEqual([0, 1]);
    expect(l.categoryLabels).toHaveLength(4);
  });

  it('truncates a long series to the categories that exist', () => {
    const l = layoutChart(
      spec({ categories: ['a', 'b'], series: [{ name: 'S', values: [1, 2, 3, 4] }] }),
      W,
      H
    );
    expect(l.bars).toHaveLength(2);
  });

  it('draws an empty chart without throwing', () => {
    const l = layoutChart(spec({ categories: [], series: [] }), W, H);
    expect(l.bars).toHaveLength(0);
    expect(Number.isFinite(l.plot.width)).toBe(true);
  });

  it('is total across every kind, even with no data at all', () => {
    for (const kind of CHART_KINDS) {
      expect(() => layoutChart(spec({ kind, categories: [], series: [] }), W, H)).not.toThrow();
    }
  });
});

describe('layoutChart — legend', () => {
  it('shows one entry per series, and none for a lone series', () => {
    const one = layoutChart(spec(), W, H);
    expect(one.legend).toHaveLength(0);

    const two = layoutChart(
      spec({ series: [
        { name: 'A', values: [1, 2, 3] },
        { name: 'B', values: [3, 2, 1] },
      ] }),
      W,
      H
    );
    expect(two.legend.map((e) => e.label)).toEqual(['A', 'B']);
  });

  it('names the categories for a pie, not the series', () => {
    const l = layoutChart(spec({ kind: 'pie' }), W, H);
    expect(l.legend.map((e) => e.label)).toEqual(['A', 'B', 'C']);
  });

  it('wraps onto a second row rather than running off the edge', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      name: `A rather long series name ${i}`,
      values: [1, 2, 3],
    }));
    const l = layoutChart(spec({ series: many }), W, H);

    for (const e of l.legend) {
      expect(e.x).toBeGreaterThanOrEqual(0);
      expect(e.textX).toBeLessThan(W);
    }
    expect(new Set(l.legend.map((e) => e.y)).size).toBeGreaterThan(1);
  });
});
