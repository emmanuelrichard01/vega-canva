/**
 * Crossfade lengths for library playback. Pure.
 *
 * Equal-power curves keep the perceived loudness steady through the overlap,
 * where a linear fade dips in the middle. The curves themselves and their
 * timing live in `gapless.ts`.
 */

/** Between two different tracks: long enough to blend, beat-agnostic. */
export const TRACK_FADE = 5;
/** A track looping into its own start. */
export const LOOP_FADE = 3;
/** A person pressing Next, Previous or a track in the list. */
export const SKIP_FADE = 1.2;
export const DEFAULT_CROSSFADE = TRACK_FADE;
/** No fade is longer than a third of the shorter track. */
const MAX_FRACTION = 1 / 3;

export function equalPowerGains(progress: number): { out: number; in: number } {
  const p = Math.min(1, Math.max(0, progress));
  return { out: Math.cos((p * Math.PI) / 2), in: Math.sin((p * Math.PI) / 2) };
}

/** The fade length for a pair of tracks. */
export function fadeLength(outgoing: number, incoming: number, preferred = DEFAULT_CROSSFADE): number {
  const limit = Math.min(outgoing, incoming) * MAX_FRACTION;
  return Math.max(0, Math.min(preferred, limit));
}

/**
 * How far ahead of a transition's start it is committed to the audio clock.
 * Long enough that a hidden tab, whose timers may fire once a second or less,
 * still lands the fade; `cancelPending` undoes it if the queue changes.
 */
export const SCHEDULE_LEAD = 12;
/** When the next track is still not ready this close to the start, the current one loops instead. */
export const FALLBACK_LEAD = 3;
/** The next track is decoded once its transition is this close, not when the current one starts. */
export const DECODE_LEAD = 30;

/**
 * What to do about the transition out of the current track, `untilStart`
 * seconds before it begins: `wait`, `commit` to the next track, or `loop` the
 * current one because the next is not ready.
 */
export function transitionStep(untilStart: number, nextReady: boolean): 'wait' | 'commit' | 'loop' {
  if (untilStart > SCHEDULE_LEAD) return 'wait';
  if (nextReady) return 'commit';
  return untilStart <= FALLBACK_LEAD ? 'loop' : 'wait';
}
