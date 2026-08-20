import { describe, expect, it } from 'vitest';
import {
  EXPORT_FORMAT_IDS,
  FORMAT_SPECS,
  resolveBackground,
  type ExportFormat,
} from './ExportTypes';

/**
 * The format table, and the rule that keeps a control honest.
 *
 * The dialog derives every control from these flags — a quality slider appears
 * because `lossy` is true, a transparency option is disabled because `alpha` is
 * false. So a wrong flag is not a wrong description, it is a wrong control: the
 * failure this table replaced was `format === 'png'` written out at each
 * setting, where adding a format meant finding all of them.
 */

describe('FORMAT_SPECS', () => {
  it('describes every id in the list, and lists every id it describes', () => {
    // Two records of the same set, which is invariant 7's shape. The dialog
    // iterates the list; the controls read the table.
    expect([...EXPORT_FORMAT_IDS].sort()).toEqual(Object.keys(FORMAT_SPECS).sort());
  });

  it('keys every entry by its own id', () => {
    for (const [key, spec] of Object.entries(FORMAT_SPECS)) {
      expect(spec.id, key).toBe(key);
    }
  });

  it('gives every format a distinct, usable extension and a mime type', () => {
    const extensions = new Set<string>();
    for (const id of EXPORT_FORMAT_IDS) {
      const spec = FORMAT_SPECS[id];
      expect(spec.extension, id).toMatch(/^[a-z0-9]+$/);
      expect(spec.mime, id).toMatch(/^[a-z]+\/[a-z0-9.+-]+$/);
      extensions.add(spec.extension);
    }
    expect(extensions.size).toBe(EXPORT_FORMAT_IDS.length);
  });

  it('gives every format a label and a blurb the dialog can show', () => {
    for (const id of EXPORT_FORMAT_IDS) {
      expect(FORMAT_SPECS[id].label.length, id).toBeGreaterThan(0);
      expect(FORMAT_SPECS[id].blurb.length, id).toBeGreaterThan(10);
    }
  });

  it('never marks a lossless format lossy', () => {
    // A quality slider on PNG is the specific control this flag prevents.
    expect(FORMAT_SPECS.png.lossy).toBe(false);
    expect(FORMAT_SPECS.svg.lossy).toBe(false);
    expect(FORMAT_SPECS.json.lossy).toBe(false);
  });

  it('marks the two formats that genuinely have no alpha channel', () => {
    // JPEG has none at all; the PDF path composites onto an opaque page.
    expect(FORMAT_SPECS.jpeg.alpha).toBe(false);
    expect(FORMAT_SPECS.pdf.alpha).toBe(false);
  });

  it('marks only the pixel formats raster, so scale means something', () => {
    const raster = EXPORT_FORMAT_IDS.filter((id) => FORMAT_SPECS[id].raster);
    expect(raster.sort()).toEqual(['jpeg', 'pdf', 'png', 'webp']);
  });
});

describe('resolveBackground', () => {
  const png = FORMAT_SPECS.png;
  const jpeg = FORMAT_SPECS.jpeg;

  it('leaves an alpha-capable format clear when transparency is asked for', () => {
    expect(resolveBackground('transparent', png)).toBeNull();
    expect(resolveBackground(undefined, png)).toBeNull();
  });

  /**
   * The failure this function exists for: asking a JPEG for transparency does
   * not produce a transparent JPEG, it produces whatever was in the buffer —
   * usually black. Paper is the answer everybody actually wants.
   */
  it('resolves transparency to paper for a format that has no alpha', () => {
    expect(resolveBackground('transparent', jpeg)).toBe('#FFFFFF');
    expect(resolveBackground(undefined, jpeg)).toBe('#FFFFFF');
  });

  it('never returns null for a format without an alpha channel', () => {
    for (const id of EXPORT_FORMAT_IDS as ExportFormat[]) {
      const spec = FORMAT_SPECS[id];
      if (spec.alpha) continue;
      for (const wanted of ['transparent', 'paper', 'ink', '#123456'] as const) {
        expect(resolveBackground(wanted, spec), `${id} / ${wanted}`).not.toBeNull();
      }
    }
  });

  it('maps the two named backgrounds to real colours', () => {
    expect(resolveBackground('paper', png)).toBe('#FFFFFF');
    expect(resolveBackground('ink', png)).toBe('#161616');
  });

  it('passes a literal colour through untouched', () => {
    // The type allows any string so a custom colour needs no new branch.
    expect(resolveBackground('#FF8800', png)).toBe('#FF8800');
    expect(resolveBackground('#FF8800', jpeg)).toBe('#FF8800');
  });
});
