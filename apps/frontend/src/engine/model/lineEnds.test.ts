import { describe, it, expect } from 'vitest';
import {
  boxFromEndpoints,
  constrainToAngle,
  fitLineToBox,
  lineEndpoints,
  lineNodeFromEndpoints,
  lineNodeFromVertices,
  localVertices,
  runPoints,
  worldVertices,
} from './lineEnds';

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

describe('a line with more than two points', () => {
  const corner = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 80 },
  ];

  it('stores the run and derives a box that contains it', () => {
    const node = lineNodeFromVertices(corner, undefined, { kind: 'line' });
    expect(node.geometry.vertices).toHaveLength(3);
    // The box is the drawn extent plus half a stroke on every side: a
    // two-unit stroke pads one unit each way, so 100x80 becomes 102x82.
    expect(node.width).toBeCloseTo(102, 6);
    expect(node.height).toBeCloseTo(82, 6);
  });

  it('does not grow a vertices field for an ordinary two-point line', () => {
    /**
     * A document should not carry a field for a feature it is not using, and
     * an existing line must be stored exactly as it always was.
     */
    const node = lineNodeFromEndpoints({ x: 0, y: 0 }, { x: 100, y: 0 }, { kind: 'line' });
    expect(node.geometry.vertices).toBeUndefined();
    expect(node.geometry.bends).toBeUndefined();
    expect(node.geometry.a).toEqual({ x: 1, y: 1 });
  });

  it('removes a stale run when a line is reduced back to two points', () => {
    /**
     * `localVertices` prefers `vertices`, so leaving a five-point run standing
     * would make the line snap back to its old shape the next time anything
     * read it -- a change that appears to work and then undoes itself.
     */
    const many = lineNodeFromVertices(corner, undefined, { kind: 'line' });
    const two = lineNodeFromVertices(
      [{ x: 0, y: 0 }, { x: 50, y: 50 }],
      undefined,
      many.geometry
    );
    expect(two.geometry.vertices).toBeUndefined();
  });

  it('keeps the run when a two-point line is bent', () => {
    // A bend makes a two-point line non-straight, so its shape can no longer
    // be read off `a` and `b` alone.
    const bent = lineNodeFromVertices(
      [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      [{ u: 0.5, v: 0.3 }],
      { kind: 'line' }
    );
    expect(bent.geometry.vertices).toHaveLength(2);
    expect(bent.geometry.bends).toEqual([{ u: 0.5, v: 0.3 }]);
    // And its box is the extent of the curve, not of the chord.
    expect(bent.height).toBeGreaterThan(25);
  });

  it('reads back through one function, whichever form it was stored in', () => {
    const many = lineNodeFromVertices(corner, undefined, { kind: 'line' });
    const two = lineNodeFromEndpoints({ x: 0, y: 0 }, { x: 100, y: 0 }, { kind: 'line' });
    const legacy = { x: 0, y: 0, width: 100, height: 50, scaleX: 1, scaleY: 1, rotation: 0 };

    expect(localVertices(many as never)).toHaveLength(3);
    expect(localVertices(two as never)).toHaveLength(2);
    expect(localVertices(legacy as never)).toEqual([{ x: 0, y: 0 }, { x: 100, y: 50 }]);
  });

  it('draws its own shape rather than a profile', () => {
    /**
     * A wave is defined along one run from A to B, and a run of corners has
     * several. The profile is ignored here *and* withdrawn from the panel --
     * a control that does nothing is worse than a control that is absent.
     */
    const node = lineNodeFromVertices(corner, undefined, { kind: 'line', lineProfile: 'wavy' });
    expect(runPoints(node as never)).toHaveLength(3);
  });

  it('puts its vertices where the line is, rotation included', () => {
    const node = { ...lineNodeFromVertices(corner, undefined, { kind: 'line' }), rotation: 90 };
    const upright = worldVertices({ ...node, rotation: 0 } as never);
    const turned = worldVertices(node as never);
    const span = (points: Array<{ x: number; y: number }>, axis: 'x' | 'y') =>
      Math.max(...points.map((p) => p[axis])) - Math.min(...points.map((p) => p[axis]));

    // A quarter turn about the centre: the *run's* own extent swaps axes.
    // Measured on the points rather than on the box, which is a unit larger on
    // each side because it carries half the stroke.
    expect(span(turned, 'x')).toBeCloseTo(span(upright, 'y'), 5);
    expect(span(turned, 'y')).toBeCloseTo(span(upright, 'x'), 5);
    // And it turns about the node's centre, so the run stays where it was.
    const centre = { x: node.x + node.width / 2, y: node.y + node.height / 2 };
    const middle = (points: Array<{ x: number; y: number }>, axis: 'x' | 'y') =>
      (Math.max(...points.map((p) => p[axis])) + Math.min(...points.map((p) => p[axis]))) / 2;
    expect(middle(turned, 'x')).toBeCloseTo(centre.x - (middle(upright, 'y') - centre.y), 5);
  });
});

describe('fitLineToBox', () => {
  const geometry = {
    kind: 'line' as const,
    a: { x: 0, y: 0 },
    b: { x: 100, y: 50 },
    vertices: [{ x: 0, y: 0 }, { x: 60, y: 10 }, { x: 100, y: 50 }],
  };

  it('scales the run with its box', () => {
    /**
     * The bug: the transformer stands down for a *solo* line, so nobody saw
     * that a line caught in a multi-object selection got a new box and kept
     * its old endpoints -- everything else grew and the line stayed put.
     */
    const fitted = fitLineToBox(geometry, { width: 100, height: 50 }, { width: 200, height: 50 })!;
    expect(fitted.vertices).toEqual([{ x: 0, y: 0 }, { x: 120, y: 10 }, { x: 200, y: 50 }]);
  });

  it('scales the two-point form as well, so an old line resizes too', () => {
    const fitted = fitLineToBox(geometry, { width: 100, height: 50 }, { width: 100, height: 100 })!;
    expect(fitted.b).toEqual({ x: 100, y: 100 });
  });

  it('leaves bends alone, which is what chord space is for', () => {
    /**
     * A bend is a fraction of its own chord, so a segment that doubles keeps a
     * curve of the same shape. Stored absolutely they would need scaling here
     * too -- non-uniformly, which a quadratic through three points does not
     * survive.
     */
    const bent = { ...geometry, bends: [{ u: 0.5, v: 0.3 }, null] };
    const fitted = fitLineToBox(bent, { width: 100, height: 50 }, { width: 300, height: 50 })!;
    expect(fitted.bends).toEqual(bent.bends);
  });

  it('does nothing when the box did not change', () => {
    // Returning a fresh object anyway would make every unrelated resize write
    // a geometry the CRDT then has to broadcast.
    expect(fitLineToBox(geometry, { width: 100, height: 50 }, { width: 100, height: 50 })).toBeNull();
  });

  it('survives a box with no extent on one axis', () => {
    // A horizontal line is exactly this: zero tall before its stroke padding.
    const fitted = fitLineToBox(geometry, { width: 100, height: 0 }, { width: 200, height: 0 });
    expect(fitted!.vertices![2]).toEqual({ x: 200, y: 50 });
  });
});
