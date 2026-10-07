import { describe, expect, it } from 'vitest';
import {
  cropToAspect,
  fillImage,
  fitImage,
  frameModeOf,
  matchingPreset,
  placementSize,
  quarterTurn,
  replacementCrop,
  windowOfAspect,
} from './imageFrame';

const natural = { width: 4000, height: 3000 }; // 4:3

describe('windowOfAspect', () => {
  it('takes the largest centred window of the ratio', () => {
    expect(windowOfAspect(natural, 1)).toEqual({ x: 500, y: 0, width: 3000, height: 3000 });
    expect(windowOfAspect(natural, 16 / 9)).toEqual({ x: 0, y: 375, width: 4000, height: 2250 });
  });

  it('keeps an off-centre window inside the bitmap', () => {
    const w = windowOfAspect(natural, 1, { x: 3900, y: 1500 });
    expect(w.x + w.width).toBeLessThanOrEqual(4000);
    expect(w.x).toBe(1000);
  });

  it('falls back to the whole picture for nonsense', () => {
    expect(windowOfAspect({ width: 0, height: 10 }, 1)).toEqual({ x: 0, y: 0, width: 0, height: 10 });
    expect(windowOfAspect(natural, Number.NaN)).toEqual({ x: 0, y: 0, width: 4000, height: 3000 });
  });
});

describe('frameModeOf', () => {
  it('reads an untouched picture as fit', () => {
    expect(frameModeOf({ x: 0, y: 0, width: 400, height: 300 }, natural, undefined)).toBe('fit');
  });

  it('reads a cropped picture at its window proportions as fill', () => {
    expect(frameModeOf({ x: 0, y: 0, width: 300, height: 300 }, natural, { x: 500, y: 0, width: 3000, height: 3000 })).toBe('fill');
  });

  it('reads a freely resized picture as stretched', () => {
    expect(frameModeOf({ x: 0, y: 0, width: 400, height: 100 }, natural, undefined)).toBe('stretched');
  });

  it('cannot say before the bitmap size is known', () => {
    expect(frameModeOf({ x: 0, y: 0, width: 400, height: 100 }, { width: 0, height: 0 }, undefined)).toBeNull();
  });
});

describe('fit and fill', () => {
  const stretched = { x: 100, y: 100, width: 800, height: 200 };

  it('fit shows the whole picture inside the old box, centred', () => {
    const out = fitImage(stretched, natural)!;
    expect(out.crop).toBeUndefined();
    expect(out.box.height).toBe(200);
    expect(out.box.width).toBeCloseTo(266.67, 1);
    expect(out.box.x + out.box.width / 2).toBeCloseTo(500, 1);
    expect(frameModeOf(out.box, natural, out.crop)).toBe('fit');
  });

  it('fill keeps the box and crops the picture to cover it', () => {
    const crop = fillImage(stretched, natural, undefined)!;
    expect(crop.width / crop.height).toBeCloseTo(4, 3);
    expect(frameModeOf(stretched, natural, crop)).toBe('fill');
  });

  it('fill keeps the framing centre a person already chose', () => {
    const framed = { x: 0, y: 0, width: 1000, height: 1000 };
    const crop = fillImage({ x: 0, y: 0, width: 200, height: 100 }, natural, framed)!;
    expect(crop.x + crop.width / 2).toBeCloseTo(Math.max(crop.width / 2, 500), 3);
  });
});

describe('cropToAspect', () => {
  it('keeps the picture scale and the box centre', () => {
    const box = { x: 0, y: 0, width: 400, height: 300 };
    const out = cropToAspect(box, natural, undefined, 1)!;
    expect(out.box).toEqual({ x: 50, y: 0, width: 300, height: 300 });
    expect(matchingPreset(natural, out.crop)).toBe('1:1');
  });

  it('original restores the whole picture', () => {
    const box = { x: 50, y: 0, width: 300, height: 300 };
    const out = cropToAspect(box, natural, { x: 500, y: 0, width: 3000, height: 3000 }, null)!;
    expect(out.crop).toBeUndefined();
    expect(out.box.width / out.box.height).toBeCloseTo(4 / 3, 5);
    expect(matchingPreset(natural, out.crop)).toBe('original');
  });
});

describe('quarterTurn', () => {
  it('turns square pictures a quarter and wraps', () => {
    expect(quarterTurn(0, 1)).toBe(90);
    expect(quarterTurn(0, -1)).toBe(270);
    expect(quarterTurn(270, 1)).toBe(0);
  });

  it('squares a tilted picture to the next quarter in the direction turned', () => {
    expect(quarterTurn(3, 1)).toBe(90);
    expect(quarterTurn(3, -1)).toBe(0);
    expect(quarterTurn(Number.NaN, 1)).toBe(90);
  });
});

describe('replacement and placement', () => {
  it('a replacement picture fills the frame it lands in', () => {
    const crop = replacementCrop({ width: 300, height: 300 }, natural)!;
    expect(crop.width).toBe(crop.height);
  });

  it('a replacement of the same proportions is not cropped', () => {
    expect(replacementCrop({ width: 400, height: 300 }, natural)).toBeUndefined();
  });

  it('places large pictures within the cap at their own proportions', () => {
    expect(placementSize(natural)).toEqual({ width: 800, height: 600 });
    expect(placementSize({ width: 100, height: 50 })).toEqual({ width: 100, height: 50 });
    expect(placementSize({ width: Number.NaN, height: 1 })).toEqual({ width: 300, height: 300 });
  });
});
