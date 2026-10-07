/**
 * Reading a font file somebody handed us: what it is, and whether to take it.
 *
 * Every check here runs before a byte is uploaded. The server re-checks the
 * type and size, but only the client can parse the file cheaply enough to
 * name the family and refuse a renamed PDF with a sentence a person can act
 * on.
 */

export const MAX_FONT_BYTES = 10 * 1024 * 1024;

export type FontFormat = 'woff2' | 'woff' | 'ttf' | 'otf';

/** The type each format is uploaded and served as. */
export const FONT_MIME: Record<FontFormat, string> = {
  woff2: 'font/woff2',
  woff: 'font/woff',
  ttf: 'font/ttf',
  otf: 'font/otf',
};

/** The `format()` hint a `@font-face` source takes for each. */
export const CSS_FORMAT: Record<FontFormat, string> = {
  woff2: 'woff2',
  woff: 'woff',
  ttf: 'truetype',
  otf: 'opentype',
};

export const FONT_ACCEPT = '.woff2,.woff,.ttf,.otf,font/woff2,font/woff,font/ttf,font/otf';

export class FontFileError extends Error {}

/**
 * The format a file really is, from its first four bytes.
 *
 * The extension is a claim; the signature is the file. A `.ttf` that is
 * really a WOFF2 is stored and served as WOFF2, because a `format()` hint
 * that disagrees with the bytes makes the browser refuse the face.
 */
export function sniffFontFormat(bytes: Uint8Array): FontFormat | 'collection' | null {
  if (bytes.length < 4) return null;
  const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (tag === 'wOF2') return 'woff2';
  if (tag === 'wOFF') return 'woff';
  if (tag === 'OTTO') return 'otf';
  if (tag === 'ttcf') return 'collection';
  if (tag === 'true') return 'ttf';
  if (bytes[0] === 0x00 && bytes[1] === 0x01 && bytes[2] === 0x00 && bytes[3] === 0x00) return 'ttf';
  return null;
}

export function formatFromName(name: string): FontFormat | null {
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  return ext === 'woff2' || ext === 'woff' || ext === 'ttf' || ext === 'otf' ? ext : null;
}

/**
 * A family name safe to put in CSS and in the document.
 *
 * Quotes, backslashes and control characters are removed rather than escaped:
 * the name is quoted in a dozen places, and a name that cannot break out of
 * quotes needs no escaping in any of them.
 */
export function cleanFamilyName(raw: string | null | undefined): string {
  return [...String(raw ?? '')]
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code >= 0x20 && code !== 0x7f;
    })
    .join('')
    .replace(/['"\\;{}<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64);
}

/**
 * Weight and slant from a style name, for when the OS/2 table is missing or
 * the source is a local font that only reports "Semibold Italic".
 */
export function styleFromName(style: string): { weight: number; italic: boolean } {
  const s = style.toLowerCase().replace(/[\s_-]+/g, '');
  const italic = /italic|oblique|slanted/.test(s);
  const table: Array<[RegExp, number]> = [
    [/hairline|thin/, 100],
    [/extralight|ultralight/, 200],
    [/light/, 300],
    [/medium/, 500],
    [/semibold|demibold/, 600],
    [/extrabold|ultrabold/, 800],
    [/black|heavy/, 900],
    [/bold/, 700],
  ];
  const hit = table.find(([re]) => re.test(s));
  return { weight: hit ? hit[1] : 400, italic };
}

export interface FontFileInfo {
  family: string;
  /** The face's own style name, e.g. "Semibold Italic". */
  style: string;
  weight: number;
  italic: boolean;
  /** Present for a variable face with a weight axis. */
  weightMin?: number;
  weightMax?: number;
  format: FontFormat;
  postscriptName: string;
  sizeBytes: number;
}

/** The parts of fontkit's `Font` this module reads. */
interface ParsedFace {
  familyName?: string;
  subfamilyName?: string;
  postscriptName?: string;
  italicAngle?: number;
  variationAxes?: Partial<Record<string, { min: number; max: number; default: number }>>;
  getName?: (key: string, lang?: string) => string | null;
  'OS/2'?: { usWeightClass?: number; fsSelection?: { italic?: boolean } };
  numGlyphs?: number;
}

/** The facts about a parsed face, separated from parsing so tests can feed a stub. */
export function describeFace(face: ParsedFace, format: FontFormat, sizeBytes: number, fileName: string): FontFileInfo {
  const named = (key: string) => {
    try {
      return face.getName?.(key, 'en') ?? null;
    } catch {
      return null;
    }
  };
  const fallbackFamily = cleanFamilyName(fileName.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '));
  const family = cleanFamilyName(named('preferredFamily') || face.familyName) || fallbackFamily || 'Uploaded font';
  const style = cleanFamilyName(named('preferredSubfamily') || face.subfamilyName) || 'Regular';

  const fromName = styleFromName(style);
  const os2Weight = face['OS/2']?.usWeightClass;
  const weight =
    typeof os2Weight === 'number' && os2Weight >= 1 && os2Weight <= 1000 ? Math.round(os2Weight) : fromName.weight;
  const italic = Boolean(face['OS/2']?.fsSelection?.italic) || (face.italicAngle ?? 0) !== 0 || fromName.italic;

  const axis = face.variationAxes?.wght;
  const variable =
    axis && Number.isFinite(axis.min) && Number.isFinite(axis.max) && axis.max > axis.min
      ? { weightMin: Math.max(1, Math.round(axis.min)), weightMax: Math.min(1000, Math.round(axis.max)) }
      : {};

  return {
    family,
    style,
    weight,
    italic,
    ...variable,
    format,
    postscriptName: cleanFamilyName(face.postscriptName) || family.replace(/\s+/g, ''),
    sizeBytes,
  };
}

let fontkitPromise: Promise<typeof import('fontkit')> | null = null;

/**
 * Check a file and read its family and style.
 *
 * @throws {FontFileError} with a sentence fit to show the person who chose it.
 */
export async function inspectFontFile(file: Pick<File, 'name' | 'size' | 'arrayBuffer'>): Promise<FontFileInfo> {
  if (file.size === 0) throw new FontFileError(`${file.name} is empty.`);
  if (file.size > MAX_FONT_BYTES) {
    throw new FontFileError(`${file.name} is larger than 10 MB, the limit for a font.`);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const sniffed = sniffFontFormat(bytes);
  if (sniffed === 'collection') {
    throw new FontFileError(`${file.name} is a font collection. Export the single face you need as .otf or .ttf and upload that.`);
  }
  if (!sniffed) {
    throw new FontFileError(`${file.name} is not a font file. Use WOFF2, WOFF, TTF or OTF.`);
  }

  let face: ParsedFace;
  try {
    const fontkit = await (fontkitPromise ??= import('fontkit'));
    face = fontkit.create(bytes as never) as unknown as ParsedFace;
  } catch {
    throw new FontFileError(`${file.name} could not be read. It may be damaged.`);
  }
  if (!face || (typeof face.numGlyphs === 'number' && face.numGlyphs < 1)) {
    throw new FontFileError(`${file.name} has no glyphs to draw.`);
  }
  return describeFace(face, sniffed, file.size, file.name);
}

/**
 * The file as it is uploaded: its bytes under a name and type that match
 * what it really is, whatever the operating system called it.
 */
export function canonicalFontFile(file: Blob, info: FontFileInfo): File {
  const base = `${info.family}-${info.style}`.replace(/[^A-Za-z0-9-]+/g, '') || 'font';
  return new File([file], `${base}.${info.format}`, { type: FONT_MIME[info.format] });
}
