import { describe, expect, it } from 'vitest';
import { boxInPolygon, clipPolylineByPolygon, pointInPolygon } from './eraseHit';

const square = [
  { x: 40, y: -20 },
  { x: 60, y: -20 },
  { x: 60, y: 20 },
  { x: 40, y: 20 },
];

describe('lasso erasing', () => {
  it('tests points against the lasso', () => {
    expect(pointInPolygon({ x: 50, y: 0 }, square)).toBe(true);
    expect(pointInPolygon({ x: 10, y: 0 }, square)).toBe(false);
  });

  it('cuts a stroke exactly at the lasso edge', () => {
    const line = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    const runs = clipPolylineByPolygon(line, square);
    expect(runs).toHaveLength(2);
    expect(runs[0][runs[0].length - 1].x).toBeCloseTo(40);
    expect(runs[1][0].x).toBeCloseTo(60);
    expect(runs[1][runs[1].length - 1].x).toBe(100);
  });

  it('keeps a stroke the lasso does not touch', () => {
    const line = [{ x: 0, y: 50 }, { x: 100, y: 50 }];
    expect(clipPolylineByPolygon(line, square)).toEqual([line]);
  });

  it('removes a stroke entirely inside the lasso', () => {
    const line = [{ x: 45, y: 0 }, { x: 55, y: 5 }];
    expect(clipPolylineByPolygon(line, square)).toEqual([]);
  });

  it('cuts a stroke that weaves in and out several times', () => {
    const zig = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 10 }, { x: 0, y: 10 }];
    const runs = clipPolylineByPolygon(zig, square);
    // Two passes through the lasso leave three pieces outside it.
    expect(runs).toHaveLength(3);
  });

  it('only takes whole boxes that sit inside the lasso', () => {
    expect(boxInPolygon({ x: 45, y: -10, width: 10, height: 10 }, square)).toBe(true);
    expect(boxInPolygon({ x: 30, y: -10, width: 20, height: 10 }, square)).toBe(false);
  });
});
