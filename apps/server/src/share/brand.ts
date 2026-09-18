/**
 * The Vega Studio mark, as geometry.
 *
 * The brand shipped as print-scale PNGs — a 4290px logomark — and every icon
 * the app served was a raster cut from one of them, or, for the install icons,
 * from an older logo altogether. This is the mark measured off that master
 * (edges sampled along scanlines, not eyeballed) and written as three paths,
 * so every size is drawn rather than resampled and a favicon, an app icon and
 * a share card cannot disagree about what the logo is.
 *
 * Drawn in a 100×100 box. The master is 4290×4134; its artwork is centred in
 * the square here, which moves it by under two units.
 */

export const BRAND_AMBER = '#F3A024';
export const BRAND_INK = '#161616';
export const BRAND_PAPER = '#FFFFFF';

/** The amber V: a stem with a tab, and a diagonal arm. */
export const MARK_V =
  'M19.78 5.42H39.27Q40.77 5.42 40.77 6.92V55.04L69.48 5.42H95.95L48.16 88Q44.45 94.42 40.2 94.42H18.28V67.32' +
  'A12 12 0 0 0 6.28 55.32H3.99V32.42H13.28A5 5 0 0 0 18.28 27.42V6.92Q18.28 5.42 19.78 5.42Z';

/** The four-point sparkle. */
export const MARK_SPARKLE =
  'M78.1 59.32Q79.0 75.92 95.4 76.82Q79.0 77.72 78.1 94.32Q77.2 77.72 60.8 76.82Q77.2 75.92 78.1 59.32Z';

export interface MarkOptions {
  /** Pixel box the mark is drawn into. */
  size: number;
  x?: number;
  y?: number;
  /** Draw the ink tile behind the artwork. */
  tile?: boolean;
  /** Tile corner radius, in the mark's 100-unit space. */
  radius?: number;
  /** Shrink the artwork inside the tile, for maskable icons' safe zone. 1 = as drawn. */
  inset?: number;
  tileColor?: string;
}

/** The mark as an SVG fragment, for composing into a larger drawing. */
export function markSvg({ size, x = 0, y = 0, tile = true, radius = 3, inset = 1, tileColor = BRAND_INK }: MarkOptions): string {
  const s = size / 100;
  const shift = (100 - 100 * inset) / 2;
  return (
    `<g transform="translate(${x} ${y}) scale(${s})">` +
    (tile ? `<rect width="100" height="100" rx="${radius}" fill="${tileColor}"/>` : '') +
    `<g transform="translate(${shift} ${shift}) scale(${inset})">` +
    `<path d="${MARK_V}" fill="${BRAND_AMBER}"/>` +
    `<path d="${MARK_SPARKLE}" fill="${BRAND_PAPER}"/>` +
    `</g></g>`
  );
}
