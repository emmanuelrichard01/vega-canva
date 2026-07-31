import { describe, expect, it } from 'vitest';
import {
  CROP_HANDLES,
  MIN_CROP_PX,
  cropScale,
  dragCropHandle,
  fullCrop,
  isCropped,
  packCrop,
  panCropWindow,
  readCrop,
  sourceBoxInWorld,
  type CropState,
} from './imageCrop';

/** A 400x300 bitmap drawn at 800x600 on the board — two world units per pixel. */
const natural = { width: 400, height: 300 };
const state = (): CropState => ({
  node: { x: 100, y: 50, width: 800, height: 600 },
  crop: { x: 0, y: 0, width: 400, height: 300 },
});

/** Every operation must leave the crop inside the bitmap. */
const insideBitmap = (s: CropState) => {
  expect(s.crop.x).toBeGreaterThanOrEqual(-1e-9);
  expect(s.crop.y).toBeGreaterThanOrEqual(-1e-9);
  expect(s.crop.x + s.crop.width).toBeLessThanOrEqual(natural.width + 1e-9);
  expect(s.crop.y + s.crop.height).toBeLessThanOrEqual(natural.height + 1e-9);
  expect(s.crop.width).toBeGreaterThanOrEqual(MIN_CROP_PX - 1e-9);
  expect(s.crop.height).toBeGreaterThanOrEqual(MIN_CROP_PX - 1e-9);
};

/** The two rectangles must never drift apart. */
const scaleUnchanged = (s: CropState) => {
  const k = cropScale(s);
  expect(k.x).toBeCloseTo(2, 9);
  expect(k.y).toBeCloseTo(2, 9);
};

describe('readCrop', () => {
  it('falls back to the whole image when there is no crop', () => {
    expect(readCrop(undefined, natural)).toEqual(fullCrop(natural));
    expect(readCrop(null, natural)).toEqual(fullCrop(natural));
    expect(readCrop({}, natural)).toEqual(fullCrop(natural));
  });

  it('keeps a crop that fits', () => {
    const c = { x: 10, y: 20, width: 100, height: 80 };
    expect(readCrop(c, natural)).toEqual(c);
  });

  it('discards a crop that does not fit its bitmap rather than clamping it', () => {
    // It belongs to a different image — which is exactly what replacing `src`
    // does when an upload completes. A clamped leftover would show an
    // arbitrary corner of the new picture with no indication why.
    expect(readCrop({ x: 0, y: 0, width: 4000, height: 30 }, natural)).toEqual(fullCrop(natural));
    expect(readCrop({ x: 390, y: 0, width: 100, height: 30 }, natural)).toEqual(fullCrop(natural));
    expect(readCrop({ x: -50, y: 0, width: 100, height: 30 }, natural)).toEqual(fullCrop(natural));
  });

  it('rejects unusable numbers', () => {
    for (const bad of [NaN, Infinity, 0, -10, '20']) {
      expect(readCrop({ x: 0, y: 0, width: bad, height: 30 }, natural)).toEqual(fullCrop(natural));
    }
  });

  it('survives an image whose natural size is not known yet', () => {
    // `naturalWidth` is undefined until the bitmap loads, and nothing should
    // throw in the frames before that.
    const unknown = { width: 0, height: 0 };
    expect(readCrop({ x: 0, y: 0, width: 10, height: 10 }, unknown)).toEqual({
      x: 0, y: 0, width: 0, height: 0,
    });
  });
});

describe('isCropped / packCrop', () => {
  it('an uncropped image stores no crop at all', () => {
    // Same reasoning as packAdjustments: "is this cropped" must stay
    // answerable by the presence of the key.
    expect(isCropped(fullCrop(natural), natural)).toBe(false);
    expect(packCrop(fullCrop(natural), natural)).toBeUndefined();
  });

  it('any trimmed edge counts as cropped', () => {
    expect(isCropped({ x: 5, y: 0, width: 395, height: 300 }, natural)).toBe(true);
    expect(isCropped({ x: 0, y: 0, width: 400, height: 290 }, natural)).toBe(true);
    expect(packCrop({ x: 0, y: 0, width: 400, height: 290 }, natural)).toBeDefined();
  });
});

describe('dragCropHandle', () => {
  it('trims from the right without moving the left edge', () => {
    const next = dragCropHandle(state(), natural, 'e', { x: -200, y: 0 });
    // 200 world units at 2 units per pixel is 100 natural pixels.
    expect(next.crop).toEqual({ x: 0, y: 0, width: 300, height: 300 });
    expect(next.node.x).toBe(100);
    expect(next.node.width).toBe(600);
    scaleUnchanged(next);
    insideBitmap(next);
  });

  it('trims from the left by moving the node’s origin with the edge', () => {
    // The content must stay put: what was under the pointer before the drag is
    // still under it after.
    const next = dragCropHandle(state(), natural, 'w', { x: 200, y: 0 });
    expect(next.crop).toEqual({ x: 100, y: 0, width: 300, height: 300 });
    expect(next.node.x).toBe(300);
    expect(next.node.width).toBe(600);
    // The right-hand edge has not moved.
    expect(next.node.x + next.node.width).toBe(900);
    scaleUnchanged(next);
  });

  it('trims from the top and bottom the same way', () => {
    const top = dragCropHandle(state(), natural, 'n', { x: 0, y: 100 });
    expect(top.crop.y).toBe(50);
    expect(top.node.y).toBe(150);
    expect(top.node.y + top.node.height).toBe(650);

    const bottom = dragCropHandle(state(), natural, 's', { x: 0, y: -100 });
    expect(bottom.crop.height).toBe(250);
    expect(bottom.node.y).toBe(50);
  });

  it('moves both edges for a corner handle', () => {
    const next = dragCropHandle(state(), natural, 'se', { x: -200, y: -200 });
    expect(next.crop).toEqual({ x: 0, y: 0, width: 300, height: 200 });
    expect(next.node.width).toBe(600);
    expect(next.node.height).toBe(400);
    scaleUnchanged(next);
  });

  it('stops at the edge of the bitmap instead of overshooting', () => {
    // Clamping happens in natural space and the node box is derived from the
    // result, so the two cannot drift apart by the overshoot — which is what
    // leaves a transparent seam that only appears at certain sizes.
    const next = dragCropHandle(state(), natural, 'e', { x: 5000, y: 0 });
    expect(next.crop.width).toBe(400);
    expect(next.node.width).toBe(800);
    insideBitmap(next);
    scaleUnchanged(next);
  });

  it('cannot be driven below the minimum window', () => {
    // A zero-width crop makes drawImage throw on some browsers and draw
    // nothing on others, and no gesture recovers from it.
    const next = dragCropHandle(state(), natural, 'e', { x: -100000, y: -100000 });
    expect(next.crop.width).toBe(MIN_CROP_PX);
    expect(next.node.width).toBeCloseTo(MIN_CROP_PX * 2);
    insideBitmap(next);
  });

  it('keeps the crop inside the bitmap for every handle and any wild delta', () => {
    for (const handle of CROP_HANDLES) {
      for (const d of [-1e6, -333, -1, 0, 1, 333, 1e6]) {
        const next = dragCropHandle(state(), natural, handle, { x: d, y: d });
        insideBitmap(next);
        scaleUnchanged(next);
        expect(Number.isFinite(next.node.x)).toBe(true);
        expect(Number.isFinite(next.node.width)).toBe(true);
      }
    }
  });

  it('is a no-op on a degenerate state rather than inventing one', () => {
    // Caught a real bug: the guard used to test the *derived* scale, and
    // `cropScale` falls back to 1 for a zero-width crop — so a collapsed state
    // passed the check and came back out as a 10-unit crop of a bitmap it had
    // never measured. Guard the inputs, never something computed from them.
    const degenerate: CropState = {
      node: { x: 0, y: 0, width: 0, height: 0 },
      crop: { x: 0, y: 0, width: 0, height: 0 },
    };
    expect(dragCropHandle(degenerate, natural, 'e', { x: 10, y: 10 })).toBe(degenerate);
    expect(panCropWindow(degenerate, natural, { x: 10, y: 10 })).toBe(degenerate);
  });

  it('is a no-op while the bitmap has not loaded', () => {
    // `naturalWidth` is undefined until then, so there is nothing to clamp
    // against and every gesture must do nothing at all.
    const s = state();
    expect(dragCropHandle(s, { width: 0, height: 0 }, 'e', { x: -50, y: 0 })).toBe(s);
    expect(panCropWindow(s, { width: 0, height: 0 }, { x: -50, y: 0 })).toBe(s);
  });
});

describe('panCropWindow', () => {
  const trimmed = (): CropState => ({
    node: { x: 100, y: 50, width: 400, height: 300 },
    crop: { x: 100, y: 75, width: 200, height: 150 },
  });

  it('moves the window opposite to the pointer', () => {
    // Dragging the picture right must reveal what is to its left.
    const next = panCropWindow(trimmed(), natural, { x: 20, y: 0 });
    expect(next.crop.x).toBe(90);
  });

  it('never moves the node’s box', () => {
    // The one crop gesture that changes what is shown without changing where
    // the object sits on the board.
    const before = trimmed();
    const next = panCropWindow(before, natural, { x: 40, y: -30 });
    expect(next.node).toEqual(before.node);
  });

  it('stops at the edges of the source', () => {
    const left = panCropWindow(trimmed(), natural, { x: 99999, y: 99999 });
    expect(left.crop.x).toBe(0);
    expect(left.crop.y).toBe(0);
    const right = panCropWindow(trimmed(), natural, { x: -99999, y: -99999 });
    expect(right.crop.x).toBe(natural.width - 200);
    expect(right.crop.y).toBe(natural.height - 150);
  });

  it('cannot move a window that already covers the whole image', () => {
    const next = panCropWindow(state(), natural, { x: 500, y: 500 });
    expect(next.crop.x).toBe(0);
    expect(next.crop.y).toBe(0);
  });
});

describe('sourceBoxInWorld', () => {
  it('places the whole picture so the window lands on the node’s box', () => {
    // This is what the dimmed "what you are cutting off" layer is drawn with,
    // so if it is wrong the two layers visibly fail to register.
    const s: CropState = {
      node: { x: 100, y: 50, width: 400, height: 300 },
      crop: { x: 100, y: 75, width: 200, height: 150 },
    };
    const box = sourceBoxInWorld(s, natural);
    // Two world units per natural pixel again.
    expect(box).toEqual({ x: -100, y: -100, width: 800, height: 600 });
    // The window, measured off the source box, is exactly the node's box.
    expect(box.x + s.crop.x * 2).toBe(s.node.x);
    expect(box.y + s.crop.y * 2).toBe(s.node.y);
  });

  it('coincides with the node’s box when nothing is cropped', () => {
    const box = sourceBoxInWorld(state(), natural);
    expect(box).toEqual(state().node);
  });
});
