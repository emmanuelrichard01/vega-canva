import { describe, expect, it } from 'vitest';
import { fitScale, MAX_CANVAS_AREA, MAX_CANVAS_EDGE } from './rasterLimits';

/**
 * The cap that decides whether an export is an image or an empty file.
 *
 * Exceeding a browser's canvas limit does not throw — it hands back a blank
 * bitmap that encodes and downloads perfectly happily. So the only defence is
 * arithmetic done before the allocation, and the only way to know the
 * arithmetic is right is to assert it.
 */

describe('fitScale', () => {
  it('honours the requested scale when there is room', () => {
    expect(fitScale(800, 600, 2)).toBe(2);
    expect(fitScale(100, 100, 4)).toBe(4);
  });

  it('never exceeds the edge cap', () => {
    // 5000 × 4 would be 20,000px on one side.
    const scale = fitScale(5000, 100, 4);
    expect(5000 * scale).toBeLessThanOrEqual(MAX_CANVAS_EDGE);
  });

  /**
   * The case the code did not previously handle, despite its own comment
   * claiming it did. 4096 × 4096 at 2× is 8192 on each edge — inside the edge
   * cap — and 67 megapixels, four times the area ceiling Safari enforces. It
   * passed, and produced a blank file.
   */
  it('never exceeds the area cap even when both edges fit', () => {
    const w = 4096;
    const h = 4096;
    const scale = fitScale(w, h, 2);
    expect(w * scale).toBeLessThanOrEqual(MAX_CANVAS_EDGE);
    expect(w * scale * h * scale).toBeLessThanOrEqual(MAX_CANVAS_AREA + 1);
    // And it genuinely had to reduce it, or this test proves nothing.
    expect(scale).toBeLessThan(2);
  });

  it('reduces a wide, short board by area rather than by edge', () => {
    // 8000 × 2000 is inside the edge cap at 1× and 16 megapixels exactly.
    const scale = fitScale(8000, 2000, 2);
    expect(8000 * scale * 2000 * scale).toBeLessThanOrEqual(MAX_CANVAS_AREA + 1);
  });

  /**
   * A board already past the ceiling at its own size must still export at 1:1.
   * Shrinking it below full size trades a blank image for an illegible one,
   * and the user asked for a file, not a thumbnail.
   */
  it('does not shrink below 1x, however large the board', () => {
    expect(fitScale(20000, 20000, 4)).toBe(1);
    expect(fitScale(100000, 100000, 1)).toBe(1);
  });

  it('still honours a deliberate request below 1x', () => {
    // The floor is the cap declining to shrink, not a minimum on the caller.
    expect(fitScale(200, 200, 0.5)).toBe(0.5);
  });

  it('survives a degenerate box without dividing by zero', () => {
    expect(Number.isFinite(fitScale(0, 0, 2))).toBe(true);
    expect(fitScale(0, 0, 2)).toBeGreaterThan(0);
  });

  it('is monotonic — asking for more never yields less', () => {
    const box = { w: 3000, h: 2000 };
    let last = 0;
    for (const requested of [1, 2, 3, 4]) {
      const got = fitScale(box.w, box.h, requested);
      expect(got).toBeGreaterThanOrEqual(last - 1e-9);
      last = got;
    }
  });
});
