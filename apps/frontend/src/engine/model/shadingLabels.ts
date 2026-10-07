/**
 * What every hand-drawn setting is called, in one place.
 *
 * The properties panel and the selection rail both name these settings, and
 * they read them from here so the two surfaces never describe one setting two
 * ways. Kept beside the generator rather than beside the icons because a file
 * that exports both a component and a constant loses fast refresh.
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
 * How hard the pen was pressed, from a neat hand to a deliberate scrawl.
 *
 * Each name is followed by what it does rather than by how it works, because
 * "two passes" is a fact about the generator and "drawn twice" is a fact about
 * the drawing. The person choosing is looking at the drawing.
 */
export const SKETCH_LEVEL_NAMES: Record<SketchLevel, string> = {
  light: 'Neat',
  medium: 'Sketchy',
  heavy: 'Wild',
};

export const SKETCH_LEVEL_LABELS: Record<'off' | SketchLevel, string> = {
  off: 'Clean: ruled lines',
  light: 'Neat: one steady pass',
  medium: 'Sketchy: drawn twice',
  heavy: 'Wild: twice, and past every corner',
};

/** The two looks an object can take, as the per-object override names them. */
export const SKETCH_LOOK_LABELS = {
  clean: 'Clean: ruled lines',
  sketch: 'Sketch: drawn by hand',
} as const;

/** The short names, for badges and tight places. */
export const FILL_STYLE_NAMES: Record<FillStyle, string> = {
  solid: 'Solid',
  hachure: 'Hachure',
  crosshatch: 'Cross-hatch',
  dots: 'Dots',
  zigzag: 'Scribble',
};

/** What happens to the interior once the outline is hand-drawn. */
export const FILL_STYLE_LABELS: Record<FillStyle, string> = {
  solid: 'Solid: a flat fill',
  hachure: 'Hachure: parallel pen strokes',
  crosshatch: 'Cross-hatch: two sets, crossed',
  dots: 'Dots: stippled by hand',
  zigzag: 'Scribble: one back-and-forth line',
};

/** The order the fill styles are offered in: the four classics, then the scribble. */
export const FILL_STYLE_ORDER: readonly FillStyle[] = ['solid', 'hachure', 'crosshatch', 'dots', 'zigzag'];
