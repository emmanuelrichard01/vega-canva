import { beforeEach, describe, expect, it, vi } from 'vitest';

/** A fresh module each time, because the store reads storage once at load. */
async function load() {
  vi.resetModules();
  return import('./learnState');
}

/** A working store: the default environment has a bare object with no `getItem`. */
function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  };
}

describe('learnState', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage());
  });

  it('retires a coach mark once its gesture has been performed', async () => {
    const { learnState } = await load();
    expect(learnState.isRetired('grid-content')).toBe(false);
    learnState.learn('grid-content');
    expect(learnState.isRetired('grid-content')).toBe(true);
  });

  it('stops showing a coach mark after it has appeared twice without being used', async () => {
    const { learnState, MAX_SHOWS } = await load();
    expect(MAX_SHOWS).toBe(2);
    learnState.noteShown('pen-snap');
    expect(learnState.isRetired('pen-snap')).toBe(false);
    learnState.noteShown('pen-snap');
    expect(learnState.isRetired('pen-snap')).toBe(true);
    // Shown and learned stay different facts: the library still says it is new.
    expect(learnState.isLearned('pen-snap')).toBe(false);
  });

  it('dismisses one lesson for good without touching the others or muting them all', async () => {
    const { learnState } = await load();
    learnState.dismiss('eraser-lasso');
    expect(learnState.isRetired('eraser-lasso')).toBe(true);
    expect(learnState.isRetired('pen-snap')).toBe(false);
    expect(learnState.getSnapshot().muted).toBe(false);
    expect(learnState.isLearned('eraser-lasso')).toBe(false);
  });

  it('remembers across a reload', async () => {
    const first = await load();
    first.learnState.dismiss('shape-library');
    first.learnState.noteShown('chart-data');
    const second = await load();
    expect(second.learnState.isRetired('shape-library')).toBe(true);
    expect(second.learnState.getSnapshot().shown['chart-data']).toBe(1);
  });

  it('ignores ids that are not lessons, so a removed lesson leaves no ghost', async () => {
    localStorage.setItem('vega_lessons_dismissed_v1', JSON.stringify(['gone-lesson', 'pen-snap']));
    localStorage.setItem('vega_lessons_shown_v1', JSON.stringify({ 'gone-lesson': 5, 'pen-snap': 1 }));
    const { learnState } = await load();
    expect(learnState.getSnapshot().dismissed).toEqual(['pen-snap']);
    expect(Object.keys(learnState.getSnapshot().shown)).toEqual(['pen-snap']);
    learnState.dismiss('not-a-lesson');
    expect(learnState.getSnapshot().dismissed).toEqual(['pen-snap']);
  });

  it('survives unreadable storage', async () => {
    localStorage.setItem('vega_lessons_shown_v1', '{broken');
    const { learnState } = await load();
    expect(learnState.isRetired('pen-snap')).toBe(false);
  });
});
