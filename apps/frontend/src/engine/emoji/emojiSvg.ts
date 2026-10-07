import { codeOf, emojiUrl } from './emojiCode';

/**
 * Emoji artwork as SVG markup, for exports.
 *
 * An exported SVG has to stand on its own: a link to `/emoji/1f44d.svg` would
 * break the moment the file left this site. So exports inline the artwork.
 * The build script has already sanitised every file and prefixed its ids with
 * its own code, so any number of different emoji can share one document
 * without their gradients colliding, and the same emoji twice is harmless.
 *
 * Exporting is asynchronous anyway, so the exporter awaits `prefetchEmojiSvg`
 * for the glyphs it is about to place and then reads them synchronously.
 */

const markup = new Map<string, string | null>();
const LIMIT = 400;

export async function prefetchEmojiSvg(natives: Iterable<string>, fetcher: typeof fetch = fetch): Promise<void> {
  const codes = [...new Set([...natives].map(codeOf).filter(Boolean))].filter((c) => !markup.has(c));
  await Promise.all(
    codes.map(async (code) => {
      try {
        const res = await fetcher(emojiUrl(code));
        const text = res.ok ? await res.text() : '';
        markup.set(code, text.trimStart().startsWith('<svg') ? text : null);
      } catch {
        markup.set(code, null);
      }
      while (markup.size > LIMIT) markup.delete(markup.keys().next().value as string);
    })
  );
}

/**
 * The emoji as an `<svg>` element placed at `x, y` and `size` square, or null
 * when its artwork is not loaded (the caller then writes the glyph as text).
 */
export function emojiSvgElement(native: string, x: number, y: number, size: number): string | null {
  const svg = markup.get(codeOf(native));
  if (!svg) return null;
  const f = (n: number) => String(Math.round(n * 100) / 100);
  // The root keeps its own viewBox; only its placement and size are replaced.
  return svg.replace(/^<svg\b([^>]*)>/, (_m, attrs: string) => {
    const kept = attrs.replace(/\s(?:x|y|width|height)="[^"]*"/g, '');
    return `<svg${kept} x="${f(x)}" y="${f(y)}" width="${f(size)}" height="${f(size)}">`;
  });
}
