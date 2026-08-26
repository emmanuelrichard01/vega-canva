/**
 * The font file behind a family, so its glyph outlines can be read.
 *
 * ## Why the browser cannot just be asked
 *
 * The page has already downloaded and rendered Inter, and there is no web API
 * that will hand back a glyph's outline — `FontFace` exposes the *loading* of a
 * face and nothing about its contents, and a 2D context will draw text but not
 * describe it. The only way to a real letterform is the font binary, so the
 * binary is fetched a second time. The browser cache makes that nearly free:
 * the same URL the stylesheet already pulled comes back from disk.
 *
 * ## Why the CSS is fetched rather than the font URL constructed
 *
 * `fonts.gstatic.com` paths carry a content hash — `.../inter/v20/UcCO3Fwr…woff2`
 * — that nothing outside Google can derive, and it changes whenever the face is
 * revised. The stylesheet at `fonts.googleapis.com/css2` is the published index
 * of those URLs, and asking for one family at one weight returns a handful of
 * `@font-face` blocks split by unicode range. Any of them will do: they are the
 * same outlines, subset differently, and the last block is the Latin one.
 *
 * Both endpoints send `Access-Control-Allow-Origin: *`, which is what makes
 * this possible from the page at all.
 */

/**
 * A parsed font, in the shape this codebase needs from it.
 *
 * Structural rather than `fontkit`'s own type: the library is loaded on demand
 * inside `loadFont` and nothing else in the app should have to know it exists,
 * let alone import it eagerly — it carries a Brotli decompressor, and paying
 * for that on first paint to support a command most sessions never run would be
 * a poor trade.
 */
export interface ParsedFont {
  unitsPerEm: number;
  /**
   * Shape a run of text into positioned glyphs.
   *
   * Real shaping, not a loop over characters: this is where kerning pairs and
   * ligatures are applied, which is the difference between outlines that match
   * what was on the canvas and outlines that are subtly too wide.
   */
  layout(text: string): {
    glyphs: Array<{ path: { commands: Array<{ command: string; args: number[] }> } }>;
    positions: Array<{ xAdvance: number }>;
  };
}

/** Families the app loads from Google Fonts — see `index.html`. */
const GOOGLE_FAMILIES = new Set([
  'Inter', 'DM Sans', 'Outfit', 'Plus Jakarta Sans', 'Space Grotesk', 'Roboto',
  'Lora', 'Playfair Display', 'JetBrains Mono', 'Caveat', 'Architects Daughter',
]);

/**
 * Raised when a face cannot be outlined, with a sentence fit to show someone.
 *
 * The failures here are all things a person can act on — a system font, a
 * dropped connection — so they are reported rather than swallowed into a
 * command that silently does nothing.
 */
export class FontUnavailableError extends Error {}

/** One entry per family/weight/style, because the parse is the expensive part. */
const cache = new Map<string, Promise<ParsedFont>>();

/** `fontkit` itself, imported once and only when something needs an outline. */
let fontkitPromise: Promise<typeof import('fontkit')> | null = null;

const keyFor = (family: string, weight: number, italic: boolean) =>
  `${family}|${weight}|${italic ? 'i' : 'n'}`;

/**
 * The stylesheet URL for one face.
 *
 * `text=` is deliberately *not* used. Asking Google to subset the file to the
 * characters in hand would make it smaller, but it would also be a different
 * URL for every string anybody ever converts — a cache miss every time, and a
 * request that leaks the document's contents to a third party.
 */
function cssUrl(family: string, weight: number, italic: boolean): string {
  const axis = italic ? `ital,wght@1,${weight}` : `wght@${weight}`;
  return `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:${axis}&display=swap`;
}

/**
 * Load and parse the file behind a family, weight and slant.
 *
 * @throws {FontUnavailableError} when the family is not one the app serves, or
 *   the network refuses.
 */
export function loadFont(family: string, weight = 400, italic = false): Promise<ParsedFont> {
  const key = keyFor(family, weight, italic);
  const existing = cache.get(key);
  if (existing) return existing;

  const pending = (async () => {
    if (!GOOGLE_FAMILIES.has(family)) {
      throw new FontUnavailableError(
        `${family} is installed on this machine rather than served with the board, so its outlines are not available to read. Set the text in one of the board's own fonts first.`
      );
    }

    let css: string;
    try {
      const response = await fetch(cssUrl(family, weight, italic));
      if (!response.ok) throw new Error(String(response.status));
      css = await response.text();
    } catch {
      throw new FontUnavailableError(
        `Could not reach the font service to read ${family}'s outlines. Check the connection and try again.`
      );
    }

    // The last block is the Latin subset; earlier ones are Cyrillic, Greek and
    // Vietnamese. Any of them holds the same outlines, but Latin is the one
    // that will have the glyphs.
    const urls = [...css.matchAll(/url\((https:[^)]+)\)/g)].map((m) => m[1]);
    const url = urls[urls.length - 1];
    if (!url) {
      throw new FontUnavailableError(`The font service returned no file for ${family}.`);
    }

    const [bytes, fontkit] = await Promise.all([
      fetch(url).then((r) => r.arrayBuffer()),
      (fontkitPromise ??= import('fontkit')),
    ]);

    // `create` returns a collection for a `.ttc`, which Google does not serve —
    // but the type admits it, and a collection has no `layout`.
    const font = fontkit.create(new Uint8Array(bytes) as never) as unknown as ParsedFont;
    if (typeof font?.layout !== 'function') {
      throw new FontUnavailableError(`${family} arrived in a form that cannot be read.`);
    }
    return font;
  })();

  // A failed load is not cached: the next attempt should be allowed to succeed
  // once the network comes back.
  pending.catch(() => cache.delete(key));
  cache.set(key, pending);
  return pending;
}
