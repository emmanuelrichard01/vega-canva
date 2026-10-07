/**
 * The arithmetic behind camera motion: momentum after a flick, and the soft
 * give at the zoom limits. Pure, so the feel is tested rather than eyeballed.
 */

/** Fraction of pan speed that survives one second of coasting. */
export const RETAINED_PER_SECOND = 0.0063;
/** Coasting stops below this speed, in screen px per ms. */
export const STOP_BELOW = 0.05;
/** A release slower than this, in screen px per ms, does not coast at all. */
export const FLICK_THRESHOLD = 0.1;

export interface Velocity {
  x: number;
  y: number;
}

/**
 * One step of momentum, decayed by elapsed time rather than by frame, so a
 * flick travels the same distance at 60Hz and 144Hz.
 *
 * Returns the new velocity and the pan delta to apply, in screen pixels.
 */
export function momentumStep(v: Velocity, dtSeconds: number): { velocity: Velocity; dx: number; dy: number } {
  const dt = Math.min(0.05, Math.max(0.001, dtSeconds));
  const decay = Math.pow(RETAINED_PER_SECOND, dt);
  const velocity = { x: v.x * decay, y: v.y * decay };
  return { velocity, dx: velocity.x * dt * 1000, dy: velocity.y * dt * 1000 };
}

export function isCoasting(v: Velocity): boolean {
  return Math.abs(v.x) > STOP_BELOW || Math.abs(v.y) > STOP_BELOW;
}

export function isFlick(v: Velocity): boolean {
  return Math.abs(v.x) > FLICK_THRESHOLD || Math.abs(v.y) > FLICK_THRESHOLD;
}

/** Total distance a flick coasts before stopping, in screen pixels (one axis). */
export function coastDistance(speed: number, frameSeconds = 1 / 60): number {
  let v = { x: speed, y: 0 };
  let total = 0;
  for (let i = 0; i < 10_000 && isCoasting(v); i++) {
    const step = momentumStep(v, frameSeconds);
    v = step.velocity;
    total += step.dx;
  }
  return total;
}

/**
 * How far past a zoom limit a gesture may stretch, as a ratio of the limit.
 *
 * Reaching the end of the range should feel like meeting something soft, not
 * a wall: the zoom gives a little and eases back when the gesture stops.
 */
export const ZOOM_GIVE = 1.08;
/** Share of the gesture that still applies once past the limit. */
const RESISTANCE = 0.3;

/**
 * The zoom a gesture produces near the limits: free inside the range, resisted
 * outside it, and never further out than `ZOOM_GIVE`.
 *
 * Worked in log space, because zoom is multiplicative: a pinch out and back is
 * symmetric only there. The overshoot is capped exactly, so a gesture that
 * keeps pushing settles on one value rather than creeping.
 */
export function rubberZoom(current: number, requested: number, min: number, max: number): number {
  if (!Number.isFinite(requested) || requested <= 0) return current;
  const give = Math.log(ZOOM_GIVE);
  const logMax = Math.log(max);
  const logMin = Math.log(min);
  const cur = Math.log(Math.max(current, 1e-9));
  const delta = Math.log(requested) - cur;

  // Undo the resistance to find where the gesture itself has got to, apply the
  // request there, then resist again. A reversal inside the overshoot walks
  // back out at the same rate the gesture walked in, instead of freezing.
  let virtual = cur;
  if (cur > logMax) virtual = logMax + (cur - logMax) / RESISTANCE;
  else if (cur < logMin) virtual = logMin - (logMin - cur) / RESISTANCE;
  virtual += delta;

  if (virtual > logMax) return Math.exp(logMax + Math.min(give, (virtual - logMax) * RESISTANCE));
  if (virtual < logMin) return Math.exp(logMin - Math.min(give, (logMin - virtual) * RESISTANCE));
  return Math.exp(virtual);
}

export function clampZoom(zoom: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, zoom));
}

/** Whether the person has asked the system for less motion. */
export function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  } catch {
    return false;
  }
}
