import { describe, expect, it } from 'vitest';
import { bandScale, formatTick, linearScale, niceDomain, niceStep, roundToStep } from './scales';

describe('linearScale', () => {
  it('maps the domain onto the range', () => {
    const s = linearScale([0, 100], [0, 200]);
    expect(s(0)).toBe(0);
    expect(s(50)).toBe(100);
    expect(s(100)).toBe(200);
  });

  it('inverts when the range does, which is how y axes are drawn', () => {
    /**
     * Screen y grows downward and a value axis grows upward, so every vertical
     * scale in a chart is built with its range reversed. If this did not work
     * the charts would be drawn upside down, which is a bug that looks like a
     * design decision until somebody reads the numbers.
     */
    const s = linearScale([0, 10], [300, 0]);
    expect(s(0)).toBe(300);
    expect(s(10)).toBe(0);
    expect(s(5)).toBe(150);
  });

  it('answers the middle of the range for a zero-width domain', () => {
    /**
     * A series where every value is identical. The alternative is a division
     * by zero, and `NaN` coordinates draw nothing at all — a blank chart with
     * no error, which is the failure mode this codebase keeps naming.
     */
    const s = linearScale([7, 7], [0, 100]);
    expect(s(7)).toBe(50);
    expect(Number.isFinite(s(7))).toBe(true);
  });
});

describe('niceStep', () => {
  it('only ever returns 1, 2 or 5 times a power of ten', () => {
    for (let raw = 0.01; raw < 10_000; raw *= 1.37) {
      const step = niceStep(raw);
      const mantissa = step / 10 ** Math.floor(Math.log10(step));
      expect([1, 2, 5, 10]).toContain(Math.round(mantissa));
    }
  });

  it('survives a zero or negative step', () => {
    expect(niceStep(0)).toBe(1);
    expect(niceStep(-5)).toBe(1);
    expect(niceStep(Number.NaN)).toBe(1);
  });
});

describe('niceDomain', () => {
  it('rounds outward so the data always fits inside the axis', () => {
    const { domain } = niceDomain(3, 97);
    expect(domain[0]).toBeLessThanOrEqual(3);
    expect(domain[1]).toBeGreaterThanOrEqual(97);
  });

  it('includes zero by default, because a bar is measured from it', () => {
    /**
     * The truthfulness rule. An axis starting at 240 turns the gap between 250
     * and 260 into a visual claim the numbers do not make, and a bar whose
     * baseline is not zero has a length that means nothing.
     */
    const { domain } = niceDomain(250, 260);
    expect(domain[0]).toBe(0);
  });

  it('can be told not to, for data that does not live near zero', () => {
    const { domain } = niceDomain(297, 303, 5, false);
    expect(domain[0]).toBeGreaterThan(0);
    expect(domain[0]).toBeLessThanOrEqual(297);
  });

  it('gives a flat series a drawable axis', () => {
    const flat = niceDomain(5, 5, 5, false);
    expect(flat.domain[1]).toBeGreaterThan(flat.domain[0]);
    expect(flat.ticks.length).toBeGreaterThan(1);

    const zero = niceDomain(0, 0);
    expect(zero.domain[1]).toBeGreaterThan(zero.domain[0]);
  });

  it('produces ticks free of floating-point dust', () => {
    /**
     * The bug this forecloses is `0.30000000000000004` on an axis. Ticks are
     * counted from the start rather than accumulated for the same reason.
     */
    const { ticks } = niceDomain(0, 1, 10);
    for (const t of ticks) {
      expect(String(t)).not.toMatch(/\d{6,}/);
    }
  });

  it('spans the whole domain with evenly spaced ticks', () => {
    const { domain, ticks } = niceDomain(0, 100, 5);
    expect(ticks[0]).toBe(domain[0]);
    expect(ticks[ticks.length - 1]).toBe(domain[1]);

    const gaps = ticks.slice(1).map((t, i) => roundToStep(t - ticks[i], 0.001));
    expect(new Set(gaps).size).toBe(1);
  });

  it('handles a domain that is entirely negative', () => {
    const { domain, ticks } = niceDomain(-90, -10);
    expect(domain[0]).toBeLessThanOrEqual(-90);
    // Zero is the top of the axis here, which is what `includeZero` means for
    // data below it — bars hang downward from the baseline.
    expect(domain[1]).toBe(0);
    expect(ticks.length).toBeGreaterThan(1);
  });
});

describe('bandScale', () => {
  it('divides the range into equal slots', () => {
    const b = bandScale(4, [0, 400], 0);
    expect(b.step).toBe(100);
    expect(b.bandWidth).toBe(100);
    expect(b.at(0)).toBe(0);
    expect(b.at(3)).toBe(300);
  });

  it('takes the gap out of the slot, centred', () => {
    const b = bandScale(2, [0, 200], 0.5);
    expect(b.bandWidth).toBe(50);
    expect(b.at(0)).toBe(25);
    expect(b.centre(0)).toBe(50);
  });

  it('keeps padding as a fraction so it survives a resize', () => {
    /**
     * A fixed pixel gap becomes a solid block at small widths and stripes at
     * large ones. The same fraction at two sizes must give the same *ratio* of
     * bar to gap.
     */
    const small = bandScale(5, [0, 100], 0.3);
    const large = bandScale(5, [0, 1000], 0.3);
    expect(large.bandWidth / large.step).toBeCloseTo(small.bandWidth / small.step, 10);
  });

  it('refuses a padding that would erase the bars', () => {
    expect(bandScale(3, [0, 300], 1).bandWidth).toBeGreaterThan(0);
    expect(bandScale(3, [0, 300], -1).bandWidth).toBeLessThanOrEqual(100);
  });

  it('never divides by zero on an empty set of categories', () => {
    const b = bandScale(0, [0, 100]);
    expect(Number.isFinite(b.step)).toBe(true);
    expect(Number.isFinite(b.at(0))).toBe(true);
  });
});

describe('formatTick', () => {
  it('leaves ordinary numbers alone', () => {
    expect(formatTick(0)).toBe('0');
    expect(formatTick(250)).toBe('250');
    expect(formatTick(9999)).toBe('9999');
  });

  it('abbreviates only once the width is actually costing something', () => {
    /**
     * From 10k up, not from 1k: a chart of prices in the hundreds must not be
     * rewritten into something less precise than the data it is drawing.
     */
    expect(formatTick(1200)).toBe('1200');
    expect(formatTick(12_000)).toBe('12k');
    expect(formatTick(1_500_000)).toBe('1.5M');
  });

  it('does not show a decimal the abbreviation has already discarded', () => {
    expect(formatTick(20_000)).toBe('20k');
    expect(formatTick(2_000_000)).toBe('2M');
  });

  it('keeps the sign', () => {
    expect(formatTick(-250)).toBe('-250');
    expect(formatTick(-12_000)).toBe('-12k');
  });
});
