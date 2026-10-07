/**
 * Seek and clock arithmetic shared by every source's controls. Pure.
 */

/** Seconds a Left or Right key moves the playhead; Shift takes a larger step. */
export const SEEK_STEP = 5;
export const SEEK_STEP_LARGE = 15;

export const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));

/** A position kept inside the track. An unknown length (0) still allows a forward position. */
export function clampSeek(seconds: number, duration: number): number {
  if (!Number.isFinite(seconds)) return 0;
  return duration > 0 ? clamp(seconds, 0, duration) : Math.max(0, seconds);
}

/** The position a pointer at `x` selects on a track spanning `left` to `left + width`. */
export function seekFromPointer(x: number, left: number, width: number, duration: number): number {
  if (width <= 0 || duration <= 0) return 0;
  return clampSeek(((x - left) / width) * duration, duration);
}

/** The position after a key press, or null when the key does not seek. */
export function seekFromKey(key: string, position: number, duration: number, large = false): number | null {
  const step = large ? SEEK_STEP_LARGE : SEEK_STEP;
  switch (key) {
    case 'ArrowLeft':
    case 'ArrowDown':
      return clampSeek(position - step, duration);
    case 'ArrowRight':
    case 'ArrowUp':
      return clampSeek(position + step, duration);
    case 'Home':
      return 0;
    case 'End':
      return duration > 0 ? duration : null;
    default:
      return null;
  }
}

/** Played fraction, 0 to 1. */
export const fractionOf = (position: number, duration: number): number => (duration > 0 ? clamp(position / duration, 0, 1) : 0);

/** m:ss, or h:mm:ss for an hour or more. */
export function clock(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Where a clock that read `positionMs` at `at` stands at `now`: kept inside the track, and still while paused. */
export function extrapolate(positionMs: number, at: number, now: number, playing: boolean, durationMs: number): number {
  const moved = playing ? Math.max(0, now - at) : 0;
  const t = positionMs + moved;
  return durationMs > 0 ? Math.min(durationMs, t) : t;
}

/** Volume after a wheel notch over the slider: scrolling up raises it, in 5% steps. */
export function volumeFromWheel(volume: number, deltaY: number): number {
  const steps = Math.sign(-deltaY) * (Math.abs(deltaY) > 60 ? 2 : 1);
  return clamp(Math.round((volume + steps * 0.05) * 100) / 100, 0, 1);
}
