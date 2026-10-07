/**
 * Music theory the stations compose with: scales, diatonic chords and voice
 * leading. Pure functions over MIDI note numbers.
 */

export type Mode = 'major' | 'minor' | 'dorian' | 'mixolydian' | 'lydian';

const MODE_STEPS: Record<Mode, readonly number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
};

export interface Key {
  /** Pitch class of the tonic, 0 = C. */
  tonic: number;
  mode: Mode;
}

export const midiToHz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

export const pitchClass = (midi: number) => ((midi % 12) + 12) % 12;

/** Pitch classes of the key's scale, tonic first. */
export function scalePitchClasses(key: Key): number[] {
  return MODE_STEPS[key.mode].map((s) => (key.tonic + s) % 12);
}

export function inScale(midi: number, key: Key): boolean {
  return scalePitchClasses(key).includes(pitchClass(midi));
}

/** The scale degree `degree` (0-based, may exceed 6 or go negative) as MIDI, counting up from `tonicMidi`. */
export function degreeToMidi(key: Key, tonicMidi: number, degree: number): number {
  const steps = MODE_STEPS[key.mode];
  const octave = Math.floor(degree / 7);
  const idx = ((degree % 7) + 7) % 7;
  return tonicMidi + octave * 12 + steps[idx];
}

/**
 * A diatonic chord built in thirds on a scale degree.
 *
 * `size` 3 is a triad, 4 a seventh, 5 adds the ninth. Returned as pitch
 * classes, root first.
 */
export function chordPitchClasses(key: Key, degree: number, size = 4): number[] {
  const tonicMidi = 60 + key.tonic;
  const out: number[] = [];
  for (let i = 0; i < size; i++) out.push(pitchClass(degreeToMidi(key, tonicMidi, degree + i * 2)));
  return out;
}

/** The chord's root as MIDI in the octave starting at `low`. */
export function chordRoot(key: Key, degree: number, low: number): number {
  const pc = chordPitchClasses(key, degree, 1)[0];
  let m = low - pitchClass(low) + pc;
  if (m < low) m += 12;
  return m;
}

/** Every MIDI note in [low, high] whose pitch class is in `pcs`. */
function candidates(pcs: readonly number[], low: number, high: number): number[] {
  const out: number[] = [];
  for (let m = low; m <= high; m++) if (pcs.includes(pitchClass(m))) out.push(m);
  return out;
}

/**
 * Voices `pcs` as `voices` notes within [low, high], as close as possible to
 * `previous` (smooth voice leading).
 *
 * Every pitch class is used at least once while there are voices to spare;
 * the total semitone movement from the previous voicing is minimised over a
 * bounded search, and ties prefer the more open voicing. With no previous
 * voicing the result is a close position centred in the range.
 */
export function voiceLead(
  pcs: readonly number[],
  previous: readonly number[] | null,
  voices: number,
  low: number,
  high: number
): number[] {
  const pool = candidates(pcs, low, high);
  if (pool.length === 0) return [];
  const target = previous && previous.length > 0 ? [...previous].sort((a, b) => a - b) : null;
  const centre = (low + high) / 2;

  let best: number[] | null = null;
  let bestCost = Infinity;
  const chosen: number[] = [];

  const cost = (notes: number[]) => {
    const sorted = [...notes].sort((a, b) => a - b);
    const covered = new Set(sorted.map(pitchClass));
    const missing = pcs.slice(0, Math.min(pcs.length, voices)).filter((pc) => !covered.has(pc)).length;
    let move = 0;
    if (target) {
      for (let i = 0; i < sorted.length; i++) move += Math.abs(sorted[i] - target[Math.min(i, target.length - 1)]);
    } else {
      const mean = sorted.reduce((s, n) => s + n, 0) / sorted.length;
      move = Math.abs(mean - centre) * sorted.length * 0.5;
    }
    // Clusters of seconds in the low register are muddy; a small penalty keeps them out.
    let mud = 0;
    for (let i = 1; i < sorted.length; i++) if (sorted[i] - sorted[i - 1] < 3 && sorted[i] < 55) mud += 2;
    return missing * 100 + move + mud;
  };

  const search = (start: number) => {
    if (chosen.length === voices) {
      const c = cost(chosen);
      if (c < bestCost) {
        bestCost = c;
        best = [...chosen];
      }
      return;
    }
    for (let i = start; i < pool.length; i++) {
      // Voices sit within an octave and a fifth of the lowest, which bounds the search.
      if (chosen.length > 0 && pool[i] - chosen[0] > 19) break;
      chosen.push(pool[i]);
      search(i + 1);
      chosen.pop();
    }
  };
  search(0);
  return best ?? pool.slice(0, voices);
}

/** Total semitone distance between two voicings, voice by voice. */
export function voiceMovement(a: readonly number[], b: readonly number[]): number {
  const x = [...a].sort((p, q) => p - q);
  const y = [...b].sort((p, q) => p - q);
  let sum = 0;
  for (let i = 0; i < Math.min(x.length, y.length); i++) sum += Math.abs(x[i] - y[i]);
  return sum;
}
