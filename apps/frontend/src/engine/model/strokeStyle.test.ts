import { describe, expect, it } from 'vitest';
import type { Stroke } from './schema';
import {
  STROKE_STYLE_IDS,
  buildStroke,
  capApplies,
  dashFor,
  isDottedPattern,
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

  it('draws dots as zero-length segments', () => {
    // A zero-length segment has no extent of its own, so what makes it visible
    // is the round cap at each end of nothing — but that cap is applied when
    // the stroke is drawn rather than written into the pattern, so that
    // choosing a dash style never overwrites the cap the user picked.
    expect(dashFor('dotted', 3)).toEqual({ dash: [0, 6] });
    expect(isDottedPattern(dashFor('dotted', 3).dash)).toBe(true);
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

  it('keeps a dotted stroke dotted', () => {
    const before: Stroke = { color: '#000', width: 2, ...dashFor('dotted', 2) };
    expect(restyleForWidth(before, 10)).toEqual({ dash: [0, 20] });
  });

  it('leaves a solid stroke with nothing to apply', () => {
    expect(restyleForWidth({ color: '#000', width: 2 }, 9)).toEqual({});
  });
});

describe('capApplies', () => {
  const solid = { stroke: { color: '#000', width: 2 } };
  const dashed = { stroke: { color: '#000', width: 2, dash: [6, 4] } };

  it('applies to an open shape', () => {
    expect(capApplies({ type: 'shape', geometry: { kind: 'line' }, appearance: solid })).toBe(true);
    expect(capApplies({ type: 'shape', geometry: { kind: 'arrow' }, appearance: solid })).toBe(true);
  });

  it('does not apply to a solid closed shape', () => {
    for (const kind of ['rect', 'ellipse', 'polygon', 'star']) {
      expect(capApplies({ type: 'shape', geometry: { kind }, appearance: solid })).toBe(false);
    }
  });

  it('applies to ANY dashed outline, closed or not', () => {
    // The regression this exists for. Every dash has two ends, so rounding the
    // dashes on a rectangle is a real thing to want — and the control used to
    // be disabled for it, claiming the outline had no ends.
    for (const kind of ['rect', 'ellipse', 'polygon', 'star']) {
      expect(capApplies({ type: 'shape', geometry: { kind }, appearance: dashed })).toBe(true);
    }
    expect(capApplies({ type: 'path', geometry: { kind: 'freehand' }, appearance: dashed })).toBe(true);
  });

  it('applies to an open bezier but not a closed one', () => {
    expect(capApplies({ type: 'path', geometry: { kind: 'bezier', closed: false }, appearance: solid })).toBe(true);
    expect(capApplies({ type: 'path', geometry: { kind: 'bezier', closed: true }, appearance: solid })).toBe(false);
  });

  it('does not apply to a solid freehand stroke', () => {
    // Its path is the outline of its own stroke, already filled — the ends
    // were shaped when it was drawn and there is no live cap to change.
    expect(capApplies({ type: 'path', geometry: { kind: 'freehand' }, appearance: solid })).toBe(false);
  });

  it('always applies to a connector', () => {
    expect(capApplies({ type: 'connector', appearance: solid })).toBe(true);
  });

  it('does not apply to things with no outline at all', () => {
    expect(capApplies({ type: 'sticky', appearance: solid })).toBe(false);
    expect(capApplies({ type: 'image', appearance: undefined })).toBe(false);
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

  it('does not write a cap for a dotted pattern', () => {
    // The round cap a dot needs is applied at draw time, not stored. Storing it
    // overwrote whatever the user had chosen, and going back to solid left the
    // stroke round with no record it had ever been anything else.
    expect(buildStroke({ color: '#111', width: 2 }, dashFor('dotted', 2))).toEqual({
      color: '#111',
      width: 2,
      dash: [0, 4],
    });
  });

  it('keeps an authored cap through a dotted round trip', () => {
    const square = buildStroke({ color: '#111', width: 2, cap: 'square' }, dashFor('solid', 2));
    const dotted = buildStroke(square, dashFor('dotted', 2));
    const backToSolid = buildStroke(dotted, dashFor('solid', 2));
    expect(backToSolid.cap).toBe('square');
    expect(Object.hasOwn(backToSolid, 'dash')).toBe(false);
  });

  it('treats butt as the absent cap rather than storing it', () => {
    // Same rule as `center` for align and `miter` for join: it is what gets
    // drawn with nothing set, so writing it would be writing the default.
    const stroke = buildStroke({ color: '#111', width: 2, cap: 'butt' }, {});
    expect(Object.hasOwn(stroke, 'cap')).toBe(false);
  });

  it('identifies a dotted pattern from its dash array alone', () => {
    expect(isDottedPattern(dashFor('dotted', 3).dash)).toBe(true);
    expect(isDottedPattern(dashFor('dashed', 3).dash)).toBe(false);
    expect(isDottedPattern(undefined)).toBe(false);
    expect(isDottedPattern([])).toBe(false);
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
