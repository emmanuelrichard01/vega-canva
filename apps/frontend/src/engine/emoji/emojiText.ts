/**
 * Emoji checks with no dependencies, so the document read boundary can use
 * them without pulling in anything that knows about URLs or the build.
 */

/**
 * Whether a string is plausibly one emoji rather than arbitrary text.
 *
 * Used at the read boundary (a frame icon, a stamp) so a hostile or corrupt
 * value can never become a file path or a wall of text. Extended pictographic
 * plus the modifiers and joiners emoji sequences are built from, bounded in
 * length — the longest real sequence (a family with tones) is well under 16
 * code points.
 */
export function isEmojiLike(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 32) return false;
  const points = [...value];
  if (points.length > 16) return false;
  let pictographic = false;
  for (const ch of points) {
    if (/\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(ch)) {
      pictographic = true;
      continue;
    }
    // Joiner, variation selectors, skin-tone modifiers, keycap, tag characters.
    if (/^(?:\u200d|\ufe0e|\ufe0f|\u20e3|[\u{1f3fb}-\u{1f3ff}]|[\u{e0020}-\u{e007f}]|[0-9#*])$/u.test(ch)) continue;
    return false;
  }
  return pictographic;
}
