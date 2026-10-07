import type { StickyTheme } from './schema';

/**
 * The note palette.
 *
 * Paper-weight colours rather than highlighter ones, for three reasons:
 *
 * 1. **A wall of saturated notes is exhausting to read.** The colour labels
 *    the note; the *ink* carries the content.
 * 2. **Each ink is a deep version of its own hue**, not a generic dark grey,
 *    so a note reads as one material. `inkFor` still checks the pair and falls
 *    back to neutral ink if a pairing ever drops below AA.
 * 3. **`edge` is a hairline in a darker tint of the paper**, so a pale note on
 *    a pale board keeps a boundary.
 *
 * `THEMES` is the light-board paper, and is what every consumer outside the
 * renderer reads (exports, previews, the editor overlay). `paperOf` adds the
 * dark-board version: the same hue pulled down a step, because full-brightness
 * pastels on a near-black board glare. The ink is the same in both, so the
 * editor overlay — which reads `THEMES` — writes in the colour the note is
 * drawn in whichever theme is on.
 */
export const THEMES: Record<StickyTheme, { bg: string; text: string; edge: string; shadow: string }> = {
  yellow: { bg: '#FFE9A8', text: '#5C4300', edge: '#EED593', shadow: 'rgba(0,0,0,0.18)' },
  lime: { bg: '#E0F2A8', text: '#3B5206', edge: '#CBDF92', shadow: 'rgba(0,0,0,0.18)' },
  mint: { bg: '#BCEBD7', text: '#0E5340', edge: '#A2D9C2', shadow: 'rgba(0,0,0,0.18)' },
  sky: { bg: '#C3E1FA', text: '#0C4A70', edge: '#A8CEED', shadow: 'rgba(0,0,0,0.18)' },
  lavender: { bg: '#DDD5F8', text: '#412E7C', edge: '#C9BFEC', shadow: 'rgba(0,0,0,0.18)' },
  pink: { bg: '#FBD2E1', text: '#7A2547', edge: '#EDBBCE', shadow: 'rgba(0,0,0,0.18)' },
  coral: { bg: '#FFD0C6', text: '#7F2416', edge: '#F1B9AD', shadow: 'rgba(0,0,0,0.18)' },
  peach: { bg: '#FDDBBF', text: '#783B12', edge: '#EFC6A4', shadow: 'rgba(0,0,0,0.18)' },
  white: { bg: '#FFFFFF', text: '#1F2937', edge: '#E4E6EA', shadow: 'rgba(0,0,0,0.16)' },
  dark: { bg: '#2B303B', text: '#E9ECF3', edge: '#3E4553', shadow: 'rgba(0,0,0,0.34)' },
};

/** The order the palette is offered in: by hue, then the neutrals. Storage order is `STICKY_THEMES`. */
export const PALETTE_ORDER: readonly StickyTheme[] = [
  'yellow',
  'lime',
  'mint',
  'sky',
  'lavender',
  'pink',
  'coral',
  'peach',
  'white',
  'dark',
];

/** Display names, for tooltips and screen readers. */
export const THEME_LABELS: Record<StickyTheme, string> = {
  yellow: 'Yellow',
  lime: 'Lime',
  mint: 'Mint',
  sky: 'Sky',
  lavender: 'Lavender',
  pink: 'Pink',
  coral: 'Coral',
  peach: 'Peach',
  white: 'White',
  dark: 'Graphite',
};

export const STICKY_PADDING = 18;
/** A note is paper, not a chip of chrome: a soft corner, not a pill. */
export const STICKY_RADIUS = 6;

function hexToRgb(hex: string) {
  const clean = hex.replace('#', '');
  return {
    r: parseInt(clean.substring(0, 2), 16) || 0,
    g: parseInt(clean.substring(2, 4), 16) || 0,
    b: parseInt(clean.substring(4, 6), 16) || 0,
  };
}

function toHex({ r, g, b }: { r: number; g: number; b: number }): string {
  const h = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase();
}

/** `a` moved `t` of the way to `b`. */
export function mixHex(a: string, b: string, t: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return toHex({ r: x.r + (y.r - x.r) * t, g: x.g + (y.g - x.g) * t, b: x.b + (y.b - x.b) * t });
}

function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two opaque colours. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Body-text floor. Note writing is large, but footer text is 10px, so everything clears the small-text bar. */
const AA = 4.5;

/** The preferred ink if it clears AA on `bg`, else whichever neutral reads better. */
export function inkFor(bg: string, preferred: string): string {
  if (contrastRatio(bg, preferred) >= AA) return preferred;
  const dark = '#111827';
  const light = '#F9FAFB';
  return contrastRatio(bg, dark) >= contrastRatio(bg, light) ? dark : light;
}

/**
 * A quieter ink for the footer (author, date, counts): the main ink eased
 * toward the paper, but never past the point where it stops clearing AA.
 */
export function secondaryInkFor(bg: string, ink: string): string {
  for (let t = 0.24; t > 0; t -= 0.02) {
    const candidate = mixHex(ink, bg, t);
    if (contrastRatio(bg, candidate) >= AA + 0.1) return candidate;
  }
  return ink;
}

export interface Paper {
  bg: string;
  /** A lighter tone of the paper for the top of its gradient. */
  sheen: string;
  ink: string;
  secondaryInk: string;
  edge: string;
}

const NIGHT = '#18181B';
const cache = new Map<string, Paper>();

/** The paper a theme is drawn on, on a light or a dark board. */
export function paperOf(theme: StickyTheme, darkBoard: boolean): Paper {
  const key = `${theme}|${darkBoard ? 1 : 0}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const base = THEMES[theme] ?? THEMES.yellow;
  const bg = !darkBoard ? base.bg : theme === 'dark' ? '#363C48' : mixHex(base.bg, NIGHT, 0.1);
  const ink = inkFor(bg, base.text);
  const paper: Paper = {
    bg,
    sheen: mixHex(bg, '#FFFFFF', theme === 'dark' ? 0.05 : 0.35),
    ink,
    secondaryInk: secondaryInkFor(bg, ink),
    edge: !darkBoard ? base.edge : theme === 'dark' ? '#4A5160' : mixHex(bg, ink, 0.12),
  };
  cache.set(key, paper);
  return paper;
}

/**
 * Snap an arbitrary colour to the nearest sticky theme.
 *
 * Sticky backgrounds are a closed set of presets, but the colour picker offers
 * a free hex field; any colour that is not a preset lands on the closest one.
 */
export function nearestTheme(hex: string): StickyTheme {
  const target = hexToRgb(hex);
  let best: StickyTheme = 'yellow';
  let bestDist = Infinity;
  (Object.keys(THEMES) as StickyTheme[]).forEach((name) => {
    const c = hexToRgb(THEMES[name].bg);
    const dist = (c.r - target.r) ** 2 + (c.g - target.g) ** 2 + (c.b - target.b) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = name;
    }
  });
  return best;
}

/** The sizes a note comes in. `M` is what the tool places. */
export const STICKY_SIZES = [
  { id: 'S', label: 'Small', width: 160, height: 160 },
  { id: 'M', label: 'Medium', width: 200, height: 200 },
  { id: 'L', label: 'Large', width: 280, height: 280 },
  { id: 'wide', label: 'Wide', width: 400, height: 200 },
] as const;

export type StickySizeId = (typeof STICKY_SIZES)[number]['id'];

/** The named size a note is, or null when it has been resized by hand. */
export function stickySizeOf(width: number, height: number): StickySizeId | null {
  return STICKY_SIZES.find((s) => s.width === Math.round(width) && s.height === Math.round(height))?.id ?? null;
}

/** Fixed writing sizes, in world pixels of Caveat (about two thirds of Inter at the same number). */
export const FIXED_TEXT_SIZES = [
  { id: 'S', label: 'Small', size: 20 },
  { id: 'M', label: 'Medium', size: 28 },
  { id: 'L', label: 'Large', size: 40 },
  { id: 'XL', label: 'Extra large', size: 56 },
] as const;
