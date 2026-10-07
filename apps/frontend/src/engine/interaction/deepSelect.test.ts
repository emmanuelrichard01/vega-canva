import { describe, it, expect } from 'vitest';
import { isDeepSelect } from './deepSelect';

describe('isDeepSelect', () => {
  it('is Control off a Mac and Command on one', () => {
    expect(isDeepSelect({ ctrlKey: true }, false)).toBe(true);
    expect(isDeepSelect({ metaKey: true }, false)).toBe(false);
    expect(isDeepSelect({ metaKey: true }, true)).toBe(true);
  });

  it('leaves Control free on a Mac, where it is a right-click', () => {
    expect(isDeepSelect({ ctrlKey: true }, true)).toBe(false);
    expect(isDeepSelect(null, true)).toBe(false);
  });
});
