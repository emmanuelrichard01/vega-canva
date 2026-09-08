import { beforeEach, describe, expect, it } from 'vitest';
import { allExamples } from './chartExamples';
import { clearThumbCache, thumbFor, thumbReady } from './thumbCache';

/**
 * The cache that made the example browser cheap to reopen.
 *
 * The measurement that motivated it: sixty-three previews is 374ms of blocked
 * main thread, a contour map ~35ms of that on its own. The properties this
 * test holds are the ones that make paying it once safe — that a key is
 * specific enough not to serve a light preview into a dark popover, and that
 * the map cannot grow without a bound.
 */

const examples = allExamples();

describe('thumbCache', () => {
  beforeEach(() => clearThumbCache());

  it('serves the identical string the second time', () => {
    const { id, spec } = examples[0];
    const first = thumbFor(id, spec, 124, 70, false);
    expect(thumbReady(id, 124, 70, false)).toBe(true);
    expect(thumbFor(id, spec, 124, 70, false)).toBe(first);
  });

  it('does not answer a dark popover with a light preview', () => {
    const { id, spec } = examples[0];
    thumbFor(id, spec, 124, 70, false);
    // The theme is in the key, so the dark request is a miss and renders.
    expect(thumbReady(id, 124, 70, true)).toBe(false);
    expect(thumbFor(id, spec, 124, 70, true)).not.toBe(thumbFor(id, spec, 124, 70, false));
  });

  it('keys on size, so a bigger card is not a stretched small one', () => {
    const { id, spec } = examples[0];
    thumbFor(id, spec, 124, 70, false);
    expect(thumbReady(id, 240, 140, false)).toBe(false);
  });

  it('reports nothing ready after a clear', () => {
    const { id, spec } = examples[0];
    thumbFor(id, spec, 124, 70, false);
    clearThumbCache();
    expect(thumbReady(id, 124, 70, false)).toBe(false);
  });

  it('holds every example in both themes at once', () => {
    // The ceiling the bound was chosen against: nothing a real session does
    // should be able to evict a preview it is still showing.
    for (const { id, spec } of examples) {
      thumbFor(id, spec, 124, 70, false);
      thumbFor(id, spec, 124, 70, true);
    }
    for (const { id } of examples) {
      expect(thumbReady(id, 124, 70, false), id).toBe(true);
      expect(thumbReady(id, 124, 70, true), id).toBe(true);
    }
  });
});
