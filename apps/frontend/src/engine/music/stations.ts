/**
 * The built-in stations and the composer that writes their music.
 *
 * Composition is pure: `composeBar` turns (station, session seed, bar index,
 * previous voicing) into note events in beats. The audio engine only performs
 * what this returns, so everything musical here is testable without a sound
 * card, and a seed always replays the same piece.
 */
import { createRng, mixSeed, type Rng } from './rng';
import {
  chordPitchClasses,
  chordRoot,
  degreeToMidi,
  pitchClass,
  scalePitchClasses,
  voiceLead,
  type Key,
} from './theory';

export type StationId = 'ambient' | 'piano' | 'lofi' | 'synth' | 'house' | 'retro';

export type Voice =
  | 'pad'
  | 'pluck'
  | 'piano'
  | 'epiano'
  | 'bass'
  | 'subBass'
  | 'kick'
  | 'snare'
  | 'clap'
  | 'hat'
  | 'openHat'
  | 'arp'
  | 'stab'
  | 'chipLead'
  | 'chipBass'
  | 'chipNoise';

export interface NoteEvent {
  voice: Voice;
  /** Position in the bar, in beats from its start (before swing). */
  beat: number;
  /** Length in beats. */
  dur: number;
  /** MIDI note; absent for unpitched percussion. */
  midi?: number;
  /** 0..1. */
  vel: number;
}

export interface BarPlan {
  events: NoteEvent[];
  /** The chord voicing this bar settled on, carried into the next bar's voice leading. */
  voicing: number[];
  /** Scale degree of the chord, 0-based. */
  degree: number;
}

export interface StationSpec {
  id: StationId;
  name: string;
  /** One line for the player. */
  blurb: string;
  /** Tempo range; a session picks one value from it. */
  bpm: readonly [number, number];
  beatsPerBar: number;
  /** Where the off-beat eighth lands within its beat: 0.5 straight, ~0.62 lazy swing. */
  swing: number;
  keys: readonly Key[];
  /** Chord progressions as scale degrees, one entry per bar. */
  progressions: readonly (readonly number[])[];
  /** Notes per chord (3 triad, 4 seventh, 5 ninth). */
  chordSize: number;
}

export const STATIONS: readonly StationSpec[] = [
  {
    id: 'ambient',
    name: 'Acoustic Ambient',
    blurb: 'Slow pads and soft plucked strings',
    bpm: [58, 66],
    beatsPerBar: 4,
    swing: 0.5,
    keys: [
      { tonic: 2, mode: 'major' },
      { tonic: 7, mode: 'lydian' },
      { tonic: 9, mode: 'major' },
      { tonic: 4, mode: 'minor' },
    ],
    progressions: [
      [0, 0, 3, 3, 5, 5, 4, 4],
      [0, 0, 5, 5, 3, 3, 4, 4],
      [5, 5, 3, 3, 0, 0, 4, 4],
    ],
    chordSize: 4,
  },
  {
    id: 'piano',
    name: 'Peaceful Piano',
    blurb: 'Unhurried chords, played softly',
    bpm: [62, 72],
    beatsPerBar: 4,
    swing: 0.5,
    keys: [
      { tonic: 0, mode: 'major' },
      { tonic: 5, mode: 'major' },
      { tonic: 3, mode: 'major' },
      { tonic: 9, mode: 'minor' },
    ],
    progressions: [
      [0, 4, 5, 3, 0, 4, 3, 4],
      [3, 4, 2, 5, 3, 4, 0, 0],
      [5, 3, 0, 4, 5, 3, 1, 4],
    ],
    chordSize: 4,
  },
  {
    id: 'lofi',
    name: 'Lo-fi',
    blurb: 'Dusty keys and lazy drums',
    bpm: [72, 84],
    beatsPerBar: 4,
    swing: 0.62,
    keys: [
      { tonic: 5, mode: 'major' },
      { tonic: 10, mode: 'major' },
      { tonic: 2, mode: 'dorian' },
      { tonic: 7, mode: 'dorian' },
    ],
    progressions: [
      [1, 4, 0, 0, 1, 4, 0, 5],
      [3, 2, 1, 4, 3, 2, 1, 4],
      [0, 5, 1, 4, 0, 5, 1, 4],
    ],
    chordSize: 5,
  },
  {
    id: 'synth',
    name: 'Synth',
    blurb: 'Arpeggios under a slow filter sweep',
    bpm: [96, 106],
    beatsPerBar: 4,
    swing: 0.5,
    keys: [
      { tonic: 9, mode: 'minor' },
      { tonic: 4, mode: 'minor' },
      { tonic: 0, mode: 'minor' },
      { tonic: 7, mode: 'minor' },
    ],
    progressions: [
      [0, 5, 2, 6, 0, 5, 2, 6],
      [0, 3, 5, 4, 0, 3, 5, 4],
      [5, 6, 0, 0, 5, 6, 4, 4],
    ],
    chordSize: 3,
  },
  {
    id: 'house',
    name: 'House',
    blurb: 'A calm four-on-the-floor',
    bpm: [118, 122],
    beatsPerBar: 4,
    swing: 0.54,
    keys: [
      { tonic: 5, mode: 'minor' },
      { tonic: 8, mode: 'dorian' },
      { tonic: 1, mode: 'minor' },
      { tonic: 10, mode: 'dorian' },
    ],
    progressions: [
      [0, 0, 3, 3, 0, 0, 4, 4],
      [0, 5, 3, 4, 0, 5, 3, 4],
      [0, 6, 5, 6, 0, 6, 5, 4],
    ],
    chordSize: 4,
  },
  {
    id: 'retro',
    name: 'Retro',
    blurb: '8-bit melodies, kept low',
    bpm: [108, 124],
    beatsPerBar: 4,
    swing: 0.5,
    keys: [
      { tonic: 0, mode: 'major' },
      { tonic: 7, mode: 'mixolydian' },
      { tonic: 9, mode: 'minor' },
      { tonic: 2, mode: 'dorian' },
    ],
    progressions: [
      [0, 3, 4, 0, 5, 3, 4, 4],
      [0, 5, 3, 4, 0, 5, 3, 4],
      [5, 3, 0, 4, 5, 3, 1, 4],
    ],
    chordSize: 3,
  },
];

export const stationById = (id: StationId): StationSpec => STATIONS.find((s) => s.id === id) ?? STATIONS[0];

/** What a session fixes for its whole life: key and tempo. */
export interface Session {
  station: StationSpec;
  seed: number;
  key: Key;
  bpm: number;
}

export function createSession(station: StationSpec, seed: number): Session {
  const rng = createRng(mixSeed(seed, 0x5e55));
  const key = rng.pick(station.keys);
  const bpm = rng.int(station.bpm[0], station.bpm[1]);
  return { station, seed, key, bpm };
}

/** Bars per section; each section picks a progression and a texture. */
export const SECTION_BARS = 8;

function sectionOf(session: Session, bar: number) {
  const section = Math.floor(bar / SECTION_BARS);
  const rng = createRng(mixSeed(session.seed, section, 0x5ec7));
  const progression = rng.pick(session.station.progressions);
  // Texture density breathes between sections so the piece does not sit still.
  const density = 0.55 + rng.next() * 0.45;
  return { section, progression, density };
}

export function chordDegreeAt(session: Session, bar: number): number {
  const { progression } = sectionOf(session, bar);
  return progression[bar % SECTION_BARS % progression.length];
}

/** A scale-bound melody line over one bar, mostly stepwise, landing on chord tones on strong beats. */
function melody(
  rng: Rng,
  key: Key,
  chordPcs: readonly number[],
  low: number,
  high: number,
  slots: readonly number[],
  density: number,
  start: number
): { beat: number; midi: number }[] {
  const scale = scalePitchClasses(key);
  const scaleNotes: number[] = [];
  for (let m = low; m <= high; m++) if (scale.includes(pitchClass(m))) scaleNotes.push(m);
  if (scaleNotes.length === 0) return [];
  let idx = scaleNotes.reduce((best, n, i) => (Math.abs(n - start) < Math.abs(scaleNotes[best] - start) ? i : best), 0);
  const out: { beat: number; midi: number }[] = [];
  for (const beat of slots) {
    if (!rng.chance(density)) continue;
    const step = rng.weighted([-2, -1, 0, 1, 2, 3], [1, 4, 1, 4, 1.4, 0.4]);
    idx = Math.max(0, Math.min(scaleNotes.length - 1, idx + step));
    let note = scaleNotes[idx];
    if (Number.isInteger(beat) && beat % 2 === 0) {
      // Strong beats: nearest chord tone.
      let bestI = idx;
      for (let d = 0; d <= 3; d++) {
        for (const j of [idx - d, idx + d]) {
          if (j >= 0 && j < scaleNotes.length && chordPcs.includes(pitchClass(scaleNotes[j]))) {
            bestI = j;
            d = 4;
            break;
          }
        }
      }
      idx = bestI;
      note = scaleNotes[idx];
    }
    out.push({ beat, midi: note });
  }
  return out;
}

const range = (from: number, to: number, step: number) => {
  const out: number[] = [];
  for (let b = from; b < to - 1e-9; b += step) out.push(Math.round(b * 1000) / 1000);
  return out;
};

/**
 * Compose one bar.
 *
 * `previous` is the prior bar's voicing, so chords move by the smallest steps
 * the voicing allows. The result depends only on its arguments.
 */
export function composeBar(session: Session, bar: number, previous: readonly number[] | null): BarPlan {
  const { station, key } = session;
  const { density } = sectionOf(session, bar);
  const degree = chordDegreeAt(session, bar);
  const rng = createRng(mixSeed(session.seed, bar, 0xba7));
  const pcs = chordPitchClasses(key, degree, station.chordSize);
  const triad = pcs.slice(0, 3);
  const B = station.beatsPerBar;
  const events: NoteEvent[] = [];
  const nextDegree = chordDegreeAt(session, bar + 1);
  const changes = nextDegree !== degree;

  switch (station.id) {
    case 'ambient': {
      const voicing = voiceLead(pcs, previous, 4, 50, 74);
      // Pads overlap into the next bar so changes crossfade rather than cut.
      for (const m of voicing) events.push({ voice: 'pad', beat: 0, dur: B + 1.5, midi: m, vel: 0.5 });
      events.push({ voice: 'bass', beat: 0, dur: B, midi: chordRoot(key, degree, 38), vel: 0.35 });
      const line = melody(rng, key, pcs, 62, 86, range(0, B, 0.5), 0.28 * density, voicing[voicing.length - 1] + 5);
      for (const n of line) events.push({ voice: 'pluck', beat: n.beat, dur: 2, midi: n.midi, vel: 0.35 + rng.next() * 0.25 });
      return { events, voicing, degree };
    }
    case 'piano': {
      const voicing = voiceLead(pcs, previous, 4, 55, 72);
      const root = chordRoot(key, degree, 36);
      events.push({ voice: 'piano', beat: 0, dur: B, midi: root, vel: 0.5 });
      events.push({ voice: 'piano', beat: 2, dur: 2, midi: root + 7, vel: 0.32 });
      // A broken chord, rolled upwards, with breathing room.
      const roll = rng.chance(0.5);
      voicing.forEach((m, i) => {
        const beat = roll ? i * 0.5 : [0.5, 1, 1.5, 2.5][i % 4];
        events.push({ voice: 'piano', beat, dur: B - beat + 0.5, midi: m, vel: 0.28 + rng.next() * 0.12 });
      });
      const line = melody(rng, key, pcs, 67, 84, [0, 1, 1.5, 2, 3, 3.5], 0.4 * density, voicing[voicing.length - 1] + 3);
      for (const n of line) events.push({ voice: 'piano', beat: n.beat, dur: 1.5, midi: n.midi, vel: 0.36 + rng.next() * 0.14 });
      return { events, voicing, degree };
    }
    case 'lofi': {
      const voicing = voiceLead(pcs, previous, 5, 53, 76);
      const anticipate = changes && rng.chance(0.45);
      for (const m of voicing) events.push({ voice: 'epiano', beat: 0, dur: anticipate ? 3.4 : B, midi: m, vel: 0.36 });
      if (anticipate) {
        const next = voiceLead(chordPitchClasses(key, nextDegree, station.chordSize), voicing, 5, 53, 76);
        for (const m of next) events.push({ voice: 'epiano', beat: 3.5, dur: 1, midi: m, vel: 0.3 });
      }
      const root = chordRoot(key, degree, 36);
      events.push({ voice: 'bass', beat: 0, dur: 1.4, midi: root, vel: 0.55 });
      events.push({ voice: 'bass', beat: 2.5, dur: 1, midi: rng.chance(0.5) ? root : root + 7, vel: 0.45 });
      events.push({ voice: 'kick', beat: 0, dur: 0.5, vel: 0.7 });
      events.push({ voice: 'kick', beat: 2.5, dur: 0.5, vel: 0.55 });
      if (rng.chance(0.35)) events.push({ voice: 'kick', beat: 1.75, dur: 0.5, vel: 0.4 });
      events.push({ voice: 'snare', beat: 1, dur: 0.5, vel: 0.45 });
      events.push({ voice: 'snare', beat: 3, dur: 0.5, vel: 0.45 });
      for (const beat of range(0, B, 0.5)) {
        if (rng.chance(0.92)) events.push({ voice: 'hat', beat, dur: 0.25, vel: (Number.isInteger(beat) ? 0.3 : 0.18) + rng.next() * 0.08 });
      }
      return { events, voicing, degree };
    }
    case 'synth': {
      const voicing = voiceLead(triad, previous, 3, 55, 70);
      for (const m of voicing) events.push({ voice: 'pad', beat: 0, dur: B + 0.5, midi: m, vel: 0.28 });
      const arpNotes = [...voicing, voicing[0] + 12, voicing[1] + 12];
      const pattern = rng.pick([
        [0, 1, 2, 3, 4, 3, 2, 1],
        [0, 2, 1, 3, 2, 4, 3, 1],
        [0, 1, 2, 4, 3, 2, 1, 2],
      ]);
      range(0, B, 0.25).forEach((beat, i) => {
        const note = arpNotes[pattern[i % pattern.length]];
        events.push({ voice: 'arp', beat, dur: 0.22, midi: note, vel: i % 4 === 0 ? 0.42 : 0.3 });
      });
      const root = chordRoot(key, degree, 33);
      for (const beat of range(0, B, 0.5)) events.push({ voice: 'subBass', beat, dur: 0.45, midi: root, vel: Number.isInteger(beat) ? 0.5 : 0.36 });
      events.push({ voice: 'kick', beat: 0, dur: 0.5, vel: 0.5 });
      events.push({ voice: 'kick', beat: 2, dur: 0.5, vel: 0.5 });
      events.push({ voice: 'snare', beat: 1, dur: 0.5, vel: 0.3 });
      events.push({ voice: 'snare', beat: 3, dur: 0.5, vel: 0.3 });
      return { events, voicing, degree };
    }
    case 'house': {
      const voicing = voiceLead(pcs, previous, 4, 57, 74);
      for (let b = 0; b < B; b++) events.push({ voice: 'kick', beat: b, dur: 0.5, vel: 0.62 });
      events.push({ voice: 'clap', beat: 1, dur: 0.5, vel: 0.36 });
      events.push({ voice: 'clap', beat: 3, dur: 0.5, vel: 0.36 });
      for (const beat of range(0.5, B, 1)) events.push({ voice: 'openHat', beat, dur: 0.4, vel: 0.22 });
      for (const beat of range(0, B, 0.25)) {
        if (beat % 0.5 !== 0 && rng.chance(0.6 * density)) events.push({ voice: 'hat', beat, dur: 0.12, vel: 0.1 + rng.next() * 0.06 });
      }
      const stabBeats = rng.pick([
        [0.5, 1.5, 2.5, 3.5],
        [0.5, 1.75, 2.5],
        [0.75, 2.5, 3.25],
      ]);
      for (const beat of stabBeats) for (const m of voicing) events.push({ voice: 'stab', beat, dur: 0.35, midi: m, vel: 0.26 });
      const root = chordRoot(key, degree, 33);
      for (const beat of range(0.5, B, 1)) events.push({ voice: 'bass', beat, dur: 0.4, midi: root, vel: 0.5 });
      return { events, voicing, degree };
    }
    case 'retro': {
      const voicing = voiceLead(triad, previous, 3, 55, 72);
      const root = chordRoot(key, degree, 36);
      range(0, B, 0.5).forEach((beat, i) => {
        events.push({ voice: 'chipBass', beat, dur: 0.42, midi: i % 2 === 0 ? root : root + 7, vel: 0.4 });
        events.push({ voice: 'chipNoise', beat, dur: 0.06, vel: i % 2 === 0 ? 0.2 : 0.12 });
      });
      const line = melody(
        rng,
        key,
        triad,
        67,
        88,
        range(0, B, 0.5),
        0.62 * density,
        degreeToMidi(key, 72 + key.tonic - (key.tonic > 6 ? 12 : 0), 2)
      );
      for (const n of line) events.push({ voice: 'chipLead', beat: n.beat, dur: 0.45, midi: n.midi, vel: 0.32 });
      return { events, voicing, degree };
    }
  }
}
