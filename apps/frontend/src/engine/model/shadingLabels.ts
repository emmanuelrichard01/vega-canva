/**
 * What every hand-drawn setting is called, in one place.
 *
 * Beside the generator rather than beside the icons, for the reason the lint
 * rule pointed at: a file that exports both a component and a constant loses
 * fast refresh for everything in it. And these are the sort of thing two
 * surfaces want, which is exactly what happened.
 *
 * ## Why the sketch and fill names moved here
 *
 * They were written out twice: once in `SketchSection`, as the labels on two
 * segmented controls, and once in `ObjectContextToolbar`, as `SKETCH_LABELS`
 * and `FILL_LABELS` for the rail's popover. Nine strings each side, identical
 * by hand and kept that way by nobody. That is invariant 7 in its plainest
 * form, and the failure it produces is the quiet one: the panel and the rail
 * describe the same setting differently, each looks right on its own, and only
 * somebody using both notices.
 *
 * The toolbar's own note already said these strings appear twice and must not
 * disagree. It was solving that inside one file while the other file held a
 * second copy.
 */

import type { FillStyle, ShadingDensity, SketchLevel } from './rough';

export const SHADING_DENSITY_LABELS: Record<ShadingDensity, string> = {
  light: 'Light',
  medium: 'Medium',
  dense: 'Dense',
};

export const SHADING_DENSITY_HINTS: Record<ShadingDensity, string> = {
  light: 'Light: open strokes, a pale tone',
  medium: 'Medium: the ordinary weight',
  dense: 'Dense: close strokes, a dark tone',
};

/**
 * How hard the pen was pressed, from a ruled edge to a deliberate scrawl.
 *
 * Each name is followed by what it does rather than by how it works, because
 * "two passes" is a fact about the generator and "drawn twice" is a fact about
 * the drawing. The person choosing is looking at the drawing.
 */
export const SKETCH_LEVEL_LABELS: Record<'off' | SketchLevel, string> = {
  off: 'Off: a ruled shape',
  light: 'Light: one confident pass',
  medium: 'Medium: drawn twice',
  heavy: 'Heavy: twice, and past every corner',
};

/** What happens to the interior once the outline is hand-drawn. */
export const FILL_STYLE_LABELS: Record<FillStyle, string> = {
  solid: 'Solid: a flat fill',
  hachure: 'Hachure: parallel pen strokes',
  crosshatch: 'Cross-hatch: two sets, crossed',
  zigzag: 'Scribble: continuous back-and-forth pen marks',
  dots: 'Stipple: hand-drawn dots',
};
