import { hexToRgb } from './paint';
import { luminance, normalizeHex, rgbToHex } from './color';
import type { GradientStop } from './paint';
import type { AnyNode, Appearance } from './schema';

/**
 * Colour as people type it, and as a picker shows it.
 *
 * The picker's field took hex and nothing else, so a colour copied out of a
 * stylesheet, a design token file or a browser's devtools — `rgb(59 130 246)`,
 * `hsl(217 91% 60%)`, `rebeccapurple` — was rejected and the field quietly put
 * the old value back. Every design tool in the space accepts all three; the
 * field now does too, and shows the value back in whichever of them you are
 * working in.
 *
 * Pure, so the parsing — which is where the edge cases live — is asserted.
 */

export type ColorFormat = 'hex' | 'rgb' | 'hsl';

export interface ParsedColor {
  hex: string;
  /** Present only when the input said something about alpha. */
  alpha?: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** The CSS basic names people actually type. Not all 148: the long tail is `#`-hex anyway. */
const NAMED: Record<string, string> = {
  black: '#000000', white: '#FFFFFF', red: '#FF0000', green: '#008000', blue: '#0000FF',
  yellow: '#FFFF00', orange: '#FFA500', purple: '#800080', pink: '#FFC0CB', gray: '#808080',
  grey: '#808080', brown: '#A52A2A', cyan: '#00FFFF', magenta: '#FF00FF', lime: '#00FF00',
  navy: '#000080', teal: '#008080', olive: '#808000', maroon: '#800000', silver: '#C0C0C0',
  gold: '#FFD700', indigo: '#4B0082', violet: '#EE82EE', coral: '#FF7F50', salmon: '#FA8072',
  tomato: '#FF6347', crimson: '#DC143C', turquoise: '#40E0D0', skyblue: '#87CEEB',
  rebeccapurple: '#663399', hotpink: '#FF69B4', khaki: '#F0E68C', beige: '#F5F5DC',
};

/** `50%` → 0.5, `0.5` → 0.5, `128` of 255 → 0.502 when `scale` is 255. */
function channel(raw: string, scale: number): number | null {
  const s = raw.trim();
  if (s.endsWith('%')) {
    const n = Number(s.slice(0, -1));
    return Number.isFinite(n) ? clamp(n / 100, 0, 1) : null;
  }
  const n = Number(s);
  return Number.isFinite(n) ? clamp(n / scale, 0, 1) : null;
}

export function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x]
      : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

export function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rn) h = 60 * (((gn - bn) / d) % 6);
  else if (max === gn) h = 60 * ((bn - rn) / d + 2);
  else h = 60 * ((rn - gn) / d + 4);
  return { h: (h + 360) % 360, s, l };
}

/**
 * Anything a person is likely to paste into a colour field, or `null`.
 *
 * Hex in 3, 4, 6 and 8 digits (the long forms carrying alpha), `rgb()` and
 * `hsl()` in both the comma and the space syntax with an optional alpha, and
 * the common names. `transparent` and `none` are the picker's business and not
 * parsed here.
 */
export function parseColorInput(input: string): ParsedColor | null {
  const raw = input.trim().toLowerCase();
  if (!raw) return null;

  if (NAMED[raw]) return { hex: NAMED[raw] };

  const hex = raw.startsWith('#') ? raw.slice(1) : raw;
  if (/^[0-9a-f]{4}$/.test(hex) || /^[0-9a-f]{8}$/.test(hex)) {
    const long = hex.length === 4 ? [...hex].map((c) => c + c).join('') : hex;
    return {
      hex: `#${long.slice(0, 6).toUpperCase()}`,
      alpha: Math.round((parseInt(long.slice(6, 8), 16) / 255) * 100) / 100,
    };
  }
  const plain = normalizeHex(raw);
  if (plain) return { hex: plain.toUpperCase() };

  const fn = raw.match(/^(rgba?|hsla?)\(\s*([^)]*)\)$/);
  if (!fn) return null;
  const parts = fn[2].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const alpha = parts[3] !== undefined ? channel(parts[3], 1) : undefined;
  if (alpha === null) return null;

  if (fn[1].startsWith('rgb')) {
    const [r, g, b] = parts.slice(0, 3).map((p) => channel(p, 255));
    if (r === null || g === null || b === null) return null;
    return { hex: rgbToHex({ r: r * 255, g: g * 255, b: b * 255 }), ...(alpha !== undefined ? { alpha } : {}) };
  }

  const h = Number(parts[0].replace(/deg$/, ''));
  const s = channel(parts[1], 100);
  const l = channel(parts[2], 100);
  if (!Number.isFinite(h) || s === null || l === null) return null;
  return { hex: rgbToHex(hslToRgb(h, s, l)), ...(alpha !== undefined ? { alpha } : {}) };
}

/** A hex colour in the format the picker is showing. */
export function formatColor(hex: string, format: ColorFormat): string {
  const rgb = hexToRgb(hex);
  if (!rgb || format === 'hex') return hex.toUpperCase();
  if (format === 'rgb') return `${Math.round(rgb.r)}, ${Math.round(rgb.g)}, ${Math.round(rgb.b)}`;
  const { h, s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b);
  return `${Math.round(h)}°, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%`;
}

/**
 * What a field in a given format accepts without the function name around it.
 *
 * The RGB field shows `59, 130, 246`, so typing `59, 130, 200` into it has to
 * mean rgb — not fail because it is not a CSS function.
 */
export function parseInFormat(input: string, format: ColorFormat): ParsedColor | null {
  const direct = parseColorInput(input);
  if (direct) return direct;
  const bare = input.trim().replace(/°/g, '');
  if (format === 'rgb') return parseColorInput(`rgb(${bare})`);
  if (format === 'hsl') return parseColorInput(`hsl(${bare})`);
  return null;
}

/** WCAG contrast ratio between two colours, 1..21. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  if (Number.isNaN(la) || Number.isNaN(lb)) return 1;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** The WCAG level a ratio earns for ordinary text. */
export function contrastGrade(ratio: number): 'AAA' | 'AA' | 'AA large' | 'Fails' {
  if (ratio >= 7) return 'AAA';
  if (ratio >= 4.5) return 'AA';
  if (ratio >= 3) return 'AA large';
  return 'Fails';
}

/**
 * The colour a gradient has at an offset, alpha included.
 *
 * A stop added to a gradient used to take the colour of the stop before it,
 * which puts a hard step into a smooth blend exactly where somebody clicked to
 * refine it. Every gradient editor worth using adds the colour that is already
 * there, so adding a stop changes nothing until it is moved or recoloured.
 */
export function colorAtOffset(stops: readonly GradientStop[], offset: number): { color: string; opacity: number } {
  const ordered = [...stops].sort((a, b) => a.offset - b.offset);
  if (ordered.length === 0) return { color: '#000000', opacity: 1 };
  if (offset <= ordered[0].offset) return { color: ordered[0].color, opacity: ordered[0].opacity ?? 1 };
  const last = ordered[ordered.length - 1];
  if (offset >= last.offset) return { color: last.color, opacity: last.opacity ?? 1 };
  for (let i = 1; i < ordered.length; i++) {
    const a = ordered[i - 1];
    const b = ordered[i];
    if (offset > b.offset) continue;
    const span = b.offset - a.offset;
    const t = span <= 0 ? 0 : (offset - a.offset) / span;
    const ca = hexToRgb(a.color) ?? { r: 0, g: 0, b: 0 };
    const cb = hexToRgb(b.color) ?? { r: 0, g: 0, b: 0 };
    return {
      color: rgbToHex({
        r: ca.r + (cb.r - ca.r) * t,
        g: ca.g + (cb.g - ca.g) * t,
        b: ca.b + (cb.b - ca.b) * t,
      }),
      opacity: Math.round(((a.opacity ?? 1) + ((b.opacity ?? 1) - (a.opacity ?? 1)) * t) * 100) / 100,
    };
  }
  return { color: last.color, opacity: last.opacity ?? 1 };
}

/**
 * The colours this board is already painted in, most used first.
 *
 * Figma and Lucidchart call these document colours, and they answer the
 * question a board raises that no fixed palette can: *the blue we used for
 * the other boxes*. "Recent" was trying to be this and could not — it is kept
 * per browser, so it holds colours from every board you have touched and none
 * from the colleague who laid this one out.
 *
 * Fills, gradient stops, strokes and type, counted by object. Sticky papers are
 * left out: they are a closed set of themes with their own picker, and their
 * pastel backgrounds would crowd out the colours people chose on purpose.
 */
export function boardColors(objects: Readonly<Record<string, AnyNode>>, limit = 20): Array<{ color: string; count: number }> {
  const counts = new Map<string, number>();
  const add = (color: string | undefined) => {
    if (!color || color === 'transparent') return;
    const hex = normalizeHex(color);
    if (!hex) return;
    const key = hex.toUpperCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };

  for (const node of Object.values(objects)) {
    const appearance = (node as { appearance?: Appearance }).appearance;
    for (const paint of appearance?.fill ?? []) {
      if (paint.type === 'solid') {
        if ((paint.opacity ?? 1) > 0) add(paint.color);
      } else {
        paint.stops.forEach((s) => add(s.color));
      }
    }
    if (appearance?.stroke && appearance.stroke.width > 0) add(appearance.stroke.color);
    const typography = (node as { typography?: { color?: string } }).typography;
    if (typography && (node.type === 'text' || (node as { text?: string }).text)) add(typography.color);
  }

  return [...counts.entries()]
    .map(([color, count]) => ({ color, count }))
    .sort((a, b) => b.count - a.count || a.color.localeCompare(b.color))
    .slice(0, limit);
}
