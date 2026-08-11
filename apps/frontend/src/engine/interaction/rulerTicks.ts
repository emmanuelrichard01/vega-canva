/**
 * Where the marks on a ruler go.
 *
 * The whole difficulty of a ruler on an infinite canvas is that the zoom is
 * continuous and the labels are not: at 3.7% you cannot draw a mark every ten
 * units, and at 800% a mark every hundred leaves the ruler empty. So the
 * spacing has to be chosen from the zoom, and it has to be chosen from a set
 * of *round* numbers — a ruler labelled 0, 137, 274 is arithmetically correct
 * and useless, because the point of the labels is that you can read a position
 * off them without doing arithmetic.
 *
 * Pure, and separated from the component for the usual reason: this is the
 * part that is wrong in most implementations and the part worth testing.
 */

/**
 * The steps a ruler is allowed to use, per decade.
 *
 * 1, 2, 5 and 10 — the sequence every ruler, chart axis and engineering scale
 * has used for a century, because those are the divisions a person can
 * subdivide by eye. Adding 2.5 or 3 makes the spacing more even and the ruler
 * harder to read, which is the wrong trade.
 */
const STEPS = [1, 2, 5, 10];

/** Below this many screen pixels apart, labels collide and stop being legible. */
const MIN_LABEL_GAP_PX = 64;

/** Minor ticks per major interval. Four gives halves and quarters. */
const MINOR_PER_MAJOR = 4;

export interface Tick {
  /** World coordinate of the mark. */
  value: number;
  /** Screen offset along the ruler, in pixels from its start. */
  offset: number;
  major: boolean;
}

/**
 * The smallest round step whose marks are at least `minGapPx` apart on screen.
 *
 * Walks decades rather than searching, so the answer is exact at any zoom
 * including the extremes the camera allows.
 */
export function tickStep(zoom: number, minGapPx = MIN_LABEL_GAP_PX): number {
  if (!(zoom > 0) || !Number.isFinite(zoom)) return 100;

  // The world distance that `minGapPx` screen pixels covers is the smallest
  // step that could possibly work; the answer is the next round number up.
  const raw = minGapPx / zoom;
  const decade = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const step of STEPS) {
    const candidate = step * decade;
    if (candidate >= raw) return candidate;
  }
  return 10 * decade;
}

/**
 * Every mark visible along one axis.
 *
 * `from`/`to` are world coordinates; `originPx` and `zoom` map world to screen
 * exactly as the camera does, so the ruler and the canvas cannot disagree
 * about where a coordinate is — the one bug that makes a ruler worse than
 * nothing.
 *
 * Minor ticks are emitted between the majors and carry no label. They are what
 * makes a ruler readable *between* the numbers, which is most of what it is
 * for; a ruler with only labelled marks is a list of numbers.
 */
export function ticksFor(
  from: number,
  to: number,
  zoom: number,
  originPx: number,
  minGapPx = MIN_LABEL_GAP_PX
): Tick[] {
  if (!(to > from) || !(zoom > 0) || !Number.isFinite(zoom)) return [];

  const major = tickStep(zoom, minGapPx);
  const minor = major / MINOR_PER_MAJOR;

  // Guard against a range so wide at so small a zoom that the tick count would
  // be unbounded. The camera clamps zoom, so this is a floor under a bug
  // rather than an expected path — but an unbounded loop here would hang the
  // tab, and returning a coarse ruler is a better failure than that.
  const count = (to - from) / minor;
  if (!Number.isFinite(count) || count > 5000) return [];

  const first = Math.ceil(from / minor) * minor;
  const ticks: Tick[] = [];
  for (let value = first; value <= to; value += minor) {
    // Rounded before comparison: `0.1 * 3` is not `0.3`, and a major tick that
    // fails that test loses its label for no reason the user can see.
    const rounded = Math.round(value / minor) * minor;
    const isMajor = Math.abs(rounded % major) < minor / 1000 || Math.abs(Math.abs(rounded % major) - major) < minor / 1000;
    ticks.push({ value: rounded, offset: originPx + rounded * zoom, major: isMajor });
  }
  return ticks;
}

/**
 * A tick's label, short enough to fit between its neighbours.
 *
 * Fractions appear only when the step is fractional — a ruler at 800% needs
 * "12.5" and a ruler at 25% showing "400.0" is noise pretending to be
 * precision.
 */
export function tickLabel(value: number, step: number): string {
  if (step >= 1) return String(Math.round(value));
  const decimals = Math.min(3, Math.ceil(-Math.log10(step)));
  return value.toFixed(decimals);
}
