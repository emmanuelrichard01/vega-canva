import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS, cardFor, estimateBytes, exportLabel, formatBytes, pixelSize, previewFormat, sanitizePrefs } from './exportModel';

describe('export decisions', () => {
  it('files each format under its card', () => {
    expect(cardFor('png').id).toBe('image');
    expect(cardFor('jpeg').id).toBe('image');
    expect(cardFor('webp').id).toBe('image');
    expect(cardFor('svg').id).toBe('svg');
    expect(cardFor('pdf').id).toBe('pdf');
    expect(cardFor('json').id).toBe('json');
  });

  it('keeps remembered settings that are still valid and drops the rest', () => {
    expect(sanitizePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(sanitizePrefs({ format: 'webp', scale: 3, background: 'ink', padding: 0, quality: 0.5, embedLocalFonts: true })).toEqual({
      format: 'webp',
      scale: 3,
      background: 'ink',
      padding: 0,
      quality: 0.5,
      embedLocalFonts: true,
    });
    // 4× was offered once; a format that is not one; a quality off the scale.
    expect(sanitizePrefs({ format: 'gif', scale: 4, padding: 13, quality: 9, embedLocalFonts: 'yes' })).toEqual({
      ...DEFAULT_PREFS,
      quality: 1,
    });
  });

  it('estimates pixel formats by the square of the scale, and does not guess the others', () => {
    expect(estimateBytes('png', 1000, 2)).toBe(4000);
    expect(estimateBytes('svg', 1000, 3)).toBe(1000);
    expect(estimateBytes('pdf', 1000, 2)).toBeNull();
    expect(estimateBytes('json', 1000, 2)).toBeNull();
    expect(estimateBytes('png', null, 2)).toBeNull();
  });

  it('previews a PDF through its PNG capture, and a backup not at all', () => {
    expect(previewFormat('pdf')).toBe('png');
    expect(previewFormat('svg')).toBe('svg');
    expect(previewFormat('json')).toBeNull();
  });

  it('says sizes and actions plainly', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
    expect(pixelSize({ width: 800, height: 600 }, 2)).toBe(`${(1600).toLocaleString()} × ${(1200).toLocaleString()}`);
    expect(exportLabel('png', null)).toBe('Export PNG');
    expect(exportLabel('pdf', { frames: 4 })).toBe('Export 4-page PDF');
    expect(exportLabel('png', { frames: 4 })).toBe('Export 4 PNG files');
  });
});
