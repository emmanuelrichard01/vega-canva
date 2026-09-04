/**
 * Turning numbers into positions, and choosing the numbers an axis admits to.
 *
 * This module is deliberately free of the store, Konva and the schema: a chart
 * that lands in an exported file is decided here, and geometry that decides
 * what a file contains is the kind this codebase keeps runnable in Node. Every
 * function is total — given a degenerate domain it returns something drawable
 * rather than `NaN`, because a chart with one data point is a real thing
 * somebody will make and an axis of `NaN` is a blank rectangle with no error.
 */

/** A closed interval. `[min, max]`, and `min` may equal `max`. */
export type Domain = readonly [number, number];

/**
 * Map a value in `domain` onto `range`.
 *
 * Returns the midpoint of the range for a zero-width domain rather than
 * dividing by zero. That case is not hypothetical: a single-point series, or
 * a series where every value is the same, produces one, and the honest answer
 * for "where does 7 sit between 7 and 7" is "in the middle".
 */
export function linearScale(domain: Domain, range: Domain): (value: number) => number {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0;

  if (span === 0 || !Number.isFinite(span)) {
    const mid = (r0 + r1) / 2;
    return () => mid;
  }

  const k = (r1 - r0) / span;
  return (value: number) => r0 + (value - d0) * k;
}

/**
 * The step an axis should use: 1, 2, 5 or 10 times a power of ten.
 *
 * Any other step produces labels nobody reads fluently — an axis marked every
 * 3.7 units is arithmetic on display rather than a scale. The 1/2/5 family is
 * what every plotting library converges on for that reason.
 */
export function niceStep(rawStep: number): number {
  if (!Number.isFinite(rawStep) || rawStep <= 0) return 1;

  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalised = rawStep / magnitude;

  // The boundaries are geometric midpoints rather than 1.5/3/7, so a raw step
  // is rounded to whichever of the four it is genuinely closest to on a log
  // scale. Linear midpoints bias every choice upward.
  if (normalised <= 1.5) return magnitude;
  if (normalised <= 3) return 2 * magnitude;
  if (normalised <= 7) return 5 * magnitude;
  return 10 * magnitude;
}

/**
 * Widen a domain to land on round numbers, and the ticks inside it.
 *
 * **Zero is included when the data is near it**, which is not a rounding rule
 * but a truthfulness one: a bar chart whose axis starts at 240 exaggerates the
 * difference between 250 and 260 into a visual claim the numbers do not make.
 * Bars are measured from the baseline, so the baseline has to be zero or the
 * length of the bar means nothing. `includeZero` is therefore on by default
 * and the caller turns it off for the marks where it is wrong — a line chart
 * of a temperature range, where the interesting variation is a few degrees
 * around 300K and forcing zero flattens it to a straight line.
 */
export function niceDomain(
  min: number,
  max: number,
  tickCount = 5,
  includeZero = true
): { domain: Domain; ticks: number[] } {
  let lo = Number.isFinite(min) ? min : 0;
  let hi = Number.isFinite(max) ? max : 0;

  if (includeZero) {
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 0);
  }

  if (lo === hi) {
    // A flat series still needs a drawable axis. One unit either side of the
    // value reads as "this is flat"; a zero-height plot reads as "broken".
    if (lo === 0) {
      lo = 0;
      hi = 1;
    } else {
      const pad = Math.abs(lo) * 0.5;
      lo -= pad;
      hi += pad;
    }
  }

  const count = Math.max(2, Math.round(tickCount));
  const step = niceStep((hi - lo) / count);

  const start = Math.floor(lo / step) * step;
  const end = Math.ceil(hi / step) * step;

  const ticks: number[] = [];
  // Counted rather than accumulated: repeatedly adding 0.1 drifts, and an axis
  // labelled 0.30000000000000004 is the classic form of that bug.
  const steps = Math.round((end - start) / step);
  for (let i = 0; i <= steps; i += 1) ticks.push(roundToStep(start + i * step, step));

  return { domain: [start, end], ticks };
}

/**
 * Clear the floating-point dust a multiplication leaves behind.
 *
 * `0.1 * 3` is `0.30000000000000004`, and an axis label is the one place that
 * is guaranteed to be seen. The number of decimals is taken from the step, so
 * a step of 0.25 keeps two and a step of 1000 keeps none.
 */
export function roundToStep(value: number, step: number): number {
  if (!Number.isFinite(step) || step <= 0) return value;
  const decimals = Math.max(0, Math.min(20, -Math.floor(Math.log10(step)) + 1));
  return Number(value.toFixed(decimals));
}

/**
 * Positions for a run of categories: bars, columns, tick labels.
 *
 * `padding` is the fraction of each slot left as gap, so 0 gives touching bars
 * (a histogram) and 0.4 gives the airy spacing a column chart wants. Expressed
 * as a fraction rather than in pixels because the whole point is that it holds
 * as the chart is resized — a fixed gap turns into a solid block at small
 * widths and into stripes at large ones.
 */
export interface Band {
  /** Distance between the start of one slot and the next. */
  step: number;
  /** Drawn width of one bar, gap already removed. */
  bandWidth: number;
  /** Left edge of the drawn band for category `i`. */
  at(index: number): number;
  /** Centre of the drawn band for category `i` — where a tick label goes. */
  centre(index: number): number;
}

export function bandScale(count: number, range: Domain, padding = 0.25): Band {
  const [r0, r1] = range;
  const n = Math.max(1, Math.floor(count));
  const step = (r1 - r0) / n;
  // Clamped rather than trusted: a padding of 1 is a chart of invisible bars,
  // and a negative one draws them overlapping their neighbours.
  const clamped = Math.min(0.9, Math.max(0, padding));
  const bandWidth = step * (1 - clamped);
  const offset = (step - bandWidth) / 2;

  return {
    step,
    bandWidth,
    at: (index: number) => r0 + index * step + offset,
    centre: (index: number) => r0 + index * step + step / 2,
  };
}

/**
 * Format a number for an axis or a value label.
 *
 * Thousands are abbreviated because an axis is read at a glance and
 * `1,200,000` costs more width than it carries information — but only from
 * 10,000 up, so a chart of prices in the hundreds is not rewritten into
 * something less precise than the data.
 */
export function formatTick(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${trimZeros(value / 1_000_000)}M`;
  if (abs >= 10_000) return `${trimZeros(value / 1000)}k`;
  return trimZeros(value);
}

function trimZeros(value: number): string {
  // One decimal at most, and none when it would be `.0` — `1.0k` reads as a
  // precision the abbreviation has already thrown away.
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/**
 * A logarithmic scale, for data that spans orders of magnitude.
 *
 * ## Why this is not a flag on `linearScale`
 *
 * A log scale is undefined at and below zero, and that is not an edge case to
 * clamp away — it is the whole reason the caller has to opt in. A response-time
 * chart from 8ms to 40s is unreadable on a linear axis and obvious on a log
 * one; the same axis applied to a series containing a zero has no honest
 * answer, and silently substituting one would draw a point where the data says
 * nothing.
 *
 * So: values at or below zero map to the bottom of the range and the *caller*
 * is told, through `logDomainOf`, whether its data can be drawn this way at
 * all. A control that offers a log axis for data containing zero and quietly
 * lies is the failure this arrangement exists to prevent.
 */
export function logScale(domain: Domain, range: Domain): (value: number) => number {
  const [d0, d1] = domain;
  const [r0, r1] = range;

  const lo = Math.log10(Math.max(d0, Number.MIN_VALUE));
  const hi = Math.log10(Math.max(d1, Number.MIN_VALUE));
  const span = hi - lo;

  if (!(span > 0) || !Number.isFinite(span)) {
    const mid = (r0 + r1) / 2;
    return () => mid;
  }

  return (value: number) => {
    if (!(value > 0)) return r0;
    return r0 + ((Math.log10(value) - lo) / span) * (r1 - r0);
  };
}

/**
 * Whether a set of values can be drawn on a log axis, and the domain if so.
 *
 * Decades rather than the data's own bounds: an axis running 8 to 40000 with
 * ticks at those numbers is not a log axis anybody can read. Rounding out to
 * powers of ten is what puts the gridlines where the eye expects them.
 */
export function logDomainOf(values: number[]): { ok: boolean; domain: Domain; ticks: number[] } {
  const positive = values.filter((v) => Number.isFinite(v) && v > 0);
  // Fewer than two positive values is not a range, and any non-positive value
  // means part of the data cannot be shown at all.
  const ok = positive.length > 0 && positive.length === values.filter(Number.isFinite).length;

  if (positive.length === 0) return { ok: false, domain: [1, 10], ticks: [1, 10] };

  const lo = 10 ** Math.floor(Math.log10(Math.min(...positive)));
  const hi = 10 ** Math.ceil(Math.log10(Math.max(...positive)));
  const domain: Domain = [lo, hi === lo ? lo * 10 : hi];

  const ticks: number[] = [];
  for (let e = Math.log10(domain[0]); e <= Math.log10(domain[1]) + 1e-9; e += 1) {
    ticks.push(10 ** Math.round(e));
  }

  return { ok, domain, ticks };
}
