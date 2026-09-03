import { describe, expect, it } from 'vitest';
import {
  DASH_PRESET,
  dashFor,
  dashRatioOf,
  restyleForWidth,
  styleOf,
} from './strokeStyle';
import type { Stroke } from './schema';

const stroke = (width: number, dash?: number[]): Stroke => ({ color: '#000', width, dash });

/**
 * A dash can be shaped, and still scales with the weight.
 *
 * The rule this module was built on is that a fixed `[6, 4]` is a clear dashed
 * line at 1px and a nearly solid one at 12px, so the pattern is derived from
 * the weight. Letting somebody author an absolute array would quietly repeal
 * that for any pattern they touched — and leave the panel's own hint saying
 * something untrue. Editing the *ratio* keeps both.
 */

describe('a preset is a ratio like any other', () => {
  it('still produces what it always did', () => {
    expect(dashFor('dashed', 4)).toEqual({ dash: [12, 8] });
    expect(dashFor('dotted', 4)).toEqual({ dash: [0, 8] });
    expect(dashFor('solid', 4)).toEqual({});
  });

  it('names the preset shapes rather than hiding them in a switch', () => {
    expect(DASH_PRESET.dashed).toEqual({ on: 3, off: 2 });
    expect(DASH_PRESET.dotted).toEqual({ on: 0, off: 2 });
    expect(DASH_PRESET.solid).toBeNull();
  });

  it('clamps a useless weight, so a hairline still dashes', () => {
    // A 0-width stroke draws nothing, and a fractional weight would give a
    // dash shorter than a device pixel.
    expect(dashFor('dashed', 0)).toEqual({ dash: [3, 2] });
    expect(dashFor('dashed', 0.4)).toEqual({ dash: [3, 2] });
  });
});

describe('a shaped dash is stored in absolute units', () => {
  it('multiplies the ratio by the weight', () => {
    expect(dashFor('dashed', 5, { on: 4, off: 1 })).toEqual({ dash: [20, 5] });
  });

  it('refuses a gap of zero', () => {
    /**
     * A zero gap is a solid line drawn as a pattern: legal, pointless, and
     * indistinguishable from solid except that `styleOf` would keep calling it
     * dashed — so the Style control would show Dashed over a line with no
     * dashes in it.
     */
    expect(dashFor('dashed', 4, { on: 3, off: 0 })).toEqual({});
    expect(styleOf(stroke(4, dashFor('dashed', 4, { on: 3, off: 0 }).dash))).toBe('solid');
  });

  it('keeps a dot a dot', () => {
    const out = dashFor('dotted', 3, { on: 0, off: 5 });
    expect(out).toEqual({ dash: [0, 15] });
    expect(styleOf(stroke(3, out.dash))).toBe('dotted');
  });
});

describe('the ratio is read back out, never stored beside the array', () => {
  it('recovers what was written', () => {
    const { dash } = dashFor('dashed', 6, { on: 2.5, off: 1.5 });
    expect(dashRatioOf(stroke(6, dash))).toEqual({ on: 2.5, off: 1.5 });
  });

  it('answers nothing for a solid stroke', () => {
    expect(dashRatioOf(stroke(4))).toBeNull();
    expect(dashRatioOf(undefined)).toBeNull();
  });

  it('divides by the weight the array was written for', () => {
    expect(dashRatioOf(stroke(4, [12, 8]))).toEqual({ on: 3, off: 2 });
    expect(dashRatioOf(stroke(2, [12, 8]))).toEqual({ on: 6, off: 4 });
  });
});

describe('a shaped dash survives a weight change', () => {
  it('rescales a preset exactly as before', () => {
    expect(restyleForWidth(stroke(2, [6, 4]), 8)).toEqual({ dash: [24, 16] });
  });

  it('rescales a hand-shaped pattern too', () => {
    /**
     * The property the whole design exists for. A 4:1 pattern authored at 2px
     * is still 4:1 at 8px — where a stored absolute array would have stayed
     * `[8, 2]` and become a nearly solid line, silently, on the one edit most
     * likely to follow shaping a dash.
     */
    const shaped = dashFor('dashed', 2, { on: 4, off: 1 });
    expect(shaped).toEqual({ dash: [8, 2] });
    expect(restyleForWidth(stroke(2, shaped.dash), 8)).toEqual({ dash: [32, 8] });
  });

  it('is stable under repeated restyling', () => {
    /**
     * Ratio in, ratio out, so walking a stroke up and back down returns the
     * pattern it started with rather than drifting a little each time.
     *
     * The previous width has to be carried along, and that is the contract
     * rather than a detail of the test: `restyleForWidth` reads the ratio
     * against the width the array was *written for*, so a caller handing it a
     * stroke whose `width` has already been updated is asking the wrong
     * question. Every caller applies it before the width lands, which is why
     * it is a single call on the change rather than a reaction to it.
     */
    let width = 3;
    let dash = dashFor('dashed', width, { on: 5, off: 2 }).dash;
    for (const next of [7, 11, 2, 3]) {
      dash = restyleForWidth(stroke(width, dash), next).dash;
      width = next;
    }
    expect(dashRatioOf(stroke(width, dash))?.on).toBeCloseTo(5, 6);
    expect(dashRatioOf(stroke(width, dash))?.off).toBeCloseTo(2, 6);
  });

  it('leaves a solid stroke solid', () => {
    // Callers apply this on every width change without checking.
    expect(restyleForWidth(stroke(2), 9)).toEqual({});
  });

  it('keeps a dotted stroke dotted', () => {
    const dotted = dashFor('dotted', 2, { on: 0, off: 3 });
    const wider = restyleForWidth(stroke(2, dotted.dash), 6);
    expect(wider.dash?.[0]).toBe(0);
    expect(styleOf(stroke(6, wider.dash))).toBe('dotted');
  });
});
