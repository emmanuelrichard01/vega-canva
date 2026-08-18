import { describe, expect, it } from 'vitest';
import { tickLabel, tickStep, ticksFor } from './rulerTicks';

describe('tickStep', () => {
  it('only ever returns a round number', () => {
    // A ruler labelled 0, 137, 274 is arithmetically correct and useless: the
    // point of the labels is reading a position off them without arithmetic.
    for (let zoom = 0.02; zoom < 10; zoom *= 1.07) {
      const step = tickStep(zoom);
      const decade = Math.pow(10, Math.floor(Math.log10(step)));
      expect([1, 2, 5, 10]).toContain(Math.round(step / decade));
    }
  });

  it('keeps marks at least the minimum gap apart on screen', () => {
    for (let zoom = 0.02; zoom < 10; zoom *= 1.07) {
      expect(tickStep(zoom) * zoom).toBeGreaterThanOrEqual(64);
    }
  });

  it('gets finer as the canvas is zoomed in', () => {
    expect(tickStep(8)).toBeLessThan(tickStep(1));
    expect(tickStep(1)).toBeLessThan(tickStep(0.1));
  });

  it('survives a zoom that is not a usable number', () => {
    // The camera clamps zoom, so these are a floor under a bug rather than an
    // expected path — but a ruler is chrome and must never be the thing that
    // throws during a render.
    expect(tickStep(0)).toBe(100);
    expect(tickStep(Number.NaN)).toBe(100);
    expect(tickStep(-1)).toBe(100);
  });
});

describe('ticksFor', () => {
  it('maps world to screen exactly as the camera does', () => {
    // A ruler that disagrees with the canvas about where a coordinate is, is
    // worse than no ruler.
    const ticks = ticksFor(0, 400, 1, 50);
    const first = ticks.find((t) => t.value === 100)!;
    expect(first.offset).toBe(150);
  });

  it('starts at the first mark inside the range, not at the range edge', () => {
    const ticks = ticksFor(37, 400, 1, 0);
    expect(ticks[0].value).toBeGreaterThanOrEqual(37);
    expect(ticks[0].value % (tickStep(1) / 4)).toBeCloseTo(0, 6);
  });

  it('emits minor ticks between the labelled ones', () => {
    // A ruler with only labelled marks is a list of numbers; the minors are
    // what make it readable between them.
    const ticks = ticksFor(0, 400, 1, 0);
    expect(ticks.some((t) => !t.major)).toBe(true);
    expect(ticks.some((t) => t.major)).toBe(true);
  });

  it('marks every multiple of the major step as major', () => {
    const step = tickStep(1);
    const ticks = ticksFor(0, step * 3, 1, 0);
    for (const tick of ticks) {
      const onMajor = Math.abs(tick.value % step) < 1e-6 || Math.abs(Math.abs(tick.value % step) - step) < 1e-6;
      expect(tick.major).toBe(onMajor);
    }
  });

  it('does not lose a label to floating-point drift', () => {
    // `0.1 * 3` is not `0.3`. A major tick failing that comparison loses its
    // label for no reason a reader can see.
    const ticks = ticksFor(0, 5, 800, 0);
    const majors = ticks.filter((t) => t.major);
    expect(majors.length).toBeGreaterThan(1);
  });

  it('handles negative coordinates, which an infinite canvas is half made of', () => {
    const ticks = ticksFor(-400, -100, 1, 0);
    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks.every((t) => t.value >= -400 && t.value <= -100)).toBe(true);
  });

  it('returns nothing rather than hanging on an impossible range', () => {
    expect(ticksFor(0, -1, 1, 0)).toEqual([]);
    expect(ticksFor(0, 100, 0, 0)).toEqual([]);
    // Unbounded tick counts would hang the tab; a coarse ruler is the better
    // failure.
    expect(ticksFor(-1e9, 1e9, 0.0001, 0)).toEqual([]);
  });
});

describe('tickLabel', () => {
  it('shows no decimals for a whole-number step', () => {
    // "400.0" at 25% zoom is noise pretending to be precision.
    expect(tickLabel(400, 100)).toBe('400');
    expect(tickLabel(-50, 10)).toBe('-50');
  });

  it('shows exactly enough decimals for a fractional step', () => {
    expect(tickLabel(12.5, 0.5)).toBe('12.5');
    expect(tickLabel(0.25, 0.05)).toBe('0.25');
  });
});

describe('the canvas dot field', () => {
  /**
   * The grid asks `tickStep` for its spacing rather than scaling a fixed
   * world size by the zoom, and this is why.
   *
   * Scaled, the dots land four pixels apart at 0.2 while still being three
   * pixels across, so the field closes into a flat grey wash — and eighty
   * apart at 4, where it stops reading as a grid. Re-stepping keeps the
   * on-screen pitch inside a band the eye reads as the same texture at every
   * zoom, while each dot still sits on a round world coordinate.
   */
  const DOT_GAP_PX = 20;

  it('holds a readable pitch across the whole zoom range', () => {
    for (const zoom of [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 4, 8]) {
      const pitch = tickStep(zoom, DOT_GAP_PX) * zoom;
      expect(pitch).toBeGreaterThanOrEqual(DOT_GAP_PX);
      expect(pitch).toBeLessThanOrEqual(DOT_GAP_PX * 2.5);
    }
  });

  it('spaces the dots on the same round numbers the ruler marks', () => {
    // 100 world units at quarter zoom, not 80 or 125 — so a dot falls on the
    // ruler's own divisions instead of drifting between them.
    expect(tickStep(0.25, DOT_GAP_PX)).toBe(100);
    expect(tickStep(1, DOT_GAP_PX)).toBe(20);
    expect(tickStep(2, DOT_GAP_PX)).toBe(10);
  });
});
