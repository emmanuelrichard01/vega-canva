import { ThemeService } from '../ThemeService';

/**
 * The ink a chart's chrome is drawn in.
 *
 * Shared by both painters rather than written into each, for the reason the
 * layout is shared: two copies of a colour is two charts that can come to
 * disagree, and the disagreement shows up in an exported file rather than on
 * screen where somebody would see it.
 *
 * ## Why this is theme-aware, having started out fixed
 *
 * The first version was a single mid-tone per role, on the diagram engine's
 * reasoning: a chart is *content*, it sits over whatever the board is, and one
 * colour that clears 3:1 against both a white canvas and a near-black one is
 * about the most a fixed value can do.
 *
 * That reasoning is sound and it buys the wrong thing. "Clears 3:1 against
 * both" is a compromise that is *merely legible* in both themes and crisp in
 * neither — a grey pale enough to survive a dark board is washed out on a
 * white one, and the axis labels end up looking like a disabled control. The
 * board's background is not actually unknown: it follows the theme, and the
 * theme is a value this app already publishes.
 *
 * So each role has a light and a dark value, each chosen for its own ground.
 * The compromise tone is kept as the fallback for the one caller that has no
 * DOM to ask — an export running in a worker — where a colour that is legible
 * on both is exactly right.
 *
 * Konva parses fills with the 2D context, not with CSS, so a
 * `var(--text-secondary)` handed to a canvas is unparseable and silently
 * leaves the previous value in place. Every colour here is a literal for that
 * reason; `ThemeService` documents the failure in full.
 */

export interface ChartInk {
  /** Grid rules, the baseline, axis ticks, category labels, radar rings. */
  chrome: string;
  /** Title, value labels and legend text: the words that carry meaning. */
  ink: string;
  /**
   * The hairline between a pie slice and its neighbour.
   *
   * It separates two filled wedges from each other, not the pie from the board
   * behind it — so it takes the *board's* colour rather than a fixed white,
   * which on a dark board read as a bright cage drawn over the chart.
   */
  sliceEdge: string;
}

/** Pure, so it can be asserted and so a worker can ask for either. */
export function chartInkFor(dark: boolean): ChartInk {
  return dark
    ? { chrome: '#7A8699', ink: '#C8D2E0', sliceEdge: '#18181B' }
    : { chrome: '#98A2B3', ink: '#475569', sliceEdge: '#FFFFFF' };
}

/**
 * The ink for the theme currently on screen.
 *
 * Falls back to the light palette with no DOM, which is what an export running
 * outside a document gets. That is the right default rather than an arbitrary
 * one: a chart exported to SVG or PDF is overwhelmingly going into a document
 * with a white page.
 */
export function currentChartInk(): ChartInk {
  return chartInkFor(ThemeService.isDarkMode());
}

/**
 * The single-tone fallback, kept for callers with no theme to consult.
 *
 * These are the values every chart used before the split, and they are still
 * the correct answer to "one colour that has to survive both grounds".
 */
export const CHART_CHROME_NEUTRAL = '#94A3B8';
export const CHART_INK_NEUTRAL = '#64748B';
