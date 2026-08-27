import { describe, expect, it } from 'vitest';
import {
  bendFromPoint,
  bendPoint,
  controlPoint,
  hasBend,
  insertVertex,
  isMultiPoint,
  MAX_BEND,
  moveVertex,
  nearestSegment,
  normalizeBends,
  normalizeVertices,
  polylinePoints,
  removeVertex,
  segmentPoints,
  catmullRomPoints,
  straightBends,
  type Bends,
} from './polyline';
import type { Point } from './schema';

const A: Point = { x: 0, y: 0 };
const B: Point = { x: 100, y: 0 };

/** A quadratic Bézier, evaluated. For comparing curves rather than samples. */
const quad = (a: Point, control: Point, b: Point, t: number): Point => {
  const s = 1 - t;
  return {
    x: s * s * a.x + 2 * s * t * control.x + t * t * b.x,
    y: s * s * a.y + 2 * s * t * control.y + t * t * b.y,
  };
};

/** Where the drawn curve actually is at its middle. */
const drawnMiddle = (a: Point, b: Point, bend: Parameters<typeof segmentPoints>[2]) => {
  const pts = segmentPoints(a, b, bend);
  return pts[(pts.length - 1) / 2];
};

describe('bendPoint', () => {
  it('is the chord midpoint when the segment is straight', () => {
    // Which is what makes the handle discoverable: every segment has one, in
    // the place anyone would reach for it.
    expect(bendPoint(A, B, null)).toEqual({ x: 50, y: 0 });
  });

  it('measures across the chord, not down the screen', () => {
    /**
     * The whole reason a bend is stored in the chord's frame. The same bend on
     * a horizontal and a vertical segment bows by the same amount, each in its
     * own chord's normal direction -- so a bent line that is then rotated is
     * still the same bent line.
     */
    const horizontal = bendPoint(A, B, { u: 0.5, v: 0.2 });
    const vertical = bendPoint(A, { x: 0, y: 100 }, { u: 0.5, v: 0.2 });
    expect(horizontal).toEqual({ x: 50, y: 20 });
    expect(vertical).toEqual({ x: -20, y: 50 });
  });

  it('survives a segment with no length', () => {
    // Two clicks in the same place. Every ratio here divides by the length.
    expect(bendPoint(A, A, { u: 0.5, v: 1 })).toEqual({ x: 0, y: 0 });
  });
});

describe('bendFromPoint', () => {
  it('round-trips a dragged handle', () => {
    const bend = bendFromPoint(A, B, { x: 70, y: -30 });
    expect(bendPoint(A, B, bend)).toEqual({ x: 70, y: -30 });
  });

  it('returns to exactly straight when the handle goes back to the middle', () => {
    /**
     * A curve nobody can see but every export samples at ninety-six points is
     * worse than no curve. Letting go roughly where the handle started has to
     * give back a segment that is straight, not one bent by a thousandth.
     */
    expect(bendFromPoint(A, B, { x: 50.4, y: 0.3 })).toBeNull();
  });

  it('clamps a bend that is dragged absurdly far out', () => {
    const bend = bendFromPoint(A, B, { x: 50, y: 100000 });
    expect(bend!.v).toBe(MAX_BEND);
  });

  it('is scale-free, so the same gesture bends a long and a short segment alike', () => {
    const short = bendFromPoint(A, B, { x: 50, y: 25 });
    const long = bendFromPoint(A, { x: 400, y: 0 }, { x: 200, y: 100 });
    expect(short).toEqual(long);
  });
});

describe('segmentPoints', () => {
  it('gives a straight segment exactly its two endpoints', () => {
    // Not a resampled approximation: nothing already on a board moves, and the
    // common case does not pay for a feature it is not using.
    expect(segmentPoints(A, B, null)).toEqual([A, B]);
  });

  it('draws a curve through the handle, not near it', () => {
    /**
     * The handle is the point the curve passes through at its middle -- the
     * Bézier's own control point sits twice as far out, and a handle there
     * would never be under the pointer that is dragging it.
     */
    const bend = { u: 0.5, v: 0.3 };
    expect(drawnMiddle(A, B, bend)).toEqual(bendPoint(A, B, bend));
  });

  it('starts and ends on its vertices', () => {
    const pts = segmentPoints(A, B, { u: 0.7, v: -0.4 });
    expect(pts[0]).toEqual(A);
    expect(pts[pts.length - 1]).toEqual(B);
  });

  it('samples a long segment more finely than a short one', () => {
    const short = segmentPoints(A, { x: 40, y: 0 }, { u: 0.5, v: 0.2 });
    const long = segmentPoints(A, { x: 400, y: 0 }, { u: 0.5, v: 0.2 });
    expect(long.length).toBeGreaterThan(short.length);
  });
});

describe('controlPoint', () => {
  it('is null for a straight segment, so callers cannot draw one by accident', () => {
    expect(controlPoint(A, B, null)).toBeNull();
  });

  it('sits twice as far out as the handle', () => {
    expect(controlPoint(A, B, { u: 0.5, v: 0.25 })).toEqual({ x: 50, y: 50 });
  });
});

describe('polylinePoints', () => {
  const square: Point[] = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
  ];

  it('joins segments without repeating the vertex between them', () => {
    // So every consumer can treat the result as one polyline -- which is what
    // the caps, the sketcher, the outline and the exporter already do.
    expect(polylinePoints(square)).toEqual(square);
  });

  it('is the two points for a two-point line', () => {
    expect(polylinePoints([A, B])).toEqual([A, B]);
  });

  it('expands only the segments that are bent', () => {
    const bends: Bends = [null, { u: 0.5, v: 0.3 }];
    const out = polylinePoints(square, bends);
    expect(out[0]).toEqual(square[0]);
    expect(out[1]).toEqual(square[1]);
    expect(out[out.length - 1]).toEqual(square[2]);
    expect(out.length).toBeGreaterThan(3);
  });

  it('handles a run with nothing in it', () => {
    expect(polylinePoints([])).toEqual([]);
    expect(polylinePoints([A])).toEqual([A]);
  });
});

describe('insertVertex', () => {
  it('puts the new point on a straight segment', () => {
    const out = insertVertex([A, B], undefined, 0, 0.25);
    expect(out.vertices).toEqual([A, { x: 25, y: 0 }, B]);
    expect(out.bends).toEqual([null, null]);
  });

  it('splits a bent segment exactly, so the shape does not move', () => {
    /**
     * de Casteljau: the two quadratics that come out draw the same curve as
     * the one that went in. Rounding the split into two straight halves would
     * be far less code and would make the one gesture that means "I want more
     * control here" destroy the shape it was aimed at.
     */
    const bend = { u: 0.5, v: 0.4 };
    const after = insertVertex([A, B], [bend], 0, 0.5);
    expect(after.vertices).toHaveLength(3);

    /**
     * Compared as *curves*, not as samples. Measuring the split against the
     * drawn polyline would fold in the sampler's own chord error -- about six
     * hundredths of a unit here -- and report it as a defect in the split.
     * de Casteljau's claim is exact, so the assertion should be too: the left
     * half at `2t` is the original at `t`, for every `t` up to the split.
     */
    const [p0, p1, p2] = after.vertices;
    const whole = controlPoint(A, B, bend)!;
    const left = controlPoint(p0, p1, after.bends[0])!;
    const right = controlPoint(p1, p2, after.bends[1])!;

    for (const t of [0, 0.17, 0.33, 0.5]) {
      expect(quad(p0, left, p1, t * 2).x).toBeCloseTo(quad(A, whole, B, t).x, 9);
      expect(quad(p0, left, p1, t * 2).y).toBeCloseTo(quad(A, whole, B, t).y, 9);
      expect(quad(p1, right, p2, t * 2).x).toBeCloseTo(quad(A, whole, B, t + 0.5).x, 9);
      expect(quad(p1, right, p2, t * 2).y).toBeCloseTo(quad(A, whole, B, t + 0.5).y, 9);
    }
  });

  it('lands the split point on the curve rather than on the chord', () => {
    const bend = { u: 0.5, v: 0.4 };
    const out = insertVertex([A, B], [bend], 0, 0.5);
    expect(out.vertices[1]).toEqual(bendPoint(A, B, bend));
  });

  it('keeps the bends list the right length', () => {
    const out = insertVertex([A, B, { x: 100, y: 100 }], [null, null], 1, 0.5);
    expect(out.vertices).toHaveLength(4);
    expect(out.bends).toHaveLength(3);
  });

  it('refuses a segment that does not exist', () => {
    const out = insertVertex([A, B], undefined, 7, 0.5);
    expect(out.vertices).toEqual([A, B]);
  });
});

describe('removeVertex', () => {
  const three: Point[] = [A, { x: 50, y: 50 }, B];

  it('joins the neighbours with a straight segment', () => {
    /**
     * Straight rather than a curve fitted through what two used to describe:
     * two quadratics generally have no single quadratic that matches them, so
     * a "preserved" curve would put the line somewhere nobody had put it.
     */
    const out = removeVertex(three, [{ u: 0.5, v: 0.2 }, { u: 0.5, v: 0.2 }], 1);
    expect(out.vertices).toEqual([A, B]);
    expect(out.bends).toEqual([null]);
  });

  it('drops the right slot when an end goes', () => {
    const out = removeVertex(three, [{ u: 0.5, v: 0.1 }, { u: 0.5, v: 0.9 }], 0);
    expect(out.vertices).toEqual([{ x: 50, y: 50 }, B]);
    expect(out.bends).toEqual([{ u: 0.5, v: 0.9 }]);
    const last = removeVertex(three, [{ u: 0.5, v: 0.1 }, { u: 0.5, v: 0.9 }], 2);
    expect(last.bends).toEqual([{ u: 0.5, v: 0.1 }]);
  });

  it('refuses to take a line below two points', () => {
    // A line with one end is not a line.
    const out = removeVertex([A, B], undefined, 0);
    expect(out.vertices).toEqual([A, B]);
  });

  it('ignores an index that is not there', () => {
    expect(removeVertex(three, undefined, 9).vertices).toEqual(three);
  });
});

describe('moveVertex', () => {
  it('moves one and copies rather than mutating', () => {
    const original: Point[] = [A, B];
    const moved = moveVertex(original, 1, { x: 10, y: 10 });
    expect(moved[1]).toEqual({ x: 10, y: 10 });
    expect(original[1]).toEqual(B);
  });

  it('leaves a bend following its own chord', () => {
    /**
     * The point of storing a bend in chord space. Dragging an endpoint of a
     * bent segment must carry the curve with it -- stored absolutely, the
     * curve would slew sideways instead of following the corner.
     */
    const bend = { u: 0.5, v: 0.3 };
    const moved = moveVertex([A, B], 1, { x: 0, y: 100 });
    expect(drawnMiddle(moved[0], moved[1], bend)).toEqual(bendPoint(moved[0], moved[1], bend));
  });
});

describe('nearestSegment', () => {
  const corner: Point[] = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
  ];

  it('finds which segment the pointer is over', () => {
    expect(nearestSegment(corner, undefined, { x: 30, y: 4 })?.index).toBe(0);
    expect(nearestSegment(corner, undefined, { x: 104, y: 60 })?.index).toBe(1);
  });

  it('reports where along that segment, so the new point lands on the line', () => {
    const hit = nearestSegment(corner, undefined, { x: 25, y: 8 })!;
    expect(hit.t).toBeCloseTo(0.25, 2);
    expect(hit.point).toEqual({ x: 25, y: 0 });
    expect(hit.distance).toBeCloseTo(8, 6);
  });

  it('follows a curve rather than its chord', () => {
    /**
     * A click on the outside of a bend is nearest to the drawn curve, not to
     * the straight line between the vertices -- otherwise adding a point to a
     * curve puts it somewhere the curve is not.
     */
    const bend = { u: 0.5, v: 0.4 };
    const hit = nearestSegment([A, B], [bend], { x: 50, y: 45 })!;
    expect(hit.point.y).toBeCloseTo(40, 6);
    expect(hit.distance).toBeCloseTo(5, 6);
  });

  it('is null for a run with no segments', () => {
    expect(nearestSegment([A], undefined, A)).toBeNull();
  });
});

describe('reading what the document stored', () => {
  it('pads a bends list that is too short', () => {
    /**
     * `geometry` is one last-write-wins value in the CRDT, so a vertex added by
     * one client and removed by another can leave a mismatched pair. The
     * alternative to a slightly wrong curve is a line that does not render.
     */
    expect(normalizeBends(4, [{ u: 0.5, v: 0.2 }])).toEqual([{ u: 0.5, v: 0.2 }, null, null]);
  });

  it('cuts one that is too long', () => {
    expect(normalizeBends(2, [null, null, null])).toHaveLength(1);
  });

  it('rejects a bend that is not two numbers', () => {
    expect(normalizeBends(2, [{ u: 'x', v: 1 }])).toEqual([null]);
    expect(normalizeBends(2, [{ u: NaN, v: 1 }])).toEqual([null]);
    expect(normalizeBends(2, 'nonsense')).toEqual([null]);
  });

  it('clamps a stored bend that is out of range', () => {
    expect(normalizeBends(2, [{ u: 0.5, v: 99 }])).toEqual([{ u: 0.5, v: MAX_BEND }]);
  });

  it('keeps only points that are really points', () => {
    expect(normalizeVertices([A, { x: 1 }, B])).toEqual([A, B]);
    expect(normalizeVertices([A, { x: Infinity, y: 0 }, B])).toEqual([A, B]);
  });

  it('refuses a run that cannot be a line', () => {
    expect(normalizeVertices([A])).toBeNull();
    expect(normalizeVertices(null)).toBeNull();
  });
});

describe('isMultiPoint / hasBend', () => {
  it('knows a two-point line from a run of corners', () => {
    expect(isMultiPoint([A, B])).toBe(false);
    expect(isMultiPoint([A, { x: 5, y: 5 }, B])).toBe(true);
    expect(isMultiPoint(undefined)).toBe(false);
  });

  it('knows a straight run from a bent one', () => {
    // A two-point line with a bend is still not straight, which is why the
    // renderer cannot decide from the vertex count alone.
    expect(hasBend([null, null])).toBe(false);
    expect(hasBend([null, { u: 0.5, v: 0.1 }])).toBe(true);
    expect(hasBend(undefined)).toBe(false);
  });
});

describe('drawing a run as a curve', () => {
  const corner: Point[] = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
  ];

  /** The direction the curve is travelling as it passes sample `i`. */
  const heading = (points: Point[], i: number) =>
    Math.atan2(points[i + 1].y - points[i].y, points[i + 1].x - points[i].x);

  it('takes the kink out of the corner', () => {
    /**
     * The thing per-segment bends could not do. Bowing a segment bends its
     * *middle* and leaves its ends where they were, so a sharp turn stayed a
     * sharp turn between two arcs. Here the run arrives at the corner and
     * leaves it along one shared direction — the turn is spread across the
     * curve instead of happening all at one point.
     *
     * The corner is still *on* the curve, and should be: a route goes through
     * the points you placed. What changes is that it no longer stops there to
     * turn ninety degrees.
     */
    const drawn = catmullRomPoints(corner);
    const at = drawn.findIndex((p) => Math.hypot(p.x - 100, p.y) < 1e-6);
    expect(at).toBeGreaterThan(0);

    // No single step turns by anything like the ninety degrees the raw corner
    // does -- which is exactly the difference between a kink and a curve.
    let sharpest = 0;
    for (let i = 0; i + 2 < drawn.length; i += 1) {
      sharpest = Math.max(sharpest, Math.abs(heading(drawn, i + 1) - heading(drawn, i)));
    }
    expect(sharpest).toBeLessThan(Math.PI / 8);
  });

  it('still passes through every point the line was drawn through', () => {
    const drawn = catmullRomPoints(corner);
    for (const vertex of corner) {
      const nearest = Math.min(...drawn.map((p) => Math.hypot(p.x - vertex.x, p.y - vertex.y)));
      expect(nearest).toBeLessThan(1e-6);
    }
  });

  it('starts and finishes exactly on the run’s own ends', () => {
    // Whatever it does in between, a line still runs from where you put its
    // first point to where you put its last.
    const drawn = catmullRomPoints(corner);
    expect(drawn[0]).toEqual(corner[0]);
    expect(drawn[drawn.length - 1]).toEqual(corner[corner.length - 1]);
  });

  it('does not tie a knot at a hairpin', () => {
    /**
     * The reason this is *centripetal* Catmull-Rom rather than the uniform
     * form. Uniform loops on itself the moment the points are unevenly spaced,
     * which a hand-drawn route always is.
     */
    const hairpin: Point[] = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 10, y: 12 },
      { x: 200, y: 24 },
    ];
    const drawn = catmullRomPoints(hairpin);
    for (const p of drawn) {
      expect(p.x).toBeGreaterThan(-70);
      expect(p.x).toBeLessThan(270);
    }
  });

  it('leaves a straight run straight', () => {
    const straight: Point[] = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }];
    for (const p of catmullRomPoints(straight)) expect(p.y).toBeCloseTo(0, 9);
  });

  it('has nothing to smooth below three points', () => {
    // Two points make one straight segment; there is no corner to round.
    expect(catmullRomPoints([{ x: 0, y: 0 }, { x: 10, y: 0 }])).toEqual([
      { x: 0, y: 0 }, { x: 10, y: 0 },
    ]);
  });

  it('is what polylinePoints draws when the run is smooth', () => {
    /**
     * Checked before the bends are read, not merged with them: the two describe
     * the same segments and one of them has to be in charge.
     */
    const bends: Bends = [{ u: 0.5, v: 0.4 }, null];
    expect(polylinePoints(corner, bends, true)).toEqual(catmullRomPoints(corner));
    expect(polylinePoints(corner, bends, false)).not.toEqual(catmullRomPoints(corner));
  });
});

describe('straightBends', () => {
  it('is a straight slot for every segment', () => {
    expect(straightBends(4)).toEqual([null, null, null]);
    expect(straightBends(1)).toEqual([]);
    expect(straightBends(0)).toEqual([]);
  });
});
