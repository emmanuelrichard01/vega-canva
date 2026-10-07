import { describe, expect, it } from 'vitest';
import { STATIONS, SECTION_BARS, chordDegreeAt, composeBar, createSession } from './stations';
import { chordPitchClasses, inScale, pitchClass, voiceMovement } from './theory';
import { variationTitle, keyName } from './describe';

const PITCHED_CHORD_VOICES = new Set(['pad', 'epiano', 'stab']);
const MELODY_VOICES = new Set(['pluck', 'chipLead']);

const compose = (stationIndex: number, seed: number, bars: number) => {
  const session = createSession(STATIONS[stationIndex], seed);
  const plans = [];
  let prev: number[] | null = null;
  for (let bar = 0; bar < bars; bar++) {
    const plan = composeBar(session, bar, prev);
    plans.push(plan);
    prev = plan.voicing;
  }
  return { session, plans };
};

describe('stations', () => {
  it('covers the six categories', () => {
    expect(STATIONS.map((s) => s.name)).toEqual(['Acoustic Ambient', 'Peaceful Piano', 'Lo-fi', 'Synth', 'House', 'Retro']);
  });

  it.each(STATIONS.map((s, i) => [s.id, i] as const))('%s is deterministic for a seed', (_id, i) => {
    const a = compose(i, 12345, 16);
    const b = compose(i, 12345, 16);
    expect(JSON.stringify(a.plans)).toBe(JSON.stringify(b.plans));
    expect(a.session.key).toEqual(b.session.key);
    expect(a.session.bpm).toBe(b.session.bpm);
  });

  it.each(STATIONS.map((s, i) => [s.id, i] as const))('%s varies with the seed', (_id, i) => {
    const outputs = new Set<string>();
    for (const seed of [1, 2, 3, 4, 5, 6]) outputs.add(JSON.stringify(compose(i, seed, 8).plans));
    expect(outputs.size).toBeGreaterThan(1);
  });

  it.each(STATIONS.map((s, i) => [s.id, i] as const))('%s stays in tempo range and in the bar', (_id, i) => {
    for (const seed of [7, 99, 2024]) {
      const { session, plans } = compose(i, seed, SECTION_BARS * 3);
      expect(session.bpm).toBeGreaterThanOrEqual(session.station.bpm[0]);
      expect(session.bpm).toBeLessThanOrEqual(session.station.bpm[1]);
      for (const plan of plans) {
        for (const ev of plan.events) {
          expect(ev.beat).toBeGreaterThanOrEqual(0);
          expect(ev.beat).toBeLessThan(session.station.beatsPerBar);
          expect(ev.dur).toBeGreaterThan(0);
          expect(ev.vel).toBeGreaterThan(0);
          expect(ev.vel).toBeLessThanOrEqual(1);
          if (ev.midi != null) {
            expect(ev.midi).toBeGreaterThanOrEqual(24);
            expect(ev.midi).toBeLessThanOrEqual(100);
          }
        }
      }
    }
  });

  it.each(STATIONS.map((s, i) => [s.id, i] as const))('%s plays chord tones and in-key melodies', (_id, i) => {
    for (const seed of [3, 31, 314]) {
      const { session, plans } = compose(i, seed, SECTION_BARS * 2);
      plans.forEach((plan, bar) => {
        const chord = chordPitchClasses(session.key, chordDegreeAt(session, bar), session.station.chordSize);
        const next = chordPitchClasses(session.key, chordDegreeAt(session, bar + 1), session.station.chordSize);
        for (const ev of plan.events) {
          if (ev.midi == null) continue;
          if (PITCHED_CHORD_VOICES.has(ev.voice)) {
            // Lo-fi anticipates the next chord on the last off-beat.
            const allowed = ev.beat >= 3.5 ? [...chord, ...next] : chord;
            expect(allowed).toContain(pitchClass(ev.midi));
          }
          if (MELODY_VOICES.has(ev.voice)) expect(inScale(ev.midi, session.key)).toBe(true);
        }
        for (const m of plan.voicing) {
          const pcs = session.station.chordSize <= 3 ? chord.slice(0, 3) : chord;
          expect(pcs).toContain(pitchClass(m));
        }
      });
    }
  });

  it.each(STATIONS.map((s, i) => [s.id, i] as const))('%s voice-leads its chords smoothly', (_id, i) => {
    const { plans } = compose(i, 777, SECTION_BARS * 2);
    for (let b = 1; b < plans.length; b++) {
      const voices = plans[b].voicing.length;
      // On average no voice leaps more than a fifth between bars.
      expect(voiceMovement(plans[b - 1].voicing, plans[b].voicing) / voices).toBeLessThanOrEqual(7);
    }
  });

  it('changes progression only on section boundaries', () => {
    const session = createSession(STATIONS[1], 42);
    const sectionA = Array.from({ length: SECTION_BARS }, (_, b) => chordDegreeAt(session, b));
    const again = Array.from({ length: SECTION_BARS }, (_, b) => chordDegreeAt(session, b));
    expect(again).toEqual(sectionA);
  });
});

describe('describe', () => {
  it('titles variations stably', () => {
    expect(variationTitle('lofi', 9)).toBe(variationTitle('lofi', 9));
    expect(variationTitle('lofi', 9).split(' ')).toHaveLength(2);
  });

  it('spells keys conventionally', () => {
    expect(keyName({ tonic: 10, mode: 'major' })).toBe('B♭ major');
    expect(keyName({ tonic: 6, mode: 'minor' })).toBe('F♯ minor');
    expect(keyName({ tonic: 2, mode: 'dorian' })).toBe('D Dorian');
  });
});
