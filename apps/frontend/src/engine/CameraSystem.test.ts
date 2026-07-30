import { describe, it, expect, beforeEach } from 'vitest';
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
