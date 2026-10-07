import { describe, expect, it } from 'vitest';
import { barSeconds, barsDue, eventTime, secondsPerBeat, swungBeat, volumeToGain } from './timing';
import { createRng, mixSeed } from './rng';

describe('timing', () => {
  it('converts tempo', () => {
    expect(secondsPerBeat(120)).toBe(0.5);
    expect(barSeconds(60, 4)).toBe(4);
  });

  it('leaves straight time alone', () => {
    for (const b of [0, 0.25, 0.5, 0.75, 1, 2.5]) expect(swungBeat(b, 0.5)).toBeCloseTo(b);
  });

  it('moves the off-beat eighth and keeps sixteenths in order', () => {
    expect(swungBeat(0.5, 0.62)).toBeCloseTo(0.62);
    expect(swungBeat(1, 0.62)).toBeCloseTo(1);
    const points = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((b) => swungBeat(b, 0.66));
    for (let i = 1; i < points.length; i++) expect(points[i]).toBeGreaterThan(points[i - 1]);
  });

  it('places events in seconds from the bar start', () => {
    expect(eventTime(10, 1, 120, 0.5)).toBeCloseTo(10.5);
    expect(eventTime(10, 0.5, 60, 0.6)).toBeCloseTo(10.6);
  });

  it('schedules the bars that start within the lookahead', () => {
    // 120 bpm, 4/4: a bar every 2 s.
    expect(barsDue(10, 9.9, 0.35, 120, 4)).toEqual([10]);
    expect(barsDue(10, 9, 0.35, 120, 4)).toEqual([]);
    expect(barsDue(10, 9.9, 2.5, 120, 4)).toEqual([10, 12]);
    expect(barsDue(10, 9.9, 4.5, 120, 4)).toEqual([10, 12, 14]);
  });

  it('recovers from a stall instead of flooding the past', () => {
    const due = barsDue(10, 60, 0.35, 120, 4);
    expect(due).toHaveLength(1);
    expect(due[0]).toBeGreaterThan(60);
  });

  it('maps volume perceptually', () => {
    expect(volumeToGain(0)).toBe(0);
    expect(volumeToGain(1)).toBe(1);
    expect(volumeToGain(0.5)).toBeCloseTo(0.25);
    expect(volumeToGain(2)).toBe(1);
  });
});

describe('rng', () => {
  it('is deterministic per seed', () => {
    const a = createRng(5);
    const b = createRng(5);
    for (let i = 0; i < 20; i++) expect(a.next()).toBe(b.next());
  });

  it('stays in range', () => {
    const r = createRng(mixSeed(1, 2, 3));
    for (let i = 0; i < 500; i++) {
      const v = r.int(-2, 3);
      expect(v).toBeGreaterThanOrEqual(-2);
      expect(v).toBeLessThanOrEqual(3);
    }
  });

  it('mixes seeds into distinct streams', () => {
    expect(mixSeed(1, 2)).not.toBe(mixSeed(2, 1));
    expect(mixSeed(7, 0)).not.toBe(mixSeed(7, 1));
  });
});
