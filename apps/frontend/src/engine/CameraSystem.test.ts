import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cameraSystem } from './CameraSystem';

/**
 * Zoom direction is the kind of thing that inverts silently: it type-checks
 * either way, and whoever wrote it had a 50/50 chance. It shipped inverted —
 * `zoomAt(+1)` divided by the zoom factor while its only caller passed `+1`
 * meaning "zoom in" — so pinching outward on a trackpad shrank the canvas.
 * These tests pin the convention rather than the implementation.
 */

beforeEach(() => {
  cameraSystem.x = 0;
  cameraSystem.y = 0;
  cameraSystem.zoom = 1;
});

describe('CameraSystem zoom direction', () => {
  it('zooms in on a negative wheel delta, the way a trackpad pinch-out reports', () => {
    cameraSystem.zoomByWheel(-100, 400, 300);
    expect(cameraSystem.zoom).toBeGreaterThan(1);
  });

  it('zooms out on a positive wheel delta', () => {
    cameraSystem.zoomByWheel(100, 400, 300);
    expect(cameraSystem.zoom).toBeLessThan(1);
  });

  it('treats a positive step as zooming in', () => {
    cameraSystem.zoomAt(1, 400, 300);
    expect(cameraSystem.zoom).toBeGreaterThan(1);
    cameraSystem.zoom = 1;
    cameraSystem.zoomAt(-1, 400, 300);
    expect(cameraSystem.zoom).toBeLessThan(1);
  });

  it('returns to the original zoom after an equal in-and-out gesture', () => {
    // Zoom is multiplicative, so a symmetric gesture has to land exactly back.
    cameraSystem.zoomByWheel(-60, 400, 300);
    cameraSystem.zoomByWheel(60, 400, 300);
    expect(cameraSystem.zoom).toBeCloseTo(1, 6);
  });

  it('keeps the world point under the cursor pinned', () => {
    const screenX = 500;
    const screenY = 250;
    const worldBefore = cameraSystem.screenToWorld(screenX, screenY);

    cameraSystem.zoomByWheel(-120, screenX, screenY);

    const worldAfter = cameraSystem.screenToWorld(screenX, screenY);
    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 6);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 6);
  });

  it('ignores a zero or non-finite delta', () => {
    cameraSystem.zoomByWheel(0, 400, 300);
    expect(cameraSystem.zoom).toBe(1);
    cameraSystem.zoomByWheel(Number.NaN, 400, 300);
    expect(cameraSystem.zoom).toBe(1);
  });

  it('cannot leap several zoom levels from one violent notch', () => {
    cameraSystem.zoomByWheel(-100000, 400, 300);
    expect(cameraSystem.zoom).toBeLessThanOrEqual(2);
  });

  it('stays within sane zoom limits however long you keep gesturing', () => {
    for (let i = 0; i < 200; i++) cameraSystem.zoomByWheel(-200, 400, 300);
    const zoomedIn = cameraSystem.zoom;
    expect(Number.isFinite(zoomedIn)).toBe(true);
    // Clamped rather than running away to infinity.
    cameraSystem.zoomByWheel(-200, 400, 300);
    expect(cameraSystem.zoom).toBe(zoomedIn);

    for (let i = 0; i < 400; i++) cameraSystem.zoomByWheel(200, 400, 300);
    const zoomedOut = cameraSystem.zoom;
    expect(zoomedOut).toBeGreaterThan(0);
    cameraSystem.zoomByWheel(200, 400, 300);
    expect(cameraSystem.zoom).toBe(zoomedOut);
  });
});

describe('CameraSystem animation', () => {
  it('animates smoothly to target pose and calls onComplete', () => {
    let completed = false;
    cameraSystem.setPose(0, 0, 1);

    cameraSystem.animateTo(200, 150, 1.5, {
      duration: 0,
      onComplete: () => {
        completed = true;
      },
    });

    expect(cameraSystem.x).toBe(200);
    expect(cameraSystem.y).toBe(150);
    expect(cameraSystem.zoom).toBe(1.5);
    expect(completed).toBe(true);
  });

  it('cancels in-flight animation on manual pan, zoom, or setPose', () => {
    cameraSystem.setPose(0, 0, 1);
    cameraSystem.animateTo(500, 500, 2, { duration: 1000 });
    expect(cameraSystem.isAnimating()).toBe(true);

    cameraSystem.panBy(10, 10);
    expect(cameraSystem.isAnimating()).toBe(false);

    cameraSystem.animateTo(500, 500, 2, { duration: 1000 });
    expect(cameraSystem.isAnimating()).toBe(true);

    cameraSystem.zoomBy(1.1, 400, 300);
    expect(cameraSystem.isAnimating()).toBe(false);

    cameraSystem.animateTo(500, 500, 2, { duration: 1000 });
    expect(cameraSystem.isAnimating()).toBe(true);

    cameraSystem.setPose(100, 100, 1);
    expect(cameraSystem.isAnimating()).toBe(false);
  });
});

describe('CameraSystem navigation APIs', () => {
  beforeEach(() => {
    cameraSystem.cancelAnimation();
    cameraSystem.resize(800, 600);
  });

  it('zooms to an exact level about the viewport centre', () => {
    cameraSystem.zoomToLevel(2, 400, 300, 0);
    expect(cameraSystem.zoom).toBe(2);
    // The world point that was at the centre is still there.
    expect(cameraSystem.screenToWorld(400, 300)).toEqual({ x: 400, y: 300 });
  });

  it('clamps an out-of-range level', () => {
    cameraSystem.zoomToLevel(100, 400, 300, 0);
    expect(cameraSystem.zoom).toBe(cameraSystem.zoomLimits.maxZoom);
  });

  it('flies to a box, centring it', () => {
    const ok = cameraSystem.flyToBounds({ x: 1000, y: 1000, width: 200, height: 100 }, { duration: 0, padding: 0 });
    expect(ok).toBe(true);
    const centre = cameraSystem.screenToWorld(400, 300);
    expect(centre.x).toBeCloseTo(1100);
    expect(centre.y).toBeCloseTo(1050);
  });

  it('refuses a box with no position', () => {
    expect(cameraSystem.flyToBounds({ x: Number.NaN, y: 0, width: 10, height: 10 }, { duration: 0 })).toBe(false);
  });

  it('lets a pinch run a little past the limit, then settles back inside', async () => {
    cameraSystem.setPose(0, 0, cameraSystem.zoomLimits.maxZoom);
    cameraSystem.zoomBy(1.5, 400, 300, true);
    expect(cameraSystem.zoom).toBeGreaterThan(cameraSystem.zoomLimits.maxZoom);
    expect(cameraSystem.reportedZoom).toBe(cameraSystem.zoomLimits.maxZoom);
    await new Promise((r) => setTimeout(r, 600));
    expect(cameraSystem.zoom).toBeCloseTo(cameraSystem.zoomLimits.maxZoom, 5);
  });

  it('stops at the limit for a wheel notch, a key step or a button', () => {
    const { maxZoom } = cameraSystem.zoomLimits;
    cameraSystem.setPose(0, 0, maxZoom);
    cameraSystem.zoomByWheel(-120, 400, 300);
    expect(cameraSystem.zoom).toBe(maxZoom);
    cameraSystem.zoomAt(1, 400, 300);
    expect(cameraSystem.zoom).toBe(maxZoom);
    cameraSystem.zoomBy(1.5, 400, 300);
    expect(cameraSystem.zoom).toBe(maxZoom);
  });

  it('does not settle after a programmatic move replaces the gesture', async () => {
    const { maxZoom } = cameraSystem.zoomLimits;
    cameraSystem.setPose(0, 0, maxZoom);
    cameraSystem.zoomBy(1.5, 400, 300, true);
    cameraSystem.setPose(10, 20, 2);
    await new Promise((r) => setTimeout(r, 400));
    expect(cameraSystem.zoom).toBe(2);
    expect(cameraSystem.x).toBe(10);
  });

  it('stops momentum when other camera motion starts', () => {
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    cameraSystem.setPose(0, 0, 1);
    cameraSystem.coast({ x: 1, y: 0 });
    expect(cameraSystem.isAnimating()).toBe(true);
    cameraSystem.zoomBy(1.1, 400, 300);
    expect(cameraSystem.isAnimating()).toBe(false);
    cameraSystem.coast({ x: 1, y: 0 });
    cameraSystem.animateTo(5, 5, 1, { duration: 0 });
    expect(cameraSystem.isAnimating()).toBe(false);
    vi.unstubAllGlobals();
  });
});
