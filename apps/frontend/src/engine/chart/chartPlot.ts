import { parseExpression, type CompiledExpression } from './expression';

/**
 * Sampling a formula into points a chart can draw.
 *
 * ## The two things a function plotter gets wrong
 *
 * **Asymptotes.** `tan(x)` runs to infinity at every odd multiple of pi/2. A
 * naive sampler joins the sample either side of one, drawing a near-vertical
 * line through a place the function never visits — the single most recognisable
 * way a plotter is wrong. The run is broken at any sample that is not finite,
 * and at any *jump* far larger than the neighbouring steps, because a
 * discontinuity that happens to land between two finite samples looks exactly
 * like a very steep slope otherwise.
 *
 * **Uniform sampling.** A fixed step draws `sin(50x)` as noise and a straight
 * line as five hundred redundant points. This subdivides where the curve turns:
 * a segment whose midpoint is far from the chord between its ends is split, to
 * a depth limit. That is adaptive sampling, and it is the difference between a
 * curve and a polygon.
 *
 * Both produce `null` holes, which is the same representation a missing reading
 * uses everywhere else in this engine — so the layout breaks the run at them
 * with no plotting-specific code at all.
 */

export interface PlotSample {
  x: number;
  /** `null` where the function is undefined or discontinuous. */
  y: number | null;
}

/** How far a curve may be from its chord before the segment is split. */
const FLATNESS = 0.35;
const MAX_DEPTH = 6;

/**
 * A jump larger than this multiple of the median step is read as a
 * discontinuity rather than as a steep slope.
 *
 * Median rather than mean, because the outliers this is trying to find would
 * drag a mean up to include themselves.
 */
const JUMP_FACTOR = 24;

export interface PlotOptions {
  from: number;
  to: number;
  /** Baseline sample count before adaptive subdivision. */
  samples?: number;
}

/**
 * Sample `f` across a domain, splitting where it curves and breaking where it
 * is undefined.
 */
export function samplePlot(
  f: (x: number) => number,
  options: PlotOptions
): PlotSample[] {
  const from = Number.isFinite(options.from) ? options.from : -10;
  const to = Number.isFinite(options.to) ? options.to : 10;
  if (!(to > from)) return [];

  const base = Math.min(2000, Math.max(16, Math.round(options.samples ?? 160)));
  const step = (to - from) / base;

  const out: PlotSample[] = [];
  const value = (x: number) => {
    const y = f(x);
    return Number.isFinite(y) ? y : null;
  };

  let prevX = from;
  let prevY = value(from);
  out.push({ x: prevX, y: prevY });

  for (let i = 1; i <= base; i += 1) {
    const x = from + i * step;
    const y = value(x);
    if (prevY !== null && y !== null) {
      subdivide(f, prevX, prevY, x, y, 0, out);
    }
    out.push({ x, y });
    prevX = x;
    prevY = y;
  }

  return breakDiscontinuities(out);
}

/**
 * Split a segment while its midpoint departs from the straight line between
 * its ends. Depth-limited, so a pathological function cannot hang the tab.
 */
function subdivide(
  f: (x: number) => number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  depth: number,
  out: PlotSample[]
): void {
  if (depth >= MAX_DEPTH) return;

  const xm = (x0 + x1) / 2;
  const ym = f(xm);
  if (!Number.isFinite(ym)) return;

  const chord = (y0 + y1) / 2;
  const span = Math.abs(y1 - y0) + Math.abs(x1 - x0);
  // Scaled by the segment's own size, so the test means the same thing on a
  // curve through 0.001 and one through a million.
  if (Math.abs(ym - chord) <= FLATNESS * span * 0.1) return;

  subdivide(f, x0, y0, xm, ym, depth + 1, out);
  out.push({ x: xm, y: ym });
  subdivide(f, xm, ym, x1, y1, depth + 1, out);
}

/**
 * Turn implausible jumps into holes.
 *
 * `tan` steps from a very large positive to a very large negative between two
 * finite samples, and nothing about either sample says "undefined". The tell is
 * the *size of the step* against its neighbours.
 */
function breakDiscontinuities(points: PlotSample[]): PlotSample[] {
  const steps: number[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1].y;
    const b = points[i].y;
    if (a !== null && b !== null) steps.push(Math.abs(b - a));
  }
  if (steps.length < 4) return points;

  const sorted = [...steps].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 0;
  if (median === 0) return points;

  const limit = median * JUMP_FACTOR;
  const out: PlotSample[] = [points[0]];

  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const cur = points[i];
    if (prev.y !== null && cur.y !== null && Math.abs(cur.y - prev.y) > limit) {
      // A hole between them, so the run is cut rather than joined across.
      out.push({ x: (prev.x + cur.x) / 2, y: null });
    }
    out.push(cur);
  }
  return out;
}

export interface PlotCurve {
  /** The expression as typed, kept for the editor and for the legend. */
  source: string;
  color?: string;
  /** Absent means visible; the panel toggles it without deleting the formula. */
  hidden?: boolean;
  /** Stroke thickness in pixels (1 to 5). Absent defaults to 2. */
  width?: number;
  /** Stroke dash style. Absent is solid. */
  style?: 'solid' | 'dashed' | 'dotted';
}

export interface CompiledCurve {
  source: string;
  color?: string;
  compiled: CompiledExpression | null;
  error?: string;
}

/** Compile a list of curves, keeping the failures so the panel can show them. */
export function compileCurves(
  curves: PlotCurve[],
  variable: string | string[] = 'x'
): CompiledCurve[] {
  return curves.map((c) => {
    const result = parseExpression(c.source, variable);
    return result.ok
      ? { source: c.source, color: c.color, compiled: result.expression }
      : { source: c.source, color: c.color, compiled: null, error: result.error.message };
  });
}

/**
 * A parametric pair sampled over `t`: `x(t)`, `y(t)`.
 *
 * Kept separate from `samplePlot` rather than generalised, because the
 * adaptive test is different: a function of x is subdivided on how far *y*
 * departs from the chord, while a parametric curve has to be subdivided on the
 * distance in the **plane**. Folding them together would mean one of the two
 * silently getting the other's flatness test, and the curve that suffers is
 * the one that doubles back — which is the whole reason to use parametric form.
 */
export function sampleParametric(
  fx: (t: number) => number,
  fy: (t: number) => number,
  options: PlotOptions
): Array<{ x: number; y: number } | null> {
  const from = Number.isFinite(options.from) ? options.from : 0;
  const to = Number.isFinite(options.to) ? options.to : Math.PI * 2;
  if (!(to > from)) return [];

  const n = Math.min(4000, Math.max(32, Math.round(options.samples ?? 400)));
  const out: Array<{ x: number; y: number } | null> = [];

  for (let i = 0; i <= n; i += 1) {
    const t = from + ((to - from) * i) / n;
    const x = fx(t);
    const y = fy(t);
    out.push(Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null);
  }
  return out;
}

/**
 * A polar curve `r(a)` sampled into cartesian points.
 *
 * A negative radius is drawn on the opposite ray rather than dropped, which is
 * the standard convention and is what makes `r = cos(2a)` produce a four-petal
 * rose instead of two petals and two gaps.
 */
export function samplePolar(
  fr: (a: number) => number,
  options: PlotOptions
): Array<{ x: number; y: number } | null> {
  const from = Number.isFinite(options.from) ? options.from : 0;
  const to = Number.isFinite(options.to) ? options.to : Math.PI * 2;
  if (!(to > from)) return [];

  const n = Math.min(4000, Math.max(64, Math.round(options.samples ?? 720)));
  const out: Array<{ x: number; y: number } | null> = [];

  for (let i = 0; i <= n; i += 1) {
    const a = from + ((to - from) * i) / n;
    const r = fr(a);
    if (!Number.isFinite(r)) {
      out.push(null);
      continue;
    }
    out.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
  }
  return out;
}
