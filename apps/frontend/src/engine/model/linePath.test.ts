import { describe, it, expect } from 'vitest';
import {
  LINE_PROFILES,
  LINE_PROFILE_LABELS,
  MAX_AMPLITUDE_SCALE,
  MAX_WAVES,
  MIN_WAVES,
  defaultEndAlign,
  dynamicWaves,
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
  // wave, plus the two endpoints -- and the two points that end the flat lead
  // at each end, which is what brings the run in along its own axis.
  it('gives a zigzag two corners per wave', () => {
    for (const count of [1, 3, 6, 12]) {
      expect(linePoints(A, B, 'zigzag', count), `count=${count}`).toHaveLength(2 * count + 4);
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

describe('amplitude / loop size scaling', () => {
  it('scales coil loop height directly with amplitudeScale', () => {
    const baseline = peak(linePoints(A, B, 'coil', 2, 1.0));
    const small = peak(linePoints(A, B, 'coil', 2, 0.5));
    const large = peak(linePoints(A, B, 'coil', 2, 1.5));

    expect(small).toBeLessThan(baseline);
    expect(large).toBeGreaterThan(baseline);
    expect(small).toBeCloseTo(baseline * 0.5, 4);
    expect(large).toBeCloseTo(baseline * 1.5, 4);
  });

  it('scales wave amplitude directly with amplitudeScale', () => {
    const baseline = peak(linePoints(A, B, 'wavy', 6, 1.0));
    const small = peak(linePoints(A, B, 'wavy', 6, 0.5));
    const large = peak(linePoints(A, B, 'wavy', 6, 2.0));

    expect(small).toBeCloseTo(baseline * 0.5, 4);
    expect(large).toBeCloseTo(baseline * 2.0, 4);
  });

  it('scales zigzag amplitude directly with amplitudeScale', () => {
    const baseline = peak(linePoints(A, B, 'zigzag', 6, 1.0));
    const small = peak(linePoints(A, B, 'zigzag', 6, 0.5));
    const large = peak(linePoints(A, B, 'zigzag', 6, 2.0));

    expect(small).toBeCloseTo(baseline * 0.5, 4);
    expect(large).toBeCloseTo(baseline * 2.0, 4);
  });

  it('scales curved bow depth directly with amplitudeScale', () => {
    const baseline = peak(linePoints(A, B, 'curved', 6, 1.0));
    const small = peak(linePoints(A, B, 'curved', 6, 0.5));
    const large = peak(linePoints(A, B, 'curved', 6, 2.0));

    expect(small).toBeCloseTo(baseline * 0.5, 4);
    expect(large).toBeCloseTo(baseline * 2.0, 4);
  });

  it('clamps amplitude scale to MAX_AMPLITUDE_SCALE (2.0 / 200%)', () => {
    expect(MAX_AMPLITUDE_SCALE).toBe(2.0);
    const maxed = peak(linePoints(A, B, 'wavy', 6, 2.0));
    const over = peak(linePoints(A, B, 'wavy', 6, 4.5));
    expect(over).toBeCloseTo(maxed, 4);
  });
});

describe('smart and dynamic loop / wave count', () => {
  it('calculates proportional loop counts for coil based on line length', () => {
    /**
     * The same period as a wave and a zigzag, which is a change from the 48 it
     * had. Drawn side by side at 500 units, ten loops read as a row of small
     * curls competing with each other; seven are large enough to be a coil,
     * because the span rule then gives each one half as much height again.
     */
    expect(dynamicWaves(72, 'coil')).toBe(1);
    expect(dynamicWaves(144, 'coil')).toBe(2);
    expect(dynamicWaves(300, 'coil')).toBe(4);
    expect(dynamicWaves(600, 'coil')).toBe(8);
  });

  it('gives every repeating profile the same rhythm', () => {
    // One period for all three is what makes them look like one family rather
    // than three separate marks.
    for (const length of [180, 400, 900]) {
      expect(dynamicWaves(length, 'coil')).toBe(dynamicWaves(length, 'wavy'));
      expect(dynamicWaves(length, 'zigzag')).toBe(dynamicWaves(length, 'wavy'));
    }
  });

  it('calculates proportional wave counts for wavy/zigzag based on line length', () => {
    /**
     * A seventy-two-unit period. It was thirty-six, which put seventeen
     * repeats on a six-hundred-unit line at an amplitude of eight -- a texture
     * applied to a straight line rather than a wavy line. Amplitude is a
     * fraction of the period, so a tight period is also a shallow one; the two
     * faults are the same fault.
     */
    expect(dynamicWaves(36, 'wavy')).toBe(1);
    expect(dynamicWaves(180, 'wavy')).toBe(3);
    expect(dynamicWaves(360, 'zigzag')).toBe(5);
    expect(dynamicWaves(600, 'wavy')).toBe(8);
  });

  it('keeps a wave deep enough to read at the density it picks', () => {
    /**
     * The measurement that chose the period: at 600 units the crest-to-trough
     * has to be a visible fraction of the run, not a ripple on it. Eight of 75
     * units, about eighteen deep, is unmistakably a wave at a glance.
     */
    const pts = linePoints(A, { x: 600, y: 0 }, 'wavy');
    const amplitude = Math.max(...pts.map((p) => Math.abs(p.y)));
    expect(amplitude).toBeGreaterThan(15);
    expect(amplitude).toBeLessThan(24);
  });

  it('uses dynamic waves in linePoints when waves is undefined', () => {
    const pts150 = linePoints(A, { x: 150, y: 0 }, 'coil');
    const pts600 = linePoints(A, { x: 600, y: 0 }, 'coil');
    expect(pts600.length).toBeGreaterThan(pts150.length);
  });
});

describe('where a run leaves and arrives', () => {
  /** The angle the run's first and last segments make with its own axis. */
  const angles = (profile: Parameters<typeof linePoints>[2], length = 400) => {
    const pts = linePoints(A, { x: length, y: 0 }, profile, undefined, 1);
    const n = pts.length;
    const deg = (r: number) => Math.abs((r * 180) / Math.PI);
    return {
      start: deg(Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x)),
      end: deg(Math.atan2(pts[n - 1].y - pts[n - 2].y, pts[n - 1].x - pts[n - 2].x)),
    };
  };

  it('brings a zigzag in and out along its own axis', () => {
    /**
     * The bug this closes. Without a flat lead the first and last strokes rise
     * straight off the baseline, so the line arrived at 44° to the direction it
     * was going -- and an end cap had two bad options and no good one: along
     * the run it sits crooked against the stroke reaching it, along the stroke
     * it aims 44° away from where the line goes. Both readings are wrong, which
     * is how you know the marker was never the problem.
     */
    const { start, end } = angles('zigzag');
    expect(start).toBeCloseTo(0, 6);
    expect(end).toBeCloseTo(0, 6);
  });

  it('grows a wave out of the line rather than crossing it steeply', () => {
    /**
     * A zero crossing is the *steepest* part of a sine, so a whole number of
     * periods left and arrived at 55°. The envelope takes the amplitude to zero
     * at each end, and with `A` and `sin` both zero the tangent there is
     * exactly the axis -- what is left is the sampling step.
     */
    const { start, end } = angles('wavy');
    expect(start).toBeLessThan(8);
    expect(end).toBeLessThan(8);
  });

  it('holds at every length, which is what makes it a rule', () => {
    for (const length of [160, 400, 900]) {
      expect(angles('zigzag', length).end).toBeCloseTo(0, 6);
      expect(angles('wavy', length).end).toBeLessThan(8);
    }
  });

  it('leaves the coil alone, which always did this', () => {
    // It enters and leaves on flat leads, and was the only profile whose
    // arrowheads looked right. The other two now follow it.
    expect(angles('coil').end).toBeCloseTo(0, 6);
  });

  it('leaves an arc on its tangent, because that is what an arc is', () => {
    /**
     * ±20.6°, symmetrically -- the arc leaving and arriving. Flattening this
     * would make the head ignore the curve it sits on, which is the opposite
     * of the fix.
     */
    const { start, end } = angles('curved');
    expect(start).toBeGreaterThan(15);
    expect(end).toBeGreaterThan(15);
  });

  it('still starts and finishes exactly on its endpoints', () => {
    // The leads and the envelope shape the approach; they must not shorten the
    // line, which is the one thing its two endpoints mean.
    for (const profile of ['wavy', 'zigzag'] as const) {
      const pts = linePoints(A, { x: 400, y: 0 }, profile);
      expect(pts[0]).toEqual({ x: 0, y: 0 });
      expect(pts[pts.length - 1].x).toBeCloseTo(400, 6);
      expect(pts[pts.length - 1].y).toBeCloseTo(0, 6);
    }
  });
});
