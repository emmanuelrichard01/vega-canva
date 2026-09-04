import { describe, expect, it } from 'vitest';
import { roundedPolyline } from './connectorCorners';

/**
 * Rounding a routed connector's elbows.
 *
 * The failure this guards is a knot: a fixed radius on a segment shorter than
 * twice that radius consumes the whole segment, and the next corner starts
 * before the previous one finished.
 */

/** An L: right along the top, then down. One corner, both segments 100. */
const ell = [0, 0, 100, 0, 100, 100];

describe('with no radius it is the polyline it was given', () => {
  it('walks the points', () => {
    expect(roundedPolyline(ell, 0)).toBe('M0 0 L100 0 L100 100');
  });

  it('treats a negative radius as none', () => {
    expect(roundedPolyline(ell, -10)).toBe('M0 0 L100 0 L100 100');
  });

  it('has nothing to round on a two-point run', () => {
    // A straight connector is the commonest case and has no corners at all.
    expect(roundedPolyline([0, 0, 50, 50], 20)).toBe('M0 0 L50 50');
  });

  it('answers nothing for nothing', () => {
    expect(roundedPolyline([], 8)).toBe('');
    expect(roundedPolyline([1, 2], 8)).toBe('');
  });
});

describe('a rounded corner', () => {
  it('leaves the segment early and rejoins it late, curving through the corner', () => {
    /**
     * The construction: stop `r` before the corner, quadratic *through* the
     * corner as its control point, resume `r` after it. For a right angle that
     * is the exact quarter-circle a rounded rectangle draws.
     */
    expect(roundedPolyline(ell, 20)).toBe('M0 0 L80 0 Q100 0 100 20 L100 100');
  });

  it('keeps the endpoints exactly where they were', () => {
    // The ends are bound to objects; moving one would detach the arrow from
    // the thing it points at.
    const d = roundedPolyline(ell, 30);
    expect(d.startsWith('M0 0')).toBe(true);
    expect(d.endsWith('L100 100')).toBe(true);
  });

  it('rounds every corner of a longer route', () => {
    const zigzag = [0, 0, 100, 0, 100, 100, 200, 100];
    expect(roundedPolyline(zigzag, 20).match(/Q/g)).toHaveLength(2);
  });
});

describe('no corner borrows from its neighbour', () => {
  it('takes at most half the shorter segment', () => {
    /**
     * The knot this exists to prevent. An elbow ten units from a box's edge is
     * ordinary, and a 40-unit radius there would run past the next corner.
     */
    const tight = [0, 0, 20, 0, 20, 200];
    // Half of the 20-unit segment is 10, so the curve starts at x=10.
    expect(roundedPolyline(tight, 40)).toBe('M0 0 L10 0 Q20 0 20 10 L20 200');
  });

  it('lets two tight corners meet exactly, never overlap', () => {
    // Both corners want the middle segment; each takes half, so they touch at
    // its midpoint and no further.
    const stair = [0, 0, 50, 0, 50, 40, 100, 40];
    const d = roundedPolyline(stair, 100);
    expect(d).toContain('Q50 0 50 20');
    expect(d).toContain('Q50 40 70 40');
  });

  it('skips a corner with a zero-length segment', () => {
    // A duplicated point is a corner with nothing to round against, and the
    // unit vector for it is a division by zero.
    const doubled = [0, 0, 100, 0, 100, 0, 100, 100];
    const d = roundedPolyline(doubled, 20);
    expect(d).not.toContain('NaN');
    expect(d.startsWith('M0 0')).toBe(true);
  });
});

describe('a straight-through corner is not a corner', () => {
  it('passes collinear points through without an arc', () => {
    /**
     * A 180° "corner" has no arc. Constructing one puts a zero-length
     * quadratic in the path, which some renderers draw as a dot on an
     * otherwise clean line.
     */
    const straight = [0, 0, 50, 0, 100, 0];
    expect(roundedPolyline(straight, 20)).not.toContain('Q');
  });

  it('still rounds a genuine corner in the same run', () => {
    const mixed = [0, 0, 50, 0, 100, 0, 100, 100];
    const d = roundedPolyline(mixed, 20);
    expect(d.match(/Q/g)).toHaveLength(1);
  });
});
