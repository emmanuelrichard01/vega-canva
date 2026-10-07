import { describe, expect, it } from 'vitest';
import { chordPitchClasses, degreeToMidi, inScale, midiToHz, pitchClass, scalePitchClasses, voiceLead, voiceMovement, type Key } from './theory';

const C_MAJOR: Key = { tonic: 0, mode: 'major' };
const A_MINOR: Key = { tonic: 9, mode: 'minor' };

describe('scales and chords', () => {
  it('spells the modes', () => {
    expect(scalePitchClasses(C_MAJOR)).toEqual([0, 2, 4, 5, 7, 9, 11]);
    expect(scalePitchClasses(A_MINOR)).toEqual([9, 11, 0, 2, 4, 5, 7]);
    expect(scalePitchClasses({ tonic: 2, mode: 'dorian' })).toEqual([2, 4, 5, 7, 9, 11, 0]);
  });

  it('builds diatonic chords in thirds', () => {
    expect(chordPitchClasses(C_MAJOR, 0, 3)).toEqual([0, 4, 7]); // C
    expect(chordPitchClasses(C_MAJOR, 4, 4)).toEqual([7, 11, 2, 5]); // G7
    expect(chordPitchClasses(C_MAJOR, 1, 4)).toEqual([2, 5, 9, 0]); // Dm7
    expect(chordPitchClasses(A_MINOR, 0, 3)).toEqual([9, 0, 4]); // Am
  });

  it('wraps scale degrees across octaves', () => {
    expect(degreeToMidi(C_MAJOR, 60, 7)).toBe(72);
    expect(degreeToMidi(C_MAJOR, 60, -1)).toBe(59);
  });

  it('tunes A4 to 440', () => {
    expect(midiToHz(69)).toBeCloseTo(440);
    expect(midiToHz(81)).toBeCloseTo(880);
  });

  it('checks scale membership', () => {
    expect(inScale(61, C_MAJOR)).toBe(false);
    expect(inScale(62, C_MAJOR)).toBe(true);
  });
});

describe('voiceLead', () => {
  it('keeps every voice in range and covers the chord', () => {
    const pcs = chordPitchClasses(C_MAJOR, 0, 4);
    const v = voiceLead(pcs, null, 4, 52, 76);
    expect(v).toHaveLength(4);
    for (const m of v) {
      expect(m).toBeGreaterThanOrEqual(52);
      expect(m).toBeLessThanOrEqual(76);
      expect(pcs).toContain(pitchClass(m));
    }
    expect(new Set(v.map(pitchClass)).size).toBe(4);
  });

  it('moves by small steps through a ii–V–I', () => {
    const prog = [1, 4, 0, 5, 1, 4, 0];
    let prev: number[] | null = null;
    for (const degree of prog) {
      const next = voiceLead(chordPitchClasses(C_MAJOR, degree, 4), prev, 4, 52, 76);
      if (prev) {
        // Four voices moving to the nearest chord tones never need more than about a fourth each.
        expect(voiceMovement(prev, next)).toBeLessThanOrEqual(4 * 5);
      }
      prev = next;
    }
  });

  it('leads more smoothly than restarting from close position each bar', () => {
    const prog = [0, 5, 3, 4, 0, 5, 3, 4];
    let led: number[] | null = null;
    let restarted: number[] | null = null;
    let ledTotal = 0;
    let restartTotal = 0;
    for (const degree of prog) {
      const pcs = chordPitchClasses(C_MAJOR, degree, 4);
      const a = voiceLead(pcs, led, 4, 52, 76);
      const b = voiceLead(pcs, null, 4, 52, 76);
      if (led) ledTotal += voiceMovement(led, a);
      if (restarted) restartTotal += voiceMovement(restarted, b);
      led = a;
      restarted = b;
    }
    expect(ledTotal).toBeLessThan(restartTotal);
  });
});
