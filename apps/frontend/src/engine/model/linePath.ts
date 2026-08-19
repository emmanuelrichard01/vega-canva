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

  // Coil: a loop that also travels, which is what a phone cord does. The
  // across-component is a full circle per period while the along-component
  // advances — so each turn closes on itself without the line ever going
  // backwards far enough to double over.
  // A coil turns through a full circle per repeat, so it needs more samples
  // per unit of run than a wave that only rises and falls once.
  const steps = count * Math.round(stepsFor(period) * 1.5);
  /**
   * A coil's loop is sized against its *period*, not against the shared wave
   * amplitude.
   *
   * It used to be a multiple of `amplitude`, so when that came down to keep a
   * wave's arrival angle reasonable the coil's loops shrank with it — and a
   * coil whose loops are small is just a wobbly line. The two profiles want
   * different things from the same number: a wave wants to stay shallow enough
   * that its ends do not leave steeply, and a coil wants loops big enough to
   * close and read as loops.
   *
   * At 0.62 of the period a turn is a clear open circle rather than a kink,
   * and consecutive turns still clear each other along the run.
   */
  const loop = period * 0.62;
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps;
    const turn = t * count * Math.PI * 2;
    // A coil *does* need its ends eased, unlike a wave: `1 - cos` starts and
    // ends at zero but its loop carries the run backwards on the way, so
    // without this the first and last turns push out past the endpoints the
    // heads are drawn at.
    const edge = Math.min(1, Math.min(t, 1 - t) * count * 3);
    return at(
      t * length - Math.sin(turn) * loop * 0.55 * edge,
      (1 - Math.cos(turn)) * loop * 0.5 * edge
    );
  });
}
