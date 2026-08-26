import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mountedSet, renderScope } from './renderScope';

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

describe('mountedSet', () => {
  const all = ['a', 'b', 'c', 'd'];

  it('renders everything while the culler has not reported', () => {
    // Null means "no restriction", which is Canvas's existing behaviour on the
    // first frame. Showing too much costs a frame; showing too little costs an
    // export.
    expect(mountedSet(all, [], [], null)).toBeNull();
  });

  it('keeps the culled set when nothing is exporting', () => {
    expect([...(mountedSet(all, ['a'], [], null) ?? [])]).toEqual(['a']);
  });

  it('keeps a selected object mounted even off screen', () => {
    // Canvas already did this. Stated here so the two cannot drift.
    expect(mountedSet(all, ['a'], ['d'], null)?.has('d')).toBe(true);
  });

  it('mounts what an export needs, however far off screen it is', () => {
    /**
     * The bug: a board wider than the window exported an image of the right
     * dimensions containing only what was on screen -- and disagreeing with
     * the SVG of the same board, which is built from the document.
     */
    const set = mountedSet(all, ['a'], [], new Set(['c', 'd']));
    expect([...(set ?? [])].sort()).toEqual(['a', 'c', 'd']);
  });

  it('does not invent ids the board does not have', () => {
    const set = mountedSet(all, ['a'], [], new Set(['ghost']));
    expect(set?.has('ghost')).toBe(false);
  });
});
