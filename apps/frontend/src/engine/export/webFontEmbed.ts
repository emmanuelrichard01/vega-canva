import interNormal from '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url';
import interItalic from '@fontsource-variable/inter/files/inter-latin-wght-italic.woff2?url';
import robotoNormal from '@fontsource-variable/roboto/files/roboto-latin-wght-normal.woff2?url';
import robotoItalic from '@fontsource-variable/roboto/files/roboto-latin-wght-italic.woff2?url';
import outfitNormal from '@fontsource-variable/outfit/files/outfit-latin-wght-normal.woff2?url';
import groteskNormal from '@fontsource-variable/space-grotesk/files/space-grotesk-latin-wght-normal.woff2?url';
import caveat400 from '@fontsource/caveat/files/caveat-latin-400-normal.woff2?url';
import caveat500 from '@fontsource/caveat/files/caveat-latin-500-normal.woff2?url';
import caveat600 from '@fontsource/caveat/files/caveat-latin-600-normal.woff2?url';
import caveat700 from '@fontsource/caveat/files/caveat-latin-700-normal.woff2?url';
import architects400 from '@fontsource/architects-daughter/files/architects-daughter-latin-400-normal.woff2?url';
import { fontEntry } from '../text/fontCatalogue';

/**
 * The app's own typefaces, written into an exported SVG.
 *
 * An SVG names its fonts; it does not carry them. A board set in Inter or
 * Caveat opens on a machine without them in whatever that machine substitutes,
 * which for a hand-lettered face is a different drawing. So, when asked, the
 * faces the file actually uses are inlined as `@font-face` rules with base64
 * bytes:
 *
 * - **bundled** faces (`@fontsource`) by the URL Vite gave the woff2 at build
 *   time. The browser already holds those bytes, so the fetch is a cache hit;
 * - **Google** faces by the stylesheet Google publishes for exactly the
 *   weights and styles in use, keeping only the unicode-range blocks that
 *   cover characters in the file, so a Latin board does not carry Cyrillic.
 *
 * Which faces are "in use" is read off the finished markup rather than the
 * document, because labels, tables, charts and code name fonts the nodes never
 * mention (connector labels are Inter whatever the board says).
 *
 * Uploaded and device faces are `text/fontEmbed`'s job and are not repeated.
 */

interface Face {
  url: string;
  /** A single weight, or a variable range such as `100 900`. */
  weight: string;
  italic: boolean;
  unicodeRange?: string;
}

/** Every bundled face, by family. Variable families carry one file per style. */
const BUNDLED: Record<string, Face[]> = {
  Inter: [
    { url: interNormal, weight: '100 900', italic: false },
    { url: interItalic, weight: '100 900', italic: true },
  ],
  Roboto: [
    { url: robotoNormal, weight: '100 900', italic: false },
    { url: robotoItalic, weight: '100 900', italic: true },
  ],
  Outfit: [{ url: outfitNormal, weight: '100 900', italic: false }],
  'Space Grotesk': [{ url: groteskNormal, weight: '300 700', italic: false }],
  Caveat: [
    { url: caveat400, weight: '400', italic: false },
    { url: caveat500, weight: '500', italic: false },
    { url: caveat600, weight: '600', italic: false },
    { url: caveat700, weight: '700', italic: false },
  ],
  'Architects Daughter': [{ url: architects400, weight: '400', italic: false }],
};

/** The `… Variable` aliases `@fontsource` registers resolve to the plain family. */
const ALIASES: Record<string, string> = {
  'Inter Variable': 'Inter',
  'Roboto Variable': 'Roboto',
  'Outfit Variable': 'Outfit',
  'Space Grotesk Variable': 'Space Grotesk',
};

/** One face a file asks for. */
export interface FaceUse {
  family: string;
  weight: number;
  italic: boolean;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** The first family in a CSS font stack, unquoted and with aliases folded. */
export function primaryFamily(stack: string): string {
  const first = decodeEntities(stack).split(',')[0]?.trim().replace(/^['"]|['"]$/g, '') ?? '';
  return ALIASES[first] ?? first;
}

/**
 * Every (family, weight, style) the markup sets text in. Read from the
 * attributes on each element that names a family; an element inherits
 * nothing here, which matches how every writer in this app emits text.
 */
export function facesInMarkup(markup: string): FaceUse[] {
  const seen = new Map<string, FaceUse>();
  for (const tag of markup.matchAll(/<[a-zA-Z][^>]*\sfont-family="([^"]*)"[^>]*>/g)) {
    const family = primaryFamily(tag[1]);
    if (!family || /^(sans-serif|serif|monospace|cursive|system-ui)$/i.test(family)) continue;
    const weightAttr = /\sfont-weight="([^"]*)"/.exec(tag[0])?.[1];
    const weight = weightAttr === 'bold' ? 700 : Number(weightAttr) || 400;
    const italic = /\sfont-style="italic"/.test(tag[0]);
    const key = `${family}|${weight}|${italic}`;
    if (!seen.has(key)) seen.set(key, { family, weight, italic });
  }
  return [...seen.values()];
}

/** Every character drawn as text in the markup. */
export function codepointsInMarkup(markup: string): Set<number> {
  const out = new Set<number>();
  for (const m of markup.matchAll(/<(text|tspan)\b[^>]*>([^<]*)/g)) {
    for (const ch of decodeEntities(m[2])) out.add(ch.codePointAt(0)!);
  }
  return out;
}

/** Whether a CSS `unicode-range` covers any of these characters. No range covers everything. */
export function rangeCovers(range: string | undefined, codepoints: ReadonlySet<number>): boolean {
  if (!range) return true;
  const spans = range.split(',').map((part) => {
    const [lo, hi] = part.trim().replace(/^U\+/i, '').split('-');
    if (lo.includes('?')) return [parseInt(lo.replace(/\?/g, '0'), 16), parseInt(lo.replace(/\?/g, 'F'), 16)];
    return [parseInt(lo, 16), parseInt(hi ?? lo, 16)];
  });
  for (const cp of codepoints) for (const [a, b] of spans) if (cp >= a && cp <= b) return true;
  return false;
}

/** The weight a static face actually has nearest to the one asked for. */
function snap(weight: number, weights: readonly number[]): number {
  if (!weights.length) return weight;
  return weights.reduce((best, w) => (Math.abs(w - weight) < Math.abs(best - weight) ? w : best), weights[0]);
}

/** Which bundled faces cover these uses: one per style for variable files, the nearest static weight otherwise. */
export function bundledFacesFor(uses: readonly FaceUse[]): Map<string, Face[]> {
  const out = new Map<string, Face[]>();
  for (const use of uses) {
    const faces = BUNDLED[use.family];
    if (!faces) continue;
    const styled = faces.filter((f) => f.italic === use.italic);
    const pool = styled.length ? styled : faces;
    const statics = pool.filter((f) => !f.weight.includes(' '));
    const pick = statics.length
      ? statics.find((f) => Number(f.weight) === snap(use.weight, statics.map((s) => Number(s.weight))))
      : pool[0];
    if (!pick) continue;
    const list = out.get(use.family) ?? [];
    if (!list.includes(pick)) list.push(pick);
    out.set(use.family, list);
  }
  return out;
}

/** The css2 URL for exactly these weights and styles of a Google family. */
export function googleCssUrl(family: string, uses: readonly FaceUse[]): string | null {
  const entry = fontEntry(family);
  if (!entry || entry.source !== 'google') return null;
  const tuples = new Set<string>();
  for (const use of uses) {
    const italic = use.italic && entry.italic ? 1 : 0;
    tuples.add(`${italic},${snap(use.weight, entry.weights)}`);
  }
  const sorted = [...tuples].sort((a, b) => {
    const [ai, aw] = a.split(',').map(Number);
    const [bi, bw] = b.split(',').map(Number);
    return ai - bi || aw - bw;
  });
  return `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:ital,wght@${sorted.join(';')}&display=swap`;
}

/** The `@font-face` blocks of a Google stylesheet. */
export function parseFontFaces(css: string): Face[] {
  const faces: Face[] = [];
  for (const block of css.matchAll(/@font-face\s*{([^}]*)}/g)) {
    const body = block[1];
    const url = /src:\s*url\(([^)]+)\)/.exec(body)?.[1]?.replace(/^['"]|['"]$/g, '');
    if (!url) continue;
    faces.push({
      url,
      weight: /font-weight:\s*([^;]+);/.exec(body)?.[1]?.trim() ?? '400',
      italic: /font-style:\s*italic/.test(body),
      unicodeRange: /unicode-range:\s*([^;]+);?/.exec(body)?.[1]?.trim(),
    });
  }
  return faces;
}

function toBase64(bytes: Uint8Array): string {
  let out = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(out);
}

function faceRule(family: string, face: Face, bytes: Uint8Array): string {
  const name = family.replace(/['"\\;{}<>]/g, '');
  return (
    `@font-face{font-family:'${name}';` +
    `src:url(data:font/woff2;base64,${toBase64(bytes)}) format('woff2');` +
    `font-weight:${face.weight};font-style:${face.italic ? 'italic' : 'normal'};` +
    (face.unicodeRange ? `unicode-range:${face.unicodeRange.replace(/[;{}<>]/g, '')};` : '') +
    `}`
  );
}

export interface WebFontEmbed {
  /** `@font-face` rules to put in the file's style block. */
  css: string;
  /** What the rules add to the file, in bytes. */
  bytes: number;
  /** Families written into the file. */
  embedded: string[];
  /** Families the file names that could not be read (offline, a system face). */
  missing: string[];
}

export interface WebFontOptions {
  fetchBytes?: (url: string) => Promise<ArrayBuffer>;
  fetchText?: (url: string) => Promise<string>;
  /** Families handled elsewhere (uploaded and device faces), skipped here. */
  skip?: (family: string) => boolean;
}

const fetchOk = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(String(r.status));
    return r;
  });

/**
 * `@font-face` rules for every bundled or Google face the markup sets text
 * in, with the bytes inline. A face that cannot be read is listed in
 * `missing` and the file names it, as it would have without embedding.
 */
export async function embedWebFonts(markup: string, options: WebFontOptions = {}): Promise<WebFontEmbed> {
  const fetchBytes = options.fetchBytes ?? ((url: string) => fetchOk(url).then((r) => r.arrayBuffer()));
  const fetchText = options.fetchText ?? ((url: string) => fetchOk(url).then((r) => r.text()));
  const uses = facesInMarkup(markup).filter((u) => !options.skip?.(u.family));
  const codepoints = codepointsInMarkup(markup);
  const byFamily = new Map<string, FaceUse[]>();
  for (const use of uses) byFamily.set(use.family, [...(byFamily.get(use.family) ?? []), use]);

  const rules: string[] = [];
  const embedded: string[] = [];
  const missing: string[] = [];
  const bundled = bundledFacesFor(uses);

  for (const [family, familyUses] of byFamily) {
    let faces: Face[] | null = bundled.get(family) ?? null;
    if (!faces) {
      const url = googleCssUrl(family, familyUses);
      if (!url) {
        if (!fontEntry(family) || fontEntry(family)?.source === 'system') continue;
        missing.push(family);
        continue;
      }
      try {
        faces = parseFontFaces(await fetchText(url)).filter((f) => rangeCovers(f.unicodeRange, codepoints));
      } catch {
        missing.push(family);
        continue;
      }
    }
    let wrote = false;
    for (const face of faces) {
      try {
        rules.push(faceRule(family, face, new Uint8Array(await fetchBytes(face.url))));
        wrote = true;
      } catch {
        // An unreadable file leaves that face named only.
      }
    }
    (wrote ? embedded : missing).push(family);
  }

  const css = rules.join('\n');
  return { css, bytes: new TextEncoder().encode(css).length, embedded, missing };
}
