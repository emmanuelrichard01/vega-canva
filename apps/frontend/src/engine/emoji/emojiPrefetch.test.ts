import { describe, expect, it } from 'vitest';
import { FIRST_SCREEN, firstScreenCodes } from './emojiPrefetch';

describe('firstScreenCodes', () => {
  it('puts recents first, as codes, then the first category, without repeats', () => {
    expect(firstScreenCodes(['👍🏽', '❤️'], ['1f600', '2764', '1f601'])).toEqual(['1f44d-1f3fd', '2764', '1f600', '1f601']);
  });

  it('stops at the first screen', () => {
    const many = Array.from({ length: 200 }, (_, i) => (0x1f300 + i).toString(16));
    expect(firstScreenCodes([], many)).toHaveLength(FIRST_SCREEN);
    expect(firstScreenCodes([], many, 3)).toEqual(many.slice(0, 3));
  });
});
