/**
 * `:smile` autocomplete, as pure text arithmetic.
 *
 * A query is a colon followed by at least two shortcode characters, ending at
 * the caret, where the colon starts a word. "Starts a word" is what keeps a
 * time (`10:30`), a URL (`https://`) and a ratio (`a:b`) from opening a menu.
 */

export interface ShortcodeQuery {
  /** Index of the colon. */
  start: number;
  /** The caret. */
  end: number;
  /** What follows the colon, lowercased. */
  query: string;
}

const CHAR = /[a-z0-9_+-]/i;
export const SHORTCODE_MIN = 2;
const SHORTCODE_MAX = 32;

export function shortcodeAt(text: string, caret: number): ShortcodeQuery | null {
  if (caret < 0 || caret > text.length) return null;
  let i = caret - 1;
  while (i >= 0 && caret - i <= SHORTCODE_MAX + 1 && CHAR.test(text[i])) i--;
  if (i < 0 || text[i] !== ':') return null;
  const query = text.slice(i + 1, caret);
  if (query.length < SHORTCODE_MIN || query.length > SHORTCODE_MAX) return null;
  const before = i > 0 ? text[i - 1] : '';
  if (before && !/[\s([{"'“‘]/.test(before)) return null;
  // A query that is already closed (`:smile:`) has been typed out in full.
  if (text[caret] === ':') return null;
  return { start: i, end: caret, query: query.toLowerCase() };
}

/** Replace the query with the emoji, and where the caret goes after it. */
export function applyShortcode(text: string, q: ShortcodeQuery, native: string): { text: string; caret: number } {
  const next = text.slice(0, q.start) + native + text.slice(q.end);
  return { text: next, caret: q.start + native.length };
}
