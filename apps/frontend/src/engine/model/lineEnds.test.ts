import { describe, it, expect } from 'vitest';
import { boxFromEndpoints, constrainToAngle, lineEndpoints } from './lineEnds';

const box = (over: Partial<Parameters<typeof lineEndpoints>[0]> = {}) => ({
  x: 100, y: 100, width: 200, height: 80, scaleX: 1, scaleY: 1, rotation: 0, ...over,
});

describe('lineEndpoints', () => {
  it('runs corner to corner of the box', () => {
    expect(lineEndpoints(box())).toEqual({ a: { x: 100, y: 100 }, b: { x: 300, y: 180 } });
  });

  it('takes the other diagonal when an axis is flipped', () => {
    expect(lineEndpoints(box({ scaleX: -1 }))).toEqual({
      a: { x: 300, y: 100 },
      b: { x: 100, y: 180 },
    });
  });

  it('honours rotation, so a handle sits on the line it belongs to', () => {
    // A quarter turn about the centre swaps the run's axis.
    const { a, b } = lineEndpoints(box({ width: 100, height: 0, rotation: 90 }));
    expect(a.x).toBeCloseTo(150, 6);
    expect(b.x).toBeCloseTo(150, 6);
    expect(b.y - a.y).toBeCloseTo(100, 6);
  });
});

describe('boxFromEndpoints', () => {
  it('round-trips through lineEndpoints', () => {
    for (const [a, b] of [
      [{ x: 0, y: 0 }, { x: 100, y: 50 }],
      [{ x: 100, y: 50 }, { x: 0, y: 0 }],
      [{ x: 0, y: 50 }, { x: 100, y: 0 }],
    ] as const) {
      const ends = lineEndpoints(boxFromEndpoints(a, b));
      expect(ends.a.x).toBeCloseTo(a.x, 6);
      expect(ends.a.y).toBeCloseTo(a.y, 6);
      expect(ends.b.x).toBeCloseTo(b.x, 6);
      expect(ends.b.y).toBeCloseTo(b.y, 6);
    }
  });

  it('allows a truly horizontal line, which the box transformer could not make', () => {
    // The transformer floors a box at ten units per axis, so the flattest line
    // it could produce was a ten-pixel diagonal. Endpoint editing is what makes
    // the two most common lines drawable at all.
    const flat = boxFromEndpoints({ x: 0, y: 40 }, { x: 300, y: 40 });
    expect(flat.height).toBe(0);
    const ends = lineEndpoints(flat);
    expect(ends.a.y).toBeCloseTo(ends.b.y, 6);
  });

  it('allows a truly vertical line', () => {
    const upright = boxFromEndpoints({ x: 60, y: 0 }, { x: 60, y: 200 });
    expect(upright.width).toBe(0);
    const ends = lineEndpoints(upright);
    expect(ends.a.x).toBeCloseTo(ends.b.x, 6);
  });

  it('clears rotation, because the endpoints already say the angle', () => {
    expect(boxFromEndpoints({ x: 0, y: 0 }, { x: 10, y: 90 }).rotation).toBe(0);
  });
});

describe('constrainToAngle', () => {
  it('snaps to the nearest fifteen degrees', () => {
    const p = constrainToAngle({ x: 0, y: 0 }, { x: 100, y: 4 });
    expect(Math.atan2(p.y, p.x)).toBeCloseTo(0, 6);
  });

  it('keeps the length, so it reads as rotating rather than as fighting a grid', () => {
    const moving = { x: 70, y: 71 };
    const p = constrainToAngle({ x: 0, y: 0 }, moving);
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(Math.hypot(moving.x, moving.y), 6);
    // 45° is on the fifteen-degree ladder, so this barely moves.
    expect(Math.atan2(p.y, p.x)).toBeCloseTo(Math.PI / 4, 2);
  });

  it('leaves a zero-length drag alone rather than dividing by it', () => {
    expect(constrainToAngle({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({ x: 5, y: 5 });
  });
});
