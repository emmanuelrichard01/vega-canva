import { describe, expect, it } from 'vitest';
import { cropToAspect, dragCropHandleLocked, resolveCropAspect, type CropState } from './imageCrop';

const natural = { width: 2000, height: 1000 };
// Shown at half size, uncropped: 1000 × 500 on the board.
const state: CropState = {
  node: { x: 0, y: 0, width: 1000, height: 500 },
  crop: { x: 0, y: 0, width: 2000, height: 1000 },
};

const boardAspect = (s: CropState) => s.node.width / s.node.height;

describe('cropToAspect', () => {
  it('takes the largest centred square and keeps the centre and scale', () => {
    const next = cropToAspect(state, natural, 1);
    expect(next.crop).toEqual({ x: 500, y: 0, width: 1000, height: 1000 });
    expect(next.node.width).toBeCloseTo(500);
    expect(next.node.height).toBeCloseTo(500);
    expect(next.node.x + next.node.width / 2).toBeCloseTo(500);
    expect(next.node.y + next.node.height / 2).toBeCloseTo(250);
  });

  it('produces the requested shape on the board for every preset', () => {
    for (const ratio of [4 / 3, 3 / 2, 16 / 9, 4 / 5, 9 / 16]) {
      expect(boardAspect(cropToAspect(state, natural, ratio))).toBeCloseTo(ratio, 3);
    }
  });

  it('stays inside the bitmap when the current crop sits at an edge', () => {
    const atEdge: CropState = { node: { x: 0, y: 0, width: 100, height: 100 }, crop: { x: 1800, y: 0, width: 200, height: 200 } };
    const next = cropToAspect(atEdge, natural, 1);
    expect(next.crop.x + next.crop.width).toBeLessThanOrEqual(natural.width);
    expect(next.crop.x).toBeGreaterThanOrEqual(0);
  });

  it('resolves Original from the bitmap', () => {
    expect(resolveCropAspect('original', natural)).toBe(2);
    expect(resolveCropAspect(null, natural)).toBeNull();
  });
});

describe('dragCropHandleLocked', () => {
  const square: CropState = { node: { x: 0, y: 0, width: 400, height: 400 }, crop: { x: 400, y: 200, width: 800, height: 800 } };

  it('keeps the ratio and the opposite corner on a corner drag', () => {
    const next = dragCropHandleLocked(square, natural, 'se', { x: -100, y: -20 }, 1);
    expect(boardAspect(next)).toBeCloseTo(1, 5);
    expect(next.node.x).toBeCloseTo(0);
    expect(next.node.y).toBeCloseTo(0);
    expect(next.node.width).toBeCloseTo(300);
  });

  it('grows the other side about the centre on an edge drag', () => {
    const next = dragCropHandleLocked(square, natural, 'e', { x: -100, y: 0 }, 1);
    expect(boardAspect(next)).toBeCloseTo(1, 5);
    expect(next.node.y + next.node.height / 2).toBeCloseTo(200);
  });

  it('never leaves the bitmap', () => {
    const next = dragCropHandleLocked(square, natural, 'se', { x: 5000, y: 5000 }, 1);
    expect(next.crop.x + next.crop.width).toBeLessThanOrEqual(natural.width + 1e-6);
    expect(next.crop.y + next.crop.height).toBeLessThanOrEqual(natural.height + 1e-6);
    expect(boardAspect(next)).toBeCloseTo(1, 5);
  });
});
