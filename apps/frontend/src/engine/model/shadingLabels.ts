/**
 * What the three shading densities are called.
 *
 * Beside the generator rather than beside the icon, for the reason the lint
 * rule pointed at: a file that exports both a component and a constant loses
 * fast refresh for everything in it. And these are the sort of thing two
 * surfaces will want — the panel today, a toolbar popover tomorrow — so they
 * belong somewhere neither has to import a component to reach.
 */

import type { ShadingDensity } from './rough';

export const SHADING_DENSITY_LABELS: Record<ShadingDensity, string> = {
  light: 'Light',
  medium: 'Medium',
  dense: 'Dense',
};

export const SHADING_DENSITY_HINTS: Record<ShadingDensity, string> = {
  light: 'Light — open strokes, a pale tone',
  medium: 'Medium — the ordinary weight',
  dense: 'Dense — close strokes, a dark tone',
};
