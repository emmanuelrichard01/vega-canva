import { describe, expect, it } from 'vitest';
import { fitPose, framesInReadingOrder, stepFrame } from './framesOrder';
import type { AnyNode } from '../../engine/model/schema';

const frame = (id: string, x: number, y: number, w = 100, h = 100): AnyNode =>
  ({ id, type: 'frame', x, y, width: w, height: h }) as unknown as AnyNode;

describe('framesInReadingOrder', () => {
  it('reads rows top to bottom and left to right, tolerating small offsets', () => {
    const order = framesInReadingOrder([
      frame('c', 0, 200),
      frame('b', 150, 10),
      frame('a', 0, 0),
      { id: 'n', type: 'shape', x: 0, y: 0, width: 1, height: 1 } as unknown as AnyNode,
    ]);
    expect(order.map((f) => f.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('stepFrame', () => {
  const order = [frame('a', 0, 0), frame('b', 200, 0), frame('c', 400, 0)];
  it('steps and wraps', () => {
    expect(stepFrame(order, 'a', 1)?.id).toBe('b');
    expect(stepFrame(order, 'c', 1)?.id).toBe('a');
    expect(stepFrame(order, 'a', -1)?.id).toBe('c');
  });
  it('starts at an end when there is no current frame', () => {
    expect(stepFrame(order, null, 1)?.id).toBe('a');
    expect(stepFrame(order, null, -1)?.id).toBe('c');
    expect(stepFrame([], null, 1)).toBeNull();
  });
});

describe('fitPose', () => {
  it('centres the box and fits it with a margin, within the zoom limits', () => {
    const pose = fitPose({ x: 0, y: 0, width: 1000, height: 500 }, { width: 1000, height: 1000 }, { minZoom: 0.05, maxZoom: 5 });
    expect(pose.x).toBe(500);
    expect(pose.y).toBe(250);
    expect(pose.zoom).toBeCloseTo(0.76);
    expect(fitPose({ x: 0, y: 0, width: 1, height: 1 }, { width: 1000, height: 1000 }, { minZoom: 0.05, maxZoom: 5 }).zoom).toBe(5);
  });
});
