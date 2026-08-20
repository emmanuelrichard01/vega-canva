import { describe, it, expect } from 'vitest';
import {
  LINE_PROFILES,
  LINE_PROFILE_LABELS,
  MAX_WAVES,
  MIN_WAVES,
  defaultEndAlign,
  linePoints,
  type LineProfile,
} from './linePath';
import type { Point } from './schema';

/**
 * The profiles are pure geometry, and they were tuned by eye — the coil alone
 * was rebuilt four times from a formula before being stamped from a reference,
 * with two placement bugs found by looking at it rather than by any check.
 *
 * So these assert the *character* each profile is supposed to have — it doubles
 * back, it is centred, it starts and ends on the line — rather than pinning the
 * sampled point lists, which are meant to stay tunable.
 */

const A: Point = { x: 0, y: 0 };
const B: Point = { x: 600, y: 0 };
const LENGTH = 600;

/** Every profile that actually draws a shape; `straight` is the pass-through. */
const SHAPED = LINE_PROFILES.filter((p) => p !== 'straight');

/** A point in the run's own frame: distance along it, and offset across it. */
function project(p: Point, a: Point, b: Point): { along: number; across: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  return {
    along: (p.x - a.x) * ux + (p.y - a.y) * uy,
    across: (p.x - a.x) * -uy + (p.y - a.y) * ux,
  };
}

const alongs = (pts: Point[], a = A, b = B) => pts.map((p) => project(p, a, b).along);
const acrosses = (pts: Point[], a = A, b = B) => pts.map((p) => project(p, a, b).across);
const peak = (pts: Point[]) => Math.max(...acrosses(pts).map(Math.abs));

describe('LINE_PROFILES', () => {
  // Invariant 7: a second list of the same fact drifts. The labels are that
  // second list, and a profile missing one reads as blank in the panel.
  it('has a label for every profile and no orphans', () => {
    expect(Object.keys(LINE_PROFILE_LABELS).sort()).toEqual([...LINE_PROFILES].sort());
  });

  it('produces at least two finite points for every profile', () => {
    for (const profile of LINE_PROFILES) {
      const pts = linePoints(A, B, profile, 6);
      expect(pts.length, profile).toBeGreaterThanOrEqual(2);
      for (const p of pts) {
        const finite = Number.isFinite(p.x) && Number.isFinite(p.y);
        expect(finite, `${profile} ${JSON.stringify(p)}`).toBe(true);
      }
    }
  });
});

describe('the endpoint contract', () => {
  // End caps are placed on the first and last points. A profile that starts or
  // finishes anywhere but its own endpoints puts the arrowhead off the line.
  it('starts at a and finishes at b, whatever the profile', () => {
    for (const profile of LINE_PROFILES) {
      const pts = linePoints(A, B, profile, 6);
      const first = pts[0];
      const last = pts[pts.length - 1];
      expect(first.x, profile).toBeCloseTo(A.x, 9);
      expect(first.y, profile).toBeCloseTo(A.y, 9);
      expect(last.x, profile).toBeCloseTo(B.x, 9);
      expect(last.y, profile).toBeCloseTo(B.y, 9);
    }
  });

  // Documented promise: a straight line is bit-for-bit what it always was, so
  // applying a profile unconditionally cannot move anything already on a board.
  it('hands straight back exactly the two points it was given', () => {
    const pts = linePoints(A, B, 'straight', 6);
    expect(pts).toHaveLength(2);
    expect(pts[0]).toBe(A);
    expect(pts[1]).toBe(B);
  });

  // A line being born under the pointer has no length, and every profile
  // divides by it.
  it('never produces NaN for a zero-length run', () => {
    for (const profile of LINE_PROFILES) {
      for (const b of [{ x: 0, y: 0 }, { x: 1e-9, y: 0 }]) {
        const pts = linePoints(A, b, profile, 6);
        expect(pts, profile).toHaveLength(2);
        for (const p of pts) {
          expect(Number.isNaN(p.x) || Number.isNaN(p.y), profile).toBe(false);
        }
      }
    }
  });
});

describe('orientation', () => {
  /**
   * The failure this exists to catch is named in the source: a profile
   * described in absolute coordinates comes out correct on a horizontal line
   * and sideways on a vertical one. Every profile is written in along/across
   * and mapped out once, so drawing a rotated run must equal rotating the
   * drawing of a flat one.
   */
  it('draws the same shape at any angle', () => {
    const theta = 0.6457718; // 37 degrees, so nothing lands on an axis
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const rotated: Point = { x: A.x + LENGTH * cos, y: A.y + LENGTH * sin };

    for (const profile of SHAPED) {
      const flat = linePoints(A, B, profile, 5);
      const turned = linePoints(A, rotated, profile, 5);
      expect(turned.length, profile).toBe(flat.length);
      for (let i = 0; i < flat.length; i += 1) {
        const x = flat[i].x * cos - flat[i].y * sin;
        const y = flat[i].x * sin + flat[i].y * cos;
        expect(turned[i].x, `${profile}[${i}].x`).toBeCloseTo(x, 6);
        expect(turned[i].y, `${profile}[${i}].y`).toBeCloseTo(y, 6);
      }
    }
  });

  it('draws the same extent backwards', () => {
    // Reversing the ends flips which side is "across", so the mark mirrors —
    // but how far it stands off the run must not change.
    for (const profile of SHAPED) {
      const there = linePoints(A, B, profile, 4);
      const back = linePoints(B, A, profile, 4);
      expect(peak(back), profile).toBeCloseTo(peak(there), 6);
    }
  });
});

describe('the wave count', () => {
  it('clamps below MIN_WAVES and above MAX_WAVES', () => {
    for (const profile of SHAPED) {
      expect(linePoints(A, B, profile, 0), profile).toEqual(linePoints(A, B, profile, MIN_WAVES));
      expect(linePoints(A, B, profile, -5), profile).toEqual(linePoints(A, B, profile, MIN_WAVES));
      expect(linePoints(A, B, profile, 9999), profile).toEqual(linePoints(A, B, profile, MAX_WAVES));
    }
  });

  it('rounds a fractional count rather than truncating it', () => {
    expect(linePoints(A, B, 'zigzag', 6.4)).toEqual(linePoints(A, B, 'zigzag', 6));
    expect(linePoints(A, B, 'zigzag', 6.6)).toEqual(linePoints(A, B, 'zigzag', 7));
  });

  // A zigzag is defined by where it turns, not by sampling: two corners per
  // wave, plus the two endpoints.
  it('gives a zigzag two corners per wave', () => {
    for (const count of [1, 3, 6, 12]) {
      expect(linePoints(A, B, 'zigzag', count), `count=${count}`).toHaveLength(2 * count + 2);
    }
  });
});

describe('amplitude follows the period, not the run', () => {
  /**
   * Tied to the period so that turning the dial up makes waves *tighter*
   * rather than making the line thinner. Scaling by run length instead makes a
   * short wavy line flat and a long one wild. Asserted on zigzag, whose
   * corners sit exactly on the amplitude — a sampled sine only approaches it.
   */
  const AMPLITUDE_RATIO = 0.24;

  it('sets a zigzag corner at period * 0.24', () => {
    expect(peak(linePoints(A, B, 'zigzag', 6))).toBeCloseTo((LENGTH / 6) * AMPLITUDE_RATIO, 9);
    expect(peak(linePoints(A, B, 'zigzag', 3))).toBeCloseTo((LENGTH / 3) * AMPLITUDE_RATIO, 9);
  });

  it('makes waves tighter, not the line thinner, as the count rises', () => {
    const six = peak(linePoints(A, B, 'zigzag', 6));
    const twelve = peak(linePoints(A, B, 'zigzag', 12));
    expect(twelve).toBeCloseTo(six / 2, 9);
  });

  it('scales the gesture with the run at a fixed count', () => {
    // Same count over twice the run is twice the period, so twice the height:
    // a long line does not flatten out.
    const long = peak(linePoints(A, { x: 1200, y: 0 }, 'zigzag', 6));
    expect(long).toBeCloseTo(2 * peak(linePoints(A, B, 'zigzag', 6)), 9);
  });

  it('gives a wavy line very nearly the same peak as a zigzag', () => {
    // Sampled rather than cornered, so it lands just under the true crest.
    const wavy = peak(linePoints(A, B, 'wavy', 6));
    expect(wavy).toBeGreaterThan((LENGTH / 6) * AMPLITUDE_RATIO * 0.99);
    expect(wavy).toBeLessThanOrEqual((LENGTH / 6) * AMPLITUDE_RATIO);
  });
});

describe('wavy', () => {
  /**
   * There is deliberately no fade at the ends: a sine over a whole number of
   * periods already starts and finishes on the line, and fading flattened the
   * last stretch, so the run went straight for a moment and the head looked
   * stuck on rather than grown out of it. If the ends stop being zero
   * crossings, that reasoning has been undone.
   */
  it('begins and ends on the axis without being flattened there', () => {
    const off = acrosses(linePoints(A, B, 'wavy', 6));
    expect(Math.abs(off[0])).toBeLessThan(1e-9);
    expect(Math.abs(off[off.length - 1])).toBeLessThan(1e-9);
    // The very next sample must already be climbing — a fade would hold it flat.
    expect(Math.abs(off[1])).toBeGreaterThan(0);
  });

  it('crosses the axis twice per wave', () => {
    const off = acrosses(linePoints(A, B, 'wavy', 6));
    let crossings = 0;
    for (let i = 1; i < off.length; i += 1) {
      if (Math.sign(off[i]) !== Math.sign(off[i - 1]) && off[i] !== 0) crossings += 1;
    }
    expect(crossings).toBe(12);
  });
});

describe('curved', () => {
  it('bows to one side only, with its apex at the middle', () => {
    const pts = linePoints(A, B, 'curved', 6);
    const off = acrosses(pts);
    expect(Math.min(...off)).toBeGreaterThanOrEqual(0);
    const apex = off.indexOf(Math.max(...off));
    expect(alongs(pts)[apex]).toBeCloseTo(LENGTH / 2, 6);
  });

  it('leaves and arrives flat against the run', () => {
    // A half-sine, not a circular arc — so an end cap points along the line
    // rather than off at a circle's tangent.
    const off = acrosses(linePoints(A, B, 'curved', 6));
    expect(Math.abs(off[0])).toBeLessThan(1e-9);
    expect(Math.abs(off[off.length - 1])).toBeLessThan(1e-9);
  });

  it('ignores the wave count', () => {
    // One arc across the whole run, whatever the dial says.
    expect(linePoints(A, B, 'curved', 2)).toEqual(linePoints(A, B, 'curved', 20));
  });

  it('bows to the height a single wave would have', () => {
    // So switching between Curved and Wavy keeps the same weight of gesture.
    expect(peak(linePoints(A, B, 'curved', 6))).toBeCloseTo((LENGTH / 2) * 0.24, 6);
  });
});

describe('coil', () => {
  /**
   * The character four formula-derived attempts could not produce: a run that
   * loops on its way across has to double back on itself, because a curve with
   * one value per position can never cross itself. This is the single property
   * separating a coil from a wave.
   */
  it('doubles back on itself, at every count', () => {
    for (const count of [1, 2, 6, 12]) {
      const run = alongs(linePoints(A, B, 'coil', count));
      const backtracks = run.filter((v, i) => i > 0 && v < run[i - 1] - 1e-9).length;
      expect(backtracks, `count=${count}`).toBeGreaterThan(0);
    }
  });

  /**
   * The bug the most recent commit fixed: the drawing begins half a period
   * *before* the first crossing, and `lead` was used as though it were the
   * crossing — so the row sat half a period left of centre and the flat run on
   * the right came out a full period longer than the one on the left.
   */
  it('centres the row of loops, with equal flat leads at each end', () => {
    for (const count of [1, 2, 3, 6, 12]) {
      const pts = linePoints(A, B, 'coil', count);
      const off = acrosses(pts);
      const run = alongs(pts);
      const tol = 0.5;
      const first = off.findIndex((v) => Math.abs(v) > tol);
      let last = off.length - 1;
      while (last >= 0 && Math.abs(off[last]) <= tol) last -= 1;
      expect(first, `count=${count}`).toBeGreaterThan(0);
      const leadIn = run[first];
      const leadOut = LENGTH - run[last];
      expect(leadOut, `count=${count}`).toBeCloseTo(leadIn, 6);
    }
  });

  it('stays within the run it was asked to draw', () => {
    for (const count of [1, 6, 20]) {
      const run = alongs(linePoints(A, B, 'coil', count));
      expect(Math.min(...run), `count=${count}`).toBeGreaterThanOrEqual(-1e-6);
      expect(Math.max(...run), `count=${count}`).toBeLessThanOrEqual(LENGTH + 1e-6);
    }
  });

  it('loops to one side of the run', () => {
    // The leads are the axis and the loops rise off it, so the mark is
    // single-sided — the crossings sit above the baseline, never straddling it.
    const off = acrosses(linePoints(A, B, 'coil', 4));
    expect(Math.max(...off)).toBeLessThanOrEqual(1e-6);
    expect(Math.min(...off)).toBeLessThan(0);
  });

  /**
   * Two rules size the mark and the smaller wins: a loop is a fifth of the run
   * tall, until there are enough loops that the row would overflow. A single
   * loop must be a proper loop rather than a bump, and adding loops may shrink
   * them but must never grow them.
   */
  it('sizes a lone loop against the run, then shrinks to fit as they multiply', () => {
    expect(peak(linePoints(A, B, 'coil', 1))).toBeCloseTo(LENGTH * 0.2, 6);
    const heights = [1, 2, 3, 6, 12, 20].map((n) => peak(linePoints(A, B, 'coil', n)));
    for (let i = 1; i < heights.length; i += 1) {
      expect(heights[i], `count index ${i}`).toBeLessThanOrEqual(heights[i - 1] + 1e-6);
    }
    expect(heights[heights.length - 1]).toBeLessThan(heights[0]);
  });
});

describe('defaultEndAlign', () => {
  /**
   * One rule, read by the canvas, the exporter and the panel specimen alike. A
   * straight run has nothing to protect so its head sits on the last point;
   * anything with a shape projects instead, keeping every crest and corner.
   */
  it('keeps a straight head inside and projects every shaped one', () => {
    expect(defaultEndAlign(undefined)).toBe('inside');
    expect(defaultEndAlign('straight')).toBe('inside');
    for (const profile of SHAPED) {
      expect(defaultEndAlign(profile), profile).toBe('extend');
    }
  });

  it('answers for every profile that exists', () => {
    for (const profile of LINE_PROFILES as readonly LineProfile[]) {
      expect(['inside', 'extend'], profile).toContain(defaultEndAlign(profile));
    }
  });
});
