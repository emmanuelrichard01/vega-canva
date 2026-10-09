import { beforeEach, describe, expect, it } from 'vitest';
import { resetRotateCursorCache, rotateCursorCacheSize, rotateCursorCss } from './rotateCursor';
import { CORNER_SIGNS, inCornerRing, intoFrame, quantiseAngle, radialAngle, ringRadii } from '../interaction/rotateHandle';
import { claimCursor, cursorOverride } from './cursorOverride';

describe('rotate cursor', () => {
  beforeEach(resetRotateCursorCache);
  it('quantises to 5 degrees and memoises at most 72 variants', () => {
    for (let d = 0; d < 720; d += 0.7) rotateCursorCss(d);
    expect(rotateCursorCacheSize()).toBeLessThanOrEqual(72);
    expect(rotateCursorCss(12.4)).toBe(rotateCursorCss(10));
    expect(quantiseAngle(-2)).toBe(0);
    expect(quantiseAngle(358)).toBe(0);
  });
  it('radial angle is clockwise from east', () => {
    expect(radialAngle({ x: 0, y: 0 }, { x: 0, y: -5 })).toBe(270);
  });
  it('ring excludes the handle and the far field, shrinks for small objects', () => {
    const c = { x: 0, y: 0 };
    const tl = CORNER_SIGNS[0];
    expect(inCornerRing(c, tl, { x: -2, y: -2 }, 1, 200)).toBe(false);
    expect(inCornerRing(c, tl, { x: -10, y: -10 }, 1, 200)).toBe(true);
    expect(inCornerRing(c, tl, { x: -30, y: -30 }, 1, 200)).toBe(false);
    expect(inCornerRing(c, tl, { x: 10, y: 10 }, 1, 200)).toBe(false);
    expect(ringRadii(10).outer).toBeLessThan(ringRadii(200).outer);
  });
  it('maps rotated points into the frame', () => {
    expect(Math.round(intoFrame({ x: 0, y: 0 }, { x: 0, y: 10 }, 90).x)).toBe(10);
  });
  it('releases a claim', () => {
    claimCursor('rotate', 'grab');
    claimCursor('rotate', null);
    expect(cursorOverride.get()).toBeNull();
  });
});
