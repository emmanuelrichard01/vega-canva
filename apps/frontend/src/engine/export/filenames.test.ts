import { describe, expect, it } from 'vitest';
import { exportFilename, slugify } from './filenames';

/**
 * The name on the file that leaves the app.
 *
 * All edge cases, which is why it is worth asserting: the empty name, the name
 * that is only punctuation, the name in a script with no ASCII in it, and the
 * handful of words Windows still reserves.
 */

describe('slugify', () => {
  it('lowercases and joins words with dashes', () => {
    expect(slugify('Checkout Flow')).toBe('checkout-flow');
    expect(slugify('  Spaced   Out  ')).toBe('spaced-out');
  });

  it('collapses runs of separators into one dash', () => {
    expect(slugify('a   b___c')).toBe('a-b-c');
  });

  it('removes the characters a path parser reserves', () => {
    expect(slugify('reports/2026: Q1 "final"')).toBe('reports2026-q1-final');
    expect(slugify('a\\b|c?d*e<f>g')).toBe('abcdefg');
  });

  /**
   * The bug this rewrite exists for.
   *
   * The old rule was `[^a-z0-9]+ → '-'`, which deletes entire writing systems:
   * a board named in Japanese or Cyrillic contains no ASCII alphanumerics, so
   * every character became a dash, the dashes were stripped, and the result
   * fell through to the fallback. **Every non-Latin board exported as
   * `untitled.png`** — a fact its owner could only discover in the downloads
   * folder.
   */
  it('keeps a name written in another script', () => {
    expect(slugify('設計レビュー')).toBe('設計レビュー');
    expect(slugify('Проект Альфа')).toBe('проект-альфа');
    expect(slugify('مخطط')).toBe('مخطط');
  });

  it('keeps accented Latin rather than flattening it away', () => {
    expect(slugify('Café Plan')).toBe('café-plan');
  });

  it('falls back only when there is genuinely nothing left', () => {
    expect(slugify('')).toBe('untitled');
    expect(slugify('   ')).toBe('untitled');
    expect(slugify('///')).toBe('untitled');
  });

  it('never returns a name that starts or ends with a dash', () => {
    for (const input of ['-lead', 'trail-', ' - both - ', '///a///']) {
      const out = slugify(input);
      expect(out.startsWith('-'), input).toBe(false);
      expect(out.endsWith('-'), input).toBe(false);
    }
  });

  /**
   * Truncation happens before the dashes are stripped, so a cut that lands on
   * a separator cannot leave `quarterly-planning-workshop-.png` behind.
   */
  it('never leaves a trailing dash after truncating a long name', () => {
    const long = `${'a'.repeat(59)} bcdefg`;
    const out = slugify(long);
    expect(out.length).toBeLessThanOrEqual(60);
    expect(out.endsWith('-')).toBe(false);
  });

  it('caps the length so the extension always fits', () => {
    expect(slugify('word-'.repeat(40)).length).toBeLessThanOrEqual(60);
  });

  it('hides neither a dotfile nor a name Windows would truncate', () => {
    expect(slugify('.hidden').startsWith('.')).toBe(false);
    expect(slugify('trailing.').endsWith('.')).toBe(false);
  });

  /**
   * `CON`, `PRN`, `NUL` and friends cannot be filenames on Windows whatever
   * the extension — the OS refuses the write, so the download simply fails.
   */
  it('sidesteps the device names Windows reserves', () => {
    expect(slugify('CON')).toBe('con-board');
    expect(slugify('nul')).toBe('nul-board');
    expect(slugify('COM1')).toBe('com1-board');
    // Only reserved as the whole stem — a longer name containing one is fine.
    expect(slugify('control panel')).toBe('control-panel');
  });
});

describe('exportFilename', () => {
  it('appends the format extension', () => {
    expect(exportFilename('My Board', 'png')).toBe('my-board.png');
    expect(exportFilename('My Board', 'svg')).toBe('my-board.svg');
    expect(exportFilename('My Board', 'json')).toBe('my-board.json');
  });

  it('uses jpg rather than jpeg, which is what people expect to see', () => {
    expect(exportFilename('shot', 'jpeg')).toBe('shot.jpg');
  });

  it('marks the density only when it is not 1x', () => {
    expect(exportFilename('board', 'png', 1)).toBe('board.png');
    expect(exportFilename('board', 'png', 2)).toBe('board@2x.png');
    expect(exportFilename('board', 'png', 4)).toBe('board@4x.png');
  });

  it('never claims a density for a format that has none', () => {
    // An SVG is resolution-independent; `@2x` on one would be a lie.
    expect(exportFilename('board', 'svg', 3)).toBe('board.svg');
    expect(exportFilename('board', 'json', 3)).toBe('board.json');
  });

  it('marks density on PDF, whose page carries a real bitmap', () => {
    expect(exportFilename('board', 'pdf', 2)).toBe('board@2x.pdf');
  });

  it('produces a usable name from an unusable one', () => {
    expect(exportFilename('', 'png', 2)).toBe('untitled@2x.png');
  });
});
