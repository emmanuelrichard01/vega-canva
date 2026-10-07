import { describe, expect, it } from 'vitest';
import { RPM, SPIN_DOWN_SECONDS, armAngle, isSettled, restingTurntable, stepTurntable, type TurntableState } from './turntable';

const run = (s: TurntableState, seconds: number, playing: boolean, dt = 1 / 60) => {
  const trace: TurntableState[] = [];
  let state = s;
  for (let t = 0; t < seconds - 1e-9; t += dt) {
    state = stepTurntable(state, dt, playing);
    trace.push(state);
  }
  return { state, trace };
};

describe('turntable', () => {
  it('spins up to 33⅓ rpm within about a second', () => {
    const { state, trace } = run(restingTurntable(), 1.5, true);
    expect(state.rpm).toBe(RPM);
    // Monotonic acceleration: a motor does not overshoot.
    for (let i = 1; i < trace.length; i++) expect(trace[i].rpm).toBeGreaterThanOrEqual(trace[i - 1].rpm);
    const at05 = trace[Math.round(0.5 * 60) - 1].rpm;
    expect(at05).toBeGreaterThan(RPM * 0.7);
  });

  it('drops the arm only once the platter is nearly up to speed', () => {
    const { trace } = run(restingTurntable(), 2, true);
    const firstMove = trace.findIndex((s) => s.arm > 0.001);
    expect(firstMove).toBeGreaterThan(0);
    expect(trace[firstMove].rpm).toBeGreaterThanOrEqual(RPM * 0.85);
  });

  it('swings the arm on with a small overshoot, then settles', () => {
    const { state, trace } = run(restingTurntable(), 4, true);
    const peak = Math.max(...trace.map((s) => s.arm));
    expect(peak).toBeGreaterThan(1.01);
    expect(peak).toBeLessThan(1.2);
    expect(state.arm).toBe(1);
    expect(state.armVelocity).toBe(0);
  });

  it('lifts the arm at once on stop and coasts the platter down', () => {
    const playing = run(restingTurntable(), 4, true).state;
    const { trace } = run(playing, SPIN_DOWN_SECONDS + 1, false);
    // The arm is already moving off within the first few frames.
    expect(trace[5].arm).toBeLessThan(1);
    // The platter coasts: still turning after a second, stopped by the end.
    expect(trace[59].rpm).toBeGreaterThan(RPM * 0.4);
    const last = trace[trace.length - 1];
    expect(last.rpm).toBe(0);
    expect(isSettled(last, false)).toBe(true);
  });

  it('spins the record at the platter speed', () => {
    const s = stepTurntable({ angle: 0, rpm: RPM, arm: 1, armVelocity: 0 }, 1 / 60, true);
    // 33⅓ rpm is 200 degrees per second.
    expect(s.angle).toBeCloseTo(200 / 60, 4);
  });

  it('stays stable across a long frame gap', () => {
    const playing = run(restingTurntable(), 4, true).state;
    const after = stepTurntable(playing, 3, true);
    expect(after.rpm).toBe(RPM);
    expect(Math.abs(after.arm - 1)).toBeLessThan(0.01);
    expect(Number.isFinite(after.angle)).toBe(true);
  });

  it('is never settled while playing', () => {
    expect(isSettled(restingTurntable(), true)).toBe(false);
    expect(isSettled(restingTurntable(), false)).toBe(true);
  });

  it('parks the arm off the record and tracks inward with progress', () => {
    expect(armAngle(0, 0.5)).toBe(-24);
    expect(armAngle(1, 0)).toBe(-12);
    expect(armAngle(1, 1)).toBe(8);
    expect(armAngle(1, 0.5)).toBeGreaterThan(armAngle(1, 0.2));
  });
});
