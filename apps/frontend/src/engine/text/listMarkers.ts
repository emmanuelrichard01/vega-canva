/**
 * The mark that sits in front of each paragraph of a list.
 *
 * Kept apart from the layout engine because it is the only part of a list that
 * is a *decision* rather than arithmetic: which glyph, how numbering runs, what
 * happens to a blank line. The layout asks for a string and a width and does
 * not care how either was arrived at.
 */

import type { ListStyle } from '../model/schema';

/** How far the text is pushed right, as a multiple of the font size. */
export const LIST_INDENT_EMS = 1.45;

/** The letters used by an alphabetic list, wrapping to `aa` after `z`. */
function letterFor(index: number): string {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(97 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/**
 * The marker for one paragraph, or `null` when it should not get one.
 *
 * `ordinal` counts only the paragraphs that actually carry a marker, so a
 * blank line between two items does not consume a number — typing an empty
 * line to space a list out is normal, and having it eat "3." is the kind of
 * detail that makes a feature feel unfinished.
 */
export function listMarker(style: ListStyle | undefined, ordinal: number): string | null {
  switch (style) {
    case 'bullet': return '•';
    case 'dash': return '–';
    case 'circle': return '◦';
    case 'number': return `${ordinal + 1}.`;
    case 'letter': return `${letterFor(ordinal)}.`;
    default: return null;
  }
}

/**
 * Whether a paragraph takes a marker at all.
 *
 * An empty paragraph does not. It is a spacer, and putting a lone bullet on a
 * blank line is a bullet pointing at nothing.
 */
export function paragraphTakesMarker(text: string): boolean {
  return text.trim().length > 0;
}
