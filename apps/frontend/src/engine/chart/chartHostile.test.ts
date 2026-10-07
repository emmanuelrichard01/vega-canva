import { describe, expect, it } from 'vitest';
import { layoutChart } from './chartLayout';
import { chartToSvg } from './chartSvg';
import { CHART_KINDS, type ChartSpec } from './chartTypes';
import { logDomainOf, niceDomain, MAX_TICKS } from './scales';
import { normalizeNode } from '../document/normalize';

/**
 * Input a collaborator controls, aimed at the two ways a chart can hurt
 * everyone who opens the board: markup that escapes into the page, and a
 * number that makes the layout run forever.
 */

const INK = {
  ink: '#111', chrome: '#666', sliceEdge: '#fff', derived: '#333', feature: '#f00',
} as never;

const base = (over: Partial<ChartSpec> = {}): ChartSpec => ({
  kind: 'bar',
  categories: ['A', 'B', 'C'],
  series: [{ name: 'S', values: [10, 20, 30] }],
  ...over,
});

const PAYLOAD = '"/><img src=x onerror=alert(1)>';

const SVG_ELEMENTS = new Set([
  'svg', 'g', 'defs', 'path', 'rect', 'circle', 'line', 'polyline', 'polygon', 'text', 'tspan',
  'linearGradient', 'radialGradient', 'stop', 'clipPath', 'filter', 'feDropShadow', 'image',
]);

/**
 * A painted chart must never contain an element or attribute the spec smuggled
 * in. Escaped payloads survive as text (`&lt;img…`), which is harmless; what
 * matters is the markup structure, so the tags themselves are parsed.
 */
function expectInert(svg: string) {
  const TAG = /<\/?([A-Za-z][\w:-]*)((?:\s+[\w:-]+="[^"<>]*")*)\s*\/?>/g;
  for (const m of svg.matchAll(TAG)) {
    expect(SVG_ELEMENTS.has(m[1])).toBe(true);
    for (const a of m[2].matchAll(/([\w:-]+)="/g)) expect(a[1].toLowerCase().startsWith('on')).toBe(false);
  }
  // Everything that is not a well-formed tag is text, and text has no raw brackets.
  expect(svg.replace(TAG, '')).not.toMatch(/[<>]/);
}

describe('chartSvg escapes everything it interpolates', () => {
  it('series, reference and tolerance colours cannot close their attribute', () => {
    for (const kind of CHART_KINDS) {
      const svg = chartToSvg(
        base({
          kind,
          series: [{ name: PAYLOAD, values: [1, 2, 3], color: PAYLOAD }],
          reference: { value: 2, label: PAYLOAD, color: PAYLOAD },
          toleranceBand: { min: 1, max: 2, label: PAYLOAD, color: PAYLOAD },
          title: PAYLOAD,
        }),
        320,
        240,
        { id: `n-${kind}`, ink: INK }
      );
      expectInert(svg);
    }
  });

  it('the donut metric built from value prefix and suffix is escaped', () => {
    const svg = chartToSvg(
      base({ kind: 'donut', valuePrefix: '<img src=x onerror=alert(2)>', valueSuffix: PAYLOAD }),
      320,
      240,
      { id: 'donut', ink: INK }
    );
    expectInert(svg);
  });

  it('a hostile node id cannot break out of a gradient id', () => {
    const svg = chartToSvg(base({ kind: 'area', gradient: true }), 320, 240, { id: PAYLOAD, ink: INK });
    expectInert(svg);
  });
});

describe('normalize refuses colours that are not colours', () => {
  it('drops a markup colour from series, reference, band and functions', () => {
    const node = normalizeNode({
      id: 'c1',
      type: 'chart',
      x: 0, y: 0, width: 300, height: 200,
      chart: {
        kind: 'bar',
        categories: ['A'],
        series: [{ name: 'S', values: [1], color: PAYLOAD }],
        reference: { value: 1, color: PAYLOAD },
        toleranceBand: { min: 0, max: 1, color: 'red' },
        functions: [{ source: 'x', color: 'url(javascript:alert(1))' }],
      },
    }) as any;
    expect(node.chart.series[0].color).toBeUndefined();
    expect(node.chart.reference.color).toBeUndefined();
    expect(node.chart.toleranceBand.color).toBe('red');
    expect(node.chart.functions[0].color).toBeUndefined();
  });

  it('clamps chart values to a range the layout can do arithmetic on', () => {
    const node = normalizeNode({
      id: 'c2', type: 'chart', x: 0, y: 0, width: 300, height: 200,
      chart: { kind: 'bar', categories: ['A', 'B'], series: [{ name: 'S', values: [1.7e308, -1.7e308] }], yMax: 1e308 },
    }) as any;
    for (const v of node.chart.series[0].values) expect(Math.abs(v)).toBeLessThanOrEqual(1e300);
    expect(node.chart.yMax).toBeLessThanOrEqual(1e300);
  });
});

describe('extreme numbers terminate', () => {
  const finiteLayout = (spec: ChartSpec) => {
    const started = Date.now();
    const l = layoutChart(spec, 480, 320);
    expect(Date.now() - started).toBeLessThan(2000);
    for (const b of l.bars) {
      expect(Number.isFinite(b.x)).toBe(true);
      expect(Number.isFinite(b.height)).toBe(true);
    }
    return l;
  };

  it('a bar of 1.7e308 lays out', () => {
    finiteLayout(base({ series: [{ name: 'S', values: [1.7e308, 1, 2] }] }));
  });

  it('axis bounds at ±1e308 lay out', () => {
    finiteLayout(base({ yMin: -1e308, yMax: 1e308 }));
  });

  it('a subnormal value on a log axis lays out', () => {
    finiteLayout(base({ yScale: 'log', series: [{ name: 'S', values: [5e-324, 1, 1e300] }] }));
  });

  it('niceDomain never produces more than MAX_TICKS ticks', () => {
    for (const [lo, hi] of [
      [-1.7e308, 1.7e308],
      [0, Number.MAX_VALUE],
      [1e16, 1e16 + 4],
      [-Infinity, Infinity],
    ] as const) {
      const { domain, ticks } = niceDomain(lo, hi);
      expect(ticks.length).toBeLessThanOrEqual(MAX_TICKS + 1);
      expect(Number.isFinite(domain[0]) && Number.isFinite(domain[1])).toBe(true);
    }
  });

  it('logDomainOf returns non-zero decades for subnormal input', () => {
    const { domain, ticks } = logDomainOf([5e-324, 1]);
    expect(domain[0]).toBeGreaterThan(0);
    expect(ticks.length).toBeGreaterThan(1);
    expect(ticks.every((t) => t > 0 && Number.isFinite(t))).toBe(true);
  });
});
