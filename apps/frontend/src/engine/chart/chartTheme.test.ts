import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chartInkFor, featureInk } from './chartInk';
import { layoutChart } from './chartLayout';
import { paintLayout } from './chartSvg';
import { contrastInk } from '../model/color';
import { CHART_KINDS, defaultChartSpec, type ChartSpec } from './chartTypes';

/**
 * Everything a chart draws has to be readable in both themes.
 *
 * The failure this guards is quiet by construction: a colour chosen against a
 * dark board looks fine to whoever chose it, and is only wrong for people on
 * the other theme — who see a mark they cannot make out and have no reason to
 * think anything is broken.
 */

const W = 520;
const H = 340;

describe('chart ink', () => {
  it('answers for every role in both themes', () => {
    for (const dark of [true, false]) {
      const ink = chartInkFor(dark);
      for (const [role, value] of Object.entries(ink)) {
        expect(typeof value, role).toBe('string');
        expect(value.length, role).toBeGreaterThan(3);
      }
    }
  });

  it('gives light and dark genuinely different values', () => {
    const light = chartInkFor(false);
    const dark = chartInkFor(true);
    for (const role of Object.keys(light) as Array<keyof typeof light>) {
      expect(light[role], `${role} is the same in both themes`).not.toBe(dark[role]);
    }
  });

  /**
   * The maths HUD picked its accent with a nested ternary over five literals.
   * A lookup can be checked; a ternary in a renderer cannot.
   */
  it('marks each kind of found feature differently', () => {
    const ink = chartInkFor(true);
    const kinds = ['root', 'extremum', 'tangent', 'intersection'];
    const accents = kinds.map((k) => featureInk(k, ink));
    expect(new Set(accents).size).toBe(kinds.length);
    // A pole reads as a root and a cusp as an extremum: same kind of thing.
    expect(featureInk('pole', ink)).toBe(featureInk('root', ink));
    expect(featureInk('cusp', ink)).toBe(featureInk('extremum', ink));
    // Anything unrecognised still gets an accent rather than nothing.
    expect(featureInk('something new', ink)).toBe(ink.feature);
  });
});

describe('labels drawn on a mark', () => {
  /**
   * Every value label was painted in the board's foreground, including the
   * ones placed *inside* a bar or a slice — so a number inside a dark bar was
   * dark on dark in the light theme, and light on light in the dark one.
   */
  it('says what an inside label sits on, so a painter can contrast against it', () => {
    const spec: ChartSpec = {
      kind: 'bar',
      categories: ['a', 'b'],
      series: [{ name: 'S', values: [10, 20] }],
      showValues: true,
      valuePlacement: 'inside',
    };
    const l = layoutChart(spec, W, H);
    expect(l.valueLabels.length).toBeGreaterThan(0);
    for (const label of l.valueLabels) expect(label.on).toBeTruthy();
  });

  it('leaves an outside label on the board, where the board ink is right', () => {
    const l = layoutChart(
      {
        kind: 'bar',
        categories: ['a'],
        series: [{ name: 'S', values: [10] }],
        showValues: true,
        valuePlacement: 'outside',
      },
      W,
      H
    );
    for (const label of l.valueLabels) expect(label.on).toBeUndefined();
  });

  it("says what a pie's slice label sits on", () => {
    const l = layoutChart(
      {
        kind: 'pie',
        categories: ['a', 'b', 'c'],
        series: [{ name: 'S', values: [30, 40, 30] }],
        showValues: true,
      },
      W,
      H
    );
    expect(l.valueLabels.length).toBeGreaterThan(0);
    for (const label of l.valueLabels) expect(label.on).toBeTruthy();
  });

  it('picks a legible foreground for whatever it lands on', () => {
    // Black on a pale mark, white on a dark one — the property that makes the
    // field worth carrying at all.
    expect(contrastInk('#FDE68A')).not.toBe(contrastInk('#1E3A8A'));
  });
});

describe('the export follows the theme too', () => {
  it('paints a chart differently for a dark board than a light one', () => {
    const spec = defaultChartSpec('bar');
    const layout = layoutChart(spec, W, H);
    const light = paintLayout(layout, { id: 'x', ink: chartInkFor(false) });
    const dark = paintLayout(layout, { id: 'x', ink: chartInkFor(true) });
    expect(light).not.toBe(dark);
  });

  it('carries no colour of its own for the theme to disagree with', () => {
    /**
     * Both painters had the same five overlay literals typed into them — a
     * trendline's amber, a density curve's cyan, a streamline's blue — so the
     * board and the file could drift, and neither followed the theme. Read as
     * text rather than rendered, because the failure is the *source* carrying
     * a colour at all.
     */
    const source = readFileSync(join(__dirname, 'chartSvg.ts'), 'utf8');
    const literals = source.match(/["']#[0-9A-Fa-f]{3,8}["']/g) ?? [];
    expect(literals, 'colour literals in the SVG painter').toEqual([]);
  });

  it('lays out and paints every kind in both themes', () => {
    for (const kind of CHART_KINDS) {
      const layout = layoutChart(defaultChartSpec(kind), W, H);
      for (const dark of [true, false]) {
        const svg = paintLayout(layout, { id: 'k', ink: chartInkFor(dark) });
        expect(typeof svg, kind).toBe('string');
      }
    }
  });
});
