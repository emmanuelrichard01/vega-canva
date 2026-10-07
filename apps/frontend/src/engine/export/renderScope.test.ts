import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScope } from './renderScope';

describe('renderScope', () => {
  beforeEach(() => {
    // Each test starts with nothing required, whatever the previous one held.
    let guard = 20;
    while (renderScope.getSnapshot() && guard-- > 0) renderScope.require([])();
  });

  it('is null until something asks', () => {
    expect(renderScope.getSnapshot()).toBeNull();
  });

  it('holds the ids for as long as the holder does', () => {
    const release = renderScope.require(['a', 'b']);
    expect([...(renderScope.getSnapshot() ?? [])].sort()).toEqual(['a', 'b']);
    release();
    expect(renderScope.getSnapshot()).toBeNull();
  });

  it('wakes subscribers on both edges', () => {
    const seen = vi.fn();
    const stop = renderScope.subscribe(seen);
    const release = renderScope.require(['a']);
    expect(seen).toHaveBeenCalledTimes(1);
    release();
    expect(seen).toHaveBeenCalledTimes(2);
    stop();
  });

  it('survives two overlapping exports', () => {
    /**
     * The dialog renders a preview on a debounce while the user may also press
     * Export. Last-writer-wins would let the first to finish un-mount the board
     * out from under the second, which is exactly the bug being fixed.
     */
    const preview = renderScope.require(['a']);
    const download = renderScope.require(['b']);
    preview();
    expect(renderScope.getSnapshot()?.has('b')).toBe(true);
    download();
    expect(renderScope.getSnapshot()).toBeNull();
  });

  it('ignores a release called twice', () => {
    const first = renderScope.require(['a']);
    const second = renderScope.require(['b']);
    first();
    first();
    expect(renderScope.getSnapshot()).not.toBeNull();
    second();
  });
});
