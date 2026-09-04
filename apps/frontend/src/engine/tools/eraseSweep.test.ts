import { describe, expect, it } from 'vitest';
import { capsuleSpan, clipPolylineByCapsule } from './eraseHit';

/** A nib that has not moved: the capsule degenerates to a disc. */
const still = (points: { x: number; y: number }[], x: number, y: number, r: number) =>
  clipPolylineByCapsule(points, { x, y }, { x, y }, r);

/**
 * Cutting a stroke with the nib.
 *
 * Two bugs are pinned here, and they pulled in opposite directions.
 *
 * The first was accuracy: a stroke was cut at *sample* granularity, so any
 * segment the nib came near lost both its endpoints. Samples are as far apart
 * as the hand was fast, so the hole was the sample spacing — twenty or more
 * world units — no matter what size the tool was set to, and shrinking the nib
 * appeared to do nothing.
 *
 * The fix for that made the second worse. The sweep erased by stepping discs
 * along the distance travelled, spaced by a fraction of the radius, so halving
 * the radius doubled the passes — and each pass walked every object on the
 * board. At a 4px nib a single quick swipe asked for hundreds of full-document
 * scans and the canvas stopped responding.
 *
 * A capsule is what the row of discs was approximating: every point within `r`
 * of the segment travelled. One pass, exact, and the same cost at any nib size
 * and any speed.
 */

const P = (x: number, y: number) => ({ x, y });

/** A horizontal stroke along y = 0, sampled every 20 units — a fast hand. */
const sparse = [P(0, 0), P(20, 0), P(40, 0), P(60, 0), P(80, 0)];

describe('a nib that does not touch the stroke', () => {
  it('leaves it in one piece', () => {
    const runs = clipPolylineByCapsule(sparse, P(0, 50), P(80, 50), 4);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toHaveLength(sparse.length);
  });

  it('leaves it in one piece for a stationary nib too', () => {
    expect(still(sparse, 40, 50, 4)).toEqual([sparse]);
  });
});

describe('the hole is the nib, not the sampling', () => {
  it('cuts a gap of one diameter in the middle of a long segment', () => {
    /**
     * The original bug, in one assertion. The nib is a 2-unit radius and lands
     * between two samples 20 units apart; the old code deleted both of them.
     */
    const runs = still(sparse, 30, 0, 2);
    expect(runs).toHaveLength(2);
    const gapStart = runs[0][runs[0].length - 1];
    const gapEnd = runs[1][0];
    expect(gapStart.x).toBeCloseTo(28, 6);
    expect(gapEnd.x).toBeCloseTo(32, 6);
  });

  it('scales the hole with the nib', () => {
    const gapFor = (radius: number) => {
      const runs = still(sparse, 30, 0, radius);
      return runs[1][0].x - runs[0][runs[0].length - 1].x;
    };
    expect(gapFor(2)).toBeCloseTo(4, 6);
    expect(gapFor(8)).toBeCloseTo(16, 6);
  });

  it('keeps the untouched ends exactly where they were', () => {
    const runs = still(sparse, 30, 0, 2);
    expect(runs[0][0]).toEqual(P(0, 0));
    expect(runs[1][runs[1].length - 1]).toEqual(P(80, 0));
  });
});

describe('a swept nib', () => {
  it('cuts the whole span it travelled, in one pass', () => {
    // Crossing the stroke from above to below at x = 40, with a 3-unit nib:
    // the hole is the width of the capsule where it meets the line.
    const runs = clipPolylineByCapsule(sparse, P(40, -20), P(40, 20), 3);
    expect(runs).toHaveLength(2);
    expect(runs[0][runs[0].length - 1].x).toBeCloseTo(37, 6);
    expect(runs[1][0].x).toBeCloseTo(43, 6);
  });

  it('erases a whole run travelled along the stroke', () => {
    /**
     * The case a capped row of discs would have got wrong: a long fast swipe
     * along the line. The capsule takes out everything it covered, leaving the
     * ends -- a dotted trail here would be the tool visibly failing.
     */
    const runs = clipPolylineByCapsule(sparse, P(10, 0), P(70, 0), 2);
    expect(runs).toHaveLength(2);
    expect(runs[0].map((p) => p.x)).toEqual([0, 8]);
    expect(runs[1].map((p) => p.x)).toEqual([72, 80]);
  });

  it('removes a stroke it covers completely', () => {
    expect(clipPolylineByCapsule(sparse, P(-10, 0), P(90, 0), 5)).toEqual([]);
  });

  it('costs the same however far the nib travelled', () => {
    // Not a timing test: the point is that there is no per-distance loop to
    // count. One call, one walk of the stroke, at any speed.
    const short = clipPolylineByCapsule(sparse, P(30, -5), P(30, 5), 2);
    const long = clipPolylineByCapsule(sparse, P(30, -5000), P(30, 5000), 2);
    expect(short).toHaveLength(2);
    expect(long).toHaveLength(2);
  });

  it('behaves as a plain disc when the nib has not moved', () => {
    /**
     * The press and the drag go through one code path, so they cannot disagree
     * about what the nib covers. A zero-length sweep is the two end discs,
     * which are the same disc — so the hole is one diameter, centred on the
     * point, exactly as a press should leave it.
     */
    const runs = still(sparse, 30, 0, 2);
    expect(runs).toHaveLength(2);
    expect(runs[0][runs[0].length - 1].x).toBeCloseTo(28, 6);
    expect(runs[1][0].x).toBeCloseTo(32, 6);
  });
});

describe('the capsule itself', () => {
  it('reports nothing for a segment that clears it', () => {
    expect(capsuleSpan(P(0, 100), P(10, 100), P(0, 0), P(10, 0), 3)).toBeNull();
  });

  it('reports one contiguous interval across all three parts', () => {
    /**
     * A capsule is convex, which is what lets the two end discs and the
     * rectangle between them be unioned by taking the outermost bounds — they
     * cannot leave a hole between them.
     */
    const span = capsuleSpan(P(-100, 0), P(100, 0), P(-50, 0), P(50, 0), 4);
    expect(span).not.toBeNull();
    const [lo, hi] = span!;
    expect(lo).toBeLessThan(hi);
    // -54 and 54 on a run from -100 to 100 is 0.23 to 0.77.
    expect(lo).toBeCloseTo(0.23, 6);
    expect(hi).toBeCloseTo(0.77, 6);
  });

  it('is round at the ends, not square', () => {
    // Diagonally off the end of the travel: inside a box of half-width r, but
    // outside the capsule, because the cap is a circle.
    const justOutside = capsuleSpan(P(53, 3), P(53.1, 3), P(0, 0), P(50, 0), 4);
    expect(justOutside).toBeNull();
    // Straight off the end at the same distance, which the cap does reach.
    expect(capsuleSpan(P(53, 0), P(53.1, 0), P(0, 0), P(50, 0), 4)).not.toBeNull();
  });
});
