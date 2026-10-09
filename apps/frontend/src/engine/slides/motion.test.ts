import { describe, expect, it } from 'vitest';
import { flyPose } from './fly';
import { LASER_TRAIL_MS, LaserTrail } from './laser';

const stage = { width: 1600, height: 900 };

describe('the camera flight between slides', () => {
  it('starts and lands exactly on the two poses', () => {
    const a = { x: 100, y: 50, zoom: 0.8 };
    const b = { x: -3000, y: 200, zoom: 0.5 };
    const start = flyPose(a, b, stage, 0);
    const end = flyPose(a, b, stage, 1);
    expect(start.x).toBeCloseTo(a.x);
    expect(start.zoom).toBeCloseTo(a.zoom);
    expect(end.x).toBeCloseTo(b.x);
    expect(end.y).toBeCloseTo(b.y);
    expect(end.zoom).toBeCloseTo(b.zoom);
  });

  it('pulls back for a long trip and barely lifts for the slide next door', () => {
    const z = 0.7;
    const here = { x: 0, y: 0, zoom: z };
    const near = { x: -stage.width * 0.9, y: 0, zoom: z };
    const far = { x: -stage.width * 12, y: 0, zoom: z };
    expect(flyPose(here, near, stage, 0.5).zoom).toBeCloseTo(z, 2);
    expect(flyPose(here, far, stage, 0.5).zoom).toBeLessThan(z * 0.6);
  });
});

describe('the laser trail', () => {
  it('keeps only the last moment of movement, then clears once the dot is gone', () => {
    const trail = new LaserTrail();
    trail.on = true;
    trail.push(0, 0, 0);
    trail.push(10, 0, 200);
    trail.push(20, 0, 400);
    trail.prune(400);
    expect(trail.points.map((p) => p.x)).toEqual([10, 20]);
    trail.on = false;
    trail.prune(400 + LASER_TRAIL_MS + 1);
    expect(trail.points).toEqual([]);
    expect(trail.alive).toBe(false);
  });

  it('ages segments from new to gone', () => {
    const trail = new LaserTrail();
    trail.push(0, 0, 0);
    trail.push(5, 5, 100);
    const [seg] = trail.segments(100 + LASER_TRAIL_MS / 2);
    expect(seg.age).toBeCloseTo(0.5);
  });
});
