import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import {
  MAX_FONT_BYTES,
  FontFileError,
  canonicalFontFile,
  cleanFamilyName,
  describeFace,
  formatFromName,
  inspectFontFile,
  sniffFontFormat,
  styleFromName,
} from './fontFile';

const bytes = (...xs: number[]) => new Uint8Array([...xs, 0, 0, 0, 0]);
const ascii = (s: string) => bytes(...[...s].map((c) => c.charCodeAt(0)));

function fileOf(data: Uint8Array, name: string) {
  return {
    name,
    size: data.length,
    arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
  };
}

describe('sniffFontFormat', () => {
  it('reads the signature, not the extension', () => {
    expect(sniffFontFormat(ascii('wOF2'))).toBe('woff2');
    expect(sniffFontFormat(ascii('wOFF'))).toBe('woff');
    expect(sniffFontFormat(ascii('OTTO'))).toBe('otf');
    expect(sniffFontFormat(ascii('true'))).toBe('ttf');
    expect(sniffFontFormat(bytes(0x00, 0x01, 0x00, 0x00))).toBe('ttf');
    expect(sniffFontFormat(ascii('ttcf'))).toBe('collection');
    expect(sniffFontFormat(ascii('%PDF'))).toBeNull();
    expect(sniffFontFormat(new Uint8Array([1, 2]))).toBeNull();
  });

  it('maps extensions', () => {
    expect(formatFromName('Brand-Bold.WOFF2')).toBe('woff2');
    expect(formatFromName('brand.ttc')).toBeNull();
  });
});

describe('names', () => {
  it('cannot break out of a quoted CSS string', () => {
    expect(cleanFamilyName(`Evil'; } body { x: "y\\`)).toBe('Evil body x: y');
    expect(cleanFamilyName('  Brand   Sans  ')).toBe('Brand Sans');
    expect(cleanFamilyName('x'.repeat(200))).toHaveLength(64);
  });

  it('reads weight and slant from style names', () => {
    expect(styleFromName('Regular')).toEqual({ weight: 400, italic: false });
    expect(styleFromName('Semibold Italic')).toEqual({ weight: 600, italic: true });
    expect(styleFromName('ExtraBold')).toEqual({ weight: 800, italic: false });
    expect(styleFromName('Bold')).toEqual({ weight: 700, italic: false });
    expect(styleFromName('Light Oblique')).toEqual({ weight: 300, italic: true });
    expect(styleFromName('Black')).toEqual({ weight: 900, italic: false });
  });
});

describe('describeFace', () => {
  it('prefers the typographic family and the OS/2 weight', () => {
    const info = describeFace(
      {
        familyName: 'Brand Sans Semibold',
        subfamilyName: 'Regular',
        getName: (k) => (k === 'preferredFamily' ? 'Brand Sans' : k === 'preferredSubfamily' ? 'Semibold' : null),
        'OS/2': { usWeightClass: 600, fsSelection: { italic: false } },
        postscriptName: 'BrandSans-Semibold',
      },
      'woff2',
      1234,
      'whatever.woff2'
    );
    expect(info).toMatchObject({ family: 'Brand Sans', style: 'Semibold', weight: 600, italic: false, format: 'woff2', sizeBytes: 1234 });
  });

  it('records a variable weight axis', () => {
    const info = describeFace(
      { familyName: 'Var', variationAxes: { wght: { min: 100, max: 900, default: 400 } } },
      'ttf',
      10,
      'var.ttf'
    );
    expect(info.weightMin).toBe(100);
    expect(info.weightMax).toBe(900);
  });

  it('falls back to the file name for a nameless face', () => {
    expect(describeFace({}, 'otf', 1, 'acme_display-bold.otf').family).toBe('acme display bold');
  });
});

describe('inspectFontFile', () => {
  it('reads a real font', async () => {
    const require = createRequire(import.meta.url);
    const path = require.resolve('@fontsource/caveat/files/caveat-latin-400-normal.woff2');
    const data = new Uint8Array(readFileSync(path));
    const info = await inspectFontFile(fileOf(data, 'caveat.woff2'));
    expect(info.family).toBe('Caveat');
    expect(info.format).toBe('woff2');
    expect(info.weight).toBe(400);
    expect(info.italic).toBe(false);
    // The first fontkit import is slow when the machine is busy.
  }, 30_000);

  it('refuses what is not a single font, with a sentence', async () => {
    await expect(inspectFontFile(fileOf(ascii('%PDF'), 'doc.ttf'))).rejects.toThrow(/not a font file/);
    await expect(inspectFontFile(fileOf(ascii('ttcf'), 'set.ttc'))).rejects.toThrow(/collection/);
    await expect(inspectFontFile({ name: 'big.woff2', size: MAX_FONT_BYTES + 1, arrayBuffer: async () => new ArrayBuffer(0) })).rejects.toBeInstanceOf(FontFileError);
    await expect(inspectFontFile(fileOf(new Uint8Array(0), 'empty.ttf'))).rejects.toThrow(/empty/);
  });

  it('names the uploaded file after what it really is', () => {
    const file = canonicalFontFile(new Blob(['x']), {
      family: 'Brand Sans',
      style: 'Bold Italic',
      weight: 700,
      italic: true,
      format: 'woff2',
      postscriptName: 'x',
      sizeBytes: 1,
    });
    expect(file.name).toBe('BrandSans-BoldItalic.woff2');
    expect(file.type).toBe('font/woff2');
  });
});
