import { fontEntry } from './fontCatalogue';
import { CSS_FORMAT, sniffFontFormat, type FontFormat } from './fontFile';
import { dynamicFamily, ensureDynamicFamily } from './fontLibrary';
import { localFontBlob } from './localFonts';

/**
 * Fonts in exported files.
 *
 * An exported SVG set in an uploaded face is only right on a machine that has
 * that face, which the recipient of a shared file never does. So uploaded
 * faces are written into the file as `@font-face` rules with the bytes
 * inline. Faces from this device are embedded only when the person ticks the
 * option, because embedding a font they installed is their decision, not
 * ours. Built-in faces are referenced by name, as before.
 */

/** Every font family a set of nodes names, wherever in the node it is named. */
export function familiesInNodes(nodes: readonly unknown[]): string[] {
  const found = new Set<string>();
  const walk = (value: unknown, depth: number) => {
    if (!value || typeof value !== 'object' || depth > 6) return;
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 500)) walk(item, depth + 1);
      return;
    }
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'fontFamily' && typeof v === 'string' && v) found.add(v);
      else if (v && typeof v === 'object') walk(v, depth + 1);
    }
  };
  for (const node of nodes) walk(node, 0);
  return [...found].sort();
}

/** Whether any of these families is installed-on-this-device only. */
export function usesLocalFonts(families: readonly string[]): boolean {
  return families.some((f) => fontEntry(f)?.source === 'local');
}

function toBase64(bytes: Uint8Array): string {
  let out = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(out);
}

const MIME: Record<FontFormat, string> = { woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf' };

function rule(family: string, bytes: Uint8Array, format: FontFormat, weight: string, italic: boolean): string {
  const name = family.replace(/['"\\;{}<>]/g, '');
  return (
    `@font-face{font-family:'${name}';` +
    `src:url(data:${MIME[format]};base64,${toBase64(bytes)}) format('${CSS_FORMAT[format]}');` +
    `font-weight:${weight};font-style:${italic ? 'italic' : 'normal'};}`
  );
}

export interface EmbedOptions {
  /** Embed faces installed on this device. Off unless the person chose it. */
  embedLocal?: boolean;
  /** Overridable for tests. */
  fetchBytes?: (url: string) => Promise<ArrayBuffer>;
  localBlob?: (family: string, weight: number, italic: boolean) => Promise<Blob | null>;
}

const defaultFetch = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(String(r.status));
    return r.arrayBuffer();
  });

/**
 * `@font-face` rules for the uploaded (and, if chosen, local) faces among
 * these families. A face that cannot be read is left out; the file then
 * names it and falls back, which is what it did before.
 */
export async function fontFaceCss(families: readonly string[], options: EmbedOptions = {}): Promise<string> {
  const fetchBytes = options.fetchBytes ?? defaultFetch;
  const getLocal = options.localBlob ?? localFontBlob;
  const rules: string[] = [];
  for (const family of families) {
    const fam = dynamicFamily(family);
    if (!fam) continue;
    if (fam.source === 'local' && !options.embedLocal) continue;
    for (const face of fam.faces) {
      const weight =
        face.weightMin !== undefined && face.weightMax !== undefined ? `${face.weightMin} ${face.weightMax}` : String(face.weight);
      try {
        let bytes: Uint8Array;
        let format: FontFormat;
        if (face.source.kind === 'url') {
          bytes = new Uint8Array(await fetchBytes(face.source.url));
          format = face.source.format;
        } else {
          const blob = await getLocal(family, face.weight, face.italic);
          if (!blob) continue;
          bytes = new Uint8Array(await blob.arrayBuffer());
          const sniffed = sniffFontFormat(bytes);
          if (!sniffed || sniffed === 'collection') continue;
          format = sniffed;
        }
        rules.push(rule(family, bytes, format, weight, face.italic));
      } catch {
        // Unreadable face: the export names it and falls back.
      }
    }
  }
  return rules.join('\n');
}

/**
 * Load the runtime faces a capture needs before pixels are read, so a PNG or
 * PDF is not drawn in the fallback. Bounded: a face that never arrives costs
 * at most `timeoutMs`, and the export goes ahead in the fallback.
 */
export async function ensureFamiliesLoaded(families: readonly string[], timeoutMs = 3000): Promise<void> {
  const pending = families.filter((f) => dynamicFamily(f)).map((f) => ensureDynamicFamily(f));
  if (!pending.length) return;
  await Promise.race([Promise.all(pending), new Promise((r) => setTimeout(r, timeoutMs))]);
}
