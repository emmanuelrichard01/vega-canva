import { describe, it, expect } from 'vitest';
import { boxFromEndpoints, constrainToAngle, lineEndpoints, lineNodeFromEndpoints } from './lineEnds';

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

describe('a line stores its endpoints and draws its own box', () => {
  const geo = { kind: 'line' as const };

  it('round-trips the endpoints exactly', () => {
    const a = { x: 40, y: 120 };
    const b = { x: 260, y: 30 };
    const node = lineNodeFromEndpoints(a, b, geo);
    const back = lineEndpoints({ ...node, geometry: node.geometry });
    expect(back.a.x).toBeCloseTo(a.x);
    expect(back.a.y).toBeCloseTo(a.y);
    expect(back.b.x).toBeCloseTo(b.x);
    expect(back.b.y).toBeCloseTo(b.y);
  });

  it('gives a horizontal line real height, which the diagonal box never did', () => {
    // A stroke is centred on its path, so a 3px line along the exact edge of a
    // zero-tall box has half its weight outside it — and marquee, culling and
    // the radar all read that box.
    const node = lineNodeFromEndpoints({ x: 0, y: 50 }, { x: 300, y: 50 }, geo, 3);
    expect(node.height).toBeGreaterThanOrEqual(3);
    expect(node.width).toBeGreaterThanOrEqual(300);
  });

  it('grows the box to hold a wave, which is the whole point', () => {
    const straight = lineNodeFromEndpoints({ x: 0, y: 50 }, { x: 400, y: 50 }, geo, 2);
    const wavy = lineNodeFromEndpoints({ x: 0, y: 50 }, { x: 400, y: 50 },
      { kind: 'line', lineProfile: 'wavy', lineWaves: 5 }, 2);
    // The measured failure this replaced: 380x0 stored against 380x49 drawn.
    expect(wavy.height).toBeGreaterThan(straight.height * 4);
    expect(wavy.y).toBeLessThan(straight.y);
  });

  it('includes the arrowhead, so a marquee round the head catches the line', () => {
    const plain = lineNodeFromEndpoints({ x: 0, y: 50 }, { x: 300, y: 50 }, geo, 4);
    const headed = lineNodeFromEndpoints({ x: 0, y: 50 }, { x: 300, y: 50 },
      { kind: 'arrow', endEnd: 'triangle', endScale: 3 }, 4);
    expect(headed.height).toBeGreaterThan(plain.height);
  });

  it('reads a legacy line, which stores no endpoints at all', () => {
    // Every line drawn before this existed runs corner to corner of its box.
    // If this branch ever goes, every one of them collapses to a point.
    const legacy = { x: 10, y: 20, width: 100, height: 60, scaleX: 1, scaleY: 1, rotation: 0 };
    expect(lineEndpoints(legacy)).toEqual({ a: { x: 10, y: 20 }, b: { x: 110, y: 80 } });
  });

  it('reads a legacy line drawn up-and-left, where the flip is the diagonal', () => {
    const flipped = { x: 10, y: 20, width: 100, height: 60, scaleX: -1, scaleY: -1, rotation: 0 };
    expect(lineEndpoints(flipped)).toEqual({ a: { x: 110, y: 80 }, b: { x: 10, y: 20 } });
  });

  it('drops the flip once endpoints are stored, having nothing left to record', () => {
    const node = lineNodeFromEndpoints({ x: 300, y: 200 }, { x: 20, y: 10 }, geo);
    expect({ sx: node.scaleX, sy: node.scaleY, r: node.rotation }).toEqual({ sx: 1, sy: 1, r: 0 });
    // ...and the direction survives anyway, because it is in the endpoints.
    const back = lineEndpoints({ ...node, geometry: node.geometry });
    expect(back.a.x).toBeGreaterThan(back.b.x);
  });
});
