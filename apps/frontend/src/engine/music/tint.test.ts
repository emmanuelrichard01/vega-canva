import { describe, expect, it } from 'vitest';
import { averageColour, stationTint } from './tint';

describe('tint', () => {
  it('averages opaque mid-tones', () => {
    expect(averageColour([200, 100, 50, 255, 100, 100, 50, 255])).toBe('#966432');
  });
  it('skips transparent, black and white pixels', () => {
    expect(averageColour([0, 0, 0, 255, 255, 255, 255, 255, 90, 90, 90, 0])).toBeNull();
  });
  it('knows station accents and falls back for unknown ones', () => {
    expect(stationTint('lofi')).toBe('#d39a77');
    expect(stationTint('nope')).toBeNull();
  });
});
