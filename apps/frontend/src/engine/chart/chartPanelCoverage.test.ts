// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { cleanup, render } from '@testing-library/react';
import { CHART_KINDS, chartCapabilities, defaultChartSpec, type ChartKind } from './chartTypes';
import { layoutChart } from './chartLayout';
import { ChartSection } from '../../components/panel/ChartSection';
import type { ChartNode } from '../model/schema';

/**
 * The properties panel, rendered for every chart kind.
 *
 * `patch` takes a `Partial<ChartSpec>`, so a control wired to a misspelled
 * field already fails the build. What type-checking cannot see is the panel's
 * *shape*: which sections a kind shows, and in what order.
 */

/**
 * The spine: at most these sections, always in this order. The source section
 * is named for the kind's source ("Formula" for a plot, "Data" otherwise).
 */
const SPINE = ['Formula', 'Data', 'Series', 'Marks', 'Axes', 'Labels', 'Colour', 'Annotations'];

const nodeFor = (kind: ChartKind): ChartNode =>
  ({
    id: `chart-${kind}`,
    type: 'chart',
    x: 0,
    y: 0,
    width: 420,
    height: 280,
    chart: defaultChartSpec(kind),
  }) as unknown as ChartNode;

interface Panel {
  sections: string[];
  subHeads: string[];
}

/** Each kind is rendered once and read; the panel is unmounted straight after. */
const panels = new Map<ChartKind, Panel>();

function panelFor(kind: ChartKind): Panel {
  const cached = panels.get(kind);
  if (cached) return cached;
  const { container } = render(createElement(ChartSection, { node: nodeFor(kind) }));
  const text = (selector: string) =>
    Array.from(container.querySelectorAll(selector), (el) => el.textContent?.trim() ?? '');
  const panel = { sections: text('.chartp-group__label'), subHeads: text('.chartp-subhead__label') };
  cleanup();
  panels.set(kind, panel);
  return panel;
}

// Rendering every kind is the slow part; do it once, up front.
beforeAll(() => {
  for (const kind of CHART_KINDS) panelFor(kind);
}, 60_000);

describe('the chart panel', () => {
  /**
   * One fixed spine of sections for every kind. Changing kind must not move a
   * control to a different place, and a kind-specific cluster must not become
   * a new top-level heading.
   */
  it.each(CHART_KINDS)('%s shows only spine sections, in spine order', (kind) => {
    const { sections } = panelFor(kind);
    expect(sections.length, `${kind} shows no sections at all`).toBeGreaterThan(0);
    for (const s of sections) expect(SPINE, `${kind} has an off-spine section "${s}"`).toContain(s);
    const positions = sections.map((s) => SPINE.indexOf(s));
    expect(positions, `${kind} sections out of order`).toEqual([...positions].sort((a, b) => a - b));
    expect(new Set(sections).size, `${kind} repeats a section`).toBe(sections.length);
  });

  it('uses every spine section somewhere', () => {
    const seen = new Set(CHART_KINDS.flatMap((kind) => panelFor(kind).sections));
    for (const s of SPINE) expect(seen, s).toContain(s);
  });

  /** Sub-clusters use a sub-heading rather than becoming another section. */
  it('names its sub-clusters without spending a section on them', () => {
    const subHeads = new Set(CHART_KINDS.flatMap((kind) => panelFor(kind).subHeads));
    expect(subHeads).toContain('Numbers');
    expect(subHeads).toContain('Order');
  });

  /**
   * A kind that answers `false` to every capability renders a panel of
   * nothing but its type header, which is how a kind gets added and quietly
   * becomes unconfigurable.
   */
  it('gives every kind something to configure', () => {
    for (const kind of CHART_KINDS) {
      expect(Object.values(chartCapabilities(kind)).some(Boolean), kind).toBe(true);
    }
  });

  /** And every kind still lays out, which is what the panel is editing. */
  it('lays out every kind from its own defaults', () => {
    for (const kind of CHART_KINDS) {
      expect(layoutChart(defaultChartSpec(kind), 420, 280).plot.width, kind).toBeGreaterThan(0);
    }
  });
});
