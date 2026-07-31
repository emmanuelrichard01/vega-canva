import { describe, expect, it } from 'vitest';
import type { ViewportState } from './PresenceTypes';
import { easePose, followPose, poseWasDisturbed, type CameraPose } from './followCamera';

const LIMITS = { minZoom: 0.05, maxZoom: 5 };

/** Someone looking at the world rectangle (0,0)-(1000,600) on a 1000x600 screen. */
const viewport = (over: Partial<ViewportState> = {}): ViewportState => ({
  x: 0,
  y: 0,
  width: 1000,
  height: 600,
  zoom: 1,
  ...over,
});

/** What the follower's screen shows, given a pose. */
const visibleWorld = (pose: CameraPose, w: number, h: number) => ({
  minX: -pose.x / pose.zoom,
  minY: -pose.y / pose.zoom,
  maxX: (w - pose.x) / pose.zoom,
  maxY: (h - pose.y) / pose.zoom,
});

describe('followPose', () => {
  it('reproduces the leader’s view exactly on an identical screen', () => {
    const pose = followPose(viewport(), 1000, 600, LIMITS)!;
    expect(pose.zoom).toBeCloseTo(1);
    const seen = visibleWorld(pose, 1000, 600);
    expect(seen.minX).toBeCloseTo(0);
    expect(seen.minY).toBeCloseTo(0);
    expect(seen.maxX).toBeCloseTo(1000);
    expect(seen.maxY).toBeCloseTo(600);
  });

  it('centres on the middle of their view, not its corner', () => {
    // The bug this whole module exists to prevent: three call sites passed the
    // top-left corner to a "centre on this point" navigator and landed half a
    // screen up and to the left, on empty canvas.
    const pose = followPose(viewport({ x: 4000, y: 2000 }), 1000, 600, LIMITS)!;
    const seen = visibleWorld(pose, 1000, 600);
    expect((seen.minX + seen.maxX) / 2).toBeCloseTo(4500);
    expect((seen.minY + seen.maxY) / 2).toBeCloseTo(2300);
  });

  it('shows everything the leader sees on a narrower screen', () => {
    // The property follow mode exists to provide. A follower who merely copies
    // the zoom sees *less*, so the leader can point at something that is not on
    // the follower's screen at all.
    const theirs = viewport({ x: 100, y: 50 });
    const pose = followPose(theirs, 600, 600, LIMITS)!;
    const seen = visibleWorld(pose, 600, 600);
    expect(seen.minX).toBeLessThanOrEqual(100 + 1e-9);
    expect(seen.minY).toBeLessThanOrEqual(50 + 1e-9);
    expect(seen.maxX).toBeGreaterThanOrEqual(1100 - 1e-9);
    expect(seen.maxY).toBeGreaterThanOrEqual(650 - 1e-9);
    // And it had to zoom out to do it.
    expect(pose.zoom).toBeLessThan(1);
  });

  it('shows everything the leader sees on a wider screen too', () => {
    const pose = followPose(viewport(), 2000, 600, LIMITS)!;
    const seen = visibleWorld(pose, 2000, 600);
    expect(seen.minX).toBeLessThanOrEqual(1e-9);
    expect(seen.maxX).toBeGreaterThanOrEqual(1000 - 1e-9);
    expect(seen.minY).toBeLessThanOrEqual(1e-9);
    expect(seen.maxY).toBeGreaterThanOrEqual(600 - 1e-9);
  });

  it('follows someone who is zoomed in', () => {
    const pose = followPose(viewport({ x: 200, y: 100, zoom: 4 }), 1000, 600, LIMITS)!;
    // Their visible world is 250 x 150 from (200,100).
    const seen = visibleWorld(pose, 1000, 600);
    expect((seen.minX + seen.maxX) / 2).toBeCloseTo(325);
    expect((seen.minY + seen.maxY) / 2).toBeCloseTo(175);
    expect(pose.zoom).toBeCloseTo(4);
  });

  it('clamps to the camera’s own zoom limits', () => {
    // Someone zoomed far past what this camera allows must still be followable.
    const deep = followPose(viewport({ width: 10, height: 6, zoom: 40 }), 1000, 600, LIMITS)!;
    expect(deep.zoom).toBe(LIMITS.maxZoom);
    const far = followPose(viewport({ width: 1000, height: 600, zoom: 0.001 }), 1000, 600, LIMITS)!;
    expect(far.zoom).toBe(LIMITS.minZoom);
  });

  it('falls back to their zoom when they publish no size', () => {
    // A peer on an older build. There is no rectangle to fit, but following
    // them should still work rather than doing nothing.
    const pose = followPose(
      { x: 300, y: 200, zoom: 2 } as ViewportState,
      1000,
      600,
      LIMITS
    )!;
    expect(pose.zoom).toBeCloseTo(2);
    const seen = visibleWorld(pose, 1000, 600);
    expect((seen.minX + seen.maxX) / 2).toBeCloseTo(300);
  });

  it('refuses a viewport it cannot make sense of', () => {
    expect(followPose(viewport({ zoom: -1 }), 1000, 600, LIMITS)).toBeNull();
    expect(followPose(viewport({ x: NaN }), 1000, 600, LIMITS)).toBeNull();
    expect(followPose(viewport(), 0, 600, LIMITS)).toBeNull();
  });
});

describe('easePose', () => {
  const from: CameraPose = { x: 0, y: 0, zoom: 1 };
  const to: CameraPose = { x: 100, y: 200, zoom: 4 };

  it('does nothing at alpha 0 and arrives at alpha 1', () => {
    expect(easePose(from, to, 0)).toEqual(from);
    const done = easePose(from, to, 1);
    expect(done.x).toBeCloseTo(100);
    expect(done.zoom).toBeCloseTo(4);
  });

  it('eases zoom multiplicatively, not linearly', () => {
    // Halfway from 1x to 4x is 2x — the geometric middle. Linear would give
    // 2.5x, which spends most of the motion in the top half of the range and
    // arrives in a rush.
    expect(easePose(from, to, 0.5).zoom).toBeCloseTo(2);
  });

  it('is monotonic and convergent over repeated frames', () => {
    let pose = from;
    let previous = 0;
    for (let i = 0; i < 200; i++) {
      pose = easePose(pose, to, 0.2);
      expect(pose.x).toBeGreaterThanOrEqual(previous);
      previous = pose.x;
    }
    expect(pose.x).toBeCloseTo(100);
    expect(pose.y).toBeCloseTo(200);
    expect(pose.zoom).toBeCloseTo(4);
  });

  it('survives a zero starting zoom rather than producing NaN', () => {
    const pose = easePose({ x: 0, y: 0, zoom: 0 }, to, 0.5);
    expect(Number.isFinite(pose.zoom)).toBe(true);
    expect(pose.zoom).toBeGreaterThan(0);
  });
});

describe('poseWasDisturbed', () => {
  const written: CameraPose = { x: 120, y: -40, zoom: 1.5 };

  it('ignores the driver’s own float residue', () => {
    expect(poseWasDisturbed({ x: 120.2, y: -40.1, zoom: 1.5000001 }, written)).toBe(false);
  });

  it('notices a pan', () => {
    expect(poseWasDisturbed({ ...written, x: 130 }, written)).toBe(true);
    expect(poseWasDisturbed({ ...written, y: -60 }, written)).toBe(true);
  });

  it('notices a wheel notch at either end of the zoom range', () => {
    // Compared as a ratio, because a fixed epsilon is far too coarse at 0.05
    // and far too fine at 5 — one wheel notch is 1.1x wherever you are.
    for (const zoom of [0.05, 1.5, 5]) {
      const at: CameraPose = { ...written, zoom };
      expect(poseWasDisturbed({ ...at, zoom: zoom * 1.1 }, at)).toBe(true);
      expect(poseWasDisturbed({ ...at, zoom: zoom / 1.1 }, at)).toBe(true);
    }
  });
});
