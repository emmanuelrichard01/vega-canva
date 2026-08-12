/**
 * Showing a case the author did not type.
 *
 * The transform is applied at render time and never to the stored string. That
 * is the whole design: a control that rewrote the text would be destructive —
 * switching to upper case and back returns `HELLO`, not `Hello` — and the
 * editor would show something other than what was written, so the next edit
 * would bake the transform in permanently.
 *
 * The DOM overlay gets the same effect from CSS `text-transform`, which works
 * on a `<textarea>`, so the words look identical while you are typing them and
 * when you stop. Keeping those two in step is the reason the mapping lives
 * here rather than inline in each renderer.
 */

import type { TextCase } from './schema';

/** CSS's name for each case, for the DOM overlay and for SVG. */
export const CSS_TEXT_TRANSFORM: Record<TextCase, string> = {
  none: 'none',
  upper: 'uppercase',
  lower: 'lowercase',
  title: 'capitalize',
};

/**
 * Title case, as CSS's `capitalize` defines it.
 *
 * Deliberately CSS's rule — capitalise the first letter of every word, leave
 * the rest alone — and not English title case, which lowercases articles and
 * prepositions. Two reasons: the DOM editor gets `text-transform: capitalize`
 * from the browser and the canvas has to match it exactly, and a rule with a
 * word list is a rule that is wrong in every language that is not English.
 *
 * `\p{L}` rather than `\w`, so the first letter of a word is found in scripts
 * that have letters outside ASCII.
 */
function titleCase(text: string): string {
  return text.replace(/(^|[\s\-—/([{"'])(\p{L})/gu, (_, boundary: string, letter: string) => boundary + letter.toLocaleUpperCase());
}

/** The string as it should be drawn. Returns the input unchanged for `none`. */
export function applyTextCase(text: string, textCase: TextCase | undefined): string {
  switch (textCase) {
    case 'upper':
      return text.toLocaleUpperCase();
    case 'lower':
      return text.toLocaleLowerCase();
    case 'title':
      return titleCase(text);
    default:
      return text;
  }
}
