import { hexToRgb } from './paint';

/**
 * Colour arithmetic for the picker.
 *
 * Kept apart from `paint.ts`, which describes what a fill *is*; this is how a
 * human moves around inside one. The picker needs HSV specifically — not HSL
 * and not RGB — because the two-dimensional area everyone recognises is
 * saturation against value at a fixed hue, and that shape only exists in HSV.
 *
 * `hexToRgb` is imported rather than reimplemented: there is already exactly
 * one parser for a stored colour, and a second one that disagreed about `#abc`
 * or about whitespace would be a bug that only appears in one of the two
 * places colours are read.
 */

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface HSV {
  /** 0..360 */
  h: number;
  /** 0..1 */
  s: number;
  /** 0..1 */
  v: number;
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** A byte as two uppercase hex digits. */
function byte(n: number): string {
  return clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0').toUpperCase();
}

export function rgbToHex({ r, g, b }: RGB): string {
  return `#${byte(r)}${byte(g)}${byte(b)}`;
}

export function rgbToHsv({ r, g, b }: RGB): HSV {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;

  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }

  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export function hsvToRgb({ h, s, v }: HSV): RGB {
  const hn = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((hn / 60) % 2) - 1));
  const m = v - c;

  let rgb: [number, number, number];
  if (hn < 60) rgb = [c, x, 0];
  else if (hn < 120) rgb = [x, c, 0];
  else if (hn < 180) rgb = [0, c, x];
  else if (hn < 240) rgb = [0, x, c];
  else if (hn < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];

  return { r: (rgb[0] + m) * 255, g: (rgb[1] + m) * 255, b: (rgb[2] + m) * 255 };
}

export function hexToHsv(hex: string): HSV | null {
  const rgb = hexToRgb(hex);
  return rgb ? rgbToHsv(rgb) : null;
}

export function hsvToHex(hsv: HSV): string {
  return rgbToHex(hsvToRgb(hsv));
}

/**
 * Make sense of what someone typed into the hex field.
 *
 * Accepts `abc`, `#abc`, `AABBCC` and pads or rejects everything else, so the
 * field can be typed into normally — the previous one fired `onChange` on
 * every keystroke, which meant typing `#E11D48` wrote `#E`, `#E1`, `#E11`…
 * and each of those is either an invalid colour or, worse, a *valid* short one
 * that silently repainted the object mid-word.
 *
 * Returns null for anything that is not a colour, so the caller can leave the
 * field alone rather than guessing.
 */
export function normalizeHex(input: string): string | null {
  const raw = input.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]+$/.test(raw)) return null;
  if (raw.length === 3) {
    return `#${raw
      .split('')
      .map((ch) => ch + ch)
      .join('')
      .toUpperCase()}`;
  }
  if (raw.length === 6) return `#${raw.toUpperCase()}`;
  return null;
}

/**
 * Relative luminance, for deciding what to draw *on top of* a colour.
 *
 * The picker's handles sit over arbitrary user colour, so a fixed white ring
 * disappears on a pale fill and a fixed dark one disappears on a deep fill.
 * Same problem the remote-cursor name chips solve, and the same fix.
 */
export function luminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const channel = (c: number) => {
    const n = c / 255;
    return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

/** Near-black or near-white, whichever will actually be visible on `hex`. */
export function contrastInk(hex: string): string {
  return luminance(hex) > 0.45 ? '#111827' : '#FFFFFF';
}

/**
 * Lift a colour until it can be seen against the surface it sits on.
 *
 * An object's own fill is the most useful thing to tint its row icon with —
 * it is what tells six identically-named "Shape" rows apart. But a fill is
 * arbitrary user colour, and a near-black object on a dark panel (or a white
 * one on a light panel) produces an icon that is technically correct and
 * completely invisible.
 *
 * Rather than abandoning the tint, this walks it toward the readable end until
 * it clears a minimum contrast against the surface. A dark red stays
 * recognisably red; it just stops being indistinguishable from the panel.
 */
/**
 * The same lift, measured against the surface it will actually sit on.
 *
 * `readableOn` assumes the surface is the board — near-white at 0.96 or
 * near-black at 0.05. A label on a **plate** is on neither: the plate is a
 * mid-tone panel drawn under the words so the line crossing behind them does
 * not cut through the text, and against it a colour that clears 3:1 on white
 * can be nearly invisible. The plate solves the *line* over the words and does
 * nothing about the words themselves, which is exactly the case that needs the
 * real number.
 *
 * Same walk through HSV, so the hue survives and a dark red label stays
 * recognisably red rather than being replaced with black.
 */
export function readableOnSurface(color: string, surface: string, minRatio = 4.5): string {
  const rgb = hexToRgb(color);
  const surfaceLum = luminance(surface);
  // An unparseable colour is left alone rather than guessed at: returning
  // black would silently discard whatever the author chose.
  if (!rgb || Number.isNaN(surfaceLum)) return color;

  const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  if (ratio(luminance(color), surfaceLum) >= minRatio) return color;

  // Away from the surface, whichever way that is. Deciding by the surface's
  // own luminance rather than by a dark-mode flag is the whole point — a pale
  // plate in dark mode wants dark ink, and a flag would give it light ink.
  const towardDark = surfaceLum > 0.5;
  const hsv = rgbToHsv(rgb);
  let best = color;
  let bestRatio = ratio(luminance(color), surfaceLum);
  for (let i = 1; i <= 14; i += 1) {
    const v = towardDark ? Math.max(0, hsv.v - i * 0.07) : Math.min(1, hsv.v + i * 0.07);
    const s = !towardDark && hsv.v < 0.2 ? Math.max(hsv.s, 0.35) : hsv.s;
    const candidate = hsvToHex({ h: hsv.h, s, v });
    const r = ratio(luminance(candidate), surfaceLum);
    if (r > bestRatio) {
      bestRatio = r;
      best = candidate;
    }
    if (r >= minRatio) return candidate;
  }
  // Nothing reached the target — a mid-grey plate under a mid-grey ink has no
  // answer in this hue. The best of the attempts beats giving up on the first.
  return best;
}

export function readableOn(color: string, surfaceIsDark: boolean, minRatio = 2.6): string {
  const rgb = hexToRgb(color);
  if (!rgb) return color;

  const surfaceLum = surfaceIsDark ? 0.05 : 0.96;
  const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  if (ratio(luminance(color), surfaceLum) >= minRatio) return color;

  // Move in HSV so the hue survives: only the value changes, which is what
  // keeps "a dark blue" reading as blue rather than as grey.
  const hsv = rgbToHsv(rgb);
  for (let i = 1; i <= 12; i += 1) {
    const v = surfaceIsDark
      ? Math.min(1, hsv.v + i * 0.07)
      : Math.max(0, hsv.v - i * 0.07);
    // A very dark colour has almost no saturation to work with, so give it
    // some as it brightens or it converges on flat grey.
    const s = surfaceIsDark && hsv.v < 0.2 ? Math.max(hsv.s, 0.35) : hsv.s;
    const candidate = hsvToHex({ h: hsv.h, s, v });
    if (ratio(luminance(candidate), surfaceLum) >= minRatio) return candidate;
  }
  return surfaceIsDark ? '#E5E5E5' : '#404040';
}
