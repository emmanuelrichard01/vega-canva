import type { StickyTheme } from './schema';

/**
 * The note palette.
 *
 * Rebuilt from fully saturated highlighter colours (`#FDE047`, `#6EE7B7`) to a
 * paper-weight set. Three reasons, in order of how much they show:
 *
 * 1. **A wall of saturated notes is exhausting to read.** The colour should
 *    label the note, not compete with what is written on it — and at
 *    brainstorm density the old palette turned the board into a highlighter
 *    tray. Softer paper lets the *ink* carry the content.
 * 2. **Each ink is a deep version of its own hue**, not a generic dark gray.
 *    A note then reads as one material rather than as text sitting on a
 *    coloured rectangle, and every pair clears WCAG AA comfortably.
 * 3. **`edge` is a hairline in a darker tint of the paper.** Without it a pale
 *    note on a pale board has no boundary at all — the old palette got away
 *    with this only because it was loud enough to define its own edge.
 */
export const THEMES: Record<StickyTheme, { bg: string; text: string; edge: string; shadow: string }> = {
  yellow: { bg: '#FFE9A8', text: '#6B4E05', edge: '#F0D179', shadow: 'rgba(0,0,0,0.18)' },
  mint: { bg: '#BCEBD7', text: '#0F5540', edge: '#93D8BB', shadow: 'rgba(0,0,0,0.18)' },
  sky: { bg: '#C3E1FA', text: '#0C4C74', edge: '#98C9EC', shadow: 'rgba(0,0,0,0.18)' },
  pink: { bg: '#FBD2E1', text: '#7C2749', edge: '#F0B1C9', shadow: 'rgba(0,0,0,0.18)' },
  lavender: { bg: '#DDD5F8', text: '#412E7C', edge: '#C5B8EE', shadow: 'rgba(0,0,0,0.18)' },
  peach: { bg: '#FDDBBF', text: '#7C3E15', edge: '#F5C098', shadow: 'rgba(0,0,0,0.18)' },
  white: { bg: '#FFFFFF', text: '#1F2937', edge: '#E4E6EA', shadow: 'rgba(0,0,0,0.16)' },
  dark: { bg: '#2B303B', text: '#E9ECF3', edge: '#3E4553', shadow: 'rgba(0,0,0,0.34)' },
};

export const STICKY_PADDING = 18;
/** Softened a little from 12: a note is paper, not a chip of chrome. */
export const STICKY_RADIUS = 14;

function hexToRgb(hex: string) {
  const clean = hex.replace('#', '');
  return {
    r: parseInt(clean.substring(0, 2), 16) || 0,
    g: parseInt(clean.substring(2, 4), 16) || 0,
    b: parseInt(clean.substring(4, 6), 16) || 0,
  };
}

/**
 * Snap an arbitrary colour to the nearest sticky theme.
 *
 * Sticky backgrounds are a closed set of presets, but the colour picker offers
 * a free hex field. Requiring an exact match meant any colour that was not one
 * of the eight presets entered verbatim silently fell back to yellow.
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
