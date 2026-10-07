/**
 * Crossfade maths for library playback. Pure.
 *
 * Equal-power curves keep the perceived loudness steady through the overlap,
 * where a linear fade dips in the middle.
 */

export const DEFAULT_CROSSFADE = 6;
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

/** When, in the outgoing track's own time, the fade into the next one starts. */
export function fadeStart(outgoing: number, fade: number): number {
  return Math.max(0, outgoing - fade);
}

/**
 * Both decks' gains at `elapsed` seconds into a fade of `length`, scaled by
 * the master volume. A zero-length fade is an instant cut.
 */
export function deckGains(elapsed: number, length: number, volume: number): { out: number; in: number } {
  if (length <= 0) return { out: 0, in: volume };
  const g = equalPowerGains(elapsed / length);
  return { out: g.out * volume, in: g.in * volume };
}
