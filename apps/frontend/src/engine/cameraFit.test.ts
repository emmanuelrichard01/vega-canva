import { describe, expect, it } from 'vitest';
import { fitPose, unionBounds, type FitBounds } from './cameraFit';

/**
 * The arithmetic that decides whether the work is on screen.
 *
 * The version this replaced assigned a *world* offset to a camera field the
 * renderer multiplies by the zoom, so every fit that actually had to zoom put
 * the content somewhere off screen — further off the further the fit was from
 * 1:1. That is the kind of mistake that is invisible in a screenshot of the one
 * board you happened to try, and it is why this is a pure module.
 *
 * `CameraSystem` maps world to screen as `screen = world * zoom + offset`, so
 * every assertion below checks the *screen* position a world point lands at.
 */

/** Where a world point ends up on screen under a pose. */
const project = (
  pose: { x: number; y: number; zoom: number },
  wx: number,
  wy: number
) => ({ x: wx * pose.zoom + pose.x, y: wy * pose.zoom + pose.y });

const box = (x: number, y: number, width: number, height: number): FitBounds => ({
  x, y, width, height,
});

describe('fitPose', () => {
  it('centres the content in the viewport', () => {
    const pose = fitPose(box(0, 0, 400, 300), 1000, 800, { padding: 0 })!;
    const centre = project(pose, 200, 150);
    expect(centre.x).toBeCloseTo(500, 6);
    expect(centre.y).toBeCloseTo(400, 6);
  });

  /**
   * The defect that motivated this module. A board far from the origin, at a
   * zoom that is not 1, has to land in the middle — the old code's unscaled
   * offset put it hundreds of pixels away.
   */
  it('centres content that is far from the origin and needs zooming out', () => {
    const bounds = box(12_000, -8_000, 4_000, 3_000);
    const pose = fitPose(bounds, 1200, 900, { padding: 0 })!;

    expect(pose.zoom).toBeLessThan(1);
    const centre = project(pose, 12_000 + 2_000, -8_000 + 1_500);
    expect(centre.x).toBeCloseTo(600, 6);
    expect(centre.y).toBeCloseTo(450, 6);
  });

  it('puts every corner inside the viewport', () => {
    const bounds = box(-500, 200, 3_000, 1_800);
    const pose = fitPose(bounds, 1000, 700, { padding: 40 })!;

    for (const [wx, wy] of [
      [bounds.x, bounds.y],
      [bounds.x + bounds.width, bounds.y],
      [bounds.x, bounds.y + bounds.height],
      [bounds.x + bounds.width, bounds.y + bounds.height],
    ]) {
      const p = project(pose, wx, wy);
      expect(p.x).toBeGreaterThanOrEqual(-1e-6);
      expect(p.x).toBeLessThanOrEqual(1000 + 1e-6);
      expect(p.y).toBeGreaterThanOrEqual(-1e-6);
      expect(p.y).toBeLessThanOrEqual(700 + 1e-6);
    }
  });

  it('leaves the requested padding on the constraining axis', () => {
    // A wide, short box in a square viewport is constrained by width.
    const bounds = box(0, 0, 2_000, 100);
    const pose = fitPose(bounds, 1000, 1000, { padding: 50 })!;
    const left = project(pose, 0, 0);
    const right = project(pose, 2_000, 0);
    expect(left.x).toBeCloseTo(50, 6);
    expect(right.x).toBeCloseTo(950, 6);
  });

  it('measures padding in screen pixels, not world units', () => {
    // Otherwise the margin scales with the zoom: a hairline around a big board
    // and an inch around a small one.
    const big = fitPose(box(0, 0, 10_000, 10_000), 800, 800, { padding: 40 })!;
    const small = fitPose(box(0, 0, 200, 200), 800, 800, { padding: 40 })!;
    expect(project(big, 0, 0).x).toBeCloseTo(40, 6);
    // The small box is capped at 1:1 rather than magnified, so it is centred
    // with more than the padding around it — never less.
    expect(project(small, 0, 0).x).toBeGreaterThanOrEqual(40);
  });

  /**
   * Fitting zooms out, never in. Filling the screen with one sticky note is
   * not "fit to view" — it is a magnification nobody asked for, and it destroys
   * any sense of where that note sits on the board.
   */
  it('never magnifies past actual size', () => {
    const pose = fitPose(box(0, 0, 10, 10), 1600, 1200)!;
    expect(pose.zoom).toBe(1);
  });

  it('honours the zoom floor for an enormous board', () => {
    const pose = fitPose(box(0, 0, 10_000_000, 10_000_000), 1000, 800, { minZoom: 0.05 })!;
    expect(pose.zoom).toBe(0.05);
  });

  it('centres on a zero-sized box rather than refusing it', () => {
    // A single point is a legitimate thing to frame; it just cannot constrain
    // the zoom, so it takes 1:1.
    const pose = fitPose(box(500, 400, 0, 0), 1000, 800, { padding: 0 })!;
    expect(pose.zoom).toBe(1);
    const p = project(pose, 500, 400);
    expect(p.x).toBeCloseTo(500, 6);
    expect(p.y).toBeCloseTo(400, 6);
  });

  it('refuses a viewport with no area', () => {
    expect(fitPose(box(0, 0, 100, 100), 0, 800)).toBeNull();
    expect(fitPose(box(0, 0, 100, 100), 1000, 0)).toBeNull();
  });

  it('refuses bounds that are not finite', () => {
    expect(fitPose(box(NaN, 0, 100, 100), 1000, 800)).toBeNull();
    expect(fitPose(box(0, 0, Infinity, 100), 1000, 800)).toBeNull();
  });

  it('survives padding larger than the viewport', () => {
    // Degenerate, but a small window with a generous default must not produce
    // a negative usable size and a nonsense zoom.
    const pose = fitPose(box(0, 0, 400, 400), 100, 100, { padding: 200 })!;
    expect(pose.zoom).toBeGreaterThan(0);
    expect(Number.isFinite(pose.x)).toBe(true);
  });
});

describe('unionBounds', () => {
  it('starts from nothing', () => {
    expect(unionBounds(null, box(10, 20, 30, 40))).toEqual(box(10, 20, 30, 40));
  });

  it('grows to contain a box outside it', () => {
    const grown = unionBounds(box(0, 0, 100, 100), box(200, 200, 50, 50));
    expect(grown).toEqual(box(0, 0, 250, 250));
  });

  it('grows backwards for a box above and left', () => {
    const grown = unionBounds(box(0, 0, 100, 100), box(-50, -80, 10, 10));
    expect(grown).toEqual(box(-50, -80, 150, 180));
  });

  it('is unchanged by a box already inside', () => {
    expect(unionBounds(box(0, 0, 100, 100), box(20, 20, 10, 10))).toEqual(box(0, 0, 100, 100));
  });

  /**
   * The property replay depends on: fold every position anything ever held,
   * in any order, and the result contains all of them. That is what makes a
   * single frame at the start enough for the whole playback.
   */
  it('contains every box folded into it, whatever the order', () => {
    const boxes = [
      box(0, 0, 100, 100),
      box(-400, 250, 60, 60),
      box(900, -300, 200, 40),
      box(50, 50, 10, 10),
    ];
    const fold = (list: FitBounds[]) => list.reduce<FitBounds | null>(unionBounds, null)!;

    const forward = fold(boxes);
    const backward = fold([...boxes].reverse());
    expect(forward).toEqual(backward);

    for (const b of boxes) {
      expect(b.x).toBeGreaterThanOrEqual(forward.x);
      expect(b.y).toBeGreaterThanOrEqual(forward.y);
      expect(b.x + b.width).toBeLessThanOrEqual(forward.x + forward.width);
      expect(b.y + b.height).toBeLessThanOrEqual(forward.y + forward.height);
    }
  });
});
