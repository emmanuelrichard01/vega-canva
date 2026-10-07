import { EMOJI_VERSION } from './emojiVersion';

/**
 * Emoji identity: the native glyph a person typed or picked, and the code the
 * artwork is filed under.
 *
 * The document always stores the **native glyph** (`👍🏽`), never a file name.
 * It is what a text field, a clipboard and an older client all understand, and
 * it survives a change of artwork set. The code is derived from it on the way
 * to the screen, by the same rule the build script names its files with
 * (`scripts/emoji/sanitizeSvg.mjs` → `codeFromSequence`): lowercase hex code
 * points joined by `-`, with every variation selector U+FE0F removed, because
 * the same emoji arrives with and without it depending on the keyboard.
 */

const VS16 = 0xfe0f;

/** `👍🏽` → `1f44d-1f3fd`; `❤️` → `2764`. Empty for an empty string. */
export function codeOf(native: string): string {
  const parts: string[] = [];
  for (const ch of native) {
    const cp = ch.codePointAt(0);
    if (cp === undefined || cp === VS16) continue;
    parts.push(cp.toString(16));
  }
  return parts.join('-');
}

/** The inverse of `codeOf`, without the variation selectors it dropped. */
export function nativeOf(code: string): string {
  if (!/^[0-9a-f]{1,6}(?:-[0-9a-f]{1,6})*$/.test(code)) return '';
  try {
    return String.fromCodePoint(...code.split('-').map((h) => parseInt(h, 16)));
  } catch {
    return '';
  }
}

function base(): string {
  const b = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
  return b.endsWith('/') ? b : `${b}/`;
}

/**
 * Where an emoji's artwork lives. Versioned by the build's content hash, so a
 * rebuilt set is never served from a stale cache and an unchanged one always is.
 */
export function emojiUrl(code: string): string {
  return `${base()}emoji/${code}.svg?v=${EMOJI_VERSION}`;
}

/** The lazily fetched catalogue: names, keywords, categories, skin tones. */
export function emojiIndexUrl(): string {
  return `${base()}emoji/index.json?v=${EMOJI_VERSION}`;
}

export { isEmojiLike } from './emojiText';
