/**
 * The ink a chart's chrome is drawn in.
 *
 * Shared by both painters rather than written into each, for the reason the
 * layout is shared: two copies of a colour is two charts that can come to
 * disagree, and the disagreement shows up in an exported file rather than on
 * screen where somebody would see it.
 *
 * ## Why these are mid-tones and not theme tokens
 *
 * A chart is *content*. It sits on the board, not in the chrome, so it is over
 * whatever the board is — a white canvas, a near-black one, a frame someone
 * has filled with their brand colour, or a photograph. A near-black axis label
 * is right on a pale board and invisible on a dark one, and `--text-secondary`
 * follows the *interface* theme rather than the surface the object is actually
 * sitting on, so it is wrong in exactly the case that matters.
 *
 * These are the same call `canvasInk` makes in the diagram engine, and the
 * reasoning transfers verbatim: pick a mid-tone that clears roughly 3:1
 * against both a white canvas and a near-black one. That is the contrast a
 * rule or a small label needs, and it is about the most a single fixed colour
 * can do against two opposite backgrounds.
 *
 * The series colours are a different question and are not here — they are
 * content in the strong sense, chosen by the author and stored on the node, so
 * that a chart looks the same for everybody rather than being re-picked per
 * viewer. See `CHART_PALETTE`.
 */

/** Grid rules, the baseline, axis ticks and category labels. */
export const CHART_CHROME = '#94A3B8';

/** Title, value labels and legend text: the words that carry meaning. */
export const CHART_INK = '#64748B';

/**
 * The hairline between a pie slice and its neighbour.
 *
 * White rather than the board's colour, because it is separating two filled
 * wedges from each other and not the pie from what is behind it. Against a
 * dark board it reads as a drawn edge, which is what it is.
 */
export const CHART_SLICE_EDGE = '#FFFFFF';
