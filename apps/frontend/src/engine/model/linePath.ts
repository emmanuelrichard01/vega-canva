/**
 * The shape a line makes on its way from one end to the other.
 *
 * ## Why this is a profile and not five new shape kinds
 *
 * A line and an arrow are already the same shape with different ends — that is
 * written into the model and into the panel. Adding `wavy`, `zigzag` and the
 * rest as *kinds* would multiply that: a wavy line and a wavy arrow would be
 * two more kinds each carrying their own end styles, and the tool dock, the
 * normalizer, the exporter and the shape swapper would each grow ten entries
 * where they had two.
 *
 * As a profile it composes instead. Any profile takes any pair of ends, any
 * weight, any dash and any sketch level, because none of those know it exists —
 * they all read the point list this produces.
 *
 * ## Why spiral is not here
 *
 * It was asked for and it does not fit, which is worth saying rather than
 * quietly dropping. Everything below is a *path from A to B*: it starts at one
 * end, finishes at the other, and the end caps point along it. A spiral does
 * not go from A to B — it winds outward from a centre, its two ends are not
 * opposite each other, and an arrowhead on one of them points sideways at
 * nothing. It is a shape that happens to be drawn with a stroke, so it belongs
 * with the shape presets, not here. `coil` is the thing people usually mean
 * when they ask: a run that loops on its way across.
 *
 * Everything here is pure. Points in, points out.
 */

import type { Point } from './schema';

/** Every profile, as values, so the type cannot outrun what handles it. */
export const LINE_PROFILES = ['straight', 'curved', 'wavy', 'zigzag', 'coil'] as const;
export type LineProfile = (typeof LINE_PROFILES)[number];

export const LINE_PROFILE_LABELS: Record<LineProfile, string> = {
  straight: 'Straight',
  curved: 'Curved',
  wavy: 'Wavy',
  zigzag: 'Zigzag',
  coil: 'Coil',
};

/** How many repeats a profile makes across the run, before the user's count. */
const DEFAULT_WAVES = 6;
export const MIN_WAVES = 1;
export const MAX_WAVES = 40;

/**
 * How tall a wave is, relative to the distance between two of its crests.
 *
 * Tied to the period rather than to the run length, so adding waves makes them
 * *tighter* rather than making the line thinner — which is what a person
 * turning up a "waves" dial expects to see. Scaling amplitude by run length
 * instead makes a short wavy line a flat wavy line and a long one a wild one.
 */
const AMPLITUDE_RATIO = 0.24;

/**
 * How finely a curved profile is sampled, as world units per segment.
 *
 * Per *distance*, not per repeat. A fixed count per repeat gives a short wave
 * a dense sample and a long one a coarse one — so a wavy line stretched across
 * a board turns into a run of visible straight facets, at exactly the size
 * where anybody would notice. Six units keeps a segment under a couple of
 * pixels at ordinary zoom.
 */
const UNITS_PER_SAMPLE = 6;
/** Bounds on that, so a hairline is not sampled twice and a mural is not sampled ten thousand times. */
const MIN_STEPS_PER_WAVE = 12;
const MAX_STEPS_PER_WAVE = 64;

/** Samples for one repeat of `period` world units. */
function stepsFor(period: number): number {
  return Math.max(
    MIN_STEPS_PER_WAVE,
    Math.min(MAX_STEPS_PER_WAVE, Math.round(period / UNITS_PER_SAMPLE))
  );
}

/**
 * The run from `a` to `b`, as the profile draws it.
 *
 * `straight` returns exactly the two points it was given — not a resampled
 * approximation of them — so a plain line is bit-for-bit what it always was and
 * this can be applied unconditionally without moving anything already on a
 * board.
 */
export function linePoints(
  a: Point,
  b: Point,
  profile: LineProfile = 'straight',
  waves: number = DEFAULT_WAVES
): Point[] {
  if (profile === 'straight') return [a, b];

  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  // No direction and nothing to draw along. Two coincident points is a line
  // being born under the pointer, and dividing by its length is how it becomes
  // NaN before it has any extent.
  if (length < 1e-6) return [a, b];

  // Along the run, and across it. Every profile below is written in these two,
  // then mapped out once — describing them in absolute coordinates instead is
  // how a shape ends up correct on a horizontal line and sideways on a
  // vertical one.
  const ux = dx / length;
  const uy = dy / length;
  const nx = -uy;
  const ny = ux;

  const count = Math.max(MIN_WAVES, Math.min(MAX_WAVES, Math.round(waves)));
  const period = length / count;
  const amplitude = period * AMPLITUDE_RATIO;

  const at = (along: number, across: number): Point => ({
    x: a.x + ux * along + nx * across,
    y: a.y + uy * along + ny * across,
  });

  if (profile === 'curved') {
    // One arc across the whole run, bowed to the same amplitude a single wave
    // would have — so switching between Curved and Wavy keeps the line the
    // same weight of gesture rather than jumping in size.
    const bow = (length / 2) * AMPLITUDE_RATIO;
    // One arc, so it is sampled against its own whole length.
    const steps = Math.max(24, Math.min(160, Math.round(length / UNITS_PER_SAMPLE)));
    return Array.from({ length: steps + 1 }, (_, i) => {
      const t = i / steps;
      // A half-sine rather than a circular arc: it leaves and arrives flat
      // against the run, so an arrowhead at either end points along the line
      // instead of off at the tangent of a circle.
      return at(t * length, Math.sin(t * Math.PI) * bow);
    });
  }

  if (profile === 'zigzag') {
    // Corners, not samples: a zigzag is defined entirely by where it turns, and
    // sampling it would round the turns that are the whole point.
    const out: Point[] = [at(0, 0)];
    for (let i = 0; i < count; i += 1) {
      out.push(at((i + 0.25) * period, amplitude));
      out.push(at((i + 0.75) * period, -amplitude));
    }
    out.push(at(length, 0));
    return out;
  }

  if (profile === 'wavy') {
    const steps = count * stepsFor(period);
    /**
     * No fade at the ends.
     *
     * A sine over a whole number of periods already *starts and finishes on
     * the line* — both ends are zero crossings — so a fade buys nothing and
     * costs the thing it was meant to protect: it flattened the last stretch,
     * so the run went straight for a moment and then began to wave, and the
     * head looked stuck on rather than grown out of the line.
     *
     * The head takes the true tangent instead, which at a zero crossing is the
     * steepest part of the wave. That is what a wavy arrow looks like when it
     * is drawn properly — the amplitude is what keeps the angle reasonable,
     * which is why it came down rather than the ends being bent flat.
     */
    return Array.from({ length: steps + 1 }, (_, i) => {
      const along = (i / steps) * length;
      return at(along, Math.sin((along / period) * Math.PI * 2) * amplitude);
    });
  }

  /**
   * Coil: a baseline that rises into a loop, crosses itself, dips, and repeats.
   *
   * ## One template, translated
   *
   * Every loop is the *same* cubics moved along by one period, so uniformity is
   * structural rather than something that has to be eyeballed. Four earlier
   * attempts derived the shape from a formula — a shaped sine, a phase-warped
   * circle, a prolate cycloid — and each produced a curve with the wrong
   * character, because the mark is a mark rather than the output of an
   * equation. A cycloid's loops in particular are tied in size to how many
   * there are, and run into each other with no baseline between.
   *
   * ## The geometry, per period, with the crossing at the local origin
   *
   *  - **Loop** — four cubics: node → right flank → apex → left flank → node.
   *  - **Valley** — one symmetric cubic from a node to the next, dipping below
   *    the crossing level. This is what puts a *baseline* between two loops
   *    instead of running one straight into the other.
   *  - **The crossing** — the one deliberate corner. The strand entering the
   *    loop and the strand leaving into the valley meet at an angle, mirrored,
   *    and that angle is what draws the X.
   *  - **Leads** — the straight runs enter at the valley's depth, so they are
   *    level with the bottom of each dip rather than with the crossings, and
   *    the curve joins them without a kink.
   *
   * The numbers are the reference's own, kept in its coordinates — period 455,
   * loop height 290, valley depth 55 — and scaled uniformly. Keeping them
   * unscaled is deliberate: they can be read against the source they came from,
   * and one factor moves all of them together, so no proportion can drift.
   */
  const REF_PERIOD = 455;
  /** Total height of the drawing: apex to the flat lead. */
  const REF_TOTAL = 345;
  /** How far the flat lead sits below the crossings. */
  const REF_VALLEY = 55;

  /** The loop, as four cubics from the node at (0, 0). Reference coordinates. */
  const LOOP: ReadonlyArray<readonly number[]> = [
    [49.21, -49.21, 102.13, -69.6, 102.13, -145],
    [102.13, -225.08, 60.88, -290, 10, -290],
    [-57.86, -290, -112.87, -231.83, -112.87, -160.08],
    [-112.87, -80.04, -67.67, -67.67, 0, 0],
  ];
  /** The dip between two crossings, one cubic. */
  const VALLEY: readonly number[] = [73.33, 73.33, 381.67, 73.33, 455, 0];

  /**
   * One uniform scale, so every proportion above survives together, sized so
   * the loops fill the run with only a short lead at each end.
   *
   * Two rules, and the smaller wins. The first sets a loop's height against
   * the run — a fifth of it — which is what keeps a single loop a proper loop
   * rather than a bump. The second stops the row overflowing once there are
   * enough of them, by which point the height rule has long since been the
   * generous one.
   *
   * The span is 92% rather than a half: the leads are a *finish* on the mark,
   * not the bulk of it, and a row of loops marooned in the middle of a long
   * straight line reads as a line that happens to have loops instead of as a
   * looping arrow.
   */
  const MAX_SPAN = 0.92;
  let S = (length * 0.2) / REF_TOTAL;
  const maxSpan = length * MAX_SPAN;
  if (REF_PERIOD * S * count > maxSpan) S = maxSpan / (REF_PERIOD * count);

  const pitch = REF_PERIOD * S;
  /**
   * Where the first crossing sits, and why the half-pitch is here.
   *
   * `lead` is the origin the reference coordinates are laid out from, and the
   * drawing does **not** start there: the lead-in cubic begins half a period
   * *before* the first crossing and the tail ends half a period after the
   * last. Splitting the leftover evenly and using it directly therefore put
   * the whole row half a period to the left — the flat run on the right came
   * out a full period longer than the one on the left, which is exactly what
   * it looked like.
   */
  const lead = (length - pitch * count) / 2 + pitch / 2;
  // Reference y is measured with the crossings at 0 and the leads at +55; the
  // run's own axis is the leads, so everything shifts up by the valley depth.
  const px = (x: number) => lead + x * S;
  const py = (y: number) => (y - REF_VALLEY) * S;

  /**
   * Samples per cubic.
   *
   * Judged against the *pitch* rather than the whole run, so a loop is drawn
   * with the same fidelity whether there is one of them or twenty. Coarse
   * sampling shows first on the tight turn at the apex, which is exactly where
   * a loop stops looking round.
   */
  const steps = Math.max(8, Math.min(22, Math.round(pitch / 7)));
  const out: Point[] = [at(0, 0), at(px(-REF_PERIOD / 2), 0)];

  /** Sample one cubic from `from`, in reference coordinates. */
  const cubic = (fx: number, fy: number, c: readonly number[]) => {
    for (let k = 1; k <= steps; k += 1) {
      const t = k / steps;
      const m = 1 - t;
      const a = m * m * m;
      const b = 3 * m * m * t;
      const d = 3 * m * t * t;
      const e = t * t * t;
      out.push(
        at(
          px(a * fx + b * c[0] + d * c[2] + e * c[4]),
          py(a * fy + b * c[1] + d * c[3] + e * c[5])
        )
      );
    }
  };

  // Lead-in: half a valley, so the straight run flows into the first crossing.
  const hv = REF_VALLEY / 0.75;
  const hx = (REF_PERIOD - 2 * hv) / 4 + hv / 2;
  cubic(-REF_PERIOD / 2, REF_VALLEY, [-REF_PERIOD / 2 + hx, REF_VALLEY, -hv / 2, hv / 2, 0, 0]);

  for (let i = 0; i < count; i += 1) {
    const x = i * REF_PERIOD;
    let fx = x;
    let fy = 0;
    for (const c of LOOP) {
      cubic(fx, fy, [c[0] + x, c[1], c[2] + x, c[3], c[4] + x, c[5]]);
      fx = c[4] + x;
      fy = c[5];
    }
    if (i < count - 1) {
      cubic(x, 0, [VALLEY[0] + x, VALLEY[1], VALLEY[2] + x, VALLEY[3], VALLEY[4] + x, VALLEY[5]]);
    }
  }

  // Tail: the mirror of the lead-in.
  const last = (count - 1) * REF_PERIOD;
  cubic(last, 0, [
    last + hv / 2, hv / 2,
    last + REF_PERIOD / 2 - hx, REF_VALLEY,
    last + REF_PERIOD / 2, REF_VALLEY,
  ]);
  out.push(at(length, 0));
  return out;
}

/**
 * The alignment a line uses when it has not been told.
 *
 * A straight run has nothing to protect, so its head takes the classic
 * placement: tip on the last point. Anything with a shape does, so its head
 * projects instead and the run keeps every crest and corner. One rule, stated
 * once, read by the canvas, the exporter and the specimen alike.
 */
export function defaultEndAlign(profile: LineProfile | undefined): 'inside' | 'extend' {
  return !profile || profile === 'straight' ? 'inside' : 'extend';
}
