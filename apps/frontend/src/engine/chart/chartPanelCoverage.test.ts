import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHART_KINDS, chartCapabilities, defaultChartSpec } from './chartTypes';
import { layoutChart } from './chartLayout';

/**
 * The properties panel, checked for the things the compiler cannot see.
 *
 * `patch` takes a `Partial<ChartSpec>`, so a control wired to a misspelled
 * field already fails the build — there is no value in asserting it again
 * here, and an earlier draft of this file did exactly that with a hand-written
 * allowlist that was already wrong on its first run. What is left is what
 * type-checking has nothing to say about: the panel's *shape*, and whether
 * every kind can be configured at all.
 */
const PANEL = readFileSync(join(__dirname, '../../components/panel/ChartSection.tsx'), 'utf8');

describe('the chart panel', () => {
  /**
   * Six sections, in one order, for every kind.
   *
   * There were up to fifteen top-level groups and which appeared depended on
   * the kind — a histogram had "Density" *and* "Distribution", a scatter had
   * "Analytics", a field had "Solution Streamlines", four of them held a
   * single row. Nothing was in the same place twice, so changing kind meant
   * re-reading the panel to find the control you had just been using.
   *
   * The spine is the design. A test on it is what stops the next kind-specific
   * cluster becoming a sixteenth heading.
   */
  it('has one fixed spine of sections', () => {
    // `\s+` rather than a literal space: a `<Group>` that also carries
    // `actions` puts its label on the next line, and matching only the
    // one-line form silently dropped the two source sections.
    const sections = [...PANEL.matchAll(/<Group\s+label=(?:"([^"]+)"|\{([^}]+)\})/g)].map(
      (m) => m[1] ?? m[2]
    );

    expect(sections).toEqual([
      // Source, under whichever name this kind's source goes by.
      'Formula',
      'Data',
      'Marks',
      'Scales',
      'Labels',
      'Colour',
      'Notes',
    ]);
  });

  /** Sub-clusters use a sub-heading rather than becoming another section. */
  it('names its sub-clusters without spending a section on them', () => {
    expect(PANEL).toContain('<SubHead label="Numbers" />');
    expect(PANEL).toContain('<SubHead label="Order" />');
  });

  /**
   * A kind that answers `false` to every capability renders a panel of
   * nothing but its type header — which is how a kind gets added and quietly
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
