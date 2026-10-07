/**
 * Timing maths for the lookahead scheduler. Pure; seconds and beats only.
 */

export const secondsPerBeat = (bpm: number) => 60 / bpm;

export const barSeconds = (bpm: number, beatsPerBar: number) => secondsPerBeat(bpm) * beatsPerBar;

/**
 * Where a position in beats lands in time, with swing.
 *
 * Swing moves the off-beat eighth (fraction 0.5 of a beat) to `swing`, and
 * stretches the rest of the beat piecewise-linearly around it, so sixteenths
 * stay in order: 0 → 0, 0.5 → swing, 1 → 1.
 */
export function swungBeat(beat: number, swing: number): number {
  const whole = Math.floor(beat);
  const f = beat - whole;
  const s = Math.min(0.75, Math.max(0.5, swing));
  const mapped = f < 0.5 ? (f / 0.5) * s : s + ((f - 0.5) / 0.5) * (1 - s);
  return whole + mapped;
}

export function eventTime(barStart: number, beat: number, bpm: number, swing: number): number {
  return barStart + swungBeat(beat, swing) * secondsPerBeat(bpm);
}

/**
 * Which bars must be scheduled now: every bar starting before
 * `now + lookahead`, beginning with the next unscheduled one.
 *
 * Returns their start times; the caller schedules each and advances.
 */
export function barsDue(nextBarStart: number, now: number, lookahead: number, bpm: number, beatsPerBar: number): number[] {
  const out: number[] = [];
  const len = barSeconds(bpm, beatsPerBar);
  let t = nextBarStart;
  // A long stall (a suspended tab) must not schedule a flood of bars in the past.
  if (t < now - len) t = now + 0.05;
  while (t < now + lookahead && out.length < 8) {
    out.push(t);
    t += len;
  }
  return out;
}

/** Perceptual volume: a slider position in [0, 1] to a gain. */
export const volumeToGain = (v: number) => {
  const c = Math.min(1, Math.max(0, v));
  return c * c;
};
