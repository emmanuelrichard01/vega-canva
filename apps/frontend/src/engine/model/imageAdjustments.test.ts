import { describe, expect, it } from 'vitest';
import {
  ADJUSTMENT_IDS,
  NO_ADJUSTMENTS,
  activeFilterIds,
  hasAdjustments,
  packAdjustments,
  readAdjustments,
  toKonvaValues,
} from './imageAdjustments';

describe('readAdjustments', () => {
  it('treats a missing value as untouched', () => {
    expect(readAdjustments(undefined)).toEqual(NO_ADJUSTMENTS);
    expect(readAdjustments({})).toEqual(NO_ADJUSTMENTS);
    expect(readAdjustments(null)).toEqual(NO_ADJUSTMENTS);
  });

  it('keeps values inside the range', () => {
    expect(readAdjustments({ brightness: -40, contrast: 15, saturation: 100, blur: 12 })).toEqual({
      brightness: -40,
      contrast: 15,
      saturation: 100,
      blur: 12,
    });
  });

  it('clamps out-of-range values', () => {
    const a = readAdjustments({ brightness: 500, contrast: -900, saturation: 101, blur: 200 });
    expect(a).toEqual({ brightness: 100, contrast: -100, saturation: 100, blur: 100 });
  });

  it('gives blur no negative half', () => {
    // You cannot un-blur an image, and a negative blur radius makes Konva's
    // box blur read outside the buffer.
    expect(readAdjustments({ blur: -50 }).blur).toBe(0);
  });

  it('rejects values that would poison the pixel loop', () => {
    // `NaN` in a filter does not throw. It turns every channel it touches into
    // transparent black, so the image reads as "failed to load" rather than as
    // a bad slider value — which is a far more expensive thing to debug.
    for (const bad of [NaN, Infinity, -Infinity, '40', null, {}]) {
      expect(readAdjustments({ brightness: bad, contrast: bad, saturation: bad, blur: bad })).toEqual(
        NO_ADJUSTMENTS
      );
    }
  });

  it('never returns a non-finite number for any input', () => {
    const inputs = [{}, { blur: NaN }, { saturation: -1e308 }, { contrast: 1e308 }];
    for (const raw of inputs) {
      const a = readAdjustments(raw);
      for (const id of ADJUSTMENT_IDS) expect(Number.isFinite(a[id])).toBe(true);
    }
  });
});

describe('hasAdjustments', () => {
  it('is false for an untouched image', () => {
    // Load-bearing: a false here is what keeps an untouched image out of
    // Konva's cache, which costs memory and sharpness when it is not needed.
    expect(hasAdjustments(NO_ADJUSTMENTS)).toBe(false);
  });

  it('is true when any single adjustment is set', () => {
    for (const id of ADJUSTMENT_IDS) {
      expect(hasAdjustments({ ...NO_ADJUSTMENTS, [id]: id === 'blur' ? 5 : -5 })).toBe(true);
    }
  });
});

describe('packAdjustments', () => {
  it('drops the key entirely when nothing is adjusted', () => {
    expect(packAdjustments(NO_ADJUSTMENTS)).toBeUndefined();
  });

  it('stores only what differs from default', () => {
    expect(packAdjustments({ ...NO_ADJUSTMENTS, contrast: 20 })).toEqual({ contrast: 20 });
  });

  it('round-trips through readAdjustments', () => {
    const original = { brightness: -12, contrast: 30, saturation: -100, blur: 7 };
    expect(readAdjustments(packAdjustments(original))).toEqual(original);
  });

  it('a value put back to zero is removed, not stored as zero', () => {
    const nudgedBack = { ...NO_ADJUSTMENTS, brightness: 0, contrast: 5 };
    expect(packAdjustments(nudgedBack)).toEqual({ contrast: 5 });
  });
});

describe('toKonvaValues', () => {
  it('is a no-op at zero, in every filter’s own units', () => {
    const k = toKonvaValues(NO_ADJUSTMENTS);
    expect(k.brightness).toBe(0);
    expect(k.contrast).toBe(0);
    // Konva raises 2 to this power, so 0 means "multiply saturation by 1".
    expect(k.saturation).toBe(0);
    expect(k.blurRadius).toBe(0);
  });

  it('passes contrast through one-to-one', () => {
    // Konva's own scale already is -100..100, and its curve
    // ((c + 100) / 100) ** 2 is well behaved across it.
    expect(toKonvaValues({ ...NO_ADJUSTMENTS, contrast: -70 }).contrast).toBe(-70);
    expect(toKonvaValues({ ...NO_ADJUSTMENTS, contrast: 70 }).contrast).toBe(70);
  });

  it('stops brightness short of pure white and pure black', () => {
    // Konva's Brighten accepts ±1, which is a solid colour at each end — the
    // last third of that slider would do nothing but obliterate.
    const up = toKonvaValues({ ...NO_ADJUSTMENTS, brightness: 100 }).brightness;
    const down = toKonvaValues({ ...NO_ADJUSTMENTS, brightness: -100 }).brightness;
    expect(up).toBeGreaterThan(0.3);
    expect(up).toBeLessThan(1);
    expect(down).toBe(-up);
  });

  it('maps saturation through the multiplier, not the exponent', () => {
    // Konva computes 2 ** saturation, so a linear map on the exponent would
    // make the bottom of the slider do almost nothing and the top do
    // everything. -100 must reach effectively grey, +100 must be vivid.
    const grey = 2 ** toKonvaValues({ ...NO_ADJUSTMENTS, saturation: -100 }).saturation;
    const vivid = 2 ** toKonvaValues({ ...NO_ADJUSTMENTS, saturation: 100 }).saturation;
    expect(grey).toBeLessThan(0.05);
    expect(vivid).toBeCloseTo(3, 5);
    // Halfway down is halfway to grey in multiplier terms, not in exponent.
    const half = 2 ** toKonvaValues({ ...NO_ADJUSTMENTS, saturation: -50 }).saturation;
    expect(half).toBeCloseTo(0.51, 2);
  });

  it('is monotonic across the whole range of every adjustment', () => {
    // A slider that reverses direction anywhere is worse than one with the
    // wrong range.
    for (const id of ADJUSTMENT_IDS) {
      let previous = -Infinity;
      for (let v = id === 'blur' ? 0 : -100; v <= 100; v += 5) {
        const k = toKonvaValues({ ...NO_ADJUSTMENTS, [id]: v });
        const value = id === 'blur' ? k.blurRadius : id === 'saturation' ? k.saturation : k[id];
        expect(value).toBeGreaterThan(previous);
        previous = value;
      }
    }
  });

  it('never produces a non-finite value', () => {
    for (const v of [-100, -50, 0, 50, 100]) {
      const k = toKonvaValues({ brightness: v, contrast: v, saturation: v, blur: Math.abs(v) });
      for (const n of Object.values(k)) expect(Number.isFinite(n)).toBe(true);
    }
  });
});

describe('activeFilterIds', () => {
  it('is empty when nothing is adjusted', () => {
    expect(activeFilterIds(NO_ADJUSTMENTS)).toEqual([]);
  });

  it('lists only the filters doing work', () => {
    // Each filter is a full pass over every pixel on re-cache, so an image
    // with only a blur must not also be walked three more times to add zero.
    expect(activeFilterIds({ ...NO_ADJUSTMENTS, blur: 20 })).toEqual(['blur']);
    expect(activeFilterIds({ brightness: 5, contrast: 0, saturation: -5, blur: 0 })).toEqual([
      'brightness',
      'saturation',
    ]);
  });
});
