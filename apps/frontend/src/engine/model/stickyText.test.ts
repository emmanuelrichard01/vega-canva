import { describe, expect, it } from 'vitest';
import {
  fitFontSize,
  overflowsAtMinimum,
  STICKY_MAX_FONT,
  STICKY_MIN_FONT,
} from './stickyText';

/**
 * A predictable stand-in for text layout: every character is `size * 0.55`
 * wide, lines are `size * 1.3` tall, and words never break. Enough to exercise
 * the search without pulling a canvas into the test.
 */
function fakeMeasure(text: string, size: number, width: number): number {
  const charWidth = size * 0.55;
  const perLine = Math.max(1, Math.floor(width / charWidth));
  let lines = 1;
  let used = 0;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const need = word.length + (used === 0 ? 0 : 1);
    if (used + need > perLine) {
      lines++;
      used = word.length;
    } else {
      used += need;
    }
  }
  return lines * size * 1.3;
}

const fit = (text: string, width = 168, height = 168) =>
  fitFontSize({ text, width, height, measure: fakeMeasure });

describe('fitFontSize', () => {
  it('gives an empty note the largest size, so the caret is not a speck', () => {
    expect(fit('')).toBe(STICKY_MAX_FONT);
    expect(fit('   ')).toBe(STICKY_MAX_FONT);
  });

  it('sets short text large and long text small', () => {
    const short = fit('Ship it');
    const long = fit(
      'We should revisit the contrast ratios across the dark theme before the ' +
        'beta, because several of the presence colours fail AA against the board.'
    );
    expect(short).toBeGreaterThan(long);
    expect(short).toBeLessThanOrEqual(STICKY_MAX_FONT);
    expect(long).toBeGreaterThanOrEqual(STICKY_MIN_FONT);
  });

  it('never returns a size whose text does not fit', () => {
    // The property that matters: whatever comes back must actually render
    // inside the note. This is what the fixed size got wrong.
    const samples = [
      'a',
      'two words',
      'a slightly longer sentence that wraps once or twice',
      'x'.repeat(300),
      'word '.repeat(60),
    ];
    for (const text of samples) {
      const size = fit(text);
      if (size > STICKY_MIN_FONT) {
        expect(fakeMeasure(text, size, 168)).toBeLessThanOrEqual(168);
      }
    }
  });

  it('returns the largest size that fits, not merely one that does', () => {
    const text = 'a few words here';
    const size = fit(text);
    if (size < STICKY_MAX_FONT) {
      expect(fakeMeasure(text, size + 1, 168)).toBeGreaterThan(168);
    }
  });

  it('bottoms out at the minimum rather than shrinking to nothing', () => {
    // Trading unreadable-because-clipped for unreadable-because-tiny helps
    // nobody; past this point the note is simply too full and should look it.
    expect(fit('word '.repeat(400))).toBe(STICKY_MIN_FONT);
  });

  it('grows back when text is deleted', () => {
    const full = fit('word '.repeat(40));
    const trimmed = fit('word');
    expect(trimmed).toBeGreaterThan(full);
  });

  it('takes a smaller size in a narrower note', () => {
    const text = 'a reasonably long line of text';
    expect(fit(text, 90, 168)).toBeLessThan(fit(text, 260, 168));
  });

  it('survives a degenerate note without dividing by zero', () => {
    expect(fit('anything', 0, 0)).toBe(STICKY_MIN_FONT);
    expect(fit('anything', -10, 50)).toBe(STICKY_MIN_FONT);
  });
});

describe('long words', () => {
  const fakeWordWidth = (word: string, size: number) => word.length * size * 0.55;
  const fitWithWords = (text: string, width = 168, height = 168) =>
    fitFontSize({ text, width, height, measure: fakeMeasure, measureWord: fakeWordWidth });

  it('shrinks so a single long word is not broken across lines', () => {
    // "Onboarding" came out as "Onboar / ding": it fits by *height* at a large
    // size because the renderer hard-breaks it, so height alone is not enough.
    const size = fitWithWords('Onboarding');
    expect(fakeWordWidth('Onboarding', size)).toBeLessThanOrEqual(168);
  });

  it('does not punish a note whose words all fit', () => {
    // The constraint must not shrink text that was never going to break.
    const withWords = fitWithWords('Ship it now');
    const without = fit('Ship it now');
    expect(withWords).toBe(without);
  });

  it('still bottoms out at the minimum for an unbreakably long word', () => {
    expect(fitWithWords('x'.repeat(200))).toBe(STICKY_MIN_FONT);
  });
});

describe('overflowsAtMinimum', () => {
  const over = (text: string) =>
    overflowsAtMinimum({ text, width: 168, height: 168, measure: fakeMeasure });

  it('is false for text that fits at some size', () => {
    expect(over('Ship it')).toBe(false);
  });

  it('is true only once even the smallest size runs past the edge', () => {
    expect(over('word '.repeat(400))).toBe(true);
  });

  it('is false for an empty note', () => {
    expect(over('')).toBe(false);
  });
});
