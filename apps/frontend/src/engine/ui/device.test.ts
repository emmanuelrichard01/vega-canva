import { describe, expect, it } from 'vitest';
import { TOUCH_TARGET, classify, keyboardLift, touchHitPad, touchTolerance } from './device';

describe('device signal', () => {
  it('classifies by pointer and shortest side', () => {
    expect(classify(false, 390, 844)).toBe('desktop');
    expect(classify(true, 390, 844)).toBe('phone');
    expect(classify(true, 844, 390)).toBe('phone');
    expect(classify(true, 820, 1180)).toBe('tablet');
    expect(classify(true, 1366, 1024)).toBe('tablet');
  });

  it('grows a handle to a full touch target only on a coarse pointer', () => {
    expect(touchHitPad(9, false)).toBe(0);
    expect(touchHitPad(9, true)).toBe(TOUCH_TARGET - 9);
    // Already big enough: nothing added.
    expect(touchHitPad(60, true)).toBe(0);
    // The hit region is the visual plus the stroke on both halves.
    expect(9 + touchHitPad(9, true)).toBe(44);
  });

  it('scales tolerance with the target', () => {
    expect(touchTolerance(6, false)).toBe(6);
    expect(touchTolerance(6, true)).toBe(22);
    expect(touchTolerance(30, true)).toBe(30);
  });
});

describe('keyboardLift', () => {
  it('lifts a box that the keyboard would cover', () => {
    // Visible area 0..400 once the keyboard is up; the box ends at 500.
    expect(keyboardLift({ top: 440, bottom: 500 }, 0, 400)).toBe(500 - 384);
    expect(keyboardLift({ top: 100, bottom: 160 }, 0, 400)).toBe(0);
    // Taller than the room left: stop with its top at the top.
    expect(keyboardLift({ top: 200, bottom: 900 }, 0, 400)).toBe(200 - 16);
  });
});
