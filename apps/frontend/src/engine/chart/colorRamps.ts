/**
 * Perceptually uniform colour ramps, for a surface where the colour *is* the
 * value.
 *
 * ## Why not a rainbow
 *
 * The default nearly every plotting tool shipped for twenty years is the one
 * to avoid, and the reasons are measurable rather than aesthetic:
 *
 * - **It is not monotonic in lightness.** A rainbow gets lighter to yellow and
 *   darker again to red, so two different values can be equally bright and the
 *   surface reads as having a ridge where the data is flat.
 * - **It is not uniform.** Equal steps in the data are not equal steps in
 *   perceived colour, so it exaggerates some ranges and flattens others —
 *   which for a density plot is the picture telling a story the numbers do
 *   not.
 * - **It does not survive grey.** Printed or read by somebody with a colour
 *   deficiency, most of it collapses.
 *
 * The ramps here are sampled from the well-known uniform families. They are
 * stored as control points and interpolated, rather than as 256 entries,
 * because the interpolation is three lerps and the table would be four hundred
 * lines nobody can check.
 */

export type RampId = 'viridis' | 'magma' | 'diverging' | 'mono';

type RGB = readonly [number, number, number];

/** Control points, evenly spaced from 0 to 1. */
const RAMPS: Record<RampId, RGB[]> = {
  // Viridis: dark blue through green to yellow, monotonic in lightness.
  viridis: [
    [68, 1, 84],
    [59, 82, 139],
    [33, 145, 140],
    [94, 201, 98],
    [253, 231, 37],
  ],
  // Magma: black through purple and red to near-white.
  magma: [
    [0, 0, 4],
    [81, 18, 124],
    [183, 55, 121],
    [252, 137, 97],
    [252, 253, 191],
  ],
  /**
   * Blue–white–red, for data with a meaningful centre.
   *
   * The midpoint is deliberately *not* pure white: on a light board a white
   * middle is a hole in the surface rather than a value, and the reader cannot
   * tell "zero" from "nothing drawn here".
   */
  diverging: [
    [33, 102, 172],
    [146, 197, 222],
    [240, 238, 234],
    [244, 165, 130],
    [178, 24, 43],
  ],
  /** One hue, for when the surface sits beside something already coloured. */
  mono: [
    [247, 250, 252],
    [198, 219, 239],
    [107, 174, 214],
    [33, 113, 181],
    [8, 48, 107],
  ],
};

/**
 * The colour for a value in 0..1, as a CSS hex string.
 *
 * Clamped rather than wrapped: a value outside the range is at an end of the
 * scale, and wrapping would paint the maximum in the colour of the minimum —
 * the one mistake that makes a heatmap unreadable rather than merely wrong.
 */
export function rampColor(id: RampId, t: number): string {
  const stops = RAMPS[id] ?? RAMPS.viridis;
  const clamped = Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0;

  const scaled = clamped * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(scaled));
  const f = scaled - i;

  const a = stops[i];
  const b = stops[i + 1];
  const mix = (lo: number, hi: number) => Math.round(lo + (hi - lo) * f);

  return `#${hex(mix(a[0], b[0]))}${hex(mix(a[1], b[1]))}${hex(mix(a[2], b[2]))}`;
}

function hex(v: number): string {
  return Math.min(255, Math.max(0, v)).toString(16).padStart(2, '0');
}

export const RAMP_LABELS: Record<RampId, string> = {
  viridis: 'Viridis',
  magma: 'Magma',
  diverging: 'Diverging',
  mono: 'Mono',
};

/** A few swatches of a ramp, for a picker that shows what it is choosing. */
export function rampSwatches(id: RampId, count = 5): string[] {
  return Array.from({ length: count }, (_, i) => rampColor(id, i / (count - 1)));
}
