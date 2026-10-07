import { describe, expect, it } from 'vitest';
import {
  MAX_LEAD_PX,
  addSample,
  createMotion,
  predictedTarget,
  screenSpeed,
  stepMotion,
  type MotionState,
} from './cursorMotion';

const FRAME = 1000 / 60;
const BROADCAST = 1000 / 15;

/** Drive a motion through a sampled path, returning every drawn position. */
function simulate(
  path: (t: number) => { x: number; y: number },
  durationMs: number,
  opts: { zoom?: number; reduced?: boolean } = {}
): { m: MotionState; drawn: { t: number; x: number; y: number }[] } {
  const zoom = opts.zoom ?? 1;
  const start = path(0);
  const m = createMotion(start.x, start.y, 0);
  const drawn: { t: number; x: number; y: number }[] = [];
  let nextSample = BROADCAST;
  for (let t = FRAME; t <= durationMs; t += FRAME) {
    while (nextSample <= t) {
      const p = path(nextSample);
      addSample(m, p.x, p.y, nextSample, zoom);
      nextSample += BROADCAST;
    }
    stepMotion(m, FRAME, t, zoom, opts.reduced);
    drawn.push({ t, x: m.x, y: m.y });
  }
  return { m, drawn };
}

describe('cursorMotion', () => {
  it('tracks a pointer moving at constant speed with little lag', () => {
    // 600 px/s to the right, sampled at 15Hz.
    const speed = 0.6;
    const { drawn } = simulate((t) => ({ x: t * speed, y: 0 }), 1500);
    const late = drawn.filter((d) => d.t > 800);
    // Plain easing toward the last sample trails by a broadcast interval and
    // more (~40px here). Prediction keeps the gap to the true position small.
    for (const d of late) expect(Math.abs(d.x - d.t * speed)).toBeLessThan(20);
  });

  it('settles on a stopped pointer without overshooting past the bounded lead', () => {
    const speed = 1.2; // fast flick, 1200 px/s
    const stopAt = 600;
    const { drawn } = simulate((t) => ({ x: Math.min(t, stopAt) * speed, y: 0 }), 1600);
    const rest = stopAt * speed;
    const max = Math.max(...drawn.map((d) => d.x));
    expect(max - rest).toBeLessThanOrEqual(MAX_LEAD_PX);
    const final = drawn[drawn.length - 1];
    expect(Math.abs(final.x - rest)).toBeLessThan(0.5);
  });

  it('moves continuously: no frame jumps further than the pointer could travel', () => {
    const speed = 0.8;
    const { drawn } = simulate((t) => ({ x: t * speed, y: Math.sin(t / 200) * 100 }), 2000);
    for (let i = 1; i < drawn.length; i++) {
      const step = Math.hypot(drawn[i].x - drawn[i - 1].x, drawn[i].y - drawn[i - 1].y);
      // The true pointer moves ~13px per frame here; a jump of several frames'
      // travel in one frame would read as a stutter.
      expect(step).toBeLessThan(40);
    }
  });

  it('snaps on a teleport instead of sliding across the board', () => {
    const m = createMotion(0, 0, 0);
    addSample(m, 5000, 0, 66, 1);
    expect(m.x).toBe(5000);
    expect(m.vx).toBe(0);
  });

  it('scales the teleport threshold by zoom', () => {
    const m = createMotion(0, 0, 0);
    // 400 world px is 400 screen px at 100% (no snap) but 1600 at 400% (snap).
    addSample(m, 400, 0, 66, 1);
    expect(m.x).toBe(0);
    const zoomed = createMotion(0, 0, 0);
    addSample(zoomed, 400, 0, 66, 4);
    expect(zoomed.x).toBe(400);
  });

  it('caps the prediction lead in screen pixels at any zoom', () => {
    const m = createMotion(0, 0, 0);
    addSample(m, 200, 0, 66, 1);
    addSample(m, 400, 0, 132, 1); // ~3 px/ms
    const target = predictedTarget(m, 132 + 66, 2);
    expect((target.x - 400) * 2).toBeLessThanOrEqual(MAX_LEAD_PX + 1e-9);
  });

  it('sits exactly on the last sample under reduced motion', () => {
    const { m } = simulate((t) => ({ x: t, y: 0 }), 500, { reduced: true });
    expect(m.x).toBe(m.sx);
    expect(m.vx).toBe(0);
  });

  it('survives a long frame without exploding', () => {
    const m = createMotion(0, 0, 0);
    addSample(m, 100, 0, 66, 1);
    stepMotion(m, 5000, 5066, 1);
    expect(Number.isFinite(m.x)).toBe(true);
    expect(Math.abs(m.x - 100)).toBeLessThan(MAX_LEAD_PX + 1);
  });

  it('reports screen speed in px/s', () => {
    const m = createMotion(0, 0, 0);
    m.vx = 0.5;
    expect(screenSpeed(m, 2)).toBeCloseTo(1000);
  });
});
