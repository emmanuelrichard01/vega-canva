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

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * VEGA, as the wordmark draws it: a V and a crossbar-less A of the same
 * stroke, an E of three free bars, and a G that is an open ring with a spur.
 *
 * The same measurements as `vegaWordmark` in the frontend's template kit
 * (`engine/templates/catalogue/artKit.ts`), which took them off
 * `public/brand/wordmark-light.png` at a cap height of 91 units; no shipped
 * face has that E or that A, so it is geometry, not type. Keep the two in step.
 */
export function wordmarkSvg(x: number, y: number, cap: number, color = BRAND_INK): string {
  const s = cap / 91;
  const P = (pts: Array<[number, number]>) =>
    `<path d="${pts.map(([px, py], i) => `${i ? 'L' : 'M'}${r2(x + px * s)} ${r2(y + py * s)}`).join('')}Z" fill="${color}"/>`;

  let out = P([[0, 0], [18, 0], [43, 64], [68, 0], [86, 0], [48, 91], [38, 91]]);
  for (const [top, w] of [[0, 66], [36, 64], [76, 66]] as const) out += P([[146, top], [146 + w, top], [146 + w, top + 15], [146, top + 15]]);

  const cx = 315;
  const cy = 45.5;
  const R = 46;
  const r = 28;
  const from = (-36 * Math.PI) / 180;
  const to = -2 * Math.PI;
  const ring: Array<[number, number]> = [];
  const STEPS = 40;
  for (let i = 0; i <= STEPS; i++) {
    const a = from + ((to - from) * i) / STEPS;
    ring.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]);
  }
  const BAR = 12;
  ring.push([cx + 5, cy], [cx + 5, cy + BAR]);
  const resume = to + Math.asin(BAR / r);
  for (let i = 0; i <= STEPS; i++) {
    const a = resume + ((from - resume) * i) / STEPS;
    ring.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  out += P(ring);
  out += P([[408, 91], [446, 0], [456, 0], [494, 91], [476, 91], [451, 30], [427, 91]]);
  return out;
}

/** The wordmark's width at a cap height, for centring it. */
export const wordmarkWidth = (cap: number) => (494 * cap) / 91;

/** The lockup's proportions: STUDIO's cap height and width against VEGA's. */
export const STUDIO_CAP = 0.27;
export const STUDIO_WIDTH = 0.6;

/** STUDIO, in the wordmark's light tracked capitals, spread across `width`. */
export function studioSvg(x: number, y: number, cap: number, width: number, color = BRAND_AMBER, weight = 0.09): string {
  const glyphs: Array<{ advance: number; d: string }> = [
    { advance: 0.66, d: 'M.63 .15C.57 .04 .46 0 .34 0C.16 0 .04 .1 .04 .26C.04 .42 .2 .47 .36 .5C.53 .53 .66 .6 .66 .75C.66 .9 .53 1 .33 1C.18 1 .06 .94 .01 .84' },
    { advance: 0.7, d: 'M0 0H.7M.35 0V1' },
    { advance: 0.72, d: 'M0 0V.62C0 .86 .15 1 .36 1C.57 1 .72 .86 .72 .62V0' },
    { advance: 0.84, d: 'M0 0H.36C.66 0 .84 .22 .84 .5C.84 .78 .66 1 .36 1H0Z' },
    { advance: 0, d: 'M0 0V1' },
    { advance: 1, d: 'M.5 0A.5 .5 0 1 1 .5 1A.5 .5 0 1 1 .5 0Z' },
  ];
  const inked = glyphs.reduce((sum, g) => sum + g.advance * cap, 0);
  const gap = (width - inked) / (glyphs.length - 1);
  // Stroke width in glyph units: 0.09 of the cap is the brand's light weight;
  // a share card asks for more, so STUDIO survives being shrunk.
  let ox = x;
  let out = `<g fill="none" stroke="${color}" stroke-width="${r2(weight)}" stroke-linecap="butt" stroke-linejoin="miter">`;
  for (const g of glyphs) {
    out += `<path d="${g.d}" transform="translate(${r2(ox)} ${r2(y)}) scale(${r2(cap)})"/>`;
    ox += g.advance * cap + gap;
  }
  return `${out}</g>`;
}
