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
  /**
   * Readings the chart *computed*, rather than data it was given.
   *
   * A slope, a tangent's equation, a vector's magnitude: none of these is in
   * anybody's table. Giving them one accent of their own is what stops a
   * derived number in the hover readout reading as another series -- the
   * distinction the readout exists to make.
   *
   * A cyan, because the series palette has no cyan in it, so a derived row can
   * never be mistaken for the curve it was derived from.
   */
  derived: string;
  /**
   * The hairline the pointer casts onto the axes.
   *
   * Quieter than `chrome`, because it crosses the whole plot: at the axis
   * rules' own weight it reads as another gridline and competes with the data
   * it is there to help you read.
   */
  crosshair: string;
  /**
   * The accents the maths HUD marks a found feature with.
   *
   * Five hues, one per kind of thing the plotter can find for you — a root, an
   * extremum, a tangent, a crossing — because they mean different things and a
   * single accent would say only "something is here".
   *
   * Theme-aware, which they were not: they were five literals in the
   * renderer, chosen against a dark board, so on a light one the amber and
   * the cyan both dropped under 3:1 and a found root was marked in a colour
   * you had to look for. Being in the ink means they follow the theme like
   * everything else that has to be read.
   *
   * `feature` is the general one — the readout uses it to say "you are not
   * near this, you are exactly on it" — and the four beneath it distinguish
   * *what* was found.
   */
  feature: string;
  featureRoot: string;
  featureExtremum: string;
  featureTangent: string;
  featureCrossing: string;
}

/** Pure, so it can be asserted and so a worker can ask for either. */
export function chartInkFor(dark: boolean): ChartInk {
  return dark
    ? {
        chrome: '#7A8699',
        ink: '#C8D2E0',
        sliceEdge: '#18181B',
        derived: '#22D3EE',
        feature: '#FBBF24',
        featureRoot: '#FBBF24',
        featureExtremum: '#FB923C',
        featureTangent: '#34D399',
        featureCrossing: '#22D3EE',
        crosshair: 'rgba(200, 210, 224, 0.34)',
      }
    : {
        chrome: '#98A2B3',
        ink: '#475569',
        sliceEdge: '#FFFFFF',
        // A step darker on a white ground, where the bright values the dark
        // theme uses drop under 3:1 and read as disabled text.
        derived: '#0E7490',
        // Every one a step darker than its dark-theme twin, because these are
        // drawn *on* the board rather than over a plate: the bright values
        // clear 3:1 on near-black and nowhere near it on near-white.
        feature: '#B45309',
        featureRoot: '#B45309',
        featureExtremum: '#C2410C',
        featureTangent: '#047857',
        featureCrossing: '#0E7490',
        crosshair: 'rgba(71, 85, 105, 0.30)',
      };
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
/**
 * The accent for a feature the plotter found, by what it found.
 *
 * A function rather than five call sites reading five fields: the renderer had
 * a nested ternary picking between five literals, which is the shape a lookup
 * takes when it has nowhere to live.
 */
export function featureInk(kind: string | undefined, ink: ChartInk): string {
  switch (kind) {
    case 'root':
    case 'pole':
      return ink.featureRoot;
    case 'extremum':
    case 'cusp':
      return ink.featureExtremum;
    case 'tangent':
      return ink.featureTangent;
    case 'intersection':
      return ink.featureCrossing;
    default:
      return ink.feature;
  }
}

export const CHART_CHROME_NEUTRAL = '#94A3B8';
export const CHART_INK_NEUTRAL = '#64748B';
