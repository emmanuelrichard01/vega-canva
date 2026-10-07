/**
 * The turntable's physics: platter speed and tonearm position. Pure.
 *
 * - The platter accelerates quickly towards 33⅓ rpm (a direct-drive motor)
 *   and coasts down on friction when stopped, which takes longer: inertia.
 * - The tonearm is an underdamped spring towards its target, so it swings
 *   onto the record with a small overshoot and lifts off the same way.
 * - Order matters, as on a real deck: on play the arm waits until the platter
 *   is up to speed before it drops; on stop the arm lifts first and the
 *   platter coasts.
 */

export const RPM = 100 / 3;
/** Time constant of the motor's approach to speed. */
const SPIN_UP_TAU = 0.22;
/** Seconds to coast from full speed to rest. */
export const SPIN_DOWN_SECONDS = 2.6;
/** Spring constants for the arm (per second²), damping ratio below 1 for a small overshoot. */
const ARM_STIFFNESS = 70;
const ARM_DAMPING_RATIO = 0.58;
/** The arm drops once the platter is this close to speed. */
const ARM_DROP_AT = 0.85;

export interface TurntableState {
  /** Record rotation, degrees, kept in [0, 360). */
  angle: number;
  /** Platter speed in rpm. */
  rpm: number;
  /** Arm position: 0 at rest, 1 at the lead-in groove. */
  arm: number;
  /** Arm velocity, positions per second. */
  armVelocity: number;
}

export const restingTurntable = (): TurntableState => ({ angle: 0, rpm: 0, arm: 0, armVelocity: 0 });

export function stepTurntable(s: TurntableState, dt: number, playing: boolean): TurntableState {
  // Large gaps (a backgrounded tab) are integrated in small steps, so the spring stays stable.
  if (dt > 1 / 30) {
    let state = s;
    let left = Math.min(dt, 4);
    while (left > 0) {
      const h = Math.min(1 / 60, left);
      state = stepTurntable(state, h, playing);
      left -= h;
    }
    return state;
  }

  // Platter.
  let rpm = s.rpm;
  if (playing) {
    rpm += (RPM - rpm) * (1 - Math.exp(-dt / SPIN_UP_TAU));
    // Within 1% is at speed: the motor locks.
    if (RPM - rpm < RPM * 0.01) rpm = RPM;
  } else {
    rpm = Math.max(0, rpm - (RPM / SPIN_DOWN_SECONDS) * dt);
  }

  // Arm: drops only once the record is nearly up to speed; lifts at once on stop.
  const target = playing && rpm >= RPM * ARM_DROP_AT ? 1 : 0;
  const c = 2 * ARM_DAMPING_RATIO * Math.sqrt(ARM_STIFFNESS);
  const accel = ARM_STIFFNESS * (target - s.arm) - c * s.armVelocity;
  let armVelocity = s.armVelocity + accel * dt;
  let arm = s.arm + armVelocity * dt;
  if (Math.abs(target - arm) < 0.0005 && Math.abs(armVelocity) < 0.002) {
    arm = target;
    armVelocity = 0;
  }

  // 1 rpm is 6 degrees per second.
  const angle = (s.angle + rpm * 6 * dt) % 360;
  return { angle, rpm, arm, armVelocity };
}

/** At rest with nothing left to animate: the render loop can stop. */
export const isSettled = (s: TurntableState, playing: boolean): boolean =>
  playing ? false : s.rpm === 0 && s.arm === 0 && s.armVelocity === 0;

/**
 * The tonearm's angle in degrees for drawing.
 *
 * Rest is parked off the record; on the record the arm tracks inward as the
 * track plays, the way a real arm follows the spiral groove.
 */
export function armAngle(arm: number, progress: number | null): number {
  const REST = -24;
  const LEAD_IN = -12;
  const RUN_OUT = 8;
  const onRecord = LEAD_IN + (RUN_OUT - LEAD_IN) * Math.min(1, Math.max(0, progress ?? 0.18));
  return REST + (onRecord - REST) * arm;
}
