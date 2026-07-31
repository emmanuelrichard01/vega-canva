/**
 * The arithmetic behind a voice-note player.
 *
 * Pure, and separate from the player component, because every one of these is
 * an off-by-one waiting to happen at a boundary nobody clicks by hand: the
 * first pixel of the waveform, the last, a clip whose duration was never
 * recorded, a keyboard seek past the end.
 */

/**
 * `m:ss`. Anything not a real, positive number reads as `0:00` rather than
 * `NaN:aN` — which is what an audio element reports before its metadata
 * arrives, and what an uploaded clip with no stored duration reports forever.
 */
export function formatClock(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0:00';
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = (total % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

/**
 * How long the clip really is, in milliseconds.
 *
 * The stored `durationMs` is written by the recorder — but **uploaded** audio
 * is created with `durationMs: 0` and nothing ever fills it in, so those clips
 * showed `0:00 / 0:00` while plainly playing, and their progress bar could
 * never move because every position divided by zero. The element knows the
 * truth once it has metadata; prefer it, and fall back to the stored value
 * while it is still loading.
 */
export function resolveDurationMs(storedMs: number, elementSeconds: number | undefined): number {
  if (Number.isFinite(elementSeconds) && (elementSeconds as number) > 0) {
    return (elementSeconds as number) * 1000;
  }
  return Number.isFinite(storedMs) && storedMs > 0 ? storedMs : 0;
}

/** Clamp to the unit interval; `NaN` becomes 0. */
export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Where along the clip a pointer at `clientX` is, as a fraction.
 *
 * Clamped, because a drag that started on the waveform continues to deliver
 * coordinates far outside it — releasing to the left of the bar should mean
 * "the start", not a negative time the element silently rejects.
 */
export function fractionFromPointer(clientX: number, left: number, width: number): number {
  if (!(width > 0)) return 0;
  return clamp01((clientX - left) / width);
}

/**
 * The time a keyboard seek should land on, or `null` for keys we do not own.
 *
 * Arrows step five seconds, Home and End go to the ends — matching the native
 * `<audio>` element people already know, and making the scrubber usable
 * without a pointer at all. It was a row of `<div>`s before, reachable by
 * nobody.
 */
export function keyboardSeek(
  key: string,
  currentSeconds: number,
  durationSeconds: number,
  step = 5
): number | null {
  if (!(durationSeconds > 0)) return null;
  const clamp = (t: number) => Math.min(durationSeconds, Math.max(0, t));
  switch (key) {
    case 'ArrowRight':
    case 'ArrowUp':
      return clamp(currentSeconds + step);
    case 'ArrowLeft':
    case 'ArrowDown':
      return clamp(currentSeconds - step);
    case 'Home':
      return 0;
    case 'End':
      // A hair short of the end: seeking exactly to `duration` fires `ended`
      // on some browsers and immediately resets, so "End" would look like
      // "start over".
      return Math.max(0, durationSeconds - 0.01);
    default:
      return null;
  }
}

/**
 * Normalise recorded peaks for display.
 *
 * A quiet recording is all small numbers, and drawn literally it is a flat
 * line that looks like a broken clip. Scaling to the loudest peak makes every
 * note legible while keeping its own shape. A clip with no peaks at all —
 * every upload, since nothing analyses those — gets a neutral bar rather than
 * nothing.
 */
/**
 * How many bars actually fit inside a player of this width.
 *
 * The recorder stores **50** peaks and creates a **240px** node. Rendered one
 * bar per peak at a 2px floor with 2px gaps, that needs 198px of waveform —
 * inside a card that has about 134px to give once the play button, the speed
 * control and the padding have taken theirs. Flex cannot shrink below a
 * minimum width, so the waveform simply ran out of the card. Every real
 * recording, every time.
 *
 * Deriving the count from the width instead means the waveform is always a
 * shape that fits, at any size the node is resized to.
 */
export function barCountFor(playerWidth: number): number {
  /** Play button, speed control, padding and gaps. */
  const CHROME = 116;
  /** Bar plus its gap. */
  const PER_BAR = 3.5;
  const available = playerWidth - CHROME;
  if (!(available > 0)) return MIN_BARS;
  return Math.max(MIN_BARS, Math.min(MAX_BARS, Math.floor(available / PER_BAR)));
}

const MIN_BARS = 10;
const MAX_BARS = 48;

/**
 * Resample peaks to exactly `count` bars, keeping the loudest of each bucket.
 *
 * The peak, not the average: averaging flattens a recording into a smooth
 * mound and loses the transients that make a waveform recognisable as speech.
 * This is what every audio editor does when it zooms out.
 */
export function resampleWaveform(peaks: number[], count: number): number[] {
  if (count <= 0) return [];
  if (peaks.length === 0) return [];
  if (peaks.length <= count) return peaks;

  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const start = Math.floor((i * peaks.length) / count);
    const end = Math.max(start + 1, Math.floor(((i + 1) * peaks.length) / count));
    let loudest = 0;
    for (let j = start; j < end && j < peaks.length; j++) {
      if (peaks[j] > loudest) loudest = peaks[j];
    }
    out.push(loudest);
  }
  return out;
}

export function normalizeWaveform(peaks: number[], bars = 40): number[] {
  const usable = peaks.filter((p) => Number.isFinite(p) && p >= 0);
  if (usable.length === 0) return new Array(bars).fill(0.35);

  const loudest = Math.max(...usable);
  if (!(loudest > 0)) return new Array(usable.length).fill(0.12);
  return usable.map((p) => clamp01(p / loudest));
}
