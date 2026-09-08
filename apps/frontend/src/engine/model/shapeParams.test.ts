import { describe, expect, it } from 'vitest';
import {
  CALLOUT_TAILS,
  CALLOUT_TAIL_CELLS,
  SHAPE_PARAMS,
  clampParam,
  displayBounds,
  fromDisplay,
  paramValue,
  shapeParamLabel,
  shapeParams,
  toDisplay,
  type ShapeParam,
} from './shapeParams';
import { cpuPoints } from './shapeOutline';
import { SHAPE_KIND_VALUES } from './schema';

const every: ShapeParam[] = Object.values(SHAPE_PARAMS).flatMap((g) => [...g.params]);

describe('the table itself', () => {
  it('only names kinds that exist', () => {
    for (const kind of Object.keys(SHAPE_PARAMS)) {
      expect(SHAPE_KIND_VALUES).toContain(kind);
    }
  });

  it('gives every group a name for the panel to use', () => {
    for (const kind of Object.keys(SHAPE_PARAMS)) {
      expect(shapeParamLabel(kind as never)).toBeTruthy();
    }
  });

  it('has bounds the right way round, with the default inside them', () => {
    for (const p of every) {
      expect(p.min).toBeLessThan(p.max);
      expect(p.step).toBeGreaterThan(0);
      expect(p.fallback).toBeGreaterThanOrEqual(p.min);
      expect(p.fallback).toBeLessThanOrEqual(p.max);
    }
  });

  it('names each field once per kind', () => {
    for (const group of Object.values(SHAPE_PARAMS)) {
      const fields = group.params.map((p) => p.field);
      expect(new Set(fields).size).toBe(fields.length);
    }
  });
});

describe('display conversion', () => {
  it('round-trips every parameter at both ends and the default', () => {
    for (const p of every) {
      for (const stored of [p.min, p.fallback, p.max]) {
        expect(fromDisplay(p, toDisplay(p, stored))).toBeCloseTo(stored, 6);
      }
    }
  });

  /**
   * A depth is shown as the complement of what is stored, so its bounds swap
   * ends. Converting `min` and `max` independently -- the obvious thing to
   * write -- produces a stepper whose minimum is above its maximum, which
   * silently offers none of the range.
   */
  it('keeps shown bounds ordered, including the reversed ones', () => {
    for (const p of every) {
      const b = displayBounds(p);
      expect(b.min).toBeLessThan(b.max);
      const shown = toDisplay(p, p.fallback);
      expect(shown).toBeGreaterThanOrEqual(b.min);
      expect(shown).toBeLessThanOrEqual(b.max);
    }
  });

  it('reads the default when the geometry has not been touched', () => {
    for (const p of every) {
      expect(paramValue({}, p)).toBe(p.fallback);
      expect(paramValue({ [p.field]: Number.NaN }, p)).toBe(p.fallback);
    }
  });
});

describe('clamping', () => {
  it('holds a value inside its bounds', () => {
    for (const p of every) {
      expect(clampParam(p, p.min - 100)).toBe(p.min);
      expect(clampParam(p, p.max + 100)).toBe(p.max);
    }
  });

  it('keeps counts whole', () => {
    for (const p of every.filter((x) => x.unit === 'count')) {
      expect(Number.isInteger(clampParam(p, p.min + 0.4))).toBe(true);
    }
  });
});

/**
 * The reason the table exists: a dial whose top half moves and draws nothing.
 *
 * The CPU offered sixteen pins a side and the outline clamped at six, so this
 * asserts against the *drawing* rather than against the number -- a test on
 * the constants alone would have passed the whole time the bug was there.
 */
describe('a dial offers only what the shape draws', () => {
  const pins = shapeParams('cpu')[0];

  it('changes the silhouette at every step it offers', () => {
    const counts = new Set<number>();
    for (let n = pins.min; n <= pins.max; n += pins.step) {
      counts.add(cpuPoints(200, 200, n).length);
    }
    expect(counts.size).toBe((pins.max - pins.min) / pins.step + 1);
  });

  it('draws the default when asked for nothing', () => {
    expect(cpuPoints(200, 200)).toEqual(cpuPoints(200, 200, pins.fallback));
  });
});

describe('callout tails', () => {
  it('places all seven, each in its own cell of the pad', () => {
    const cells = CALLOUT_TAILS.map((t) => `${CALLOUT_TAIL_CELLS[t].row},${CALLOUT_TAIL_CELLS[t].col}`);
    expect(new Set(cells).size).toBe(CALLOUT_TAILS.length);
  });

  it('leaves the middle cell to the balloon', () => {
    expect(cells().includes('2,2')).toBe(false);
    function cells() {
      return CALLOUT_TAILS.map((t) => `${CALLOUT_TAIL_CELLS[t].row},${CALLOUT_TAIL_CELLS[t].col}`);
    }
  });
});
