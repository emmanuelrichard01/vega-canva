import { describe, expect, it } from 'vitest';
import { getRecentShapes, recordRecentShape, subscribeRecentShapes } from './recentShapes';

describe('recent shapes', () => {
  it('keeps the newest first, without repeats, and tells subscribers', () => {
    let calls = 0;
    const off = subscribeRecentShapes(() => calls++);
    recordRecentShape('rect');
    recordRecentShape('diamond');
    recordRecentShape('rect');
    expect(getRecentShapes().slice(0, 2)).toEqual(['rect', 'diamond']);
    expect(calls).toBe(3);
    // The same shape twice in a row is not news.
    recordRecentShape('rect');
    expect(calls).toBe(3);
    off();
  });

  it('holds eight at most', () => {
    for (let i = 0; i < 12; i++) recordRecentShape(`shape-${i}`);
    expect(getRecentShapes()).toHaveLength(8);
    expect(getRecentShapes()[0]).toBe('shape-11');
  });
});

describe('pinned shapes', () => {
  it('toggles a pin, keeps one of each, and tells subscribers', async () => {
    const { getPinnedShapes, subscribePinnedShapes, togglePinnedShape } = await import('./recentShapes');
    let calls = 0;
    const off = subscribePinnedShapes(() => calls++);
    expect(togglePinnedShape('cloud')).toBe(true);
    expect(togglePinnedShape('gear')).toBe(true);
    expect(getPinnedShapes()).toEqual(['cloud', 'gear']);
    expect(togglePinnedShape('cloud')).toBe(false);
    expect(getPinnedShapes()).toEqual(['gear']);
    expect(calls).toBe(3);
    off();
  });
});
