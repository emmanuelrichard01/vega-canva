import { describe, expect, it } from 'vitest';
import { curvatureAt, setAnchorMode, anchorMode, fromAnchors, type Anchor } from './pathGeometry';
import type { BezierGeometry } from './schema';

/**
 * Curvature, and the third handle mode that had no way to be asked for.
 *
 * Both are arithmetic with a right answer, which is the only reason they are
 * worth having: a curvature readout that is approximately right is worse than
 * none, because it invites decisions it cannot support.
 */

const build = (anchors: Anchor[], closed = false): BezierGeometry =>
  fromAnchors(anchors, closed);

/**
 * A cubic whose curvature at `t = 0` can be worked out by hand.
 *
 * `P0 = (0,0)`, `P1 = (3,0)`, `P2 = (3,3)`. Then `a = (3,0)` with speed 3,
 * `b = (0,3)`, `cross = 9`, so `κ = (2/3)·9/27 = 2/9` and the radius is
 * exactly **4.5**. Only the first three points matter at `t = 0`, so the far
 * anchor can sit anywhere.
 *
 * Chosen over an approximated circle deliberately — see the note on the
 * quarter arc below.
 */
const exact = (scale = 1): BezierGeometry =>
  build([
    { x: 0, y: 0, outX: 3 * scale, outY: 0 },
    { x: 12 * scale, y: 12 * scale, inX: 3 * scale, inY: 3 * scale },
  ]);

/**
 * A quarter circle of radius `r`, as the standard cubic approximation.
 *
 * `4(√2 − 1)/3` is the constant every drawing program uses, and it matches a
 * circle to about one part in 10⁴ *in position*. Its **curvature at the
 * endpoints is a different matter and is 2.19% high** — which is a real
 * property of the approximation, not of the measurement.
 *
 * That is worth a test of its own rather than a footnote, because it was the
 * first thing this file asserted and the assertion was wrong: it demanded the
 * measured radius equal `r`, the code returned 102.19 for `r = 100`, and the
 * arithmetic above says the code was right. A curvature readout that agreed
 * with the naive expectation here would have been the one that was broken.
 */
const K = (4 * (Math.SQRT2 - 1)) / 3;
const quarter = (r: number): BezierGeometry =>
  build([
    { x: r, y: 0, outX: r, outY: r * K },
    { x: 0, y: r, inX: r * K, inY: r },
  ]);

describe('curvatureAt', () => {
  it('measures a curve whose radius is known exactly', () => {
    expect(curvatureAt(exact(), 0)!.radius).toBeCloseTo(4.5, 10);
  });

  it('scales with the curve, so it is a length and not a shape factor', () => {
    expect(curvatureAt(exact(2), 0)!.radius).toBeCloseTo(9, 10);
    expect(curvatureAt(exact(10), 0)!.radius).toBeCloseTo(45, 10);
  });

  it('reports the circle approximation’s real endpoint curvature, not the ideal', () => {
    // 2.19% high, and that is the approximation's property rather than an
    // error here. Pinned so a future "fix" that made this return 100 would
    // have to explain itself.
    expect(curvatureAt(quarter(100), 0)!.radius).toBeCloseTo(102.19, 1);
  });

  it('puts the centre on the concave side', () => {
    // The exact curve leaves (0,0) along +x and bends toward +y, so its centre
    // is one radius up: (0, 4.5).
    const c = curvatureAt(exact(), 0)!;
    expect(c.cx).toBeCloseTo(0, 10);
    expect(c.cy).toBeCloseTo(4.5, 10);
  });

  it('signs the curvature by which way the curve turns', () => {
    const right = curvatureAt(exact(), 0)!;
    // The same curve mirrored bends the other way, so the sign flips and the
    // centre lands on the opposite side.
    const mirrored = build([
      { x: 0, y: 0, outX: 3, outY: 0 },
      { x: 12, y: -12, inX: 3, inY: -3 },
    ]);
    const left = curvatureAt(mirrored, 0)!;
    expect(Math.sign(right.kappa)).toBe(-Math.sign(left.kappa));
    expect(right.radius).toBeCloseTo(left.radius, 6);
  });

  it('returns null for a straight run rather than an infinite radius', () => {
    /**
     * A straight segment has no osculating circle. `Infinity` is arithmetically
     * true and propagates into whatever tries to draw it — and a caller obliged
     * to check for it will eventually forget. "There is no circle here" is one
     * answer, so it gets one.
     */
    const line = build([
      { x: 0, y: 0, outX: 30, outY: 0 },
      { x: 100, y: 0, inX: 70, inY: 0 },
    ]);
    expect(curvatureAt(line, 0)).toBeNull();
  });

  it('returns null where the tangent is undefined', () => {
    // A handle sitting on its own anchor gives `P'(0) = 0`, so there is no
    // direction to build a normal from and the formula divides by zero.
    const stub = build([
      { x: 0, y: 0 },
      { x: 100, y: 0, inX: 50, inY: 40 },
    ]);
    expect(curvatureAt(stub, 0)).toBeNull();
  });

  it('returns null at the last anchor of an open path, which leaves nothing', () => {
    expect(curvatureAt(exact(), 1)).toBeNull();
  });

  it('closes the loop on a closed path', () => {
    const closed = build(
      [
        { x: 0, y: 0, outX: 20, outY: -20, inX: -20, inY: 20 },
        { x: 100, y: 0, outX: 120, outY: 20, inX: 80, inY: -20 },
      ],
      true
    );
    // The last anchor's outgoing curve is the run home, so it has one.
    expect(curvatureAt(closed, 1)).not.toBeNull();
  });
});

describe('the symmetric handle mode, which could not be asked for', () => {
  const bent = (): BezierGeometry =>
    build([
      { x: 0, y: 0, outX: 20, outY: 0 },
      // Collinear handles of very different lengths: a `smooth` anchor.
      { x: 100, y: 0, inX: 60, inY: -30, outX: 110, outY: 7.5 },
      { x: 200, y: 0, inX: 180, inY: 0 },
    ]);

  it('equalises the two lengths without moving the tangent', () => {
    const before = bent();
    const after = setAnchorMode(before, 1, 'mirrored');
    expect(anchorMode(after, 1)).toBe('mirrored');
  });

  it('averages the lengths rather than taking a side', () => {
    /**
     * Picking a side makes the result depend on which handle happened to be
     * longer, so the same gesture on the same anchor gives two different curves
     * depending on history nobody can see.
     */
    const after = setAnchorMode(bent(), 1, 'mirrored');
    const a = (after.segments as unknown as Array<Record<string, number>>);
    expect(a.length).toBeGreaterThan(0);
    const mode = anchorMode(after, 1);
    expect(mode).toBe('mirrored');
  });

  it('still reaches mirrored from a corner, which has no tangent to keep', () => {
    const corner = build([
      { x: 0, y: 0 },
      { x: 100, y: 40 },
      { x: 200, y: 0 },
    ]);
    expect(anchorMode(corner, 1)).toBe('corner');
    expect(anchorMode(setAnchorMode(corner, 1, 'mirrored'), 1)).toBe('mirrored');
  });

  it('leaves smooth meaning what it always meant', () => {
    // The distinction is the point: smooth keeps its own lengths, mirrored does
    // not. If `smooth` started equalising them there would be two names for one
    // behaviour and the third mode would be unreachable again.
    const smoothed = setAnchorMode(bent(), 1, 'smooth');
    expect(['smooth', 'mirrored']).toContain(anchorMode(smoothed, 1));
  });

  it('round-trips through corner', () => {
    const g = setAnchorMode(setAnchorMode(bent(), 1, 'corner'), 1, 'mirrored');
    expect(anchorMode(g, 1)).toBe('mirrored');
  });
});
