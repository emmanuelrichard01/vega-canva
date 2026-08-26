import { describe, expect, it } from 'vitest';
import { CLIPBOARD_TARGET_EDGE, clipboardScale, MAX_CANVAS_AREA } from './rasterLimits';

describe('clipboardScale', () => {
  it('copies a small object at high density instead of as a thumbnail', () => {
    /**
     * The bug: a fixed 2× put a 180-unit sticky note on the clipboard as a
     * 360px image, which goes soft the moment it is dragged out in a document.
     */
    const scale = clipboardScale(180, 180);
    expect(scale).toBe(4);
    expect(180 * scale).toBeGreaterThan(700);
  });

  it('copies a large board at a density it can actually reach', () => {
    // 2× on this asked for 8000px and was silently clamped. Asking for what
    // the target implies means nothing is silently reduced.
    const scale = clipboardScale(4000, 3000);
    expect(scale).toBeLessThan(1.01);
    expect(4000 * scale).toBeLessThanOrEqual(4000);
  });

  it('lands the long edge on the target for anything smaller than it', () => {
    for (const w of [400, 800, 1200, 1600]) {
      expect(w * clipboardScale(w, w / 2)).toBeCloseTo(CLIPBOARD_TARGET_EDGE, 6);
    }
  });

  it('stops at 1:1 rather than shrinking something already past the target', () => {
    /**
     * The band's floor, stated as behaviour: an object wider than the target
     * is copied at its own size, not reduced to hit a number. Downscaling to
     * land on 1600 would make copying a large frame *lose* detail, which is
     * the opposite of what a copy is for.
     */
    expect(clipboardScale(2400, 1200)).toBe(1);
  });

  it('measures the long edge, not the area', () => {
    // A wide, short banner and a tall, narrow one are the same problem turned
    // ninety degrees, and must come back at the same density.
    expect(clipboardScale(1600, 80)).toBeCloseTo(clipboardScale(80, 1600), 10);
  });

  it('never asks for a density the browser will refuse', () => {
    // 1400 x 1400 wants 1.14x. The area cap allows about 2.9x, so the target
    // governs; the point is that the answer went through `fitScale` at all.
    const scale = clipboardScale(1400, 1400);
    expect((1400 * scale) ** 2).toBeLessThanOrEqual(MAX_CANVAS_AREA);
  });

  it("defers to fitScale's floor on a board already past the ceiling", () => {
    /**
     * `fitScale` deliberately never reduces below 1:1 -- a board larger than
     * the cap at its own size would otherwise be shrunk into illegibility to
     * satisfy a limit the browser may refuse anyway. This must not add a
     * second, quieter opinion about that.
     */
    expect(clipboardScale(9000, 9000)).toBe(1);
  });

  it('survives a degenerate box rather than dividing by zero', () => {
    expect(Number.isFinite(clipboardScale(0, 0))).toBe(true);
    expect(clipboardScale(0, 0)).toBe(4);
  });
});
