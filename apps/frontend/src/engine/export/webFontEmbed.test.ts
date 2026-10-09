import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  bundledFacesFor,
  codepointsInMarkup,
  embedWebFonts,
  facesInMarkup,
  googleCssUrl,
  parseFontFaces,
  rangeCovers,
} from './webFontEmbed';

/**
 * The app's own typefaces inside an exported SVG: which faces the markup uses,
 * which files carry them, and that the bytes go in.
 */

/** Where Vite's `?url` for a package file points, as a path on disk. */
function onDisk(url: string): string | null {
  const clean = decodeURIComponent(url.split('?')[0]);
  const candidates = [
    clean.replace(/^\/@fs\//, ''),
    clean.replace(/^\/@fs/, ''),
    join(__dirname, '..', '..', '..', clean),
    join(__dirname, '..', '..', '..', '..', '..', clean),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

const INTER_TEXT = `<text font-family="&#39;Inter&#39;, &#39;Inter Variable&#39;, sans-serif" font-weight="600">Ship it</text>`;

describe('reading the markup', () => {
  it('finds each family, weight and style the file sets text in', () => {
    const markup =
      INTER_TEXT +
      `<text font-family="Caveat, cursive" font-weight="700" font-style="italic">Hi</text>` +
      `<text font-family="Inter, system-ui, sans-serif" font-size="11">x</text>`;
    expect(facesInMarkup(markup)).toEqual([
      { family: 'Inter', weight: 600, italic: false },
      { family: 'Caveat', weight: 700, italic: true },
      { family: 'Inter', weight: 400, italic: false },
    ]);
  });

  it('collects the characters drawn, entities decoded', () => {
    const points = codepointsInMarkup('<text>A&amp;Б</text><tspan>é</tspan><rect />');
    expect([...points].map((c) => String.fromCodePoint(c)).sort()).toEqual(['&', 'A', 'é', 'Б'].sort());
  });

  it('reads unicode ranges, including wildcards', () => {
    const latin = new Set([0x41]);
    const cyrillic = new Set([0x0411]);
    expect(rangeCovers('U+0000-00FF, U+0131', latin)).toBe(true);
    expect(rangeCovers('U+0000-00FF, U+0131', cyrillic)).toBe(false);
    expect(rangeCovers('U+04??', cyrillic)).toBe(true);
    expect(rangeCovers(undefined, cyrillic)).toBe(true);
  });
});

describe('bundled faces', () => {
  it('resolves Inter to its variable woff2 by the URL Vite gives it, one file per style', () => {
    const faces = bundledFacesFor([
      { family: 'Inter', weight: 600, italic: false },
      { family: 'Inter', weight: 400, italic: false },
    ]).get('Inter')!;
    expect(faces).toHaveLength(1);
    expect(faces[0].url).toMatch(/inter-latin-wght-normal\.woff2/);
    expect(faces[0].weight).toBe('100 900');
  });

  it('snaps a static family to the nearest weight it has', () => {
    const faces = bundledFacesFor([{ family: 'Caveat', weight: 800, italic: false }]).get('Caveat')!;
    expect(faces.map((f) => f.weight)).toEqual(['700']);
  });

  it('inlines the real Inter file as base64 in an @font-face rule', async () => {
    const result = await embedWebFonts(INTER_TEXT, {
      fetchBytes: async (url) => {
        const path = onDisk(url);
        if (!path) throw new Error(`not on disk: ${url}`);
        const bytes = readFileSync(path);
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      },
    });
    expect(result.embedded).toEqual(['Inter']);
    expect(result.missing).toEqual([]);
    expect(result.css).toMatch(/^@font-face\{font-family:'Inter';src:url\(data:font\/woff2;base64,/);
    // A woff2 file begins `wOF2`, which is `d09GMg` in base64.
    expect(result.css).toContain('base64,d09GMg');
    expect(result.css).toContain('font-weight:100 900');
    expect(result.bytes).toBeGreaterThan(20_000);
  });

  it('names a face it cannot read rather than failing the export', async () => {
    const result = await embedWebFonts(INTER_TEXT, { fetchBytes: async () => Promise.reject(new Error('offline')) });
    expect(result.css).toBe('');
    expect(result.missing).toEqual(['Inter']);
  });
});

describe('Google faces', () => {
  const css = `
/* cyrillic */
@font-face { font-family: 'Lora'; font-style: normal; font-weight: 400; src: url(https://fonts.gstatic.com/s/lora/cyr.woff2) format('woff2'); unicode-range: U+0400-045F; }
/* latin */
@font-face { font-family: 'Lora'; font-style: normal; font-weight: 400; src: url(https://fonts.gstatic.com/s/lora/latin.woff2) format('woff2'); unicode-range: U+0000-00FF, U+2014; }`;

  it('asks for exactly the weights and styles in use', () => {
    expect(googleCssUrl('Lora', [{ family: 'Lora', weight: 700, italic: true }, { family: 'Lora', weight: 400, italic: false }])).toBe(
      'https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;1,700&display=swap'
    );
    expect(googleCssUrl('Inter', [{ family: 'Inter', weight: 400, italic: false }])).toBeNull();
  });

  it('keeps only the blocks that cover the characters drawn', async () => {
    expect(parseFontFaces(css)).toHaveLength(2);
    const fetched: string[] = [];
    const result = await embedWebFonts(`<text font-family="&#39;Lora&#39;, serif">Plain Latin</text>`, {
      fetchText: async () => css,
      fetchBytes: async (url) => {
        fetched.push(url);
        return new Uint8Array([0x77, 0x4f, 0x46, 0x32]).buffer;
      },
    });
    expect(fetched).toEqual(['https://fonts.gstatic.com/s/lora/latin.woff2']);
    expect(result.css).toContain('unicode-range:U+0000-00FF, U+2014');
    expect(result.embedded).toEqual(['Lora']);
  });
});
