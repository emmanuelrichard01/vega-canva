/**
 * Text that changes colour along its own length.
 *
 * ## What it is
 *
 * A palette handed out across a block of text, one colour per piece — a letter
 * each, or a word each — cycling when the text outruns the palette. "He is a
 * boy" with the rainbow is red, yellow, blue, green: four words, four colours,
 * each one a colour somebody chose.
 *
 * Nobody has to pick a colour per word, and nothing has to be re-picked when
 * the text is edited. Adding a word simply takes the next colour.
 *
 * ## Why it is not a gradient fill
 *
 * A gradient fill on text is continuous — a letter can be half one colour and
 * half the next, and a single glyph straddling a stop reads as a printing
 * error rather than as a choice. Each piece here takes one flat colour, which
 * is what keeps it legible at small sizes and what people mean by rainbow
 * text.
 *
 * ## Why a piece is a whole word, not a share of the line
 *
 * A word-cycled block asks once per word, so "extraordinarily" and "of" each
 * take one colour. Anything measured by length instead would give the long
 * word a bigger share of the palette, which reads as an accident rather than
 * as a rule.
 *
 * Everything here is pure and works on strings and numbers, so the renderer,
 * the exporter and any future consumer sample exactly the same colours.
 */

import type { GradientStop } from '../model/paint';

/** What gets its own colour. */
export const CYCLE_UNITS = ['character', 'word'] as const;
export type CycleUnit = (typeof CYCLE_UNITS)[number];

export interface ColorCycle {
  unit: CycleUnit;
  /** The palette, handed out one colour per piece and wrapping when it runs out. */
  colors: string[];
}

/**
 * The ramps offered by name.
 *
 * First and last are deliberately different. The palette wraps, so a matching
 * pair would put two identical neighbours next to each other at the seam —
 * visible on any text longer than the palette, and it reads as a repeat rather
 * than as a cycle.
 */
export const CYCLE_PRESETS: Record<string, { label: string; colors: string[] }> = {
  rainbow: {
    label: 'Rainbow',
    colors: ['#EF4444', '#F97316', '#EAB308', '#22C55E', '#3B82F6', '#8B5CF6'],
  },
  sunset: { label: 'Sunset', colors: ['#F97316', '#EC4899', '#8B5CF6'] },
  ocean: { label: 'Ocean', colors: ['#06B6D4', '#3B82F6', '#6366F1'] },
  citrus: { label: 'Citrus', colors: ['#84CC16', '#EAB308', '#F97316'] },
  candy: { label: 'Candy', colors: ['#F472B6', '#C084FC', '#60A5FA', '#34D399'] },
  mono: { label: 'Fade', colors: ['#111827', '#9CA3AF'] },
};

/** `#rrggbb` to three numbers. Anything unparseable comes back black. */
function toRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * The colour at position `t` along a ramp.
 *
 * Interpolated in plain RGB. Not because it is the best colour space — it is
 * not; a perceptual one keeps mid-points from going muddy — but because the
 * ramps above are chosen to be pleasant *as steps*, and every piece lands on a
 * step rather than between two of them unless the piece count is small. The
 * complexity of a perceptual blend buys nothing a caller could see here.
 */
export function sampleRamp(colors: readonly string[], t: number): string {
  if (colors.length === 0) return '#000000';
  if (colors.length === 1) return colors[0];
  const clamped = clamp01(t);
  const scaled = clamped * (colors.length - 1);
  const i = Math.min(colors.length - 2, Math.floor(scaled));
  const local = scaled - i;
  const [r1, g1, b1] = toRgb(colors[i]);
  const [r2, g2, b2] = toRgb(colors[i + 1]);
  const mix = (a: number, b: number) => Math.round(a + (b - a) * local);
  return `#${((1 << 24) | (mix(r1, r2) << 16) | (mix(g1, g2) << 8) | mix(b1, b2))
    .toString(16)
    .slice(1)}`;
}

/**
 * The colour for one piece.
 *
 * ## Why this hands out palette colours rather than sampling the ramp
 *
 * It sampled at first — piece `i` of `n` took the colour at `i / (n - 1)` along
 * a blend. That is the right answer for a *gradient* and the wrong one here.
 * On "He is a boy" it gives four colours interpolated between six stops, so
 * every word comes out a muddy in-between shade and none of them is a colour
 * anybody chose. What rainbow text means is *these* colours, one each, in
 * order: red, yellow, blue, green.
 *
 * So the palette is handed out directly and wraps when the text outruns it. A
 * cycle is a cycle — a fifth word starts the palette again, which is both what
 * the name says and what reads as deliberate on a long block, where a slow
 * interpolated wash just looks like a gradient that failed.
 *
 * `total` is kept in the signature and unused: callers already compute it for
 * layout, and a colour that depends on the length of the whole block is the
 * kind of thing this may want back. Naming it out loud is cheaper than
 * removing it and rediscovering why it was there.
 */
export function cycleColor(cycle: ColorCycle, index: number, _total: number): string {
  if (cycle.colors.length === 0) return '#000000';
  return cycle.colors[index % cycle.colors.length];
}

/** One coloured piece of a line: what to draw, and where it belongs in the ramp. */
export interface CycleRun {
  text: string;
  /** Offset of this run within its line, in characters. */
  at: number;
  /** Position of this run in the whole block, counted in pieces. */
  index: number;
}

/**
 * Split a line into the pieces that each take a colour.
 *
 * `offset` is the line's own start in the source string, and `before` is how
 * many pieces the block has already spent — both are needed because a line
 * knows nothing about the ones above it and the ramp is a property of the
 * *block*. A line-local ramp would restart the rainbow on every wrap, which is
 * exactly the thing that looks amateur.
 *
 * Whitespace rides with the word before it in word mode, so the runs
 * concatenate back to the original line and positioning stays exact.
 */
export function cycleRuns(line: string, unit: CycleUnit, before: number): CycleRun[] {
  if (line.length === 0) return [];
  if (unit === 'character') {
    return Array.from(line).map((ch, i) => ({ text: ch, at: i, index: before + i }));
  }

  const runs: CycleRun[] = [];
  // A word plus whatever spacing follows it, so the pieces tile the line
  // exactly. Leading spaces on a wrapped line join the first word.
  const pattern = /\s*\S+\s*/g;
  let match: RegExpExecArray | null;
  let piece = 0;
  while ((match = pattern.exec(line)) !== null) {
    runs.push({ text: match[0], at: match.index, index: before + piece });
    piece += 1;
  }
  return runs.length > 0 ? runs : [{ text: line, at: 0, index: before }];
}

/** How many pieces a whole block is divided into. */
export function cycleTotal(text: string, unit: CycleUnit): number {
  if (unit === 'character') return Array.from(text).length;
  const words = text.match(/\S+/g);
  return words ? words.length : 0;
}

/** How many pieces sit before a given offset in the source. */
export function piecesBefore(text: string, unit: CycleUnit, offset: number): number {
  return cycleTotal(text.slice(0, offset), unit);
}

/** The stops form, for anything that wants a gradient rather than steps. */
export function cycleStops(cycle: ColorCycle): GradientStop[] {
  return cycle.colors.map((color, i) => ({
    offset: cycle.colors.length === 1 ? 0 : i / (cycle.colors.length - 1),
    color,
  }));
}
