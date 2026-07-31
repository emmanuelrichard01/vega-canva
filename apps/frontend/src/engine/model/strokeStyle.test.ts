import { describe, expect, it } from 'vitest';
import type { Stroke } from './schema';
import {
  STROKE_STYLE_IDS,
  buildStroke,
  dashFor,
  restyleForWidth,
  styleOf,
} from './strokeStyle';

describe('dashFor', () => {
  it('gives a solid stroke no dash and no cap', () => {
    expect(dashFor('solid', 4)).toEqual({});
  });

  it('scales the dashed pattern with the stroke weight', () => {
    expect(dashFor('dashed', 1).dash).toEqual([3, 2]);
    expect(dashFor('dashed', 4).dash).toEqual([12, 8]);
  });

  it('draws dots as zero-length segments with a round cap', () => {
    // Both halves matter: `[0, gap]` with the default butt cap draws nothing
    // at all, because a zero-length segment has no extent of its own.
    expect(dashFor('dotted', 3)).toEqual({ dash: [0, 6], cap: 'round' });
  });

  it('never produces a pattern finer than one unit', () => {
    // A 0-width stroke draws nothing, and a fractional weight would otherwise
    // give a dash shorter than a device pixel.
    for (const width of [0, 0.25, 1, -5, NaN, Infinity]) {
      const { dash } = dashFor('dashed', width);
      expect(dash).toEqual([3, 2]);
    }
  });

  it('produces a finite, non-negative pattern for every style and weight', () => {
    for (const style of STROKE_STYLE_IDS) {
      for (const width of [0, 1, 2.5, 40, 100]) {
        const { dash } = dashFor(style, width);
        if (!dash) continue;
        expect(dash.every((n) => Number.isFinite(n) && n >= 0)).toBe(true);
        // An all-zero array is an invisible line, not a pattern.
        expect(dash.some((n) => n > 0)).toBe(true);
      }
    }
  });
});

describe('styleOf', () => {
  it('reads an absent stroke and an absent dash as solid', () => {
    expect(styleOf(undefined)).toBe('solid');
    expect(styleOf({ color: '#000', width: 2 })).toBe('solid');
    expect(styleOf({ color: '#000', width: 2, dash: [] })).toBe('solid');
  });

  it('round-trips every style it generates', () => {
    for (const style of STROKE_STYLE_IDS) {
      for (const width of [1, 2, 9, 60]) {
        const stroke: Stroke = { color: '#000', width, ...dashFor(style, width) };
        expect(styleOf(stroke)).toBe(style);
      }
    }
  });

  it('recognises a pattern authored at a different weight', () => {
    // The whole point of matching on shape rather than on exact numbers: the
    // width may have changed since the pattern was written.
    expect(styleOf({ color: '#000', width: 1, dash: [36, 24] })).toBe('dashed');
    expect(styleOf({ color: '#000', width: 20, dash: [0, 2] })).toBe('dotted');
  });

  it('calls an arbitrary pattern dashed rather than refusing to answer', () => {
    // A future pattern editor, or an older document, will produce arrays no
    // preset would generate. They still have to map to something.
    expect(styleOf({ color: '#000', width: 2, dash: [7, 3, 1, 3] })).toBe('dashed');
  });

  it('treats an all-zero pattern as solid', () => {
    // Otherwise a corrupt value renders an invisible line with no way back to
    // a visible one from the control.
    expect(styleOf({ color: '#000', width: 2, dash: [0, 0] })).toBe('solid');
  });
});

describe('restyleForWidth', () => {
  it('keeps a dashed stroke dashed and re-proportions it', () => {
    const before: Stroke = { color: '#000', width: 1, ...dashFor('dashed', 1) };
    const after = restyleForWidth(before, 8);
    expect(after.dash).toEqual([24, 16]);
    expect(styleOf({ ...before, width: 8, ...after })).toBe('dashed');
  });

  it('keeps a dotted stroke dotted, cap included', () => {
    const before: Stroke = { color: '#000', width: 2, ...dashFor('dotted', 2) };
    expect(restyleForWidth(before, 10)).toEqual({ dash: [0, 20], cap: 'round' });
  });

  it('leaves a solid stroke with nothing to apply', () => {
    expect(restyleForWidth({ color: '#000', width: 2 }, 9)).toEqual({});
  });
});

describe('buildStroke', () => {
  it('omits dash keys entirely for a solid stroke', () => {
    // Not set to `undefined`. This object is stored nested inside
    // `appearance`, where a literal `undefined` survives `toJSON()` and
    // defeats every `?? fallback` read downstream.
    const stroke = buildStroke({ color: '#111', width: 3 }, dashFor('solid', 3));
    expect(stroke).toEqual({ color: '#111', width: 3 });
    expect(Object.hasOwn(stroke, 'dash')).toBe(false);
    expect(Object.hasOwn(stroke, 'cap')).toBe(false);
  });

  it('carries the cap along with a dotted pattern', () => {
    expect(buildStroke({ color: '#111', width: 2 }, dashFor('dotted', 2))).toEqual({
      color: '#111',
      width: 2,
      dash: [0, 4],
      cap: 'round',
    });
  });

  it('drops an empty dash array rather than storing one', () => {
    expect(buildStroke({ color: '#111', width: 2 }, { dash: [] })).toEqual({
      color: '#111',
      width: 2,
    });
  });

  it('switching back to solid clears a previous pattern', () => {
    const dotted = buildStroke({ color: '#111', width: 2 }, dashFor('dotted', 2));
    const solid = buildStroke(dotted, dashFor('solid', dotted.width));
    expect(styleOf(solid)).toBe('solid');
    expect(Object.hasOwn(solid, 'dash')).toBe(false);
    expect(Object.hasOwn(solid, 'cap')).toBe(false);
  });
});
