import { describe, expect, it } from 'vitest';
import { networkGroups, NETWORK_NEUTRAL } from './chartLayoutKinds';
import { layoutChart } from './chartLayout';
import { chartCapabilities, defaultChartSpec, type ChartSpec } from './chartTypes';

/** Two triangles joined by one light bridge: the plainest graph with two groups. */
function twoTriangles(extra: Partial<ChartSpec> = {}): ChartSpec {
  const names = ['A', 'B', 'C', 'D', 'E', 'F'];
  const w = [
    [0, 3, 3, 1, 0, 0],
    [3, 0, 3, 0, 0, 0],
    [3, 3, 0, 0, 0, 0],
    [1, 0, 0, 0, 3, 3],
    [0, 0, 0, 3, 0, 3],
    [0, 0, 0, 3, 3, 0],
  ];
  return {
    kind: 'network',
    categories: names,
    series: names.map((name, i) => ({ name, values: w[i] })),
    ...extra,
  };
}

describe('networkGroups', () => {
  it('finds the two triangles either side of a bridge', () => {
    const edges = [
      { i: 0, j: 1, w: 3 }, { i: 0, j: 2, w: 3 }, { i: 1, j: 2, w: 3 },
      { i: 3, j: 4, w: 3 }, { i: 3, j: 5, w: 3 }, { i: 4, j: 5, w: 3 },
      { i: 0, j: 3, w: 1 },
    ];
    const g = networkGroups(6, edges);
    expect(g[0]).toBe(g[1]);
    expect(g[1]).toBe(g[2]);
    expect(g[3]).toBe(g[4]);
    expect(g[4]).toBe(g[5]);
    expect(g[0] === g[3]).toBe(false);
  });

  it('gives a node with no links no group', () => {
    expect(networkGroups(3, [{ i: 0, j: 1, w: 1 }])[2]).toBe(-1);
  });

  it('is deterministic', () => {
    const edges = [{ i: 0, j: 1, w: 2 }, { i: 1, j: 2, w: 2 }, { i: 2, j: 3, w: 1 }, { i: 3, j: 4, w: 2 }];
    expect(networkGroups(5, edges)).toEqual(networkGroups(5, edges));
  });
});

describe('the network layout', () => {
  it('colours a bridge grey and a link inside a group in the group colour', () => {
    const layout = layoutChart(twoTriangles(), 480, 320);
    const grey = layout.runs.filter((r) => r.color === NETWORK_NEUTRAL);
    expect(grey.length).toBe(1);
    expect(layout.runs.length).toBe(7);
    // Two groups, two colours among the nodes.
    expect(new Set(layout.dots.map((d) => d.color)).size).toBe(2);
  });

  it('gives each node its own colour when asked', () => {
    const layout = layoutChart(twoTriangles({ networkColor: 'node' }), 480, 320);
    expect(new Set(layout.dots.map((d) => d.color)).size).toBe(6);
  });

  it('draws an arrowhead for every direction of a one-way chart', () => {
    const spec = twoTriangles({ directed: true });
    // Break one direction of the A–B pair: now B → A only.
    spec.series[0] = { ...spec.series[0], values: [0, 0, 3, 1, 0, 0] };
    const layout = layoutChart(spec, 480, 320);
    // 13 directions exist, each a link and a head.
    expect(layout.runs.length).toBe(26);
  });

  it('puts no two nodes on top of each other', () => {
    for (const networkLayout of [undefined, 'ring'] as const) {
      const layout = layoutChart(twoTriangles({ networkLayout }), 360, 240);
      const d = layout.dots;
      for (let i = 0; i < d.length; i++) {
        for (let j = i + 1; j < d.length; j++) {
          expect(Math.hypot(d[i].x - d[j].x, d[i].y - d[j].y)).toBeGreaterThan(d[i].radius + d[j].radius);
        }
      }
    }
  });

  it('keeps every node inside the plot', () => {
    const layout = layoutChart(twoTriangles(), 300, 200);
    for (const d of layout.dots) {
      expect(d.x - d.radius).toBeGreaterThan(layout.plot.x - 0.01);
      expect(d.x + d.radius).toBeLessThan(layout.plot.x + layout.plot.width + 0.01);
    }
  });

  it('writes link weights when values are on, which the panel offers', () => {
    expect(chartCapabilities('network').valueLabels).toBe(true);
    const layout = layoutChart(twoTriangles({ showValues: true }), 480, 320);
    expect(layout.valueLabels.length).toBe(7);
  });

  it('draws the same graph every time', () => {
    const a = layoutChart(defaultChartSpec('network'), 480, 320);
    const b = layoutChart(defaultChartSpec('network'), 480, 320);
    expect(a.dots.map((d) => [d.x, d.y])).toEqual(b.dots.map((d) => [d.x, d.y]));
  });
});
