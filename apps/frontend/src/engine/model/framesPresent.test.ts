import { describe, expect, it } from 'vitest';
import { HUG_PADDING, MIN_FRAME_SIZE, hugBox, presentableFrames, presentationOrder, slidePose } from './frames';
import { nodeBounds } from './selection';
import type { AnyNode } from './schema';

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

describe('presentableFrames', () => {
  it('keeps visible top-level frames only', () => {
    const nodes = [
      { type: 'frame', id: 'a' },
      { type: 'frame', id: 'nested', frameId: 'a' },
      { type: 'frame', id: 'hidden', hidden: true },
      { type: 'sticky', id: 's' },
    ];
    expect(presentableFrames(nodes).map((n) => n.id)).toEqual(['a']);
  });
});

describe('slidePose', () => {
  it('centres the box in the stage with padding all round', () => {
    const pose = slidePose({ x: 100, y: 50, width: 400, height: 200 }, { width: 1000, height: 600 }, 50);
    expect(pose.zoom).toBe(2.25);
    expect(100 * pose.zoom + pose.x + (400 * pose.zoom) / 2).toBeCloseTo(500);
    expect(50 * pose.zoom + pose.y + (200 * pose.zoom) / 2).toBeCloseTo(300);
  });

  it('fits a rotated frame by its rotated bounds', () => {
    const frame = { id: 'f', type: 'frame', x: 0, y: 0, width: 200, height: 100, rotation: 90, scaleX: 1, scaleY: 1 } as unknown as AnyNode;
    const box = nodeBounds(frame);
    expect(box.width).toBeCloseTo(100);
    expect(box.height).toBeCloseTo(200);
    const pose = slidePose(box, { width: 500, height: 500 }, 50);
    // The tall side decides: 400 / 200.
    expect(pose.zoom).toBeCloseTo(2);
  });
});
