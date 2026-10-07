import { describe, expect, it } from 'vitest';
import { PX_PER_STEP, scrubRate, scrubValue, stepPrecision } from './scrub';

describe('scrubValue', () => {
  it('moves one step per two pixels', () => {
    expect(PX_PER_STEP).toBe(2);
    expect(scrubValue(10, 0, {})).toBe(10);
    expect(scrubValue(10, 1, {})).toBe(10);
    expect(scrubValue(10, 2, {})).toBe(11);
    expect(scrubValue(10, 20, {})).toBe(20);
    expect(scrubValue(10, -20, {})).toBe(0);
  });

  it('takes ten steps per unit with Shift', () => {
    expect(scrubValue(0, 20, { shift: true })).toBe(100);
    expect(scrubValue(0, -4, { shift: true })).toBe(-20);
  });

  it('takes a tenth of a step with Alt, keeping the decimal', () => {
    expect(scrubValue(0, 20, { alt: true })).toBe(1);
    expect(scrubValue(5, 6, { alt: true })).toBe(5.3);
  });

  it('respects the step size', () => {
    expect(scrubValue(0, 10, {}, { step: 15 })).toBe(75);
    expect(scrubValue(0, 4, {}, { step: 0.5 })).toBe(1);
  });

  it('clamps to the field bounds', () => {
    expect(scrubValue(95, 40, {}, { max: 100 })).toBe(100);
    expect(scrubValue(3, -40, {}, { min: 0 })).toBe(0);
  });

  it('applies the current modifier to the whole travel, without a jump', () => {
    // Pressing Shift mid-drag changes the rate from the press, not from a new origin.
    const dx = 8;
    expect(scrubValue(0, dx, {})).toBe(4);
    expect(scrubValue(0, dx, { shift: true })).toBe(40);
  });
});

describe('scrub helpers', () => {
  it('derives precision from the step', () => {
    expect(stepPrecision(1)).toBe(0);
    expect(stepPrecision(0.5)).toBe(1);
    expect(stepPrecision(0.01)).toBe(2);
  });
  it('scales the rate by modifier', () => {
    expect(scrubRate(1, {})).toBe(1);
    expect(scrubRate(1, { shift: true })).toBe(10);
    expect(scrubRate(1, { alt: true })).toBe(0.1);
  });
});
