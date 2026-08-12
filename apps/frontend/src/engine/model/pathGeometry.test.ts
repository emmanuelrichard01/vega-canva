import { describe, it, expect } from 'vitest';
import type { BezierGeometry } from './schema';
import {
  anchorMode,
  cubicAt,
  flattenPath,
  fromAnchors,
  insertAnchor,
  moveAnchor,
  moveHandle,
  nearestPointOnPath,
  pathBounds,
  pathData,
  reframePath,
  removeAnchor,
  setAnchorMode,
  splitCubic,
  toAnchors,
  toCubics,
  type Anchor,
} from './pathGeometry';

const line = (): BezierGeometry => ({
  kind: 'bezier',
  segments: [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ],
  closed: false,
});

/** A square, drawn with straight segments, closed. */
const square = (): BezierGeometry => ({
  kind: 'bezier',
  segments: [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ],
  closed: true,
});

describe('toCubics', () => {
  it('degenerates a handleless segment into the straight line it draws', () => {
    const [c] = toCubics(line());
    expect(c).toEqual({ x0: 0, y0: 0, c1x: 0, c1y: 0, c2x: 100, c2y: 0, x1: 100, y1: 0 });
    // Which is to say: the midpoint is where a straight line's would be.
    expect(cubicAt(c, 0.5)).toEqual({ x: 50, y: 0 });
  });

  it('gives a closed path one more curve than an open one', () => {
    expect(toCubics(square())).toHaveLength(4);
    expect(toCubics({ ...square(), closed: false })).toHaveLength(3);
  });

  it('reads the closing curve handles from segment zero', () => {
    const geo: BezierGeometry = {
      ...square(),
      segments: [{ x: 0, y: 0, cp1x: -40, cp1y: 100, cp2x: -40, cp2y: 0 }, ...square().segments.slice(1)],
    };
    const cubics = toCubics(geo);
    const closing = cubics[cubics.length - 1];
    expect(closing).toMatchObject({ x0: 0, y0: 100, c1x: -40, c1y: 100, c2x: -40, c2y: 0, x1: 0, y1: 0 });
  });
});

describe('the anchor-centric view', () => {
  it('gives an anchor the handle that leaves it, which lives on the next segment', () => {
    const geo: BezierGeometry = {
      kind: 'bezier',
      segments: [{ x: 0, y: 0 }, { x: 100, y: 0, cp1x: 30, cp1y: -50, cp2x: 70, cp2y: -50 }],
      closed: false,
    };
    const anchors = toAnchors(geo);
    expect(anchors[0]).toEqual({ x: 0, y: 0, outX: 30, outY: -50 });
    expect(anchors[1]).toEqual({ x: 100, y: 0, inX: 70, inY: -50 });
  });

  it('drops segment zero’s controls on an open path, where they describe nothing', () => {
    const geo: BezierGeometry = {
      kind: 'bezier',
      segments: [{ x: 0, y: 0, cp2x: 9, cp2y: 9 }, { x: 100, y: 0 }],
      closed: false,
    };
    expect(toAnchors(geo)[0].inX).toBeUndefined();
  });

  it('keeps them on a closed path, where they are the closing curve', () => {
    const geo: BezierGeometry = { ...square() };
    geo.segments[0] = { x: 0, y: 0, cp2x: -40, cp2y: 0 };
    expect(toAnchors(geo)[0]).toMatchObject({ inX: -40, inY: 0 });
  });

  it('round-trips every path it can describe', () => {
    for (const geo of [line(), square(), { ...square(), closed: false }]) {
      expect(fromAnchors(toAnchors(geo), geo.closed)).toEqual(geo);
    }
  });
});

describe('pathData', () => {
  it('closes with Z after the closing curve, not instead of it', () => {
    const d = pathData(square());
    expect(d.endsWith('C 0 100 0 0 0 0 Z')).toBe(true);
    // Four curves for four sides.
    expect(d.match(/C /g)).toHaveLength(4);
  });

  it('is a bare move for a path of one anchor, which draws nothing but is somewhere', () => {
    expect(pathData({ kind: 'bezier', segments: [{ x: 5, y: 6 }], closed: false })).toBe('M 5 6');
  });
});

describe('flattening', () => {
  it('spends points where the curve bends and not where it does not', () => {
    const straight = flattenPath(line());
    const curved = flattenPath({
      kind: 'bezier',
      segments: [{ x: 0, y: 0 }, { x: 100, y: 0, cp1x: 0, cp1y: -120, cp2x: 100, cp2y: -120 }],
      closed: false,
    });
    expect(straight).toHaveLength(2);
    expect(curved.length).toBeGreaterThan(8);
  });

  it('does not repeat the first point at the end of a closed contour', () => {
    const points = flattenPath(square());
    expect(points).toHaveLength(4);
    expect(points[points.length - 1]).not.toEqual(points[0]);
  });

  it('stays within tolerance of the real curve', () => {
    // A quarter circle of radius 100, as the standard kappa approximation.
    const k = 55.22847498307936;
    const geo: BezierGeometry = {
      kind: 'bezier',
      segments: [{ x: 100, y: 0 }, { x: 0, y: 100, cp1x: 100, cp1y: k, cp2x: k, cp2y: 100 }],
      closed: false,
    };
    for (const p of flattenPath(geo)) {
      expect(Math.abs(Math.hypot(p.x, p.y) - 100)).toBeLessThan(1);
    }
  });
});

describe('pathBounds', () => {
  it('measures the curve, not the control hull', () => {
    // Handles pulled 120 up, but a cubic only reaches three quarters of the way
    // to its controls — the hull would claim a box half again too tall.
    const geo: BezierGeometry = {
      kind: 'bezier',
      segments: [{ x: 0, y: 0 }, { x: 100, y: 0, cp1x: 0, cp1y: -120, cp2x: 100, cp2y: -120 }],
      closed: false,
    };
    const b = pathBounds(geo);
    expect(b.height).toBeGreaterThan(85);
    expect(b.height).toBeLessThan(95);
  });
});

describe('nearestPointOnPath', () => {
  it('lands on the segment under the pointer', () => {
    const hit = nearestPointOnPath(square(), { x: 50, y: -3 });
    expect(hit?.curve).toBe(0);
    expect(hit?.point.x).toBeCloseTo(50, 1);
    expect(hit?.distance).toBeCloseTo(3, 1);
  });

  it('finds the closing run of a closed path, which is a curve like any other', () => {
    const hit = nearestPointOnPath(square(), { x: -2, y: 50 });
    expect(hit?.curve).toBe(3);
  });

  it('has nothing to say about a path with one anchor', () => {
    expect(nearestPointOnPath({ kind: 'bezier', segments: [{ x: 0, y: 0 }], closed: false }, { x: 0, y: 0 })).toBeNull();
  });
});

describe('insertAnchor', () => {
  it('adds a point without moving the outline', () => {
    const curved: BezierGeometry = {
      kind: 'bezier',
      segments: [{ x: 0, y: 0 }, { x: 100, y: 0, cp1x: 0, cp1y: -120, cp2x: 100, cp2y: -120 }],
      closed: false,
    };
    // Every point of the split path lies on the original *curve* — asked of
    // the curve itself, not of the original's sample points. Two flattenings
    // of the same curve put their points in different places, so comparing
    // sample to sample measures the spacing of the samples and not the shape.
    for (const p of flattenPath(insertAnchor(curved, { curve: 0, t: 0.37 }), 0.01)) {
      expect(nearestPointOnPath(curved, p)?.distance).toBeLessThan(0.05);
    }
    expect(insertAnchor(curved, { curve: 0, t: 0.37 }).segments).toHaveLength(3);
  });

  it('puts the new anchor directly after the curve it split', () => {
    const next = insertAnchor(square(), { curve: 1, t: 0.5 });
    expect(next.segments[2]).toMatchObject({ x: 100, y: 50 });
    expect(next.segments).toHaveLength(5);
  });

  it('splits the closing curve into the gap before anchor zero', () => {
    const next = insertAnchor(square(), { curve: 3, t: 0.5 });
    expect(next.segments).toHaveLength(5);
    expect(next.segments[4]).toMatchObject({ x: 0, y: 50 });
    expect(next.closed).toBe(true);
  });
});

describe('removeAnchor', () => {
  it('leaves the neighbours where they were', () => {
    const next = removeAnchor(square(), 1);
    expect(next?.segments.map((s) => [s.x, s.y])).toEqual([
      [0, 0],
      [100, 100],
      [0, 100],
    ]);
  });

  it('declines to reduce a path to a single point, which is nothing to draw', () => {
    expect(removeAnchor(line(), 0)).toBeNull();
  });
});

describe('handle modes', () => {
  it('reads collinear equal-length handles as mirrored', () => {
    const geo = fromAnchors(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0, inX: 80, inY: 0, outX: 120, outY: 0 },
        { x: 200, y: 0 },
      ],
      false
    );
    expect(anchorMode(geo, 1)).toBe('mirrored');
  });

  it('reads collinear unequal ones as smooth, which is the difference', () => {
    const geo = fromAnchors(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0, inX: 80, inY: 0, outX: 160, outY: 0 },
        { x: 200, y: 0 },
      ],
      false
    );
    expect(anchorMode(geo, 1)).toBe('smooth');
  });

  it('reads handles folded back on each other as a corner, not as smooth', () => {
    // Collinear by the cross product alone, but both pointing the same way:
    // a cusp, which is a corner.
    const geo = fromAnchors(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0, inX: 80, inY: 0, outX: 60, outY: 0 },
        { x: 200, y: 0 },
      ],
      false
    );
    expect(anchorMode(geo, 1)).toBe('corner');
  });
});

describe('moveHandle', () => {
  const smooth = () =>
    fromAnchors(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0, inX: 80, inY: 0, outX: 140, outY: 0 },
        { x: 200, y: 0 },
      ],
      false
    );

  it('rotates the opposite handle of a smooth anchor without stretching it', () => {
    const next = moveHandle(smooth(), 1, 'in', { x: 100, y: -20 });
    const a = toAnchors(next)[1];
    // The incoming handle went straight up; the outgoing one turned to face
    // straight down, keeping its own length of 40.
    expect(a.outX).toBeCloseTo(100, 6);
    expect(a.outY).toBeCloseTo(40, 6);
  });

  it('keeps both lengths when the anchor is mirrored', () => {
    const geo = fromAnchors(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0, inX: 80, inY: 0, outX: 120, outY: 0 },
        { x: 200, y: 0 },
      ],
      false
    );
    const a = toAnchors(moveHandle(geo, 1, 'in', { x: 100, y: -50 }))[1];
    expect(a.outX).toBeCloseTo(100, 6);
    expect(a.outY).toBeCloseTo(50, 6);
  });

  it('leaves the other handle alone once the pair is broken', () => {
    const a = toAnchors(moveHandle(smooth(), 1, 'in', { x: 100, y: -20 }, { break: true }))[1];
    expect(a.outX).toBe(140);
    expect(a.outY).toBe(0);
  });

  it('leaves a corner a corner', () => {
    const geo = fromAnchors([{ x: 0, y: 0 }, { x: 100, y: 0, inX: 80, inY: 0 }, { x: 200, y: 0 }], false);
    const a = toAnchors(moveHandle(geo, 1, 'in', { x: 100, y: -20 }))[1];
    expect(a.outX).toBeUndefined();
  });
});

describe('moveAnchor', () => {
  it('carries the handles, which are stored absolutely and would be left behind', () => {
    const geo = fromAnchors(
      [{ x: 0, y: 0 }, { x: 100, y: 0, inX: 80, inY: 0, outX: 120, outY: 0 }, { x: 200, y: 0 }],
      false
    );
    const a = toAnchors(moveAnchor(geo, 1, { x: 110, y: 30 }))[1];
    expect([a.inX, a.inY]).toEqual([90, 30]);
    expect([a.outX, a.outY]).toEqual([130, 30]);
  });

  it('has no outgoing handle to carry at the end of an open path', () => {
    // Nothing leaves the last anchor, so a handle for the curve that leaves it
    // describes a curve that does not exist. `fromAnchors` drops it rather
    // than storing a control point no renderer will ever read.
    const geo = fromAnchors([{ x: 0, y: 0 }, { x: 100, y: 0, outX: 120, outY: 0 }], false);
    expect(toAnchors(geo)[1].outX).toBeUndefined();
  });
});

describe('setAnchorMode', () => {
  it('smooths along the line between the neighbours', () => {
    const geo: BezierGeometry = {
      kind: 'bezier',
      segments: [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 200, y: 0 }],
      closed: false,
    };
    const a = toAnchors(setAnchorMode(geo, 1, 'smooth'))[1];
    // Neighbours run left-to-right and level with each other, so the handles
    // come out horizontal — the curve now sweeps through rather than kinks.
    expect(a.inY).toBeCloseTo(100, 6);
    expect(a.outY).toBeCloseTo(100, 6);
    expect(a.inX).toBeLessThan(100);
    expect(a.outX).toBeGreaterThan(100);
    expect(anchorMode(setAnchorMode(geo, 1, 'smooth'), 1)).not.toBe('corner');
  });

  it('strips both handles on the way back to a corner', () => {
    const smoothed = setAnchorMode(
      { kind: 'bezier', segments: [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 200, y: 0 }], closed: false },
      1,
      'smooth'
    );
    const a = toAnchors(setAnchorMode(smoothed, 1, 'corner'))[1];
    expect(a.inX).toBeUndefined();
    expect(a.outX).toBeUndefined();
  });
});

describe('reframePath', () => {
  it('reports how far the node must move to keep the drawing still', () => {
    const geo: BezierGeometry = {
      kind: 'bezier',
      segments: [{ x: -20, y: -5 }, { x: 80, y: 45 }],
      closed: false,
    };
    const framed = reframePath(geo);
    expect([framed.dx, framed.dy]).toEqual([-20, -5]);
    expect(framed.geometry.segments[0]).toMatchObject({ x: 0, y: 0 });
    expect([framed.width, framed.height]).toEqual([100, 50]);
  });

  it('floors a flat path at one unit, so it still has something to click', () => {
    const framed = reframePath(line());
    expect(framed.height).toBe(1);
  });
});

describe('splitCubic', () => {
  it('produces two halves that trace the original exactly', () => {
    const c = { x0: 0, y0: 0, c1x: 0, c1y: 100, c2x: 100, c2y: 100, x1: 100, y1: 0 };
    const [a, b] = splitCubic(c, 0.25);
    expect(a.x1).toBeCloseTo(cubicAt(c, 0.25).x, 9);
    expect(a.y1).toBeCloseTo(cubicAt(c, 0.25).y, 9);
    // The far half, sampled halfway, is the original sampled five eighths along.
    expect(cubicAt(b, 0.5).x).toBeCloseTo(cubicAt(c, 0.625).x, 9);
    expect(cubicAt(b, 0.5).y).toBeCloseTo(cubicAt(c, 0.625).y, 9);
  });
});

describe('fromAnchors', () => {
  it('gives the closing curve of a closed path to segment zero', () => {
    const anchors: Anchor[] = [
      { x: 0, y: 0, inX: -30, inY: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100, outX: -30, outY: 100 },
    ];
    const geo = fromAnchors(anchors, true);
    expect(geo.segments[0]).toEqual({ x: 0, y: 0, cp1x: -30, cp1y: 100, cp2x: -30, cp2y: 0 });
  });

  it('drops them when the path is open, where there is no closing curve to own them', () => {
    const geo = fromAnchors([{ x: 0, y: 0, inX: -30, inY: 0 }, { x: 100, y: 0 }], false);
    expect(geo.segments[0]).toEqual({ x: 0, y: 0 });
  });
});
