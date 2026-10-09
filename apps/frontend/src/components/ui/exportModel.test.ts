import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PREFS, cardFor, estimateBytes, explainError, exportLabel, fontCostLabel, formatBytes, pixelSize, previewFormat, sanitizePrefs,
} from './exportModel';

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
    expect(
      sanitizePrefs({ format: 'webp', scale: 4, background: 'ink', padding: 0, quality: 0.5, embedLocalFonts: true, embedFonts: true, includeComments: true })
    ).toEqual({
      format: 'webp',
      scale: 4,
      background: 'ink',
      padding: 0,
      quality: 0.5,
      embedLocalFonts: true,
      embedFonts: true,
      outlineText: false,
      includeComments: true,
    });
    // A scale never offered; a format that is not one; a quality off the scale; flags that are not booleans.
    expect(sanitizePrefs({ format: 'gif', scale: 5, padding: 13, quality: 9, embedLocalFonts: 'yes', outlineText: 1 })).toEqual({
      ...DEFAULT_PREFS,
      quality: 1,
    });
  });

  it('starts with comments, font embedding and outlining off', () => {
    expect(DEFAULT_PREFS.includeComments).toBe(false);
    expect(DEFAULT_PREFS.embedFonts).toBe(false);
    expect(DEFAULT_PREFS.outlineText).toBe(false);
  });

  it('turns known failures into the fix', () => {
    expect(explainError(new Error('Out of memory'))).toMatch(/smaller scale/);
    expect(explainError(new DOMException('The canvas has been tainted', 'SecurityError'))).toMatch(/re-upload/);
    expect(explainError(new Error('This browser cannot encode image/webp. Try PNG instead.'))).toMatch(/Try PNG/);
    expect(explainError(null)).toMatch(/did not finish/);
    expect(fontCostLabel(50 * 1024)).toBe('Adds about 50 KB to the file.');
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
