/**
 * How a collaborator's pointer moves between broadcasts.
 *
 * Awareness arrives at about 15Hz, so a pointer drawn at the last reported
 * position jumps every 66ms, and one eased toward it always trails a few
 * frames behind. This module does what Figma's multiplayer cursors do:
 *
 * 1. **Predict.** Each sample also yields a velocity, and the target is
 *    extrapolated along it for at most one broadcast interval. The pointer is
 *    then roughly where its owner's pointer is now, rather than where it was
 *    66ms ago.
 * 2. **Spring.** The drawn position follows that target on a critically
 *    damped spring, solved exactly for each frame, so it is stable at any
 *    frame rate and does not ring.
 * 3. **Bound the guess.** The lead is capped in screen pixels and decays, so a
 *    pointer that stops dead overshoots by a few pixels at most and settles
 *    back without bouncing.
 *
 * All positions are in world units and times in milliseconds. Pure: the store
 * owns one `MotionState` per person and calls these on every sample and frame.
 */

export interface MotionState {
  /** Drawn position and velocity (world units, world units per ms). */
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Last broadcast sample, when it arrived, and the velocity it implies. */
  sx: number;
  sy: number;
  sampleAt: number;
  svx: number;
  svy: number;
}

/** Spring stiffness: settles to within 2% of a held target in about 75ms. */
export const SPRING_OMEGA = 0.052;
/** How far past the last sample the target may be predicted, in ms. */
export const PREDICT_MS = 66;
/** Fraction of the predicted travel actually used; the rest is held back. */
export const PREDICT_GAIN = 0.7;
/** The most the prediction may lead the last sample by, in screen pixels. */
export const MAX_LEAD_PX = 28;
/** A sample this far from the drawn position, in screen pixels, is a teleport. */
export const TELEPORT_PX = 640;
/** Samples further apart than this carry no usable velocity. */
const MAX_SAMPLE_GAP_MS = 400;
/** How quickly a new velocity estimate replaces the old one. */
const VELOCITY_BLEND = 0.6;

export function createMotion(x: number, y: number, now: number): MotionState {
  return { x, y, vx: 0, vy: 0, sx: x, sy: y, sampleAt: now, svx: 0, svy: 0 };
}

/**
 * Record a broadcast position.
 *
 * `zoom` converts the teleport threshold from screen pixels: a jump the user
 * would see as a cross-screen leap snaps instead of sliding across the board.
 */
export function addSample(m: MotionState, x: number, y: number, now: number, zoom = 1): void {
  const dt = now - m.sampleAt;
  const dx = x - m.sx;
  const dy = y - m.sy;
  if (dx === 0 && dy === 0 && dt < MAX_SAMPLE_GAP_MS) {
    // A repeat of the same position is a pointer at rest: its velocity is zero,
    // which is what stops the prediction carrying it past where it stopped.
    m.svx *= 1 - VELOCITY_BLEND;
    m.svy *= 1 - VELOCITY_BLEND;
    m.sampleAt = now;
    return;
  }

  const z = zoom > 0 ? zoom : 1;
  const jump = Math.hypot(x - m.x, y - m.y) * z;
  if (jump > TELEPORT_PX || dt > MAX_SAMPLE_GAP_MS * 4) {
    Object.assign(m, createMotion(x, y, now));
    return;
  }

  if (dt >= 8 && dt <= MAX_SAMPLE_GAP_MS) {
    m.svx += (dx / dt - m.svx) * VELOCITY_BLEND;
    m.svy += (dy / dt - m.svy) * VELOCITY_BLEND;
  } else {
    m.svx = 0;
    m.svy = 0;
  }
  m.sx = x;
  m.sy = y;
  m.sampleAt = now;
}

/** Where the pointer is predicted to be now: the last sample plus a bounded lead. */
export function predictedTarget(m: MotionState, now: number, zoom = 1): { x: number; y: number } {
  const age = Math.max(0, Math.min(now - m.sampleAt, PREDICT_MS));
  let lx = m.svx * age * PREDICT_GAIN;
  let ly = m.svy * age * PREDICT_GAIN;
  const maxLead = MAX_LEAD_PX / (zoom > 0 ? zoom : 1);
  const lead = Math.hypot(lx, ly);
  if (lead > maxLead) {
    lx *= maxLead / lead;
    ly *= maxLead / lead;
  }
  return { x: m.sx + lx, y: m.sy + ly };
}

/**
 * Advance the drawn position by one frame.
 *
 * The critically damped spring is integrated with its closed-form solution for
 * a target held over the step, so a long frame (a backgrounded tab coming back)
 * lands on the target instead of exploding. With `reduced` set there is no
 * spring and no prediction: the pointer sits on the last reported position.
 */
export function stepMotion(m: MotionState, dtMs: number, now: number, zoom = 1, reduced = false): void {
  if (reduced) {
    m.x = m.sx;
    m.y = m.sy;
    m.vx = 0;
    m.vy = 0;
    return;
  }
  const dt = Math.max(0, Math.min(dtMs, 250));
  if (dt === 0) return;
  const target = predictedTarget(m, now, zoom);
  // The target's own velocity, while it is still being predicted forward. The
  // spring works on the error relative to a target moving at this speed, so a
  // pointer moving steadily is tracked with no standing lag.
  const before = predictedTarget(m, now - dt, zoom);
  const tvx = (target.x - before.x) / dt;
  const tvy = (target.y - before.y) / dt;
  const w = SPRING_OMEGA;
  const e = Math.exp(-w * dt);
  for (const axis of ['x', 'y'] as const) {
    const v = axis === 'x' ? 'vx' : 'vy';
    const tv = axis === 'x' ? tvx : tvy;
    const d = m[axis] - before[axis];
    const rel = m[v] - tv;
    const k = rel + w * d;
    m[axis] = target[axis] + (d + k * dt) * e;
    m[v] = tv + (rel - w * k * dt) * e;
  }
}

/** Drawn speed in screen pixels per second, for the name tag's compact state. */
export function screenSpeed(m: MotionState, zoom = 1): number {
  return Math.hypot(m.vx, m.vy) * 1000 * (zoom > 0 ? zoom : 1);
}
