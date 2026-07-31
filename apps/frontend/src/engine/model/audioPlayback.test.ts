import { describe, expect, it } from 'vitest';
import {
  barCountFor,
  clamp01,
  formatClock,
  fractionFromPointer,
  keyboardSeek,
  normalizeWaveform,
  resampleWaveform,
  resolveDurationMs,
} from './audioPlayback';

describe('formatClock', () => {
  it('formats minutes and padded seconds', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(9_000)).toBe('0:09');
    expect(formatClock(65_000)).toBe('1:05');
    expect(formatClock(600_000)).toBe('10:00');
  });

  it('never renders NaN at the user', () => {
    // What an <audio> element reports before metadata loads.
    expect(formatClock(NaN)).toBe('0:00');
    expect(formatClock(Infinity)).toBe('0:00');
    expect(formatClock(-5)).toBe('0:00');
  });
});

describe('resolveDurationMs', () => {
  it('prefers what the element actually knows', () => {
    expect(resolveDurationMs(4000, 7.5)).toBe(7500);
  });

  it('rescues an uploaded clip whose stored duration is zero', () => {
    // Uploads are created with `durationMs: 0` and nothing fills it in, so
    // these showed 0:00 / 0:00 while audibly playing.
    expect(resolveDurationMs(0, 12)).toBe(12_000);
  });

  it('falls back to the stored value while metadata is still loading', () => {
    expect(resolveDurationMs(4000, NaN)).toBe(4000);
    expect(resolveDurationMs(4000, undefined)).toBe(4000);
    // Streams report Infinity for duration until they end.
    expect(resolveDurationMs(4000, Infinity)).toBe(4000);
  });

  it('is zero when neither source knows', () => {
    expect(resolveDurationMs(0, undefined)).toBe(0);
  });
});

describe('fractionFromPointer', () => {
  it('maps a position across the bar to 0..1', () => {
    expect(fractionFromPointer(100, 100, 200)).toBe(0);
    expect(fractionFromPointer(200, 100, 200)).toBe(0.5);
    expect(fractionFromPointer(300, 100, 200)).toBe(1);
  });

  it('clamps a drag that left the bar', () => {
    expect(fractionFromPointer(-50, 100, 200)).toBe(0);
    expect(fractionFromPointer(9999, 100, 200)).toBe(1);
  });

  it('survives a zero-width bar during layout', () => {
    expect(fractionFromPointer(50, 0, 0)).toBe(0);
  });
});

describe('keyboardSeek', () => {
  it('steps five seconds each way', () => {
    expect(keyboardSeek('ArrowRight', 10, 60)).toBe(15);
    expect(keyboardSeek('ArrowLeft', 10, 60)).toBe(5);
  });

  it('does not run past either end', () => {
    expect(keyboardSeek('ArrowLeft', 2, 60)).toBe(0);
    expect(keyboardSeek('ArrowRight', 58, 60)).toBe(60);
  });

  it('jumps to the ends', () => {
    expect(keyboardSeek('Home', 30, 60)).toBe(0);
    // Just short, so it does not trip `ended` and rewind to the start.
    expect(keyboardSeek('End', 0, 60)).toBeCloseTo(59.99);
  });

  it('ignores keys it does not own, so typing still works', () => {
    expect(keyboardSeek('a', 10, 60)).toBeNull();
    expect(keyboardSeek('Enter', 10, 60)).toBeNull();
  });

  it('does nothing when the duration is unknown', () => {
    expect(keyboardSeek('ArrowRight', 0, 0)).toBeNull();
  });
});

describe('normalizeWaveform', () => {
  it('scales a quiet recording up to a readable shape', () => {
    // Drawn literally these are a flat line that reads as a broken clip.
    const bars = normalizeWaveform([0.02, 0.04, 0.01]);
    expect(Math.max(...bars)).toBe(1);
    expect(bars[0]).toBeCloseTo(0.5);
  });

  it('keeps the relative shape of the recording', () => {
    const bars = normalizeWaveform([1, 0.5, 0.25]);
    expect(bars).toEqual([1, 0.5, 0.25]);
  });

  it('gives a clip with no peaks a neutral bar rather than nothing', () => {
    // Every uploaded file: nothing analyses those.
    expect(normalizeWaveform([], 8)).toEqual(new Array(8).fill(0.35));
  });

  it('handles pure silence without dividing by zero', () => {
    expect(normalizeWaveform([0, 0, 0])).toEqual([0.12, 0.12, 0.12]);
  });

  it('drops junk values', () => {
    expect(normalizeWaveform([NaN, 1, -3, 0.5])).toEqual([1, 0.5]);
  });
});

describe('barCountFor', () => {
  it('fits the waveform inside the width the recorder actually uses', () => {
    // A recorded note is 240px wide and stores 50 peaks. One bar per peak at a
    // 2px floor needs ~198px of waveform in ~134px of space, so it spilled out
    // of the card on every recording.
    const count = barCountFor(240);
    expect(count).toBeLessThan(50);
    expect(count * 3.5).toBeLessThanOrEqual(240 - 116);
  });

  it('gives a wider player more bars', () => {
    expect(barCountFor(400)).toBeGreaterThan(barCountFor(240));
  });

  it('never returns so few that it stops looking like a waveform', () => {
    expect(barCountFor(120)).toBeGreaterThanOrEqual(10);
    expect(barCountFor(0)).toBeGreaterThanOrEqual(10);
    expect(barCountFor(-50)).toBeGreaterThanOrEqual(10);
  });

  it('caps the count on a very wide player', () => {
    expect(barCountFor(5000)).toBeLessThanOrEqual(48);
  });
});

describe('resampleWaveform', () => {
  it('returns exactly the requested number of bars', () => {
    expect(resampleWaveform(Array(50).fill(0.5), 20)).toHaveLength(20);
  });

  it('keeps the peak of each bucket, not the average', () => {
    // Averaging smooths a recording into a mound and loses the transients that
    // make a waveform readable as speech.
    expect(resampleWaveform([0, 0, 1, 0], 2)).toEqual([0, 1]);
  });

  it('leaves a short waveform alone rather than inventing detail', () => {
    expect(resampleWaveform([0.2, 0.4], 10)).toEqual([0.2, 0.4]);
  });

  it('handles empty and degenerate input', () => {
    expect(resampleWaveform([], 10)).toEqual([]);
    expect(resampleWaveform([0.5], 0)).toEqual([]);
  });

  it('covers the whole clip, including the last peak', () => {
    const out = resampleWaveform([0, 0, 0, 0, 0, 0, 0, 0, 0, 1], 5);
    expect(out[out.length - 1]).toBe(1);
  });
});

describe('clamp01', () => {
  it('clamps and rejects NaN', () => {
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(NaN)).toBe(0);
  });
});
