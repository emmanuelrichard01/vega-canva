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
 * Seven rather than a longer list, and the cut is by *what question the mark
 * answers* rather than by what is easy to add. `bar` compares categories,
 * `stackedBar` compares them while also showing composition, `line` and
 * `area` show a series over an ordered run, `scatter` shows two measures
 * against each other, `pie` and `donut` show parts of one whole.
 *
 * A histogram is deliberately **not** here: it is a `bar` chart whose
 * categories are bucket labels, and the bucketing is a data transform rather
 * than a drawing mode. Putting it here would mean a chart kind that silently
 * reinterprets the numbers it was given.
 */
export const CHART_KINDS = [
  'bar',
  'stackedBar',
  'line',
  'area',
  'scatter',
  'pie',
  'donut',
] as const;

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

/** Whether a kind draws slices of a circle rather than marks against axes. */
export function isRadial(kind: ChartKind): boolean {
  return kind === 'pie' || kind === 'donut';
}

/** Whether a kind stacks its series rather than placing them side by side. */
export function isStacked(kind: ChartKind): boolean {
  return kind === 'stackedBar' || kind === 'area';
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
}

/** Everything a spec may leave out, resolved once so no reader guesses twice. */
export interface ResolvedChartOptions {
  showLegend: boolean;
  showGrid: boolean;
  showValues: boolean;
  includeZero: boolean;
  innerRadius: number;
  curved: boolean;
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
  const bars = spec.kind === 'bar' || spec.kind === 'stackedBar';
  // Marks whose filled extent is the quantity — see `includeZero`.
  const filled = bars || spec.kind === 'area';

  return {
    // More than one series needs a key; one series is named by the title and a
    // legend of one entry is a label pretending to be a control.
    showLegend: spec.showLegend ?? (radial || spec.series.length > 1),
    showGrid: spec.showGrid ?? !radial,
    showValues: spec.showValues ?? false,
    includeZero: spec.includeZero ?? filled,
    innerRadius:
      spec.kind === 'donut' ? Math.min(0.85, Math.max(0.15, spec.innerRadius ?? 0.55)) : 0,
    curved: spec.curved ?? false,
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
