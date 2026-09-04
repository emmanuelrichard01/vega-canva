/**
 * Reading things off a curve: where it crosses zero, where it turns, and how
 * much is under it.
 *
 * ## Why this works on samples rather than symbolically
 *
 * A symbolic differentiator would give exact roots for the handful of forms it
 * knew and nothing at all for the rest — and the rest includes everything
 * interesting a person actually types, because `sin(x)/x` and `|x| - cos(3x)`
 * have no closed-form roots to find. Working from the samples the plotter has
 * already taken means every result is available for every expression, and the
 * accuracy is bounded by something the user controls: the sample count.
 *
 * The trade is stated plainly rather than hidden: a feature narrower than the
 * curve's own sampling is invisible to all of this. `sin(1000x)` on a domain of
 * ±10 at 160 samples has roots this will not find, and pretending otherwise —
 * by drawing a confident marker at a root that is merely the nearest sampled
 * sign change — is worse than finding fewer. So roots are **refined by
 * bisection** against the real function once a bracket is found, which makes
 * the ones it does report accurate to within a few floating-point steps rather
 * than to within a sample.
 */

export interface Sample {
  x: number;
  y: number | null;
}

export interface CurvePoint {
  x: number;
  y: number;
}

/**
 * Where the curve crosses zero.
 *
 * Found by bracketing a sign change between adjacent samples, then bisecting
 * against the *function* rather than interpolating between the two samples.
 * Linear interpolation is the obvious shortcut and it is wrong exactly where
 * it matters: near a root the curve is only approximately a line, and the
 * error is largest for the steep crossings a reader is most likely to be
 * checking.
 *
 * A sample that is exactly zero is a root without any bracketing.
 *
 * Discontinuities are **not** roots. `1/x` changes sign across its pole
 * without ever being zero, and reporting that as a crossing is the classic
 * false positive — so a bracket whose endpoints are both large is rejected.
 */
export function findRoots(
  samples: Sample[],
  f: (x: number) => number,
  limit = 64
): number[] {
  const roots: number[] = [];

  for (let i = 1; i < samples.length && roots.length < limit; i += 1) {
    const a = samples[i - 1];
    const b = samples[i];
    if (a.y === null || b.y === null) continue;

    if (a.y === 0) {
      roots.push(a.x);
      continue;
    }
    if (a.y > 0 === b.y > 0) continue;

    // A sign change where both sides are far from zero is a pole, not a root.
    // The span is the scale to judge "far" against, since a curve through the
    // millions crosses zero with large neighbours quite legitimately.
    const reach = Math.abs(b.x - a.x);
    const slope = Math.abs(b.y - a.y) / (reach || 1);
    if (slope > 1e6) continue;

    const r = bisect(f, a.x, b.x);
    if (r !== null) roots.push(r);
  }

  return dedupe(roots);
}

/** Bisection against the real function, to floating-point resolution. */
function bisect(f: (x: number) => number, lo: number, hi: number): number | null {
  let a = lo;
  let b = hi;
  let fa = f(a);
  let fb = f(b);
  if (!Number.isFinite(fa) || !Number.isFinite(fb) || fa > 0 === fb > 0) return null;

  // Sixty iterations halves the interval by 2^60, which reaches the limit of a
  // double long before it runs out — the loop is bounded rather than tuned.
  for (let i = 0; i < 60; i += 1) {
    const m = (a + b) / 2;
    const fm = f(m);
    if (!Number.isFinite(fm)) return null;
    if (fm === 0) return m;
    if (fa > 0 === fm > 0) {
      a = m;
      fa = fm;
    } else {
      b = m;
      fb = fm;
    }
    if (Math.abs(b - a) < 1e-12) break;
  }
  return (a + b) / 2;
}

export interface Extremum extends CurvePoint {
  kind: 'min' | 'max';
}

/**
 * Local turning points, from a sign change in the sampled slope.
 *
 * Deliberately *not* refined the way roots are. A root is a property of the
 * function that bisection can pin down exactly; a turning point found from
 * samples is only as located as the samples around it, and polishing it with a
 * golden-section search would give three more digits of precision to a point
 * whose *existence* is still a claim about the sampling. Reporting it at the
 * sample is honest about what was actually measured.
 *
 * A turn across a hole is skipped: `1/x` has no maximum at its pole.
 */
export function findExtrema(samples: Sample[], limit = 48): Extremum[] {
  const out: Extremum[] = [];

  for (let i = 1; i < samples.length - 1 && out.length < limit; i += 1) {
    const prev = samples[i - 1];
    const cur = samples[i];
    const next = samples[i + 1];
    if (prev.y === null || cur.y === null || next.y === null) continue;

    const rising = cur.y - prev.y;
    const falling = next.y - cur.y;
    if (rising === 0 || falling === 0) continue;

    if (rising > 0 && falling < 0) out.push({ x: cur.x, y: cur.y, kind: 'max' });
    else if (rising < 0 && falling > 0) out.push({ x: cur.x, y: cur.y, kind: 'min' });
  }

  return out;
}

/**
 * The signed area between the curve and the x axis, by the trapezium rule.
 *
 * **Signed**, which is the whole point: the integral of `sin(x)` over a full
 * period is zero, and reporting the unsigned area would give `4` and quietly
 * answer a different question. A reader checking net change against a chart
 * needs the sign.
 *
 * Trapezoidal rather than Simpson's, because the samples are adaptively spaced
 * — Simpson's requires uniform intervals in pairs, and forcing them would mean
 * re-sampling the function on a grid, discarding the adaptive work that makes
 * the drawn curve accurate in the first place.
 *
 * Segments touching a hole contribute nothing rather than being bridged: the
 * area under an undefined region is not zero, it is undefined, and adding a
 * trapezium across a pole would produce a confident number that means nothing.
 */
export function integrate(samples: Sample[]): { value: number; complete: boolean } {
  let total = 0;
  let complete = true;

  for (let i = 1; i < samples.length; i += 1) {
    const a = samples[i - 1];
    const b = samples[i];
    if (a.y === null || b.y === null) {
      complete = false;
      continue;
    }
    total += ((a.y + b.y) / 2) * (b.x - a.x);
  }

  return { value: total, complete };
}

/**
 * A numeric derivative, as samples the plotter can draw like any other curve.
 *
 * Central differences where there is a neighbour on both sides, one-sided at
 * the ends. Central is worth the branch: its error falls with the square of the
 * step where a one-sided difference falls linearly, which on a curve with any
 * curvature at all is the difference between a derivative that overlays the
 * true slope and one visibly lagging it.
 */
export function differentiate(samples: Sample[]): Sample[] {
  return samples.map((s, i) => {
    const prev = samples[i - 1];
    const next = samples[i + 1];
    if (s.y === null) return { x: s.x, y: null };

    if (prev?.y != null && next?.y != null && next.x !== prev.x) {
      return { x: s.x, y: (next.y - prev.y) / (next.x - prev.x) };
    }
    if (next?.y != null && next.x !== s.x) return { x: s.x, y: (next.y - s.y) / (next.x - s.x) };
    if (prev?.y != null && s.x !== prev.x) return { x: s.x, y: (s.y - prev.y) / (s.x - prev.x) };
    return { x: s.x, y: null };
  });
}

/**
 * Where two sampled curves meet.
 *
 * Their difference is a curve whose roots are the intersections, so this is
 * `findRoots` on `f - g` — which is not a shortcut but the actual definition,
 * and means intersections inherit the same bisection accuracy and the same
 * pole rejection rather than needing either written twice.
 */
export function findIntersections(
  a: Sample[],
  f: (x: number) => number,
  g: (x: number) => number,
  limit = 32
): CurvePoint[] {
  const difference: Sample[] = a.map((s) => {
    const fx = f(s.x);
    const gx = g(s.x);
    return {
      x: s.x,
      y: Number.isFinite(fx) && Number.isFinite(gx) ? fx - gx : null,
    };
  });

  return findRoots(difference, (x) => f(x) - g(x), limit).map((x) => ({ x, y: f(x) }));
}

/** Collapse values that are the same root found from two adjacent brackets. */
function dedupe(values: number[]): number[] {
  const out: number[] = [];
  for (const v of values) {
    const span = Math.abs(v) || 1;
    if (!out.some((seen) => Math.abs(seen - v) < span * 1e-9)) out.push(v);
  }
  return out;
}
