import { describe, expect, it } from 'vitest';
import { HUG_PADDING, MIN_FRAME_SIZE, hugBox, presentationOrder } from './frames';

const f = (id: string, x: number, y: number, width = 100, height = 100) => ({ id, x, y, width, height });

describe('hugBox', () => {
  it('contains every box with padding on all sides', () => {
    const box = hugBox([
      { x: 10, y: 20, width: 50, height: 30 },
      { x: 100, y: 0, width: 20, height: 20 },
    ]);
    expect(box).toEqual({
      x: 10 - HUG_PADDING,
      y: -HUG_PADDING,
      width: 110 + 2 * HUG_PADDING,
      height: 50 + 2 * HUG_PADDING,
    });
  });

  it('is null with nothing to fit, and never smaller than a frame may be', () => {
    expect(hugBox([])).toBeNull();
    expect(hugBox([{ x: 0, y: 0, width: 1, height: 1 }], 0)).toEqual({
      x: 0,
      y: 0,
      width: MIN_FRAME_SIZE,
      height: MIN_FRAME_SIZE,
    });
  });
});

describe('presentationOrder', () => {
  it('walks rows top to bottom, each left to right', () => {
    const frames = [f('c', 0, 300), f('b', 300, 10), f('a', 0, 0), f('d', 300, 290)];
    expect(presentationOrder(frames).map((x) => x.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('keeps a ragged row together', () => {
    const frames = [f('two', 200, 40), f('one', 0, 0, 100, 120), f('three', 400, 0)];
    expect(presentationOrder(frames).map((x) => x.id)).toEqual(['one', 'two', 'three']);
  });

  it('is the same whatever order the frames arrive in', () => {
    const frames = [f('a', 0, 0), f('b', 150, 0), f('c', 0, 150), f('d', 150, 150)];
    const reversed = presentationOrder([...frames].reverse()).map((x) => x.id);
    expect(reversed).toEqual(presentationOrder(frames).map((x) => x.id));
  });
});
