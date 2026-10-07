import { describe, it, expect } from 'vitest';
import { frameClipCorners } from './frameClip';

describe('frameClipCorners', () => {
  const frame = { x: 0, y: 0, width: 200, height: 100, rotation: 0 };

  it('clips an object whose centre is inside the frame', () => {
    expect(frameClipCorners(frame, { x: 50, y: 50 })).toEqual([
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 100 },
      { x: 0, y: 100 },
    ]);
  });

  it('does not clip an object a stale frameId points at from outside', () => {
    expect(frameClipCorners(frame, { x: 500, y: 50 })).toBeNull();
  });

  it('follows the frame where it is now, rotation included', () => {
    // Turned 90° about (100, 50): the frame now spans x 50..150, y -50..150.
    const turned = { ...frame, rotation: 90 };
    expect(frameClipCorners(turned, { x: 100, y: 140 })).not.toBeNull();
    expect(frameClipCorners(turned, { x: 180, y: 50 })).toBeNull();
    const corners = frameClipCorners(turned, { x: 100, y: 50 })!;
    expect(corners[0].x).toBeCloseTo(150);
    expect(corners[0].y).toBeCloseTo(-50);
  });
});
