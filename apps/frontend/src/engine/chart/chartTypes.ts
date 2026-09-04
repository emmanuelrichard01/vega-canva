/**
 * What a chart *is*, as data.
 *
 * Deliberately separate from the layout that draws it. A chart node stores this
 * and nothing positional — no bar rectangles, no tick coordinates — for the
 * same reason a connector stores node ids rather than points: geometry that is
 * stored is geometry that goes stale the moment the box is resized. Everything
 * with a coordinate is recomputed on read by `chartLayout.ts`.
 */

/**
 * The marks a chart can draw.
 *
 * Cut by *what question the mark answers*, and grouped into families below
 * because that is the question somebody actually arrives with. Nobody wants
 * "a stacked area"; they want to show how a total split up over time.
 *
 * Several of these are the same pipeline read differently rather than new
 * machinery, which is the point of having them: `barHorizontal` is `bar` with
 * the axes transposed, `stackedBar100` is `stackedBar` over normalised data,
 * `step` is `line` through a staircase, `funnel` and `waterfall` are bars with
 * a different rule for where each one starts. Offering them as kinds means the
 * reading is a choice rather than something you rebuild by hand each time.
 *
 * **`histogram` is the exception, and it earns it.** It is the only kind that
 * transforms the numbers rather than just placing them: it buckets raw samples
 * and draws the counts. An earlier version of this file refused it on the
 * grounds that a kind must not silently reinterpret its data — which is right
 * about *silently* and wrong about *refusing*. Distribution is a question
 * people genuinely have, and the honest answer is an explicit kind with a
 * visible bucket count, not a chart type nobody can reach. See `bucketize`.
 */
export const CHART_KINDS = [
  // Comparison
  'bar',
  'barHorizontal',
  'stackedBar',
  'stackedBar100',
  // Trend
  'line',
  'step',
  'area',
  'stackedArea',
  // Relationship and distribution
  'scatter',
  'bubble',
  'histogram',
  // Part to whole
  'pie',
  'donut',
  'funnel',
  // Specialist
  'waterfall',
  'radar',
] as const;

/**
 * The families, which is how the picker groups them and how a reader decides.
 *
 * Sixteen kinds in one flat list is a wall — the same problem the template
 * gallery solved by grouping on the *job* rather than on the tools involved.
 * Nobody arrives wanting "a stacked area"; they arrive wanting to show how a
 * total split up over time, and the family is the question they can answer.
 */
export const CHART_FAMILIES = [
  'comparison',
  'trend',
  'distribution',
  'partToWhole',
  'specialist',
] as const;

export type ChartFamily = (typeof CHART_FAMILIES)[number];

export const CHART_FAMILY_OF: Record<ChartKind, ChartFamily> = {
  bar: 'comparison',
  barHorizontal: 'comparison',
  stackedBar: 'comparison',
  stackedBar100: 'comparison',
  line: 'trend',
  step: 'trend',
  area: 'trend',
  stackedArea: 'trend',
  scatter: 'distribution',
  bubble: 'distribution',
  histogram: 'distribution',
  pie: 'partToWhole',
  donut: 'partToWhole',
  funnel: 'partToWhole',
  waterfall: 'specialist',
  radar: 'specialist',
};

export type ChartKind = (typeof CHART_KINDS)[number];

/**
 * Exported as a value, not only a type.
 *
 * Same reasoning as `NODE_TYPES`: the read boundary has to decide at runtime
 * whether a `kind` string off the wire is one it knows, and a hand-kept second
 * copy of the list is what once rewrote every `connector` into a `shape`.
 */
export function isChartKind(value: unknown): value is ChartKind {
  return typeof value === 'string' && (CHART_KINDS as readonly string[]).includes(value);
}

/** Slices of a circle, rather than marks against a pair of axes. */
export function isRadial(kind: ChartKind): boolean {
  return kind === 'pie' || kind === 'donut';
}

/** Drawn on polar axes: one spoke per category, rings for the value scale. */
export function isPolar(kind: ChartKind): boolean {
  return kind === 'radar';
}

/**
 * Series sit on top of one another rather than side by side.
 *
 * `area` is deliberately *not* stacked: a plain area chart of two series draws
 * them overlapping, each measured from the baseline, and reading it as a stack
 * would silently double every total. `stackedArea` is the kind that stacks,
 * which is why both exist.
 */
export function isStacked(kind: ChartKind): boolean {
  return kind === 'stackedBar' || kind === 'stackedBar100' || kind === 'stackedArea';
}

/** Every series normalised to a share of its category's total. */
export function isPercentStacked(kind: ChartKind): boolean {
  return kind === 'stackedBar100';
}

/** Drawn as rectangles from a baseline — bars, stacks, funnels, waterfalls. */
export function isBarLike(kind: ChartKind): boolean {
  return (
    kind === 'bar' ||
    kind === 'barHorizontal' ||
    kind === 'stackedBar' ||
    kind === 'stackedBar100' ||
    kind === 'histogram' ||
    kind === 'waterfall' ||
    kind === 'funnel'
  );
}

/**
 * The value axis runs left-to-right and the categories run down.
 *
 * Its own predicate rather than a flag on the spec, because it is a property
 * of the *kind* and not a setting: a horizontal bar chart is what you reach for
 * when the category names are long enough that vertical labels would have to
 * be turned on their side, and that is a different chart, not a rotated one.
 */
export function isTransposed(kind: ChartKind): boolean {
  return kind === 'barHorizontal' || kind === 'funnel';
}

/** Marks whose filled extent *is* the quantity, so the axis must reach zero. */
export function encodesMagnitude(kind: ChartKind): boolean {
  return isBarLike(kind) || kind === 'area' || kind === 'stackedArea';
}

/** Bars that touch, because the categories are a continuum and not a set. */
export function isContinuous(kind: ChartKind): boolean {
  return kind === 'histogram';
}

export interface ChartSeries {
  /** Shown in the legend and in the data editor's column head. */
  name: string;
  /**
   * One value per category, positionally.
   *
   * A hole is `null` rather than `0`, because they are different claims: a
   * line chart draws a gap through a missing reading and draws a point on the
   * axis for a measured zero. Conflating them is how a sensor outage becomes
   * a reported crash to nothing.
   */
  values: Array<number | null>;
  /** Overrides the palette slot. Absent means "take the series colour". */
  color?: string;
}

export interface ChartSpec {
  kind: ChartKind;
  /**
   * The x axis labels, or the slice labels for a pie.
   *
   * The source of truth for how many points a chart has. A series longer than
   * this is truncated on read and a shorter one is padded with holes, so the
   * two can never disagree about the length of the data — which is the shape
   * of bug that puts the last bar under the wrong label.
   */
  categories: string[];
  series: ChartSeries[];
  /** Drawn above the plot. Absent draws nothing and gives the space back. */
  title?: string;
  /** Absent is "show it when there is more than one series". */
  showLegend?: boolean;
  /** Horizontal rules behind the marks. Absent is on for axis charts. */
  showGrid?: boolean;
  /** The number on each bar or point. Absent is off — it crowds quickly. */
  showValues?: boolean;
  /**
   * Whether the value axis must reach zero.
   *
   * Defaults by whether the mark **encodes magnitude with a filled extent**.
   * A bar's length and an area's depth both do, so a non-zero baseline makes
   * that extent a lie — the band between 297 and 303 would be drawn as though
   * it were the whole quantity. A line and a scatter encode *shape* and
   * *position* instead, and forcing zero onto a series that varies between 297
   * and 303 flattens the only thing they have to say.
   *
   * So: on for `bar`, `stackedBar` and `area`; off for `line` and `scatter`.
   * Area was originally grouped with line, on the reasoning that it is a line
   * with a fill — which is how it is *drawn* and not what it *means*. The test
   * that closes an area to its baseline is what caught it, by finding there
   * was no baseline to close to.
   */
  includeZero?: boolean;
  /** Hard axis bounds. Absent lets `niceDomain` choose. */
  yMin?: number;
  yMax?: number;
  /**
   * Donut hole, as a fraction of the outer radius. Clamped 0.15..0.85.
   *
   * A fraction rather than a length so it survives the chart being resized,
   * which is the same reason band padding is a fraction.
   */
  innerRadius?: number;
  /** Smooth the run through its points instead of joining them straight. */
  curved?: boolean;
  /**
   * How many buckets a histogram divides its range into. Clamped 2..60.
   *
   * Visible and editable rather than derived by a rule like Sturges', because
   * bucket count is the one setting that changes what a histogram *says* — the
   * same samples at 5 buckets and at 40 tell different stories, and both are
   * legitimate. A chart whose shape depends on a hidden heuristic is a chart
   * nobody can defend in a meeting.
   */
  buckets?: number;
  /**
   * A unit written after every value, e.g. `%`, `ms`, `k`.
   *
   * A suffix rather than a format string: a format string is a small language
   * to learn, and every real use of one here is "put this word after the
   * number". `prefix` covers currency, which goes in front.
   */
  valueSuffix?: string;
  valuePrefix?: string;
  /**
   * How many decimal places value labels and ticks show. Absent is automatic.
   *
   * Automatic means "as many as the tick step needs", which is right until the
   * data is money and 1.5 has to read as 1.50.
   */
  decimals?: number;
  /**
   * A horizontal rule across the plot at a named value: a target, a budget, an
   * SLA, a mean.
   *
   * This is the one piece of *annotation* the chart itself owns rather than
   * leaving to a line object drawn on top. It has to be here because it is the
   * only way the mark can survive a resize or a change of data — a hand-drawn
   * rule at y=250 is at 250 pixels, not at 250 units, and stops meaning
   * anything the moment either changes.
   */
  reference?: { value: number; label?: string; color?: string };
}

/** Everything a spec may leave out, resolved once so no reader guesses twice. */
export interface ResolvedChartOptions {
  showLegend: boolean;
  showGrid: boolean;
  showValues: boolean;
  includeZero: boolean;
  innerRadius: number;
  curved: boolean;
  buckets: number;
}

/**
 * Fill in what the spec omitted.
 *
 * One place, because a default applied at the point of use is a default that
 * two call sites will eventually disagree about — and this codebase has paid
 * for that with sizes read from three fields with different precedence in six
 * modules. Every reader of a chart calls this and then reads plain booleans.
 */
export function resolveChartOptions(spec: ChartSpec): ResolvedChartOptions {
  const radial = isRadial(spec.kind);
  // A funnel and a pie both name their *categories* in the legend, so both
  // want one even with a single series.
  const namesCategories = radial || spec.kind === 'funnel';

  return {
    // More than one series needs a key; one series is named by the title and a
    // legend of one entry is a label pretending to be a control.
    showLegend: spec.showLegend ?? (namesCategories || spec.series.length > 1),
    showGrid: spec.showGrid ?? !(radial || isPolar(spec.kind)),
    showValues: spec.showValues ?? false,
    includeZero: spec.includeZero ?? encodesMagnitude(spec.kind),
    innerRadius:
      spec.kind === 'donut' ? Math.min(0.85, Math.max(0.15, spec.innerRadius ?? 0.55)) : 0,
    curved: spec.curved ?? false,
    buckets: Math.min(60, Math.max(2, Math.round(spec.buckets ?? 10))),
  };
}

/**
 * A spec with its data made rectangular.
 *
 * Every series is exactly `categories.length` long afterwards. Doing this once
 * at the top of layout means no mark builder has to carry a bounds check, and
 * more importantly it means a series that is one element short cannot silently
 * shift every later value under the wrong category.
 */
export function normalizeSpec(spec: ChartSpec): ChartSpec {
  const width = spec.categories.length;

  return {
    ...spec,
    series: spec.series.map((s) => ({
      ...s,
      values: Array.from({ length: width }, (_, i) => {
        const v = s.values[i];
        return typeof v === 'number' && Number.isFinite(v) ? v : null;
      }),
    })),
  };
}

/**
 * Bucket raw samples into counts, for a histogram.
 *
 * The one data transform any kind performs, and it is explicit for that
 * reason: the caller can see the bucket count, change it, and watch the shape
 * change. Every value across every series is pooled -- a histogram of two
 * series is a histogram of both together, which is what "the distribution of
 * this data" means; comparing two distributions is two histograms.
 *
 * Bucket edges land on `niceStep` boundaries rather than on the raw min and
 * max, so the labels read `0-10, 10-20` instead of `3.7-11.2, 11.2-18.7`. A
 * histogram whose axis nobody can read is a picture of a distribution rather
 * than a measurement of one.
 */
export function bucketize(
  values: Array<number | null>,
  bucketCount: number
): { categories: string[]; counts: number[] } {
  const samples = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (samples.length === 0) return { categories: [], counts: [] };

  const lo = Math.min(...samples);
  const hi = Math.max(...samples);

  // Every sample identical: one bucket holding all of them is the truthful
  // answer, and dividing by a zero range is the alternative.
  if (lo === hi) return { categories: [formatBucket(lo, hi)], counts: [samples.length] };

  const n = Math.min(60, Math.max(2, Math.round(bucketCount)));
  const width = (hi - lo) / n;
  const counts = new Array(n).fill(0);

  for (const v of samples) {
    // The top edge belongs to the last bucket rather than to a bucket that
    // does not exist -- the classic off-by-one that silently drops the maximum.
    const i = v === hi ? n - 1 : Math.floor((v - lo) / width);
    counts[Math.min(n - 1, Math.max(0, i))] += 1;
  }

  const categories = counts.map((_, i) => formatBucket(lo + i * width, lo + (i + 1) * width));
  return { categories, counts };
}

function formatBucket(lo: number, hi: number): string {
  const span = Math.abs(hi - lo);
  const decimals = span >= 10 ? 0 : span >= 1 ? 1 : 2;
  return `${lo.toFixed(decimals)}-${hi.toFixed(decimals)}`;
}

/**
 * Normalise each category to shares of its own total, for a 100% stack.
 *
 * A category whose values sum to zero stays zero rather than becoming `NaN`,
 * and that is the honest reading: there is nothing to take a share of, so the
 * column is empty rather than arbitrarily divided.
 */
export function toPercentStack(spec: ChartSpec): ChartSpec {
  const totals = spec.categories.map((_, i) =>
    spec.series.reduce((sum, s) => {
      const v = s.values[i];
      return sum + (typeof v === 'number' && v > 0 ? v : 0);
    }, 0)
  );

  return {
    ...spec,
    series: spec.series.map((s) => ({
      ...s,
      values: s.values.map((v, i) => {
        if (typeof v !== 'number') return null;
        const total = totals[i];
        return total > 0 ? (v / total) * 100 : 0;
      }),
    })),
  };
}

/**
 * A run of points turned into a staircase.
 *
 * Each value is held until the next one arrives, which is what a step chart
 * asserts: the quantity did not slide between readings, it changed at one.
 * That is the right reading for a price, a headcount or a version number, and
 * the wrong one for a temperature -- which is why it is a separate kind rather
 * than a smoothing option.
 */
export function toStaircase<T extends { x: number; y: number }>(points: T[]): Array<{ x: number; y: number }> {
  if (points.length < 2) return points.map((p) => ({ x: p.x, y: p.y }));
  const out: Array<{ x: number; y: number }> = [{ x: points[0].x, y: points[0].y }];
  for (let i = 1; i < points.length; i += 1) {
    out.push({ x: points[i].x, y: points[i - 1].y });
    out.push({ x: points[i].x, y: points[i].y });
  }
  return out;
}

/**
 * The default series palette.
 *
 * Chosen for two things at once: distinguishable from each other, and legible
 * as a fill under dark text on a light board *and* light text on a dark one,
 * which is what stops a chart needing a different palette per theme. Ordered
 * so the first three — the common case — are maximally separated in hue rather
 * than being three neighbours off a ramp.
 */
export const CHART_PALETTE = [
  '#3B82F6',
  '#F59E0B',
  '#10B981',
  '#8B5CF6',
  '#EF4444',
  '#14B8A6',
  '#EC4899',
  '#6366F1',
  '#84CC16',
  '#F97316',
] as const;

/** The colour for series `index`, honouring an explicit override. */
export function seriesColor(series: ChartSeries | undefined, index: number): string {
  return series?.color ?? CHART_PALETTE[index % CHART_PALETTE.length];
}

/** A starting chart, used by the tool and by the templates. */
export function defaultChartSpec(kind: ChartKind = 'bar'): ChartSpec {
  if (isRadial(kind)) {
    return {
      kind,
      categories: ['Direct', 'Search', 'Social', 'Referral'],
      series: [{ name: 'Sessions', values: [420, 310, 180, 90] }],
      title: 'Traffic by channel',
    };
  }

  return {
    kind,
    categories: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    series: [{ name: 'Visits', values: [120, 210, 170, 260, 300] }],
    title: 'Visits this week',
  };
}
