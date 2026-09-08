/**
 * Turning a `ChartSpec` and a box into primitives somebody can paint.
 *
 * ## One layout, two painters
 *
 * The Konva renderer and the SVG exporter both draw charts, and the rule this
 * file exists to enforce is that neither of them does any arithmetic. They
 * receive rectangles, polylines and arcs and put them on a surface. That is
 * the same rule `computeContentBounds` holds for export framing and for the
 * same reason: this codebase's recurring defect is two derivations of one
 * answer, and "where is the third bar" answered twice is a PNG and an SVG of
 * the same chart that do not match.
 *
 * It is also what makes charts testable without a browser, which is the only
 * way anything positional gets verified here — see HANDOFF §3.
 *
 * ## Measured before it is placed
 *
 * The axis gutter is the width of the widest tick label that will actually be
 * drawn, not a constant. A constant is wrong in both directions: it clips
 * `1200` at one end and leaves a stripe of dead space beside `0` at the other.
 * The diagram engine already works this way — every column as wide as its own
 * name — and a chart has the same problem with the same answer.
 *
 * The measurer is injected. The default is an approximation good enough for
 * layout in Node; the renderer passes one backed by the real font, because the
 * only thing that knows how wide a string is in a given face is the thing that
 * will draw it.
 */

import {
  bandScale,
  formatTick,
  linearScale,
  logDomainOf,
  logScale,
  niceDomain,
  type Domain,
} from './scales';
import { monotoneSplinePoints } from './monotoneSpline';
import { integrateStreamline } from './streamline';
import { linearRegression, optimalBinCount, kernelDensityEstimation } from './chartStats';
import { compileCurves, samplePlot, sampleParametric, samplePolar } from './chartPlot';
import {
  differentiate,
  findExtrema,
  findRoots,
  integrate,
  findIntersections,
  refineExtremum,
} from './chartAnalysis';
import { contourLevels, marchingSquares } from './marchingSquares';
import { slopeField, vectorField } from './vectorField';
import { rampColorAt } from './colorRamps';
import {
  bucketize,
  isBarLike,
  isContinuous,
  isPercentStacked,
  isPolar,
  isIsotropic,
  isPlot,
  isRadial,
  isStacked,
  isTransposed,
  isTwoVariable,
  normalizeSpec,
  resolveChartOptions,
  seriesColor,
  sortSpec,
  toPercentStack,
  toStaircase,
  type ChartSpec,
} from './chartTypes';
import type { MathPlotMeta } from './chartTrace';

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** How wide a string is, in the face the chart will be drawn in. */
export type Measure = (text: string, fontSize: number) => number;

/**
 * Good enough to lay out with, and wrong by a few per cent.
 *
 * 0.55em per character is the average advance of a humanist sans at text
 * sizes. It is used in Node and as the first frame's estimate; anything that
 * cares passes the real one.
 */
export const approximateMeasure: Measure = (text, fontSize) => text.length * fontSize * 0.55;

export interface ChartBar extends Rect {
  color: string;
  seriesIndex: number;
  categoryIndex: number;
  value: number;
  /** Bars below the baseline, so a renderer can label them underneath. */
  negative: boolean;
  /** Whether corners are rounded. Heatmaps and Riemann rectangles are sharp. */
  rounded?: boolean;
  /** Custom corner radius in pixels. */
  cornerRadius?: number;
}

export interface ChartRun {
  /** Already in draw order. A gap in the data splits the run rather than
   *  drawing a straight line across it — see `ChartSeries.values`. */
  points: Point[];
  color: string;
  seriesIndex: number;
  /** Stroke thickness in pixels (1 to 5). */
  width?: number;
  /** Dash style. */
  style?: 'solid' | 'dashed' | 'dotted';
}

/**
 * One category, and every series' reading at it.
 *
 * ## Why the hover needs its own model
 *
 * Hit-testing used to work off whatever a kind happened to *draw*: bars for a
 * bar chart, dots for a scatter. Which meant an **area chart answered
 * nothing at all** -- it emits no bars, and dots are only pushed for `line`
 * and `step` -- so hovering one produced no readout, no highlight and no
 * explanation. A line with its markers turned off had the same hole.
 *
 * Deriving it from the runs instead would not work either: `toStaircase` and
 * the spline resample the points, so by the time a run exists its vertices no
 * longer correspond to categories one for one.
 *
 * So the column is built from the source values, in the same pass that places
 * the marks, and every cartesian kind gets the same reading: one x, every
 * series at it. That is also the reading people expect -- you hover a moment
 * in time to compare the lines, not to interrogate one vertex.
 */
export interface ChartColumn {
  /** The category's centre along the value-independent axis, in screen space. */
  x: number;
  /** And along the other one, for a transposed chart. */
  y: number;
  categoryIndex: number;
  entries: Array<{
    seriesIndex: number;
    value: number;
    color: string;
    /** Where this series sits, so a marker can be drawn on it. */
    x: number;
    y: number;
  }>;
}

export interface ChartArea extends ChartRun {
  /** The closed polygon, baseline included. */
  polygon: Point[];
  /**
   * Whether the fill fades toward the baseline.
   *
   * Carried on the *layout* rather than read from the spec by each painter,
   * which is what this file exists to enforce. The Konva renderer read
   * `node.chart.gradient` straight off the node and the SVG exporter had no
   * idea the field existed -- so a chart faded on the board and flat in the
   * file, silently, in a format with no way to say so. Putting it here means
   * a painter that draws areas at all cannot miss it.
   */
  gradient?: boolean;
}

export interface ChartDot extends Point {
  radius: number;
  color: string;
  seriesIndex: number;
  categoryIndex: number;
  value: number;
  shape?: 'none' | 'circle' | 'square' | 'hollow' | 'ring';
}

export interface ChartSlice {
  cx: number;
  cy: number;
  outerRadius: number;
  innerRadius: number;
  /** Radians, clockwise from twelve o'clock. */
  startAngle: number;
  endAngle: number;
  color: string;
  index: number;
  value: number;
  /** Fraction of the whole, for a label. */
  fraction: number;
  /** Where a label sits, midway along the slice's own radius. */
  labelAnchor: Point;
}

export interface ChartLabel {
  text: string;
  x: number;
  y: number;
  /**
   * The colour this label is drawn *on top of*, when that is not the board.
   *
   * Every value label was painted in `ink.ink` — the board's foreground —
   * including the ones placed *inside* a bar or a slice. So a number inside a
   * dark bar was dark on dark in the light theme, and light on light in the
   * dark one: invisible in both, and only for the marks whose colour happened
   * to be near the board's. The palette has seven colours, so roughly a third
   * of any chart with inside labels lost them.
   *
   * The layout knows which marks a label lands on and the painters do not, so
   * the layout is what says. Present means "pick a foreground against this";
   * absent means the board, and `ink.ink` is right.
   */
  on?: string;
  /** Labels are drawn into a box so they can be centred without measuring
   *  again in the renderer. */
  width: number;
  align: 'left' | 'center' | 'right';
  fontSize: number;
}

export interface ChartGridLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * The scale beside a surface, saying what a colour means.
 *
 * A heatmap without one is a picture of structure with no way to read a
 * value off it -- you can see where the peaks are and not how high. It is a
 * legend in every sense except that its entries are continuous, which is why
 * it is its own primitive rather than a run of `ChartLegendEntry` swatches
 * pretending to be a gradient.
 *
 * Laid out here and painted twice, like everything else in this file: the
 * canvas draws it with a Konva gradient and the exporter with a
 * `<linearGradient>`, from the same stops and the same ticks.
 */
export interface ChartColorBar extends Rect {
  /** Ordered 0..1 along the bar, from its bottom to its top. */
  stops: Array<{ offset: number; color: string }>;
  /** Where the numbers sit against it, already formatted. */
  ticks: Array<{ y: number; text: string }>;
  fontSize: number;
  /** Left edge of the tick text, which sits to the right of the bar. */
  textX: number;
}

export interface ChartLegendEntry {
  label: string;
  color: string;
  /** The swatch box; the text follows it. */
  x: number;
  y: number;
  swatch: number;
  textX: number;
  fontSize: number;
}

export interface ChartPolarRing {
  cx: number;
  cy: number;
  radius: number;
  /** One point per category, so the ring is a polygon and not a circle. */
  points: Point[];
}

export interface ChartPolarSpoke {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface ChartToleranceBand {
  y1: number;
  y2: number;
  color: string;
  /** Placed by the layout, because a thin band has no room inside it. */
  label?: ChartLabel;
  /** True when the corridor runs past the axis and has been cut to the plot. */
  cropped: boolean;
}

export interface ChartReference extends ChartGridLine {
  color: string;
  /** Dashed reads as an annotation; solid reads as another series. */
  dashed: boolean;
  label?: ChartLabel;
}

export interface ChartLayout {
  /** The drawing area, inside the axes and under the title. */
  plot: Rect;
  bars: ChartBar[];
  runs: ChartRun[];
  areas: ChartArea[];
  dots: ChartDot[];
  slices: ChartSlice[];
  gridLines: ChartGridLine[];
  /** The horizontal zero rule, when the value axis crosses it. */
  baseline: ChartGridLine | null;
  /**
   * The vertical zero rule, on the plots whose x axis crosses zero.
   *
   * It had no field of its own, so it was pushed into `gridLines` — where two
   * things went wrong at once. It was drawn at grid weight, which on a maths
   * plot makes the y axis as faint as the squares behind it; and the push was
   * not gated on `showGrid`, so turning the grid off left one stray vertical
   * line down the middle of the plot with nothing to explain it.
   *
   * An axis is not a grid line. `baseline` has always known that about the
   * horizontal one; this is the other half.
   */
  zeroRule: ChartGridLine | null;
  axisLabels: ChartLabel[];
  categoryLabels: ChartLabel[];
  valueLabels: ChartLabel[];
  legend: ChartLegendEntry[];
  /**
   * What the pointer reads on a cartesian chart, by category.
   *
   * Empty for the kinds whose reading is not a column -- radial, polar, and
   * the plots, which answer with a computed value rather than a stored one.
   */
  columns: ChartColumn[];
  /**
   * Which axis the categories run along.
   *
   * ## Why this is on the layout and not inferred
   *
   * Two readers used to work it out for themselves, from the *shape of a
   * bar*: the hover band asked whether the first bar in the group was wider
   * than it was tall, and the hit test asked whether a bar was four times
   * wider than tall. Both are questions about a rectangle, and the answer
   * they wanted is a fact about the chart.
   *
   * On a waterfall the two diverge visibly. A step with a small delta is a
   * short, wide rectangle and a step with a large one is tall and narrow --
   * so on a single chart the hover band came out horizontal over some bars
   * and vertical over others, and the hit test measured the pointer's
   * distance along x for one bar and along y for the next. Exactly the same
   * happens to a plain bar chart the moment one category is near zero.
   *
   * The kind knows. `isTransposed` has always known. Saying it once here
   * means neither reader can guess, and neither can guess differently.
   */
  categoryAxis: 'x' | 'y';
  /** The continuous scale, for the kinds whose colour *is* the value. */
  colorBar?: ChartColorBar | null;
  title: ChartLabel | null;
  /** Editorial subtitle beneath the title. */
  subtitle?: ChartLabel | null;
  /** Footnote or source citation at the chart footer. */
  footnote?: ChartLabel | null;
  /** Horizontal axis unit/name label. */
  xAxisTitle?: ChartLabel | null;
  /** Vertical axis unit/name label. */
  yAxisTitle?: ChartLabel | null;
  /** Shaded target corridor / tolerance band across the value axis. */
  /**
   * The corridor a value is meant to stay inside.
   *
   * Carries its own label placement and whether it was cropped, so neither
   * painter has to decide -- they disagreed about its opacity when they did
   * (0.12 on the canvas, 0.10 in the file) and both had the same green
   * literal typed into them.
   */
  toleranceBand?: ChartToleranceBand | null;
  /** Radar only: the value rings and the category spokes. */
  rings: ChartPolarRing[];
  spokes: ChartPolarSpoke[];
  /** The `reference` rule, when the spec carries one inside the domain. */
  reference: ChartReference | null;
  /** The resolved value-axis domain, exposed for tests and the panel. */
  domain: Domain;
  /** Math plot analytical and evaluation metadata for interactive tracing */
  mathPlot?: MathPlotMeta;
  /** Trendline (linear regression) for scatter and bubble plots */
  trendline?: {
    line: [Point, Point];
    slope: number;
    intercept: number;
    r2: number;
    label: string;
  } | null;
  /** Gaussian Kernel Density Estimation (KDE) curve for histograms */
  kdeCurve?: Point[] | null;
  /** Interactive solution curves for slope and vector fields */
  streamlines?: Array<{ points: Point[]; seed: Point }>;
  /** Horizontal connector bridges between waterfall bars */
  waterfallBridges?: Array<{ x1: number; y1: number; x2: number; y2: number }>;
  /** Funnel connecting trapezoidal polygons between consecutive stages */
  funnelHulls?: Array<{ polygon: Point[]; deltaPct: string }>;
  /** Donut central summary metric */
  donutMetric?: { value: string; label: string; x: number; y: number } | null;
}

/**
 * The spacing, as one scale rather than six numbers picked per call site.
 *
 * The first version was tuned by eye per gap and read as a chart drawn by a
 * program: labels crowding their axis, a title sitting on the plot, a legend
 * touching the bottom edge. Every value here is a multiple of 2 off a 4-unit
 * rhythm, which is what makes the whitespace look decided rather than left
 * over -- the same argument `index.css` makes for having a space scale at all.
 *
 * `PAD` is the outer margin and is generous on purpose: a chart is a node on a
 * board, so its edge is where it meets somebody else's work, and a mark
 * running to the boundary reads as clipped even when it is not.
 */
const PAD = 18;
/** Big enough to be a title, not so big it competes with the marks. */
const TITLE_SIZE = 16;
/** The gap under the title: a full step, so the title owns a band of its own. */
const TITLE_GAP = 14;
const LABEL_SIZE = 11;
const LEGEND_SIZE = 11;
const LEGEND_SWATCH = 10;
/**
 * Between a tick and the thing it labels.
 *
 * Wider than it looks like it needs to be. At 6 the digits touched the plot
 * edge and the axis read as one dense column of ink rather than as numbers
 * beside a chart.
 */
const TICK_GAP = 8;

/**
 * Lay a chart out inside `width` x `height`, in node-local coordinates.
 *
 * Origin is the node's top-left, so the result drops straight into a Konva
 * group or an SVG `<g>` with no further transform — which is what keeps the
 * two painters honest.
 */
export function layoutChart(
  rawSpec: ChartSpec,
  width: number,
  height: number,
  measure: Measure = approximateMeasure
): ChartLayout {
  /**
   * A histogram is bucketed *before* normalisation, and the order matters.
   *
   * `normalizeSpec` makes every series exactly `categories.length` long, and a
   * histogram's categories are empty until bucketing invents them -- so
   * normalising first truncated all thirty raw samples to nothing and the
   * chart drew an empty axis. The samples are the data; the categories are a
   * *result*. `chartCapabilities.test.ts` caught this by asking why a
   * histogram with values showed no value labels.
   */
  const bucketed =
    rawSpec.kind === 'histogram'
      ? (() => {
          const opts0 = resolveChartOptions(rawSpec);
          const rawVals = rawSpec.series.flatMap((s) => s.values.filter((v): v is number => typeof v === 'number'));
          const numBuckets = rawSpec.buckets ?? (rawVals.length >= 4 ? optimalBinCount(rawVals) : opts0.buckets);
          const { categories, counts } = bucketize(
            rawVals,
            numBuckets
          );
          return {
            ...rawSpec,
            categories,
            series: [
              {
                name: rawSpec.series[0]?.name ?? 'Count',
                values: counts,
                color: rawSpec.series[0]?.color,
              },
            ],
          };
        })()
      : rawSpec;

  // Pareto Top-N category consolidation if configured
  const aggregated =
    bucketed.topN && bucketed.topN >= 2 && bucketed.categories.length > bucketed.topN && !isPlot(bucketed.kind)
      ? (() => {
          const preSorted = sortSpec({
            ...bucketed,
            sort: bucketed.sort && bucketed.sort !== 'none' ? bucketed.sort : 'valueDesc',
          });
          const n = bucketed.topN!;
          const topCats = preSorted.categories.slice(0, n);
          const newSeries = preSorted.series.map((s) => {
            const topVals = s.values.slice(0, n);
            const otherVals = s.values.slice(n).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
            const otherSum = otherVals.length ? otherVals.reduce((a, b) => a + b, 0) : null;
            return {
              ...s,
              values: [...topVals, otherSum],
            };
          });
          return {
            ...preSorted,
            categories: [...topCats, 'Other'],
            series: newSeries,
            sort: 'none' as const,
          };
        })()
      : bucketed;

  // Sorting is a view, applied before layout and never written back --
  // see `sortSpec`. Done here so every kind gets it for free.
  const spec = sortSpec(normalizeSpec(aggregated));
  let opts = resolveChartOptions(spec);

  const empty: ChartLayout = {
    plot: { x: 0, y: 0, width: 0, height: 0 },
    bars: [], runs: [], areas: [], dots: [], slices: [], columns: [], categoryAxis: 'x',
    zeroRule: null,
    gridLines: [], baseline: null,
    axisLabels: [], categoryLabels: [], valueLabels: [], legend: [],
    title: null,
    rings: [], spokes: [], reference: null,
    domain: [0, 1],
  };

  // A chart smaller than its own furniture draws nothing rather than drawing
  // it overlapping. Konva will happily render a negative-width rect.
  if (!(width > 40) || !(height > 40)) return empty;

  let top = PAD;
  let title: ChartLabel | null = null;

  if (spec.title) {
    // Clamped rather than trusted: a title larger than the chart leaves no
    // plot at all, and the layout would go on drawing an axis into nothing.
    const size = Math.min(48, Math.max(9, Math.round(spec.titleSize ?? TITLE_SIZE)));
    title = {
      text: spec.title,
      x: PAD,
      y: top,
      width: width - PAD * 2,
      align: 'left',
      fontSize: size,
    };
    // The gap grows with the type, so a large title is not left sitting on the
    // plot -- a fixed gap is only right at one size.
    top += size + Math.round(TITLE_GAP * (size / TITLE_SIZE));
  }

  let subtitle: ChartLabel | null = null;
  if (spec.subtitle) {
    const size = 11;
    subtitle = {
      text: spec.subtitle,
      x: PAD,
      y: top,
      width: width - PAD * 2,
      align: 'left',
      fontSize: size,
    };
    top += size + 6;
  }

  let footnote: ChartLabel | null = null;
  let footnoteReserved = 0;
  if (spec.footnote) {
    const size = 9;
    footnoteReserved = size + 6;
    footnote = {
      text: spec.footnote,
      x: PAD,
      y: height - PAD / 2 - size,
      width: width - PAD * 2,
      align: 'left',
      fontSize: size,
    };
  }

  /**
   * The legend's band, on whichever side it is on.
   *
   * `legendPosition` was on the spec, offered by the panel and copied across
   * the CRDT boundary — and read by nothing at all. `buildLegend` pinned the
   * entries to `height - PAD - LEGEND_SIZE` regardless, so the control moved
   * a value nobody consulted and the legend never left the bottom.
   *
   * Reserving the space is the half that makes it work: a legend placed on
   * the right without narrowing the plot is a legend drawn over the data.
   */
  const legendSide = opts.showLegend ? (spec.legendPosition ?? 'bottom') : 'none';
  const legendBand = legendSide === 'top' || legendSide === 'bottom' ? LEGEND_SIZE + 16 : 0;

  /**
   * A ceiling on the right-hand gutter.
   *
   * It was measured from the labels alone, so one long series name —
   * "Revenue, net of returns" — took half the chart and left a plot squeezed
   * into what remained. A legend is furniture: it may take a third, and past
   * that the *name* gives way rather than the picture, which is what the
   * truncation in `buildLegend` is for.
   */
  const legendGutter =
    legendSide === 'right' ? Math.min(width * 0.34, legendWidth(spec, opts, measure)) : 0;

  const bottomReserved =
    PAD + (legendSide === 'bottom' ? legendBand : 0) + footnoteReserved;

  /**
   * Where the legend actually goes, decided here and not guessed at.
   *
   * `buildLegend` worked it out from `width` and `height`, which is why a top
   * legend landed at `y = PAD` — on top of the title, because the title is
   * also at `PAD` and the legend had no way to know. Only this function knows
   * what furniture has already been placed, so it is the one that says.
   */
  const legendBox: Rect =
    legendSide === 'top'
      ? { x: PAD, y: top, width: width - PAD * 2, height: legendBand }
      : legendSide === 'right'
        ? { x: width - legendGutter + PAD, y: top, width: legendGutter - PAD * 2, height: height - top - PAD }
        : {
            x: PAD,
            y: height - PAD - footnoteReserved - LEGEND_SIZE,
            width: width - PAD * 2,
            height: legendBand,
          };

  // A legend along the top pushes everything below it down, exactly as the
  // title does.
  if (legendSide === 'top') top += legendBand;

  opts = { ...opts, legendSide, legendBox };

  // Passed as a narrower canvas rather than threaded through nine
  // signatures: every layout already measures itself against `width`, so
  // taking the gutter off it once is the whole change.
  const usable = Math.max(40, width - legendGutter);

  let layout = isRadial(spec.kind)
    ? layoutRadial(spec, opts, usable, height, top, bottomReserved, title, measure, empty)
    : isPolar(spec.kind)
    ? layoutPolar(spec, opts, usable, height, top, bottomReserved, title, measure, empty)
    : isTwoVariable(spec.kind)
    ? layoutField(spec, opts, usable, height, top, bottomReserved, title, measure, empty)
    : isPlot(spec.kind)
    ? layoutPlot(spec, opts, usable, height, top, bottomReserved, title, measure, empty)
    : (() => {
        let prepared = spec;
        if (isPercentStacked(spec.kind)) {
          prepared = toPercentStack(spec);
        }
        return layoutCartesian(prepared, opts, usable, height, top, bottomReserved, title, measure, empty);
      })();

  let xAxisTitle: ChartLabel | null = null;
  if (spec.xAxisLabel && layout.plot.width > 0) {
    xAxisTitle = {
      text: spec.xAxisLabel,
      x: layout.plot.x + layout.plot.width / 2,
      y: layout.plot.y + layout.plot.height + 22,
      width: layout.plot.width,
      align: 'center',
      fontSize: 11,
    };
  }

  let yAxisTitle: ChartLabel | null = null;
  if (spec.yAxisLabel && layout.plot.height > 0) {
    yAxisTitle = {
      text: spec.yAxisLabel,
      x: PAD,
      y: layout.plot.y + layout.plot.height / 2,
      width: layout.plot.height,
      align: 'center',
      fontSize: 11,
    };
  }

  let toleranceBand: ChartToleranceBand | null = null;
  if (spec.toleranceBand && layout.domain && !isRadial(spec.kind) && !isPolar(spec.kind)) {
    const [dMin, dMax] = layout.domain;
    const lo = Math.min(spec.toleranceBand.min, spec.toleranceBand.max);
    const hi = Math.max(spec.toleranceBand.min, spec.toleranceBand.max);

    // A corridor entirely off the axis is not drawn. It can only happen when
    // somebody has pinned the bounds themselves, since the domain otherwise
    // widens to hold it -- and a band flattened against the edge would assert
    // a range it does not have.
    if (dMax > dMin && hi >= dMin && lo <= dMax) {
      const top = layout.plot.y;
      const bottom = layout.plot.y + layout.plot.height;
      const scaleY = (v: number) =>
        bottom - ((v - dMin) / (dMax - dMin)) * layout.plot.height;

      /**
       * Clamped to the plot.
       *
       * It was not, so a corridor reaching past the axis was drawn past the
       * axis: a translucent rectangle over the title and the tick labels,
       * which reads as a rendering fault rather than as a range.
       */
      const rawTop = scaleY(hi);
      const rawBottom = scaleY(lo);
      const y1 = Math.max(top, Math.min(bottom, rawTop));
      const y2 = Math.max(top, Math.min(bottom, rawBottom));

      toleranceBand = {
        y1,
        y2,
        color: spec.toleranceBand.color ?? TOLERANCE_INK,
        cropped: rawTop < top - 0.5 || rawBottom > bottom + 0.5,
        label: spec.toleranceBand.label
          ? {
              text: spec.toleranceBand.label,
              x: layout.plot.x + PAD,
              /**
               * Above the corridor when it is too thin to hold the words, and
               * inside it otherwise. A label pinned inside a four-pixel band
               * hangs out of both edges and looks like it belongs to neither.
               */
              y: y2 - y1 >= LABEL_SIZE + 6 ? y1 + 3 : Math.max(layout.plot.y, y1 - LABEL_SIZE - 2),
              width: layout.plot.width - PAD * 2,
              align: 'left',
              fontSize: LABEL_SIZE,
            }
          : undefined,
      };
    }
  }

  return {
    ...layout,
    subtitle,
    footnote,
    xAxisTitle,
    yAxisTitle,
    toleranceBand: layout.toleranceBand ?? toleranceBand,
  };
}

function layoutCartesian(
  spec: ChartSpec,
  opts: ReturnType<typeof resolveChartOptions>,
  width: number,
  height: number,
  top: number,
  bottomReserved: number,
  title: ChartLabel | null,
  measure: Measure,
  empty: ChartLayout
): ChartLayout {
  const kind = spec.kind;
  const stacked = isStacked(kind);
  const transposed = isTransposed(kind);
  const barLike = isBarLike(kind);

  /**
   * A waterfall's bars float: each starts where the previous finished, and the
   * axis has to cover the running total rather than the individual steps.
   * Computed first because it decides the domain.
   */
  const waterfall = kind === 'waterfall' ? runningTotals(spec) : null;

  const extent = valueExtent(spec, { stacked, waterfall });

  /**
   * The annotations count toward the axis.
   *
   * A target outside the domain was silently dropped -- `buildReference`
   * returned `null` and nothing said why -- so setting a goal of 200 on data
   * that peaks at 100 drew no line at all. That is precisely the case a target
   * is *for*: the whole reason to mark 200 is to see how far short you are.
   * The tolerance corridor had the same hole, and worse, since it was not even
   * clamped: a band above the domain was drawn over the title.
   *
   * So both extend the extent before the axis is chosen, exactly as another
   * series would. An explicit `yMin`/`yMax` still wins -- somebody who typed
   * a bound meant it, and cropping a target out of view is then their
   * decision rather than the layout's.
   */
  const annotated = annotationExtent(spec, extent);
  const nice = niceDomain(
    spec.yMin ?? annotated.min,
    spec.yMax ?? annotated.max,
    5,
    opts.includeZero
  );
  // An explicit bound is honoured exactly: someone who typed 100 wants 100,
  // not the nearest round number above it.
  let domain: Domain = [spec.yMin ?? nice.domain[0], spec.yMax ?? nice.domain[1]];
  const ticks = nice.ticks.filter((t) => t >= domain[0] && t <= domain[1]);
  const tickTexts = ticks.map((t) => formatValue(t, spec));

  /**
   * The gutters, measured.
   *
   * Transposing swaps which axis needs the room: a horizontal bar chart's
   * *category* names sit in the left gutter and are the long strings, while its
   * value ticks run along the bottom. Measuring the wrong set is how a
   * horizontal chart ends up with its category names clipped.
   */
  const bottomBand = LABEL_SIZE + TICK_GAP;
  const measureGutter = () => {
    const leftTexts = transposed ? spec.categories : tickTexts;
    return PAD + Math.max(...leftTexts.map((t) => measure(t, LABEL_SIZE)), 0) + TICK_GAP;
  };
  let gutterLeft = measureGutter();

  const plot: Rect = {
    x: gutterLeft,
    y: top,
    width: Math.max(1, width - gutterLeft - PAD),
    height: Math.max(1, height - top - bottomReserved - bottomBand),
  };
  if (plot.width < 8 || plot.height < 8) return { ...empty, title };

  // The value scale runs up the page when vertical and rightward when
  // transposed; the band scale takes the other axis. Every mark below is
  // expressed through these two, which is what lets one code path draw both
  // orientations instead of two that can disagree about anything.
  /**
   * A log axis replaces both the domain and the mapping, so it is resolved
   * before either is used. `logDomainOf` rounds out to whole decades, because
   * an axis running 8 to 40000 with ticks at those numbers is not a log axis
   * anybody can read.
   */
  const wantsLog = spec.yScale === 'log';
  const logInfo = wantsLog
    ? logDomainOf(spec.series.flatMap((s) => s.values.filter((v): v is number => v !== null)))
    : null;
  const useLog = !!logInfo?.ok;
  if (useLog && logInfo) {
    domain = logInfo.domain;
    ticks.length = 0;
    ticks.push(...logInfo.ticks);
    tickTexts.length = 0;
    tickTexts.push(...logInfo.ticks.map((t) => formatValue(t, spec)));
  }

  const range: Domain = transposed
    ? [plot.x, plot.x + plot.width]
    : [plot.y + plot.height, plot.y];
  const value = useLog ? logScale(domain, range) : linearScale(domain, range);

  // A log axis's labels are decades and may be wider than the linear ones the
  // gutter was first measured against; measuring once more is cheaper than
  // threading the scale choice above the plot rectangle.
  if (useLog) {
    const widened = measureGutter();
    if (widened > gutterLeft) {
      plot.x = widened;
      plot.width = Math.max(1, width - widened - PAD);
      gutterLeft = widened;
    }
  }

  const bandRange: Domain = transposed
    ? [plot.y, plot.y + plot.height]
    : [plot.x, plot.x + plot.width];
  // A histogram's bars touch, because its categories are a continuum.
  const padding = barLike ? (isContinuous(kind) ? 0.02 : 0.28) : 0;
  const band = bandScale(spec.categories.length, bandRange, padding);

  const zeroValue = value(clamp(0, domain[0], domain[1]));

  const gridLines: ChartGridLine[] = [];
  const axisLabels: ChartLabel[] = [];

  ticks.forEach((t, i) => {
    const at = value(t);
    if (opts.showGrid) {
      gridLines.push(
        transposed
          ? { x1: at, y1: plot.y, x2: at, y2: plot.y + plot.height }
          : { x1: plot.x, y1: at, x2: plot.x + plot.width, y2: at }
      );
    }
    axisLabels.push(
      transposed
        ? {
            text: tickTexts[i],
            x: at - band.step / 2,
            y: plot.y + plot.height + TICK_GAP,
            width: band.step,
            align: 'center',
            fontSize: LABEL_SIZE,
          }
        : {
            // Right-aligned into the gutter, so the digits line up against the
            // plot rather than ragging away from it.
            text: tickTexts[i],
            x: PAD,
            y: at - LABEL_SIZE / 2,
            width: gutterLeft - PAD - TICK_GAP,
            align: 'right',
            fontSize: LABEL_SIZE,
          }
    );
  });

  const baseline: ChartGridLine | null =
    domain[0] <= 0 && domain[1] >= 0
      ? transposed
        ? { x1: zeroValue, y1: plot.y, x2: zeroValue, y2: plot.y + plot.height }
        : { x1: plot.x, y1: zeroValue, x2: plot.x + plot.width, y2: zeroValue }
      : null;

  const categoryLabels: ChartLabel[] = spec.categories.map((text, i) =>
    transposed
      ? {
          text,
          x: PAD,
          y: band.centre(i) - LABEL_SIZE / 2,
          width: gutterLeft - PAD - TICK_GAP,
          align: 'right',
          fontSize: LABEL_SIZE,
        }
      : {
          text,
          x: band.centre(i) - band.step / 2,
          y: plot.y + plot.height + TICK_GAP,
          width: band.step,
          align: 'center',
          fontSize: LABEL_SIZE,
        }
  );

  const bars: ChartBar[] = [];
  const runs: ChartRun[] = [];
  const areas: ChartArea[] = [];
  const dots: ChartDot[] = [];
  /**
   * One entry per category, filled in as the marks are placed.
   *
   * Keyed by category index rather than pushed in order, because a series
   * with a gap contributes nothing at that category and the columns must
   * still line up with the axis.
   */
  const columnBuild = new Map<number, ChartColumn>();
  const valueLabels: ChartLabel[] = [];

  /** One bar, in whichever orientation this chart is. */
  const pushBar = (
    categoryIndex: number,
    seriesIndex: number,
    lane: { offset: number; width: number },
    from: number,
    to: number,
    color: string,
    v: number
  ) => {
    const a = value(from);
    const b = value(to);
    const lo = Math.min(a, b);
    const len = Math.abs(b - a);
    const bandStart = band.at(categoryIndex) + lane.offset;

    bars.push(
      transposed
        ? {
            x: lo, y: bandStart, width: len, height: lane.width,
            color, seriesIndex, categoryIndex, value: v, negative: v < 0,
            cornerRadius: spec.cornerRadius,
          }
        : {
            x: bandStart, y: lo, width: lane.width, height: len,
            color, seriesIndex, categoryIndex, value: v, negative: v < 0,
            cornerRadius: spec.cornerRadius,
          }
    );

    if (opts.showValues) {
      let text = formatValue(v, spec);
      if (spec.valueFormat === 'percent' || spec.valueFormat === 'both') {
        const catVals = spec.series
          .map((s) => s.values[categoryIndex])
          .filter((x): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0);
        const catSum = catVals.reduce((a, b) => a + b, 0);
        if (catSum > 0) {
          const share = (v / catSum) * 100;
          const places = Math.min(2, Math.max(0, Math.round(spec.decimals ?? 0)));
          const pctStr = `${share.toFixed(places)}%`;
          text = spec.valueFormat === 'percent' ? pctStr : `${text} (${pctStr})`;
        }
      }
      const isInside = spec.valuePlacement === 'inside';
      const isCenter = spec.valuePlacement === 'center';
      // Inside and centred sit on the bar; outside and auto sit on the board.
      const on = isInside || isCenter ? color : undefined;
      valueLabels.push(
        transposed
          ? {
              text,
              on,
              x: isInside ? lo + len - 6 : isCenter ? lo + len / 2 : lo + len + 4,
              y: bandStart + lane.width / 2 - LABEL_SIZE / 2,
              width: 60,
              align: isInside ? 'right' : isCenter ? 'center' : 'left',
              fontSize: LABEL_SIZE,
            }
          : {
              text,
              on,
              x: bandStart,
              y: isInside
                ? v >= 0 ? lo + 4 : lo + len - LABEL_SIZE - 4
                : isCenter
                ? lo + len / 2 - LABEL_SIZE / 2
                : v >= 0 ? lo - LABEL_SIZE - 2 : lo + len + 2,
              width: lane.width,
              align: 'center',
              fontSize: LABEL_SIZE,
            }
      );
    }
  };

  if (barLike) {
    if (waterfall) {
      // Each step floats between where the running total was and where it got
      // to, so a fall is drawn in the negative colour without the axis moving.
      waterfall.forEach((step, ci) => {
        pushBar(
          ci,
          0,
          { offset: 0, width: band.bandWidth },
          step.from,
          step.to,
          step.delta >= 0 ? seriesColor(spec.series[0], 0, opts.palette) : seriesColor(undefined, 4, opts.palette),
          step.delta
        );
      });
    } else if (kind === 'funnel') {
      // One series, each stage its own colour, so the shape reads as stages
      // rather than as one quantity that happens to shrink.
      const s = spec.series[0];
      s?.values.forEach((v, ci) => {
        if (typeof v !== 'number') return;
        pushBar(ci, 0, { offset: 0, width: band.bandWidth }, 0, v, seriesColor(undefined, ci, opts.palette), v);
      });
    } else {
      const lanes = stacked ? 1 : Math.max(1, spec.series.length);
      const laneWidth = band.bandWidth / lanes;
      const runningPos = new Array(spec.categories.length).fill(0);
      const runningNeg = new Array(spec.categories.length).fill(0);

      spec.series.forEach((s, si) => {
        const color = seriesColor(s, si, opts.palette);
        s.values.forEach((v, ci) => {
          if (typeof v !== 'number') return;
          let from: number;
          let to: number;
          if (stacked) {
            const base = v >= 0 ? runningPos[ci] : runningNeg[ci];
            from = base;
            to = base + v;
            if (v >= 0) runningPos[ci] = to;
            else runningNeg[ci] = to;
          } else {
            from = clamp(0, domain[0], domain[1]);
            to = v;
          }
          pushBar(
            ci,
            si,
            {
              offset: stacked ? 0 : si * laneWidth,
              width: stacked ? band.bandWidth : laneWidth,
            },
            from,
            to,
            color,
            v
          );
        });
      });
    }
  } else {
    // Lines, steps, areas, scatter and bubble all place a point per category
    // and differ only in what is drawn through them.
    const stackTotals = new Array(spec.categories.length).fill(0);

    spec.series.forEach((s, si) => {
      const color = seriesColor(s, si, opts.palette);
      const segments: Point[][] = [];
      const baseSegments: Point[][] = [];
      let current: Point[] = [];
      let currentBase: Point[] = [];

      s.values.forEach((v, ci) => {
        if (typeof v !== 'number') {
          // A hole ends the run. Joining across it would draw a straight line
          // over missing data and present an outage as a smooth decline.
          if (current.length) {
            segments.push(current);
            baseSegments.push(currentBase);
          }
          current = [];
          currentBase = [];
          return;
        }

        const base = kind === 'stackedArea' ? stackTotals[ci] : 0;
        const topValue = kind === 'stackedArea' ? base + v : v;
        if (kind === 'stackedArea') stackTotals[ci] = topValue;

        const centre = band.centre(ci);
        const p = transposed
          ? { x: value(topValue), y: centre }
          : { x: centre, y: value(topValue) };
        current.push(p);
        currentBase.push(
          transposed ? { x: value(base), y: centre } : { x: centre, y: value(base) }
        );

        if (kind === 'scatter' || kind === 'bubble') {
          /**
           * Bubble takes its radius from the value, **area**-proportional: a
           * value four times larger draws a disc of four times the area.
           * Scaling the radius instead squares the difference, which is the
           * classic way a bubble chart overstates its own data.
           */
          const radius =
            kind === 'bubble'
              ? 4 + Math.sqrt(Math.abs(v) / extent.absMax) * 16
              : 4;
          dots.push({
            ...p,
            radius,
            color,
            seriesIndex: si,
            categoryIndex: ci,
            value: v,
            shape: spec.markerShape ?? 'circle',
          });
        }

        /**
         * The hover reading, recorded whether or not a marker was drawn.
         *
         * This is the line that fixes the hole: an area chart draws no dots
         * at all, so before this its readings existed nowhere and hovering it
         * returned nothing.
         */
        const column = columnBuild.get(ci) ?? { x: p.x, y: p.y, categoryIndex: ci, entries: [] };
        column.entries.push({ seriesIndex: si, value: v, color, x: p.x, y: p.y });
        columnBuild.set(ci, column);
        // Every run kind, not three of them. `scatter`, `bubble` and
        // `stackedArea` were excluded for no reason anybody recorded, so the
        // Values toggle was offered on them and did nothing.
        if (opts.showValues) {
          let shouldLabel = true;
          if (spec.extremesOnly && (kind === 'line' || kind === 'area')) {
            const numVals = s.values.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
            if (numVals.length > 0) {
              const minVal = Math.min(...numVals);
              const maxVal = Math.max(...numVals);
              shouldLabel = v === minVal || v === maxVal;
            }
          }
          if (shouldLabel) {
            valueLabels.push({
              text: formatValue(v, spec),
              x: p.x - band.step / 2,
              y: p.y - LABEL_SIZE - 5,
              width: band.step,
              align: 'center',
              fontSize: LABEL_SIZE,
            });
          }
        }
      });
      if (current.length) {
        segments.push(current);
        baseSegments.push(currentBase);
      }

      segments.forEach((points, segIndex) => {
        if (kind === 'scatter' || kind === 'bubble') return;

        /**
         * `curved` smooths the run through its points, and is deliberately
         * exclusive with `step`: a staircase is an assertion that the value
         * did *not* slide between readings, and rounding its corners states
         * the opposite. The same argument `polyline.ts` makes for why `smooth`
         * and per-segment bends are alternatives rather than layers.
         */
        const drawn =
          kind === 'step'
            ? toStaircase(points, spec.stepMode)
            : opts.curved
              ? monotoneSplinePoints(points, transposed)
              : points;
        runs.push({ points: drawn, color, seriesIndex: si, width: spec.lineWidth ?? 2 });

        if ((kind === 'area' || kind === 'stackedArea') && drawn.length > 1) {
          const base = baseSegments[segIndex];
          // A stacked area closes onto the series beneath it rather than onto
          // the axis, which is the whole difference between the two kinds.
          const floor =
            kind === 'stackedArea' && base.length
              ? [...base].reverse()
              : transposed
                ? [
                    { x: zeroValue, y: drawn[drawn.length - 1].y },
                    { x: zeroValue, y: drawn[0].y },
                  ]
                : [
                    { x: drawn[drawn.length - 1].x, y: zeroValue },
                    { x: drawn[0].x, y: zeroValue },
                  ];
          areas.push({
            points: drawn,
            color,
            seriesIndex: si,
            polygon: [...drawn, ...floor],
            gradient: spec.gradient,
          });
        }
        if (kind === 'line' || kind === 'step') {
          if (spec.markerShape !== 'none') {
            for (const p of points) {
              dots.push({
                ...p,
                radius: 3,
                color,
                seriesIndex: si,
                categoryIndex: -1,
                value: Number.NaN,
                shape: spec.markerShape ?? 'circle',
              });
            }
          }
        }
      });
    });
  }

  // Waterfall horizontal connector bridges
  const waterfallBridges: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  if (waterfall && waterfall.length > 1) {
    for (let i = 0; i < waterfall.length - 1; i += 1) {
      const yBridge = value(waterfall[i].to);
      const xStart = band.at(i) + band.bandWidth;
      const xEnd = band.at(i + 1);
      if (transposed) {
        waterfallBridges.push({
          x1: yBridge,
          y1: band.at(i) + band.bandWidth,
          x2: yBridge,
          y2: band.at(i + 1),
        });
      } else {
        waterfallBridges.push({
          x1: xStart,
          y1: yBridge,
          x2: xEnd,
          y2: yBridge,
        });
      }
    }
  }

  // Funnel connecting trapezoidal hulls between consecutive stages
  const funnelHulls: Array<{ polygon: Point[]; deltaPct: string }> = [];
  if (kind === 'funnel' && bars.length > 1) {
    for (let i = 0; i < bars.length - 1; i += 1) {
      const b1 = bars[i];
      const b2 = bars[i + 1];
      const v1 = b1.value;
      const v2 = b2.value;
      const drop = v1 > 0 ? ((v1 - v2) / v1) * 100 : 0;
      const deltaPct = drop > 0 ? `-${drop.toFixed(0)}%` : `+${Math.abs(drop).toFixed(0)}%`;
      const poly: Point[] = transposed
        ? [
            { x: b1.x + b1.width, y: b1.y + b1.height },
            { x: b2.x + b2.width, y: b2.y },
            { x: b2.x, y: b2.y },
            { x: b1.x, y: b1.y + b1.height },
          ]
        : [
            { x: b1.x, y: b1.y + b1.height },
            { x: b1.x + b1.width, y: b1.y + b1.height },
            { x: b2.x + b2.width, y: b2.y },
            { x: b2.x, y: b2.y },
          ];
      funnelHulls.push({ polygon: poly, deltaPct });
    }
  }

  // Linear regression trendline for scatter and bubble
  let trendline: ChartLayout['trendline'] = null;
  if ((kind === 'scatter' || kind === 'bubble') && spec.showTrendline && dots.length >= 2) {
    const reg = linearRegression(dots.map((d) => ({ x: d.x, y: d.y })));
    if (reg) {
      const x1 = plot.x;
      const y1 = reg.predict(x1);
      const x2 = plot.x + plot.width;
      const y2 = reg.predict(x2);
      trendline = {
        line: [
          { x: x1, y: clamp(y1, plot.y, plot.y + plot.height) },
          { x: x2, y: clamp(y2, plot.y, plot.y + plot.height) },
        ],
        slope: reg.slope,
        intercept: reg.intercept,
        r2: reg.r2,
        label: `R² = ${reg.r2.toFixed(3)}`,
      };
    }
  }

  // Gaussian Kernel Density Estimation (KDE) curve for histogram
  let kdeCurve: Point[] | null = null;
  if (kind === 'histogram' && spec.showKde && spec.series.length > 0) {
    const rawValues = spec.series.flatMap((s) => s.values.filter((v): v is number => typeof v === 'number'));
    if (rawValues.length >= 2 && bars.length > 0) {
      const numEval = 40;
      const evalPts: number[] = [];
      for (let i = 0; i <= numEval; i += 1) {
        evalPts.push(domain[0] + (i / numEval) * (domain[1] - domain[0]));
      }
      const densities = kernelDensityEstimation(rawValues, evalPts);
      const maxDensity = Math.max(...densities.map((d) => d.density), 1e-6);
      kdeCurve = densities.map((d, i) => {
        const screenX = plot.x + (i / numEval) * plot.width;
        const screenY = plot.y + plot.height - (d.density / maxDensity) * (plot.height * 0.85);
        return { x: screenX, y: screenY };
      });
    }
  }

  // In category order, so "the next column" means what it looks like.
  const columns = [...columnBuild.values()].sort((a, b) => a.categoryIndex - b.categoryIndex);

  return {
    // A category axis has no zero to cross: the categories are a set.
    zeroRule: null,
    // From the kind, which is the only thing that knows -- see `categoryAxis`.
    categoryAxis: transposed ? 'y' : 'x',
    columns,
    plot,
    bars,
    runs,
    areas,
    dots,
    slices: [],
    gridLines,
    baseline,
    axisLabels,
    categoryLabels,
    valueLabels,
    legend: buildLegend(spec, opts, width, height, measure),
    title,
    rings: [],
    spokes: [],
    reference: buildReference(spec, domain, plot, value, transposed, measure),
    domain,
    trendline,
    kdeCurve,
    waterfallBridges,
    funnelHulls,
  };
}

/**
 * A radar chart: one spoke per category, rings for the value scale.
 *
 * Its own function rather than a branch in the cartesian one, because nothing
 * is shared past the domain — there is no band scale, no gutter, and the
 * "axis" is a set of rings whose labels sit along a single spoke. Forcing it
 * through the cartesian path would mean a `transposed`-style flag on every
 * line of that function for one kind.
 */
function layoutPolar(
  spec: ChartSpec,
  opts: ReturnType<typeof resolveChartOptions>,
  width: number,
  height: number,
  top: number,
  bottomReserved: number,
  title: ChartLabel | null,
  measure: Measure,
  empty: ChartLayout
): ChartLayout {


  const plot: Rect = {
    x: PAD,
    y: top,
    width: Math.max(1, width - PAD * 2),
    height: Math.max(1, height - top - bottomReserved),
  };
  if (plot.width < 8 || plot.height < 8) return { ...empty, title };

  const n = spec.categories.length;
  if (n < 3) {
    // Two spokes is a line and one is a point; neither is a radar, and drawing
    // one anyway produces a shape that looks like a bug rather than like data.
    return { ...empty, plot, title, legend: buildLegend(spec, opts, width, height, measure) };
  }

  const cx = plot.x + plot.width / 2;
  const cy = plot.y + plot.height / 2;
  /**
   * The largest radius whose labels still fit, solved per spoke.
   *
   * It used to be `min(w, h) / 2 - widestLabel`: the widest name's full width
   * taken off the radius in *every* direction, including twelve o'clock where
   * a label needs only its own height. On a chart whose categories are words
   * like "Reliability" that is sixty pixels off the radius on all four sides,
   * and it is why the radar came out small — a third of the space went to
   * clearance nothing was using.
   *
   * Each label sits at `radius + LABEL_GAP` along its spoke and is aligned by
   * which side it is on, so its extent from the centre is exactly
   * `(r + gap)·|cos θ| + halfWidth` across and `(r + gap)·|sin θ| + halfHeight`
   * down. Both are linear in `r`, so the largest `r` that keeps every label
   * inside the plot is a minimum over the spokes rather than a guess — and a
   * chart with short names now gets nearly the whole box.
   */
  const LABEL_GAP = 10;
  const halfHeight = LABEL_SIZE / 2;

  let radius = Math.min(plot.width, plot.height) / 2 - LABEL_GAP;
  for (let i = 0; i < n; i += 1) {
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
    const cos = Math.abs(Math.cos(angle));
    const sin = Math.abs(Math.sin(angle));
    const width = measure(spec.categories[i] ?? '', LABEL_SIZE) + 2;
    // Centred near the top and bottom, where the label straddles its spoke;
    // to one side elsewhere, where it hangs off it. Decided by the angle
    // rather than by the radius, so it does not depend on the answer.
    const halfWidth = cos < 0.25 ? width / 2 : width;

    if (cos > 1e-6) radius = Math.min(radius, (plot.width / 2 - halfWidth) / cos - LABEL_GAP);
    if (sin > 1e-6) radius = Math.min(radius, (plot.height / 2 - halfHeight) / sin - LABEL_GAP);
  }
  radius = Math.max(8, radius);

  let max = 0;
  for (const s of spec.series) {
    for (const v of s.values) if (typeof v === 'number') max = Math.max(max, v);
  }
  const nice = niceDomain(0, spec.yMax ?? max, 4, true);
  const domain: Domain = [0, spec.yMax ?? nice.domain[1]];
  const scale = linearScale(domain, [0, radius]);

  // Twelve o'clock, clockwise, matching the pie. One quarter turn, applied
  // once, in the layout rather than in either painter.
  const angleAt = (i: number) => (i / n) * Math.PI * 2 - Math.PI / 2;
  const pointAt = (i: number, r: number) => ({
    x: cx + Math.cos(angleAt(i)) * r,
    y: cy + Math.sin(angleAt(i)) * r,
  });

  const rings: ChartPolarRing[] = nice.ticks
    .filter((t) => t > domain[0] && t <= domain[1])
    .map((t) => {
      const r = scale(t);
      return {
        cx, cy, radius: r,
        // A polygon, not a circle: the rings have to have the same shape as the
        // data they are behind, or a value on a ring does not sit on it.
        points: Array.from({ length: n }, (_, i) => pointAt(i, r)),
      };
    });

  const spokes: ChartPolarSpoke[] = Array.from({ length: n }, (_, i) => {
    const p = pointAt(i, radius);
    return { x1: cx, y1: cy, x2: p.x, y2: p.y };
  });

  const runs: ChartRun[] = [];
  const areas: ChartArea[] = [];
  const dots: ChartDot[] = [];

  spec.series.forEach((s, si) => {
    const color = seriesColor(s, si, opts.palette);
    /**
     * One point per spoke, and never a negative radius.
     *
     * The domain starts at zero, so `scale` returns a negative length for a
     * negative value — which `pointAt` then draws on the *opposite* spoke,
     * silently reporting a value against the wrong category. Clamped to the
     * centre, which is what a radar can honestly say about a number below its
     * floor.
     *
     * Built over `n` rather than over the series' own length, so a short
     * series is closed at the centre instead of producing a polygon with
     * fewer corners than there are spokes.
     */
    const points = Array.from({ length: n }, (_, i) => {
      const v = s.values[i];
      const value = typeof v === 'number' && Number.isFinite(v) ? v : 0;
      return pointAt(i, Math.max(0, scale(value)));
    });
    if (points.length < 3) return;

    // Closed, because a radar's outline is a shape and not a run: leaving the
    // last spoke unjoined draws a wedge missing from an otherwise closed form.
    const closed = [...points, points[0]];
    runs.push({ points: closed, color, seriesIndex: si });
    areas.push({ points: closed, color, seriesIndex: si, polygon: points });
    points.forEach((p, i) => {
      const v = s.values[i];
      dots.push({
        ...p, radius: 3, color, seriesIndex: si,
        categoryIndex: i, value: typeof v === 'number' ? v : Number.NaN,
      });
    });
  });

  const categoryLabels: ChartLabel[] = spec.categories.map((text, i) => {
    const p = pointAt(i, radius + LABEL_GAP);
    /**
     * Placed by which side of the circle its spoke points at, so it never
     * overlaps the shape: left of the centre it is right-aligned.
     *
     * Tested on the angle rather than on `|dx| < radius * 0.25`, which is the
     * same question asked in a way that depends on the radius — and the radius
     * is now solved *from* this decision, so asking it the other way round
     * would be circular.
     */
    const cos = Math.cos(angleAt(i));
    const align: 'left' | 'center' | 'right' =
      Math.abs(cos) < 0.25 ? 'center' : cos > 0 ? 'left' : 'right';
    const w = measure(text, LABEL_SIZE) + 2;
    return {
      text,
      x: align === 'center' ? p.x - w / 2 : align === 'left' ? p.x : p.x - w,
      y: p.y - LABEL_SIZE / 2,
      width: w,
      align,
      fontSize: LABEL_SIZE,
    };
  });

  return {
    // A polar chart's axes are rings and spokes.
    zeroRule: null,
    // A radar has no category axis; the spokes are the categories.
    categoryAxis: 'x',
    // A radar reads by spoke, not by column: its own hit test walks the
    // rings, and a column here would be a second answer to the same question.
    columns: [],
    plot,
    bars: [],
    runs,
    areas,
    dots,
    slices: [],
    gridLines: [],
    baseline: null,
    axisLabels: [],
    categoryLabels,
    valueLabels: [],
    legend: buildLegend(spec, opts, width, height, measure),
    title,
    rings,
    spokes,
    reference: null,
    domain,
  };
}

/**
 * The two-variable plots: implicit curves, contours, slope fields and vector
 * fields.
 *
 * ## Why these share a function
 *
 * All four sample a **plane** rather than a run, so all four need the same
 * things and nothing the one-variable path provides: a box in two dimensions
 * rather than a domain and a discovered range, axes that must stay square
 * because both are the same plane, and a cost that is quadratic in resolution
 * rather than linear in samples.
 *
 * What differs between them is only *what is drawn at each grid location*, and
 * that is a switch at the bottom rather than four layouts.
 *
 * ## The box is given, never discovered
 *
 * Every other plot fits its y axis to what the function reached. That is
 * impossible here and would be wrong anyway: `F(x, y) = 0` has no y to
 * discover — y is an *input* — and a slope field is defined everywhere its
 * expression is. So both axes are the author's, and the panel offers all four
 * bounds.
 */
function layoutField(
  spec: ChartSpec,
  opts: ReturnType<typeof resolveChartOptions>,
  width: number,
  height: number,
  top: number,
  bottomReserved: number,
  title: ChartLabel | null,
  measure: Measure,
  empty: ChartLayout
): ChartLayout {
  const curves = compileCurves(spec.functions ?? [], ['x', 'y']);
  const live = curves.filter((c) => c.compiled);

  const xMin = spec.xMin ?? -5;
  const xMax = spec.xMax ?? 5;
  const yMin = spec.yPlotMin ?? -5;
  const yMax = spec.yPlotMax ?? 5;

  const niceY = niceDomain(yMin, yMax, 5, false);
  const yTexts = niceY.ticks.map((t) => formatValue(t, spec));
  const gutterLeft = PAD + Math.max(...yTexts.map((t) => measure(t, LABEL_SIZE)), 0) + TICK_GAP;
  const bottomBand = LABEL_SIZE + TICK_GAP;

  const plot: Rect = {
    x: gutterLeft,
    y: top,
    width: Math.max(1, width - gutterLeft - PAD),
    height: Math.max(1, height - top - bottomReserved - bottomBand),
  };
  if (plot.width < 8 || plot.height < 8) return { ...empty, title };

  // Both axes are the same plane, so a unit must be the same length on each or
  // the picture is sheared -- an implicitly drawn circle would be an ellipse.
  let xDomain: Domain = [xMin, xMax];
  let yDomain: Domain = [yMin, yMax];
  if (spec.equalAxes ?? true) {
    const unit = Math.max(
      (xDomain[1] - xDomain[0]) / plot.width,
      (yDomain[1] - yDomain[0]) / plot.height
    );
    const cx = (xDomain[0] + xDomain[1]) / 2;
    const cy = (yDomain[0] + yDomain[1]) / 2;
    xDomain = [cx - (unit * plot.width) / 2, cx + (unit * plot.width) / 2];
    yDomain = [cy - (unit * plot.height) / 2, cy + (unit * plot.height) / 2];
  }

  const sx = linearScale(xDomain, [plot.x, plot.x + plot.width]);
  const sy = linearScale(yDomain, [plot.y + plot.height, plot.y]);

  const gridLines: ChartGridLine[] = [];
  const axisLabels: ChartLabel[] = [];
  const categoryLabels: ChartLabel[] = [];

  const xTicks = niceDomain(xDomain[0], xDomain[1], 6, false).ticks;
  const yTicks = niceDomain(yDomain[0], yDomain[1], 5, false).ticks;

  for (const t of yTicks) {
    if (t < yDomain[0] || t > yDomain[1]) continue;
    const y = sy(t);
    // Zero belongs to the baseline, which draws it at axis weight. Drawing a
    // grid line there too stacks two rules on one pixel.
    if (opts.showGrid && t !== 0) {
      gridLines.push({ x1: plot.x, y1: y, x2: plot.x + plot.width, y2: y });
    }
    axisLabels.push({
      text: formatValue(t, spec),
      x: PAD,
      y: y - LABEL_SIZE / 2,
      width: gutterLeft - PAD - TICK_GAP,
      align: 'right',
      fontSize: LABEL_SIZE,
    });
  }
  for (const t of xTicks) {
    if (t < xDomain[0] || t > xDomain[1]) continue;
    const x = sx(t);
    // And zero on this axis belongs to `zeroRule`, for the same reason.
    if (opts.showGrid && t !== 0) {
      gridLines.push({ x1: x, y1: plot.y, x2: x, y2: plot.y + plot.height });
    }
    categoryLabels.push({
      text: formatValue(t, spec),
      x: x - 30,
      y: plot.y + plot.height + TICK_GAP,
      width: 60,
      align: 'center',
      fontSize: LABEL_SIZE,
    });
  }

  // Both zero rules, so an intercept can be read off.
  let baseline: ChartGridLine | null = null;
  if (yDomain[0] <= 0 && yDomain[1] >= 0) {
    const y = sy(0);
    baseline = { x1: plot.x, y1: y, x2: plot.x + plot.width, y2: y };
  }
  let zeroRule: ChartGridLine | null = null;
  if (xDomain[0] <= 0 && xDomain[1] >= 0) {
    const x = sx(0);
    zeroRule = { x1: x, y1: plot.y, x2: x, y2: plot.y + plot.height };
  }

  const runs: ChartRun[] = [];
  const bars: ChartBar[] = [];
  const box = { xMin: xDomain[0], xMax: xDomain[1], yMin: yDomain[0], yMax: yDomain[1] };
  // Capped well below the module's own limit: this is recomputed on every
  // resize frame, and a contour at 300 is ninety thousand evaluations *per
  // level*. 120 is legible and stays interactive.
  const resolution = Math.min(160, Math.max(8, Math.round(spec.resolution ?? 80)));

  const toScreen = (seg: [{ x: number; y: number }, { x: number; y: number }]) => [
    { x: sx(seg[0].x), y: sy(seg[0].y) },
    { x: sx(seg[1].x), y: sy(seg[1].y) },
  ];

  /**
   * What the surface's colours span, kept for the scale beside it.
   *
   * The range was computed inside the cell loop and thrown away, so nothing
   * downstream could say what a colour meant -- which is why the heatmap
   * shipped without a legend of any kind.
   */
  let surfaceRange: { lo: number; hi: number } | null = null;

  const streamlines: Array<{ points: Point[]; seed: Point }> = [];
  const seeds = spec.seedPoints || [];

  if (spec.kind === 'heatmap') {
    /**
     * A filled cell per sample, emitted as `ChartBar`s so both painters draw
     * it with the rectangle code they already have.
     *
     * The cells overlap by half a pixel on purpose. Adjacent rectangles at
     * fractional coordinates leave a hairline of background between them that
     * reads as a grid drawn over the surface -- the one artefact that makes a
     * heatmap look like a table.
     */
    const c = live[0];
    if (c?.compiled) {
      const f = (x: number, y: number) => c.compiled!.evaluate(x, y);
      const n = Math.min(120, Math.max(8, Math.round(spec.resolution ?? 64)));
      const dx = (box.xMax - box.xMin) / n;
      const dy = (box.yMax - box.yMin) / n;

      // Sampled once, then painted: the range has to be known before any cell
      // can be given a colour, and evaluating twice would double the cost of
      // the most expensive kind here.
      const grid: number[] = [];
      let lo = Infinity;
      let hi = -Infinity;
      for (let iy = 0; iy < n; iy += 1) {
        for (let ix = 0; ix < n; ix += 1) {
          const v = f(box.xMin + (ix + 0.5) * dx, box.yMin + (iy + 0.5) * dy);
          grid.push(v);
          if (Number.isFinite(v)) {
            if (v < lo) lo = v;
            if (v > hi) hi = v;
          }
        }
      }

      const span = hi - lo;
      if (Number.isFinite(lo) && Number.isFinite(hi)) surfaceRange = { lo, hi };
      const ramp = spec.ramp ?? 'viridis';
      const cellW = Math.abs(sx(box.xMin + dx) - sx(box.xMin)) + 0.5;
      const cellH = Math.abs(sy(box.yMin + dy) - sy(box.yMin)) + 0.5;

      for (let iy = 0; iy < n; iy += 1) {
        for (let ix = 0; ix < n; ix += 1) {
          const v = grid[iy * n + ix];
          // An undefined cell is left unpainted rather than given the bottom
          // of the ramp: the surface has no value there, and colouring it the
          // minimum would invent a region of low density.
          if (!Number.isFinite(v)) continue;
          const t = span > 0 ? (v - lo) / span : 0.5;
          const x0 = sx(box.xMin + ix * dx);
          const y0 = sy(box.yMin + (iy + 1) * dy);
          bars.push({
            x: x0,
            y: y0,
            width: cellW,
            height: cellH,
            color: rampColorAt(ramp, t, spec.rampReversed),
            seriesIndex: 0,
            categoryIndex: iy * n + ix,
            value: v,
            negative: false,
            rounded: false,
          });
        }
      }
    }
  } else if (spec.kind === 'implicit') {
    live.forEach((c, i) => {
      const f = (x: number, y: number) => c.compiled!.evaluate(x, y);
      const color = c.color ?? seriesColor(undefined, i, opts.palette);
      for (const seg of marchingSquares(f, { ...box, resolution })) {
        runs.push({ points: toScreen(seg), color, seriesIndex: i });
      }
    });
  } else if (spec.kind === 'contour') {
    const c = live[0];
    if (c?.compiled) {
      const f = (x: number, y: number) => c.compiled!.evaluate(x, y);
      const levels = contourLevels(f, box, spec.levels ?? 8);
      levels.forEach((level, li) => {
        // Each level takes the palette in order, so a contour map reads as a
        // ramp rather than as one colour repeated.
        const color = c.color ?? seriesColor(undefined, li % 10, opts.palette);
        for (const seg of marchingSquares(f, { ...box, resolution, level })) {
          runs.push({ points: toScreen(seg), color, seriesIndex: li });
        }
      });
    }
  } else if (spec.kind === 'slopeField') {
    const c = live[0];
    if (c?.compiled) {
      const color = c.color ?? seriesColor(undefined, 0, opts.palette);
      const marks = slopeField((x, y) => c.compiled!.evaluate(x, y), {
        ...box,
        density: Math.min(40, Math.max(4, Math.round(spec.resolution ?? 18))),
      });
      for (const m of marks) {
        runs.push({
          points: [
            { x: sx(m.x1), y: sy(m.y1) },
            { x: sx(m.x2), y: sy(m.y2) },
          ],
          color,
          seriesIndex: 0,
        });
      }

      if (seeds.length > 0) {
        for (const seed of seeds) {
          const line = integrateStreamline(
            (x, y) => ({ dx: 1, dy: c.compiled!.evaluate(x, y) }),
            seed,
            { bounds: box }
          );
          if (line.length > 1) {
            streamlines.push({
              points: line.map((p) => ({ x: sx(p.x), y: sy(p.y) })),
              seed: { x: sx(seed.x), y: sy(seed.y) },
            });
          }
        }
      }
    }
  } else {
    // A vector field needs both components, so the first two expressions are
    // P and Q -- positional, for the reason a parametric curve's pair is.
    const [pc, qc] = live;
    if (pc?.compiled && qc?.compiled) {
      const color = pc.color ?? seriesColor(undefined, 0, opts.palette);
      const marks = vectorField(
        (x, y) => pc.compiled!.evaluate(x, y),
        (x, y) => qc.compiled!.evaluate(x, y),
        { ...box, density: Math.min(40, Math.max(4, Math.round(spec.resolution ?? 16))) }
      );
      for (const m of marks) {
        const a = { x: sx(m.x1), y: sy(m.y1) };
        const b = { x: sx(m.x2), y: sy(m.y2) };
        runs.push({ points: [a, b], color, seriesIndex: 0 });

        // The head, as two short strokes rather than a filled triangle: both
        // painters already draw runs, and a triangle would need a new mark in
        // each of them for a decoration six pixels across.
        const angle = Math.atan2(b.y - a.y, b.x - a.x);
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        const head = Math.min(5, len * 0.4);
        if (head > 1) {
          for (const spread of [2.6, -2.6]) {
            runs.push({
              points: [
                b,
                {
                  x: b.x + Math.cos(angle + spread) * head,
                  y: b.y + Math.sin(angle + spread) * head,
                },
              ],
              color,
              seriesIndex: 0,
            });
          }
        }
      }

      if (seeds.length > 0) {
        for (const seed of seeds) {
          const line = integrateStreamline(
            (x, y) => ({ dx: pc.compiled!.evaluate(x, y), dy: qc.compiled!.evaluate(x, y) }),
            seed,
            { bounds: box }
          );
          if (line.length > 1) {
            streamlines.push({
              points: line.map((p) => ({ x: sx(p.x), y: sy(p.y) })),
              seed: { x: sx(seed.x), y: sy(seed.y) },
            });
          }
        }
      }
    }
  }

  return {
    zeroRule,
    categoryAxis: 'x',
    // A field's reading is computed from the function under the pointer,
    // not looked up in a table of stored values.
    columns: [],
    plot,
    bars,
    runs,
    areas: [],
    dots: [],
    slices: [],
    // The surface is the picture, so rules over it would be drawn *under* the
    // cells and never seen; a heatmap keeps its axis labels and nothing else.
    gridLines: spec.kind === 'heatmap' ? [] : gridLines,
    baseline: spec.kind === 'heatmap' ? null : baseline,
    axisLabels,
    categoryLabels,
    valueLabels: [],
    legend: buildPlotLegend(spec, opts, curves, width, height, measure),
    colorBar: buildColorBar(spec, surfaceRange, plot, measure),
    title,
    rings: [],
    spokes: [],
    // A two-variable plot has a real y axis, so a rule at a value is as
    // meaningful here as on any other chart with one.
    reference: buildReference(spec, yDomain, plot, sy, false, measure),
    domain: yDomain,
    streamlines,
    mathPlot: {
      isTwoVariable: true,
      kind: spec.kind,
      variables: ['x', 'y'],
      domain: { xMin: box.xMin, xMax: box.xMax, yMin: box.yMin, yMax: box.yMax },
      curves: live
        .filter((c) => c.compiled)
        .map((c, idx) => ({
          source: c.source,
          color: c.color ?? seriesColor(undefined, idx, opts.palette),
          evaluate: (x: number, y = 0) => c.compiled!.evaluate(x, y),
        })),
      roots: [],
      extrema: [],
    },
  };
}

/**
 * A plot: curves sampled from formulae, against two continuous axes.
 *
 * ## Why this is not the cartesian path with a flag
 *
 * Everything the cartesian layout is built around is absent here. There are no
 * categories, so there is no band scale and no per-category label; the x axis
 * is a *domain* with its own ticks and its own gutter, and the y domain is
 * discovered from what the functions actually did rather than from a table.
 * Threading that through `layoutCartesian` would mean a `isPlot` branch on
 * almost every line of it, which is two layouts sharing a function body rather
 * than one layout.
 *
 * ## The origin is drawn, and the axes can be locked square
 *
 * A plot with no visible origin is a picture of a curve rather than a graph of
 * one -- you cannot read a root or an intercept off it. Both zero rules are
 * drawn whenever they fall inside the view.
 *
 * `equalAxes` keeps one unit the same length on both axes, which for a
 * parametric or polar curve is not a preference: a circle drawn on unequal
 * axes is an ellipse, and that is a different curve rather than a differently
 * styled one.
 */
function layoutPlot(
  spec: ChartSpec,
  opts: ReturnType<typeof resolveChartOptions>,
  width: number,
  height: number,
  top: number,
  bottomReserved: number,
  title: ChartLabel | null,
  measure: Measure,
  empty: ChartLayout
): ChartLayout {
  const kind = spec.kind;
  const polarKind = kind === 'polarPlot';
  const variable = kind === 'parametric' ? 't' : polarKind ? 'a' : 'x';
  const curves = compileCurves(spec.functions ?? [], variable);
  const live = curves.filter((c) => c.compiled && !((spec.functions ?? [])[curves.indexOf(c)]?.hidden));

  const from = spec.xMin ?? (kind === 'function' ? -10 : 0);
  const to = spec.xMax ?? (kind === 'function' ? 10 : Math.PI * 2);

  // ---- sample first: the y domain is whatever the curves actually reached ---
  const runsRaw: Array<{ points: Array<{ x: number; y: number } | null>; color: string }> = [];

  // Kept so the analysis below reads the *same* samples that were drawn --
  // re-sampling for it would mean a marker that can disagree with its curve.
  let firstSamples: Array<{ x: number; y: number | null }> = [];
  const allCurveSamples: Array<Array<{ x: number; y: number | null }>> = [];

  if (kind === 'function') {
    live.forEach((c, i) => {
      const samples = samplePlot((x) => c.compiled!.evaluate(x), {
        from, to, samples: spec.samples,
      });
      allCurveSamples.push(samples);
      if (i === 0) firstSamples = samples;
      runsRaw.push({
        points: samples.map((s) => (s.y === null ? null : { x: s.x, y: s.y })),
        color: c.color ?? seriesColor(undefined, i, opts.palette),
      });
    });

    // The derivative is another curve, so it goes through the same pipeline
    // and gets the same hole-breaking and the same clipping for free.
    if (spec.showDerivative && firstSamples.length) {
      runsRaw.push({
        points: differentiate(firstSamples).map((s) => (s.y === null ? null : { x: s.x, y: s.y })),
        color: seriesColor(undefined, live.length, opts.palette),
      });
    }
  } else if (kind === 'parametric') {
    // The first two expressions are x(t) and y(t) -- a parametric curve *is* an
    // ordered pair, so this is positional rather than named.
    const [fx, fy] = live;
    if (fx?.compiled && fy?.compiled) {
      runsRaw.push({
        points: sampleParametric(
          (t) => fx.compiled!.evaluate(t),
          (t) => fy.compiled!.evaluate(t),
          { from, to, samples: spec.samples }
        ),
        color: fx.color ?? seriesColor(undefined, 0, opts.palette),
      });
    }
  } else {
    live.forEach((c, i) => {
      runsRaw.push({
        points: samplePolar((a) => c.compiled!.evaluate(a), { from, to, samples: spec.samples }),
        color: c.color ?? seriesColor(undefined, i, opts.palette),
      });
    });
  }

  const xs: number[] = [];
  const ys: number[] = [];
  for (const r of runsRaw) {
    for (const p of r.points) {
      if (!p) continue;
      if (Number.isFinite(p.x)) xs.push(p.x);
      if (Number.isFinite(p.y)) ys.push(p.y);
    }
  }

  const xDomainRaw: Domain =
    kind === 'function'
      ? [from, to]
      : xs.length
        ? [Math.min(...xs), Math.max(...xs)]
        : [-1, 1];

  /**
   * The y domain is clipped to a window around the data's own middle.
   *
   * A function with an asymptote reaches values in the millions a few samples
   * from it, and fitting the axis to those flattens every interesting part of
   * the curve into a horizontal line at zero. The interquartile spread is a
   * robust measure of where the curve actually lives, and the window is a
   * generous multiple of it -- so `tan(x)` shows its branches at a readable
   * scale instead of one spike and a flat line.
   */
  const yDomainRaw: Domain = ys.length ? robustExtent(ys) : [-1, 1];

  const niceX = niceDomain(xDomainRaw[0], xDomainRaw[1], 6, false);
  const niceY = niceDomain(spec.yMin ?? yDomainRaw[0], spec.yMax ?? yDomainRaw[1], 5, false);

  let xDomain: Domain = kind === 'function' ? xDomainRaw : niceX.domain;
  let yDomain: Domain = [
    spec.yClipMin ?? spec.yMin ?? niceY.domain[0],
    spec.yClipMax ?? spec.yMax ?? niceY.domain[1],
  ];

  const yTexts = niceY.ticks.map((t) => formatValue(t, spec));
  const gutterLeft = PAD + Math.max(...yTexts.map((t) => measure(t, LABEL_SIZE)), 0) + TICK_GAP;
  const bottomBand = LABEL_SIZE + TICK_GAP;

  const plot: Rect = {
    x: gutterLeft,
    y: top,
    width: Math.max(1, width - gutterLeft - PAD),
    height: Math.max(1, height - top - bottomReserved - bottomBand),
  };
  if (plot.width < 8 || plot.height < 8) return { ...empty, title };

  // Equal axes: widen whichever domain is "tighter" per pixel, so one unit is
  // the same length both ways and nothing is cropped.
  if (spec.equalAxes ?? isIsotropic(kind)) {
    const xPerPx = (xDomain[1] - xDomain[0]) / plot.width;
    const yPerPx = (yDomain[1] - yDomain[0]) / plot.height;
    const unit = Math.max(xPerPx, yPerPx);
    const cx = (xDomain[0] + xDomain[1]) / 2;
    const cy = (yDomain[0] + yDomain[1]) / 2;
    const halfW = (unit * plot.width) / 2;
    const halfH = (unit * plot.height) / 2;
    xDomain = [cx - halfW, cx + halfW];
    yDomain = [cy - halfH, cy + halfH];
  }

  const sx = linearScale(xDomain, [plot.x, plot.x + plot.width]);
  const sy = linearScale(yDomain, [plot.y + plot.height, plot.y]);

  const xTicks = niceDomain(xDomain[0], xDomain[1], 6, false).ticks.filter(
    (t) => t >= xDomain[0] && t <= xDomain[1]
  );
  const yTicks = niceDomain(yDomain[0], yDomain[1], 5, false).ticks.filter(
    (t) => t >= yDomain[0] && t <= yDomain[1]
  );

  const gridLines: ChartGridLine[] = [];
  const axisLabels: ChartLabel[] = [];
  const categoryLabels: ChartLabel[] = [];

  for (const t of yTicks) {
    const y = sy(t);
    // Zero belongs to the baseline, which draws it at axis weight. Drawing a
    // grid line there too stacks two rules on one pixel.
    if (opts.showGrid && t !== 0) {
      gridLines.push({ x1: plot.x, y1: y, x2: plot.x + plot.width, y2: y });
    }
    axisLabels.push({
      text: formatValue(t, spec),
      x: PAD,
      y: y - LABEL_SIZE / 2,
      width: gutterLeft - PAD - TICK_GAP,
      align: 'right',
      fontSize: LABEL_SIZE,
    });
  }

  for (const t of xTicks) {
    const x = sx(t);
    // And zero on this axis belongs to `zeroRule`, for the same reason.
    if (opts.showGrid && t !== 0) {
      gridLines.push({ x1: x, y1: plot.y, x2: x, y2: plot.y + plot.height });
    }
    // x labels are the *category* slot, so both painters draw them already.
    categoryLabels.push({
      text: formatValue(t, spec),
      x: x - 30,
      y: plot.y + plot.height + TICK_GAP,
      width: 60,
      align: 'center',
      fontSize: LABEL_SIZE,
    });
  }

  // Both zero rules, so a root or an intercept can actually be read off.
  let baseline: ChartGridLine | null = null;
  if (yDomain[0] <= 0 && yDomain[1] >= 0) {
    const y = sy(0);
    baseline = { x1: plot.x, y1: y, x2: plot.x + plot.width, y2: y };
  }
  let zeroRule: ChartGridLine | null = null;
  if (xDomain[0] <= 0 && xDomain[1] >= 0) {
    const x = sx(0);
    zeroRule = { x1: x, y1: plot.y, x2: x, y2: plot.y + plot.height };
  }

  const runs: ChartRun[] = [];
  runsRaw.forEach((r, si) => {
    let current: Point[] = [];
    const flush = () => {
      if (current.length > 1) {
        const curveSpec = (spec.functions ?? [])[si];
        runs.push({
          points: current,
          color: r.color,
          seriesIndex: si,
          width: curveSpec?.width ?? spec.lineWidth ?? 2,
          style: curveSpec?.style,
        });
      }
      current = [];
    };
    for (const p of r.points) {
      if (!p) {
        flush();
        continue;
      }
      const px = sx(p.x);
      const py = sy(p.y);
      // Off-screen by a wide margin is cut rather than drawn: a point at y =
      // 1e9 turns the whole run into one near-vertical stroke through the plot.
      if (!Number.isFinite(px) || !Number.isFinite(py) || py < plot.y - plot.height || py > plot.y + plot.height * 2) {
        flush();
        continue;
      }
      current.push({ x: px, y: py });
    }
    flush();
  });

  /**
   * The analysis marks, in the plot's own pixel space.
   *
   * Placed here rather than in `chartAnalysis.ts` for the reason the whole
   * module is arranged this way: analysis answers questions about the
   * *function*, in the function's units, and knows nothing about where the
   * plot is on screen. Mixing the two would make the roots of `sin(x)` depend
   * on how big somebody dragged the box.
   */
  const dots: ChartDot[] = [];
  const areas: ChartArea[] = [];
  const bars: ChartBar[] = [];
  const valueLabels: ChartLabel[] = [];
  const firstCurve = live[0];

  const calculatedRoots: Array<{ x: number; y: number; curveIndex: number }> = [];
  const calculatedExtrema: Array<{ x: number; y: number; kind: 'min' | 'max'; curveIndex: number }> = [];
  const calculatedIntersections: Array<{ x: number; y: number; curveIndices: [number, number] }> = [];
  const calculatedYIntercepts: Array<{ x: number; y: number; curveIndex: number }> = [];

  if (kind === 'function') {
    live.forEach((c, i) => {
      const samples = allCurveSamples[i];
      if (!samples?.length || !c.compiled) return;

      const rList = findRoots(samples, (x) => c.compiled!.evaluate(x));
      for (const r of rList) {
        calculatedRoots.push({ x: r, y: 0, curveIndex: i });
      }

      const eList = findExtrema(samples);
      for (const e of eList) {
        const idx = samples.findIndex((s) => s.x === e.x);
        let refined = { x: e.x, y: e.y };
        if (
          idx > 0 &&
          idx < samples.length - 1 &&
          samples[idx - 1].y !== null &&
          samples[idx + 1].y !== null
        ) {
          refined = refineExtremum(
            (x) => c.compiled!.evaluate(x),
            samples[idx - 1].x,
            samples[idx + 1].x,
            e.kind === 'max'
          );
        }
        calculatedExtrema.push({ x: refined.x, y: refined.y, kind: e.kind, curveIndex: i });
      }

      if (from <= 0 && to >= 0) {
        const y0 = c.compiled.evaluate(0);
        if (Number.isFinite(y0)) {
          calculatedYIntercepts.push({ x: 0, y: y0, curveIndex: i });
        }
      }
    });

    for (let i = 0; i < live.length; i += 1) {
      for (let j = i + 1; j < live.length; j += 1) {
        const c1 = live[i];
        const c2 = live[j];
        const s1 = allCurveSamples[i];
        if (c1?.compiled && c2?.compiled && s1?.length) {
          const ints = findIntersections(
            s1,
            (x) => c1.compiled!.evaluate(x),
            (x) => c2.compiled!.evaluate(x)
          );
          for (const pt of ints) {
            calculatedIntersections.push({ x: pt.x, y: pt.y, curveIndices: [i, j] });
          }
        }
      }
    }
  }

  const calculatedParamFeatures: Array<{
    kind: 'pole' | 'cusp' | 'horizontalTangent' | 'verticalTangent' | 'axisCrossing' | 'apsis';
    parameterValue: number;
    x: number;
    y: number;
    label: string;
    badgeText: string;
  }> = [];

  const roundVal = (n: number, d: number) => Number(n.toFixed(d)).toString();

  if (kind === 'parametric') {
    const [fx, fy] = live;
    if (fx?.compiled && fy?.compiled) {
      const fnX = (t: number) => fx.compiled!.evaluate(t);
      const fnY = (t: number) => fy.compiled!.evaluate(t);
      const N_FEAT = 240;
      const tStep = (to - from) / N_FEAT;
      const samplesX: Array<{ x: number; y: number | null }> = [];
      const samplesY: Array<{ x: number; y: number | null }> = [];
      for (let i = 0; i <= N_FEAT; i += 1) {
        const t = from + i * tStep;
        samplesX.push({ x: t, y: fnX(t) });
        samplesY.push({ x: t, y: fnY(t) });
      }

      const extY = findExtrema(samplesY);
      const extX = findExtrema(samplesX);

      const cuspTol = 1.5 * tStep;
      const matchedExtX = new Set<number>();
      const matchedExtY = new Set<number>();

      for (let i = 0; i < extX.length; i += 1) {
        for (let j = 0; j < extY.length; j += 1) {
          if (Math.abs(extX[i].x - extY[j].x) < cuspTol) {
            matchedExtX.add(i);
            matchedExtY.add(j);
            const tVal = (extX[i].x + extY[j].x) / 2;
            calculatedParamFeatures.push({
              kind: 'cusp',
              parameterValue: tVal,
              x: fnX(tVal),
              y: fnY(tVal),
              label: `Cusp / Singularity at t = ${roundVal(tVal, 3)}`,
              badgeText: `Cusp (v=0)`,
            });
            break;
          }
        }
      }

      for (let j = 0; j < extY.length; j += 1) {
        if (matchedExtY.has(j)) continue;
        const e = extY[j];
        const tVal = e.x;
        calculatedParamFeatures.push({
          kind: 'horizontalTangent',
          parameterValue: tVal,
          x: fnX(tVal),
          y: e.y,
          label: `Horizontal Tangent: dy/dt = 0 at t = ${roundVal(tVal, 3)}`,
          badgeText: `dy/dt = 0`,
        });
      }

      for (let i = 0; i < extX.length; i += 1) {
        if (matchedExtX.has(i)) continue;
        const e = extX[i];
        const tVal = e.x;
        calculatedParamFeatures.push({
          kind: 'verticalTangent',
          parameterValue: tVal,
          x: e.y,
          y: fnY(tVal),
          label: `Vertical Tangent: dx/dt = 0 at t = ${roundVal(tVal, 3)}`,
          badgeText: `dx/dt = 0`,
        });
      }

      const rootsX = findRoots(samplesX, fnX);
      for (const tVal of rootsX) {
        calculatedParamFeatures.push({
          kind: 'axisCrossing',
          parameterValue: tVal,
          x: 0,
          y: fnY(tVal),
          label: `y-Axis Crossing: x = 0 at t = ${roundVal(tVal, 3)}`,
          badgeText: `x = 0`,
        });
      }
      const rootsY = findRoots(samplesY, fnY);
      for (const tVal of rootsY) {
        calculatedParamFeatures.push({
          kind: 'axisCrossing',
          parameterValue: tVal,
          x: fnX(tVal),
          y: 0,
          label: `x-Axis Crossing: y = 0 at t = ${roundVal(tVal, 3)}`,
          badgeText: `y = 0`,
        });
      }
    }
  } else if (kind === 'polarPlot') {
    const c = live[0];
    if (c?.compiled) {
      const fnR = (a: number) => c.compiled!.evaluate(a);
      const N_FEAT = 360;
      const aStep = (to - from) / N_FEAT;
      const samplesR: Array<{ x: number; y: number | null }> = [];
      for (let i = 0; i <= N_FEAT; i += 1) {
        const a = from + i * aStep;
        samplesR.push({ x: a, y: fnR(a) });
      }

      const rootsR = findRoots(samplesR, fnR);
      for (const aVal of rootsR) {
        calculatedParamFeatures.push({
          kind: 'pole',
          parameterValue: aVal,
          x: 0,
          y: 0,
          label: `Pole: r = 0 at θ = ${roundVal((aVal * 180) / Math.PI, 1)}°`,
          badgeText: `r = 0 (Pole)`,
        });
      }

      const extR = findExtrema(samplesR);
      for (const e of extR) {
        const aVal = e.x;
        const rVal = e.y;
        const xVal = rVal * Math.cos(aVal);
        const yVal = rVal * Math.sin(aVal);
        const kindLabel = e.kind === 'max' ? 'Max Radius' : 'Min Radius';
        calculatedParamFeatures.push({
          kind: 'apsis',
          parameterValue: aVal,
          x: xVal,
          y: yVal,
          label: `${kindLabel}: r = ${roundVal(rVal, 3)} at θ = ${roundVal((aVal * 180) / Math.PI, 1)}°`,
          badgeText: `${kindLabel} (${roundVal(rVal, 2)})`,
        });
      }
    }
  }

  if (kind === 'function' && live.length && firstCurve?.compiled) {
    const inView = (x: number, y: number) =>
      x >= xDomain[0] && x <= xDomain[1] && y >= yDomain[0] && y <= yDomain[1];

    if (spec.showRoots) {
      for (const r of calculatedRoots) {
        if (!inView(r.x, 0)) continue;
        const color = live[r.curveIndex]?.color ?? seriesColor(undefined, r.curveIndex, opts.palette);
        dots.push({
          x: sx(r.x), y: sy(0), radius: 4,
          color,
          seriesIndex: r.curveIndex, categoryIndex: -1, value: 0,
        });
        valueLabels.push({
          text: formatValue(r.x, spec),
          x: sx(r.x) - 30, y: sy(0) + 6, width: 60, align: 'center', fontSize: LABEL_SIZE,
        });
      }
    }

    if (spec.showExtrema) {
      for (const e of calculatedExtrema) {
        if (!inView(e.x, e.y)) continue;
        const color = live[e.curveIndex]?.color ?? seriesColor(undefined, e.curveIndex, opts.palette);
        dots.push({
          x: sx(e.x), y: sy(e.y), radius: 4,
          color,
          seriesIndex: e.curveIndex, categoryIndex: -1, value: e.y,
        });
        valueLabels.push({
          text: formatValue(e.y, spec),
          x: sx(e.x) - 30,
          // Above a maximum and below a minimum, so the label never sits on
          // the curve it is describing.
          y: e.kind === 'max' ? sy(e.y) - LABEL_SIZE - 8 : sy(e.y) + 8,
          width: 60, align: 'center', fontSize: LABEL_SIZE,
        });
      }
    }

    /**
     * Riemann rectangles: how integration is taught, and a real check on the
     * number the area readout reports.
     *
     * Each strip is a `ChartBar`, so it inherits the bar painter in both
     * renderers and needs no new mark type. The sum of the strips is printed
     * *beside* the trapezium value rather than instead of it, because the gap
     * between them is the thing worth seeing: watching a left sum climb toward
     * the trapezium answer as `n` rises is the whole reason to draw these.
     */
    if (spec.riemann && firstCurve.compiled) {
      const n = Math.min(200, Math.max(1, Math.round(spec.riemann.n)));
      const mode = spec.riemann.mode;
      const width = (to - from) / n;
      const zeroY = sy(clamp(0, yDomain[0], yDomain[1]));
      let sum = 0;

      for (let i = 0; i < n; i += 1) {
        const left = from + i * width;
        const at =
          mode === 'left' ? left : mode === 'right' ? left + width : left + width / 2;
        const h = firstCurve.compiled.evaluate(at);
        if (!Number.isFinite(h)) continue;
        sum += h * width;

        const yTop = sy(h);
        const x0 = sx(left);
        const x1 = sx(left + width);
        bars.push({
          x: Math.min(x0, x1),
          y: Math.min(yTop, zeroY),
          width: Math.abs(x1 - x0),
          height: Math.abs(zeroY - yTop),
          color: firstCurve.color ?? seriesColor(undefined, 0, opts.palette),
          seriesIndex: 0,
          categoryIndex: i,
          value: h,
          negative: h < 0,
          rounded: false,
        });
      }

      valueLabels.push({
        text: `Σ ${formatValue(sum, spec)} · n=${n}`,
        x: plot.x + 6,
        y: plot.y + 4 + (spec.fillArea ? LABEL_SIZE + 3 : 0),
        width: plot.width - 12,
        align: 'left',
        fontSize: LABEL_SIZE,
      });
    }

    if (spec.integralBounds && firstCurve?.compiled) {
      const a = Math.min(spec.integralBounds.a, spec.integralBounds.b);
      const b = Math.max(spec.integralBounds.a, spec.integralBounds.b);
      const sign = spec.integralBounds.a <= spec.integralBounds.b ? 1 : -1;
      const intSamples = samplePlot((x) => firstCurve.compiled!.evaluate(x), {
        from: a,
        to: b,
        samples: 120,
      });
      const zeroY = sy(clamp(0, yDomain[0], yDomain[1]));
      let band: Point[] = [];
      const flushBand = () => {
        if (band.length > 1) {
          areas.push({
            points: band,
            color: firstCurve.color ?? seriesColor(undefined, 0, opts.palette),
            seriesIndex: 0,
            polygon: [
              ...band,
              { x: band[band.length - 1].x, y: zeroY },
              { x: band[0].x, y: zeroY },
            ],
          });
        }
        band = [];
      };
      for (const smp of intSamples) {
        if (smp.y === null) { flushBand(); continue; }
        band.push({ x: sx(smp.x), y: sy(smp.y) });
      }
      flushBand();

      const ya = firstCurve.compiled.evaluate(a);
      const yb = firstCurve.compiled.evaluate(b);
      if (Number.isFinite(ya)) {
        gridLines.push({
          x1: sx(a),
          y1: zeroY,
          x2: sx(a),
          y2: sy(clamp(ya, yDomain[0], yDomain[1])),
        });
      }
      if (Number.isFinite(yb)) {
        gridLines.push({
          x1: sx(b),
          y1: zeroY,
          x2: sx(b),
          y2: sy(clamp(yb, yDomain[0], yDomain[1])),
        });
      }

      const { value, complete } = integrate(intSamples);
      const roundedA = roundVal(spec.integralBounds.a, 2);
      const roundedB = roundVal(spec.integralBounds.b, 2);
      valueLabels.push({
        text: complete
          ? `∫[${roundedA}, ${roundedB}] ≈ ${formatValue(sign * value, spec)}`
          : `∫[${roundedA}, ${roundedB}] undefined`,
        x: plot.x + 6,
        y: plot.y + 4,
        width: plot.width - 12,
        align: 'left',
        fontSize: LABEL_SIZE,
      });
    } else if (spec.fillArea) {
      const zeroY = sy(clamp(0, yDomain[0], yDomain[1]));
      let band: Point[] = [];
      const flushBand = () => {
        if (band.length > 1) {
          areas.push({
            points: band,
            color: firstCurve.color ?? seriesColor(undefined, 0, opts.palette),
            seriesIndex: 0,
            polygon: [
              ...band,
              { x: band[band.length - 1].x, y: zeroY },
              { x: band[0].x, y: zeroY },
            ],
          });
        }
        band = [];
      };
      for (const smp of firstSamples) {
        if (smp.y === null) { flushBand(); continue; }
        band.push({ x: sx(smp.x), y: sy(smp.y) });
      }
      flushBand();

      const { value, complete } = integrate(firstSamples);
      valueLabels.push({
        // The tilde is not decoration: this is a trapezium sum over adaptive
        // samples, and presenting it as an exact integral would overstate it.
        // An incomplete one says so, because a curve with a pole in the
        // interval has an area this cannot claim to know.
        text: complete ? `∫ ≈ ${formatValue(value, spec)}` : '∫ undefined on this domain',
        x: plot.x + 6,
        y: plot.y + 4,
        width: plot.width - 12,
        align: 'left',
        fontSize: LABEL_SIZE,
      });
    }
  }

  return {
    zeroRule,
    categoryAxis: 'x',
    // A curve's value at a point is evaluated, not looked up -- `chartTrace`
    // answers the hover here, and a stored column would be a stale second copy.
    columns: [],
    plot,
    bars,
    runs,
    areas,
    dots,
    slices: [],
    gridLines,
    baseline,
    axisLabels,
    categoryLabels,
    valueLabels,
    legend: buildPlotLegend(spec, opts, curves, width, height, measure),
    title,
    rings: [],
    spokes: [],
    reference: buildReference(spec, yDomain, plot, sy, false, measure),
    domain: yDomain,
    mathPlot: {
      kind,
      variable: spec.variable ?? variable,
      domain: { xMin: xDomain[0], xMax: xDomain[1], yMin: yDomain[0], yMax: yDomain[1] },
      curves: live
        .filter((c) => c.compiled)
        .map((c, idx) => ({
          source: c.source,
          color: c.color ?? seriesColor(undefined, idx, opts.palette),
          evaluate: (x: number, y = 0) => c.compiled!.evaluate(x, y),
        })),
      parametric:
        kind === 'parametric' && live[0]?.compiled && live[1]?.compiled
          ? {
              sourceX: live[0].source,
              sourceY: live[1].source,
              color: live[0].color ?? seriesColor(undefined, 0, opts.palette),
              fx: (t: number) => live[0].compiled!.evaluate(t),
              fy: (t: number) => live[1].compiled!.evaluate(t),
              tMin: from,
              tMax: to,
            }
          : undefined,
      polar:
        kind === 'polarPlot' && live[0]?.compiled
          ? [
              {
                source: live[0].source,
                color: live[0].color ?? seriesColor(undefined, 0, opts.palette),
                fr: (a: number) => live[0].compiled!.evaluate(a),
                aMin: from,
                aMax: to,
              },
            ]
          : undefined,
      roots: calculatedRoots,
      extrema: calculatedExtrema,
      intersections: calculatedIntersections,
      yIntercepts: calculatedYIntercepts,
      paramFeatures: calculatedParamFeatures,
    },
  };
}

/**
 * A window around where the data actually lives.
 *
 * The interquartile spread rather than min/max, because one sample beside an
 * asymptote is enough to make the true extent useless as an axis. Falls back to
 * the full extent when the spread is degenerate -- a constant function has no
 * quartile spread and still has to be drawn.
 */
function robustExtent(values: number[]): Domain {
  const sorted = [...values].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const iqr = q3 - q1;

  if (!(iqr > 0)) return min === max ? [min - 1, max + 1] : [min, max];

  const lo = Math.max(min, q1 - iqr * 3);
  const hi = Math.min(max, q3 + iqr * 3);
  return lo === hi ? [lo - 1, hi + 1] : [lo, hi];
}

/** A plot's legend names its formulae, and says which of them failed. */
/**
 * The scale beside a surface.
 *
 * ## Where it goes
 *
 * Inside the plot, along its right edge, rather than in reserved gutter of
 * its own. A colour bar is small and a surface is dense to its edges anyway,
 * so taking a strip out of the drawing area would shrink the picture by more
 * than the bar occupies. Sitting over the surface is also what makes it
 * readable: the eye compares the bar to the colours directly beside it
 * without travelling.
 *
 * ## The stops
 *
 * Nine, sampled from the same `rampColor` the cells are painted with, so the
 * bar cannot show a ramp the surface does not use. Nine rather than two,
 * because every ramp here except `mono` turns corners in the middle -- a
 * two-stop gradient from viridis's ends is a purple-to-yellow fade with none
 * of the green that makes it readable.
 *
 * ## The numbers
 *
 * Three: the bottom, the middle and the top. A surface's scale is read for
 * magnitude and sign, not for precise values -- that is what the hover
 * readout is for -- and a column of eight numbers down the side of a picture
 * is furniture competing with the thing it describes.
 */
function buildColorBar(
  spec: ChartSpec,
  range: { lo: number; hi: number } | null,
  plot: Rect,
  measure: Measure
): ChartColorBar | null {
  if (!range || spec.kind !== 'heatmap') return null;
  // The legend toggle governs this too: it is the legend, for this kind.
  if (!(spec.showLegend ?? true)) return null;

  const BAR_W = 10;
  const fontSize = LABEL_SIZE;
  const texts = [range.hi, (range.lo + range.hi) / 2, range.lo].map((v) => formatValue(v, spec));
  const textW = Math.max(...texts.map((t) => measure(t, fontSize)), 0);

  const height = Math.max(40, Math.min(plot.height - PAD * 2, plot.height * 0.55));
  const x = plot.x + plot.width - PAD - textW - TICK_GAP - BAR_W;
  const y = plot.y + (plot.height - height) / 2;

  // Not enough room to sit inside the picture without covering it: no bar is
  // better than a bar over the only part of the surface still visible.
  if (x < plot.x + plot.width * 0.5) return null;

  const ramp = spec.ramp ?? 'viridis';
  const STOPS = 9;
  const stops = Array.from({ length: STOPS }, (_, i) => {
    const offset = i / (STOPS - 1);
    // Offset zero is the *bottom* of the bar, which is the low end of the
    // ramp -- so the colour at an offset is the colour of the value at that
    // height, and the bar reads the same way up as the surface does.
    return { offset, color: rampColorAt(ramp, offset, spec.rampReversed) };
  });

  return {
    x,
    y,
    width: BAR_W,
    height,
    stops,
    ticks: [
      { y: y + fontSize * 0.8, text: texts[0] },
      { y: y + height / 2 + fontSize * 0.3, text: texts[1] },
      { y: y + height, text: texts[2] },
    ],
    fontSize,
    textX: x + BAR_W + TICK_GAP,
  };
}

function buildPlotLegend(
  spec: ChartSpec,
  opts: ReturnType<typeof resolveChartOptions>,
  curves: ReturnType<typeof compileCurves>,
  width: number,
  height: number,
  measure: Measure
): ChartLegendEntry[] {
  if (!opts.showLegend || curves.length === 0) return [];
  const asSeries: ChartSpec = {
    ...spec,
    kind: 'line',
    series: curves.map((c, i) => ({
      // The expression itself is the name: it is what the reader wants to know
      // and what the author typed, and inventing "Series 1" beside it would be
      // a label that says less than the thing it labels.
      name: c.error ? `${c.source} — ${c.error}` : c.source,
      values: [],
      color: c.color ?? seriesColor(undefined, i, opts.palette),
    })),
  };
  return buildLegend(asSeries, { ...opts, showLegend: true }, width, height, measure);
}

/**
 * A waterfall's steps: where each bar starts, where it ends, what it added.
 *
 * The running total is what the axis must cover, which is why this is computed
 * before the domain rather than while placing bars.
 */
function runningTotals(spec: ChartSpec): Array<{ from: number; to: number; delta: number }> {
  const s = spec.series[0];
  if (!s) return [];
  let running = 0;
  return s.values.map((v) => {
    const delta = typeof v === 'number' ? v : 0;
    const from = running;
    running += delta;
    return { from, to: running, delta };
  });
}

/** The smallest and largest value the axis has to cover. */
function valueExtent(
  spec: ChartSpec,
  ctx: { stacked: boolean; waterfall: Array<{ from: number; to: number }> | null }
): { min: number; max: number; absMax: number } {
  const seen: number[] = [];

  if (ctx.waterfall) {
    for (const step of ctx.waterfall) seen.push(step.from, step.to);
  } else if (ctx.stacked) {
    // Against the *sum*: an axis topping out at the largest single component
    // would put every stack through the roof of the plot.
    for (let i = 0; i < spec.categories.length; i += 1) {
      let pos = 0;
      let neg = 0;
      for (const s of spec.series) {
        const v = s.values[i];
        if (typeof v !== 'number') continue;
        if (v >= 0) pos += v;
        else neg += v;
      }
      seen.push(pos, neg);
    }
  } else {
    for (const s of spec.series) {
      for (const v of s.values) if (typeof v === 'number') seen.push(v);
    }
  }

  if (seen.length === 0) return { min: 0, max: 1, absMax: 1 };
  return {
    min: Math.min(...seen),
    max: Math.max(...seen),
    absMax: Math.max(...seen.map(Math.abs), 1e-9),
  };
}

/**
 * The reference rule, if the spec has one and it falls inside the axis.
 *
 * Dropped rather than clamped when it does not: a target line pinned to the top
 * of the plot because the real target is off the scale is a drawing that says
 * the target was met.
 */
/**
 * The value extent, widened to hold whatever is annotated on top of it.
 *
 * Separate from `valueExtent` because the two answer different questions:
 * that one is "how big are the numbers", this one is "how much axis do we
 * need". Keeping them apart is what stops a target line quietly changing what
 * counts as the data's own range -- which matters for `includeZero`, for the
 * bar baseline, and for anything else that asks about the data rather than
 * about the picture.
 */
/**
 * The corridor's default ink.
 *
 * One definition, where there were two: `#10B981` was typed into the Konva
 * renderer and again into the SVG exporter, which is how they came to draw it
 * at two different opacities without anybody noticing. Green because a
 * tolerance corridor is the one annotation whose meaning genuinely is "this is
 * the good region" -- unlike a delta against a target, whose sign says nothing
 * about whether the news is good.
 */
export const TOLERANCE_INK = '#10B981';

/** How solid the corridor's fill is, in both painters. */
export const TOLERANCE_FILL_OPACITY = 0.12;

function annotationExtent(
  spec: ChartSpec,
  extent: { min: number; max: number }
): { min: number; max: number } {
  let { min, max } = extent;

  const consider = (v: number | undefined) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return;
    if (v < min) min = v;
    if (v > max) max = v;
  };

  consider(spec.reference?.value);
  consider(spec.toleranceBand?.min);
  consider(spec.toleranceBand?.max);

  return { min, max };
}

function buildReference(
  spec: ChartSpec,
  domain: Domain,
  plot: Rect,
  value: (v: number) => number,
  transposed: boolean,
  measure: Measure
): ChartReference | null {
  const ref = spec.reference;
  if (!ref || !Number.isFinite(ref.value)) return null;
  /**
   * Outside the domain the line is not drawn, and after `annotationExtent`
   * that can only happen when somebody has pinned `yMin`/`yMax` themselves.
   * Clamping instead would draw the rule along the axis and assert a value it
   * does not have -- worse than absent, because it looks like a reading.
   */
  if (ref.value < domain[0] || ref.value > domain[1]) return null;

  const at = value(ref.value);
  const color = ref.color ?? '#EF4444';
  const dashed = (ref.style ?? 'dashed') === 'dashed';
  const line = transposed
    ? { x1: at, y1: plot.y, x2: at, y2: plot.y + plot.height }
    : { x1: plot.x, y1: at, x2: plot.x + plot.width, y2: at };

  if (!ref.label) return { ...line, color, dashed };

  const w = measure(ref.label, LABEL_SIZE) + 4;
  return {
    ...line,
    color,
    dashed,
    label: {
      text: ref.label,
      x: transposed ? at + 4 : plot.x + plot.width - w,
      y: transposed ? plot.y + 2 : at - LABEL_SIZE - 3,
      width: w,
      align: transposed ? 'left' : 'right',
      fontSize: LABEL_SIZE,
    },
  };
}

/**
 * A value as text, honouring the spec's prefix, suffix and decimals.
 *
 * One function, used for tick labels and value labels alike, so an axis
 * reading `$1.2k` cannot sit under bars labelled `1200`.
 */
export function formatValue(v: number, spec: ChartSpec): string {
  /**
   * Two independent settings, not one.
   *
   * Abbreviation used to be inferred from `decimals` being absent, so setting
   * a decimal count silently switched `12k` back to `12000` -- two behaviours
   * riding one field, which is the shape this codebase keeps splitting apart.
   * `compactNumbers` says it now, and defaults to true so nothing that was
   * abbreviating stops.
   */
  const compact = spec.compactNumbers ?? true;
  const places =
    typeof spec.decimals === 'number'
      ? Math.min(6, Math.max(0, Math.round(spec.decimals)))
      : null;

  let body: string;
  if (compact && Math.abs(v) >= 10_000) {
    // The abbreviation already discards precision, so a decimal count applies
    // to the abbreviated figure rather than the raw one: `1.50M`, not
    // `1500000.00` shortened afterwards.
    const unit = Math.abs(v) >= 1_000_000 ? 1_000_000 : 1000;
    const suffix = unit === 1_000_000 ? 'M' : 'k';
    const scaled = v / unit;
    body = `${places === null ? trimTo1(scaled) : scaled.toFixed(places)}${suffix}`;
  } else if (places !== null) {
    body = v.toFixed(places);
  } else {
    body = compact ? formatTick(v) : String(Math.round(v * 1e6) / 1e6);
  }

  return `${spec.valuePrefix ?? ''}${body}${spec.valueSuffix ?? ''}`;
}

/** One decimal at most, and none when it would be `.0`. */
function trimTo1(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function layoutRadial(
  spec: ChartSpec,
  opts: ReturnType<typeof resolveChartOptions>,
  width: number,
  height: number,
  top: number,
  bottomReserved: number,
  title: ChartLabel | null,
  measure: Measure,
  empty: ChartLayout
): ChartLayout {
  const plot: Rect = {
    x: PAD,
    y: top,
    width: Math.max(1, width - PAD * 2),
    height: Math.max(1, height - top - bottomReserved),
  };
  if (plot.width < 8 || plot.height < 8) return { ...empty, title };

  const series = spec.series[0];
  // Negatives have no meaning as a share of a whole, and drawing one as a
  // positive slice would state something false. They are dropped, not clamped.
  const values = (series?.values ?? []).map((v) =>
    typeof v === 'number' && v > 0 ? v : 0
  );
  const total = values.reduce((a, b) => a + b, 0);

  const cx = plot.x + plot.width / 2;
  const cy = plot.y + plot.height / 2;
  const outerRadius = Math.max(1, Math.min(plot.width, plot.height) / 2 - 2);
  const innerRadius = outerRadius * opts.innerRadius;

  const slices: ChartSlice[] = [];
  const valueLabels: ChartLabel[] = [];

  if (total > 0) {
    // Twelve o'clock, clockwise. Konva and SVG both put zero radians at three
    // o'clock, so the quarter turn is applied once, here, rather than by each
    // painter — which is exactly the sort of thing two painters get different.
    let angle = -Math.PI / 2;

    values.forEach((v, i) => {
      if (v <= 0) return;
      const sweep = (v / total) * Math.PI * 2;
      const mid = angle + sweep / 2;
      const labelR = innerRadius + (outerRadius - innerRadius) * 0.62;

      slices.push({
        cx, cy, outerRadius, innerRadius,
        startAngle: angle,
        endAngle: angle + sweep,
        color: seriesColor({ name: '', values: [], color: series?.color }, i, opts.palette),
        index: i,
        value: v,
        fraction: v / total,
        labelAnchor: { x: cx + Math.cos(mid) * labelR, y: cy + Math.sin(mid) * labelR },
      });

      if (opts.showValues) {
        // Honours `decimals` so the Numbers control is not inert here: a pie of
        // near-equal slices needs 33.3% to say anything at all.
        const share = (v / total) * 100;
        const places = Math.min(3, Math.max(0, Math.round(spec.decimals ?? 0)));
        const pct = Number(share.toFixed(places));
        const pctStr = `${share.toFixed(places)}%`;
        const rawStr = formatValue(v, spec);
        const text =
          spec.valueFormat === 'value'
            ? rawStr
            : spec.valueFormat === 'both'
            ? `${rawStr} (${pctStr})`
            : pctStr;

        const isOutside = spec.valuePlacement === 'outside';
        const finalR = isOutside ? outerRadius + 14 : labelR;
        // Under about six per cent there is no room for the text inside the
        // slice, and a percentage sitting over its neighbour is worse than an
        // unlabelled sliver the legend already names. Outside placement avoids this.
        if (isOutside || pct >= 6) {
          valueLabels.push({
            text,
            // A label inside the wedge sits on the wedge; one placed outside
            // sits on the board. This is the case where it mattered most: a
            // percentage is *always* inside by default, so a pie in the
            // palette's darker colours lost a third of its numbers.
            on: isOutside
              ? undefined
              : seriesColor({ name: '', values: [], color: series?.color }, i, opts.palette),
            x: cx + Math.cos(mid) * finalR - 25,
            y: cy + Math.sin(mid) * finalR - LABEL_SIZE / 2,
            width: 50,
            align: 'center',
            fontSize: LABEL_SIZE,
          });
        }
      }
      angle += sweep;
    });
  }

  const donutMetric =
    opts.innerRadius > 0 && total > 0
      ? {
          value: formatValue(total, spec),
          label: 'Total',
          x: cx,
          y: cy,
        }
      : null;

  return {
    // A pie has no axes at all.
    zeroRule: null,
    // A pie's categories are angles, not a run along an axis.
    categoryAxis: 'x',
    // A slice is its own reading; there is no second axis to column by.
    columns: [],
    plot,
    bars: [], runs: [], areas: [], dots: [],
    slices,
    gridLines: [],
    baseline: null,
    axisLabels: [],
    categoryLabels: [],
    valueLabels,
    legend: buildLegend(spec, opts, width, height, measure),
    title,
    rings: [],
    spokes: [],
    reference: null,
    domain: [0, total || 1],
    donutMetric,
  };
}

/**
 * The legend, laid along the bottom and wrapped by measurement.
 *
 * Entries are placed left to right and an entry that would run past the right
 * edge starts a new row — the same rule the sticky-note footer follows for
 * reaction chips, and for the same reason: a legend that overflows silently
 * puts a series name off the edge of the object, where it is not merely ugly
 * but missing.
 */
function buildLegend(
  spec: ChartSpec,
  opts: ReturnType<typeof resolveChartOptions>,
  width: number,
  height: number,
  measure: Measure
): ChartLegendEntry[] {
  if (!opts.showLegend) return [];

  // A pie's and a funnel's legend name their *categories*: both draw one
  // series whose points are the things being compared. Everything else names
  // its series.
  const entries = isRadial(spec.kind) || spec.kind === 'funnel'
    ? spec.categories.map((label, i) => ({
        label,
        color: seriesColor({ name: '', values: [], color: spec.series[0]?.color }, i, opts.palette),
      }))
    : spec.series.map((s, i) => ({ label: s.name || `Series ${i + 1}`, color: seriesColor(s, i, opts.palette) }));

  if (entries.length === 0) return [];

  const GAP = 16;
  const out: ChartLegendEntry[] = [];
  const side = opts.legendSide ?? 'bottom';
  const box = opts.legendBox;
  if (!box) return [];

  /**
   * A column down the right, or a wrapping row.
   *
   * The two are different enough to be separate loops: a column needs no
   * wrapping and a row needs no fixed `x`, and folding them together produced
   * a single loop with a branch in every line of it.
   */
  if (side === 'right') {
    /**
     * A column in the gutter the caller reserved for it.
     *
     * Names are cut to the gutter's width rather than allowed to set it: the
     * gutter is capped at a third of the chart, so past that the *name* gives
     * way instead of the picture. A legend that squeezes the plot into a
     * strip has stopped being a key and started being the subject.
     */
    const textRoom = Math.max(24, box.width - LEGEND_SWATCH - 5);
    let y = box.y;
    for (const e of entries) {
      // One row per entry, and no more rows than the gutter is tall.
      if (y + LEGEND_SIZE > box.y + box.height) break;
      out.push({
        label: truncateTo(e.label, textRoom, measure),
        color: e.color,
        x: box.x,
        y,
        swatch: LEGEND_SWATCH,
        textX: box.x + LEGEND_SWATCH + 5,
        fontSize: LEGEND_SIZE,
      });
      y += LEGEND_SIZE + 6;
    }
    return out;
  }

  let x = box.x;
  // Both bands are the same wrapping run, started from the line the caller
  // reserved — which for a top legend is below the title, not on it.
  let y = box.y;

  for (const e of entries) {
    const textWidth = measure(e.label, LEGEND_SIZE);
    const entryWidth = LEGEND_SWATCH + 5 + textWidth;

    if (x > box.x && x + entryWidth > box.x + box.width) {
      x = box.x;
      // Downward at the top and upward at the bottom, so a second row grows
      // into the space reserved for it rather than over the plot.
      y += side === 'top' ? LEGEND_SIZE + 5 : -(LEGEND_SIZE + 5);
    }

    out.push({
      label: e.label,
      color: e.color,
      x,
      y,
      swatch: LEGEND_SWATCH,
      textX: x + LEGEND_SWATCH + 5,
      fontSize: LEGEND_SIZE,
    });
    x += entryWidth + GAP;
  }

  return out;
}

/** The widest entry, plus its swatch and the gap to the plot. */
/**
 * A label cut to fit, with an ellipsis where it was cut.
 *
 * Character-counting would be wrong for the same reason the axis gutter is
 * measured rather than assumed: "IIIII" and "WWWWW" are the same length and
 * nothing like the same width. Binary search rather than a walk, because a
 * legend of twenty entries measures a lot of substrings otherwise.
 */
function truncateTo(text: string, room: number, measure: Measure): string {
  if (measure(text, LEGEND_SIZE) <= room) return text;

  const ellipsis = '…';
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(text.slice(0, mid) + ellipsis, LEGEND_SIZE) <= room) lo = mid;
    else hi = mid - 1;
  }
  // Nothing fits: one character and the mark, which still says a series is
  // there — an empty label would read as a missing entry.
  return lo <= 0 ? text.slice(0, 1) + ellipsis : text.slice(0, lo).trimEnd() + ellipsis;
}

function legendColumnWidth(
  entries: Array<{ label: string }>,
  measure: Measure
): number {
  const widest = Math.max(0, ...entries.map((e) => measure(e.label, LEGEND_SIZE)));
  return LEGEND_SWATCH + 5 + widest + PAD * 2;
}

/**
 * How much width a right-hand legend needs, before the plot is laid out.
 *
 * Measured from the same entry list `buildLegend` will produce, rather than
 * guessed at — a fixed gutter is either too wide for "A"/"B" or too narrow
 * for a real series name, and the second case is a legend that overhangs the
 * edge of the chart.
 */
function legendWidth(
  spec: ChartSpec,
  opts: ReturnType<typeof resolveChartOptions>,
  measure: Measure
): number {
  if (!opts.showLegend) return 0;
  const labels =
    isRadial(spec.kind) || spec.kind === 'funnel'
      ? spec.categories
      : spec.series.map((series, i) => series.name || `Series ${i + 1}`);
  if (labels.length === 0) return 0;
  return legendColumnWidth(labels.map((label) => ({ label })), measure);
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}
