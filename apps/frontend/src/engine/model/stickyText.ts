/**
 * How big the writing on a sticky note should be.
 *
 * A sticky is a fixed square, so the text has to give. Before this the size
 * was a stored number that never changed, and Konva clipped anything past the
 * bottom edge — so typing past the fold made your own words **silently
 * invisible**, with no scrollbar, no ellipsis and no indication that anything
 * was missing. It is the single most common thing anyone does with a sticky
 * note and it lost data in plain sight.
 *
 * Fitting the type instead is also what makes a sticky *feel* right: three
 * words come out large and confident, a paragraph settles down small, and the
 * note always looks deliberately composed. That is the behaviour in FigJam and
 * Miro, and it is worth copying.
 *
 * The policy is pure and the measuring is injected, because measuring text
 * needs a canvas and the decision does not. Tests drive it with an arithmetic
 * fake; the renderer drives it with Konva, which is the only thing that knows
 * exactly how Konva will wrap.
 */

/**
 * Bounds of the type scale, in world pixels.
 *
 * Set for a handwriting face, which needs more of them than a UI sans does:
 * Caveat's x-height is roughly two thirds of Inter's at the same nominal size,
 * so 44px of Caveat reads about as large as 30px of Inter. The ceiling is
 * raised to match, and the floor lifted because a script face falls apart into
 * a squiggle long before a grotesque does.
 */
export const STICKY_MIN_FONT = 15;
export const STICKY_MAX_FONT = 58;

/**
 * Same on the canvas and in the editor, or text jumps when you stop typing.
 *
 * Looser than a UI face would want. A script has long ascenders and deep
 * descenders that tangle with the line below at the 1.3 a grotesque is happy
 * with.
 */
export const STICKY_LINE_HEIGHT = 1.38;

export interface FitOptions {
  text: string;
  /** Space available for the text, inside the note's padding. */
  width: number;
  height: number;
  /** Height of `text` wrapped to `width` at `size`. */
  measure: (text: string, size: number, width: number) => number;
  /**
   * Width of a single unwrapped word at `size`.
   *
   * Optional, and the difference between "fits" and "looks right". Height
   * alone is not enough: a lone long word at a large size still *fits* by
   * height, because the renderer hard-breaks it across lines — so a note
   * saying "Onboarding" came out as "Onboar / ding". Nothing is clipped and it
   * looks broken, which is the sort of thing only rendering it will tell you.
   */
  measureWord?: (word: string, size: number) => number;
  min?: number;
  max?: number;
}

/** The word most likely to force a break. */
function longestWord(text: string): string {
  let longest = '';
  for (const word of text.split(/\s+/)) if (word.length > longest.length) longest = word;
  return longest;
}

/**
 * The largest size at which `text` fits, never below `min`.
 *
 * Returns `min` when even that overflows: at that point the note is genuinely
 * too full, and shrinking further trades one unreadable state for another. The
 * caller shows the overflow rather than hiding it.
 *
 * Binary search over integers — text height is monotonic in font size, and a
 * linear walk from 44 to 11 is thirty-odd text layouts on every keystroke.
 */
export function fitFontSize({
  text,
  width,
  height,
  measure,
  measureWord,
  min = STICKY_MIN_FONT,
  max = STICKY_MAX_FONT,
}: FitOptions): number {
  if (!text.trim()) return max;
  if (!(width > 0) || !(height > 0)) return min;

  const word = measureWord ? longestWord(text) : '';

  // Both conditions are monotonic in size, so their conjunction is too and a
  // binary search is still valid.
  const fits = (size: number) => {
    if (measure(text, size, width) > height) return false;
    if (measureWord && word && measureWord(word, size) > width) return false;
    return true;
  };

  let lo = min;
  let hi = Math.max(min, Math.round(max));
  let best = min;

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (fits(mid)) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return best;
}

/**
 * Does the text still overflow at the smallest size?
 *
 * Kept separate from `fitFontSize` so the renderer can say so — a note that is
 * genuinely overfull should look overfull, not silently truncated.
 */
export function overflowsAtMinimum(options: FitOptions): boolean {
  const { text, width, height, measure, min = STICKY_MIN_FONT } = options;
  if (!text.trim()) return false;
  if (!(width > 0) || !(height > 0)) return false;
  return measure(text, min, width) > height;
}
