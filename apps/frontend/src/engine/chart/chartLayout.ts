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
import { catmullRomPoints } from '../model/polyline';
import { compileCurves, samplePlot, sampleParametric, samplePolar } from './chartPlot';
import { differentiate, findExtrema, findRoots, integrate } from './chartAnalysis';
import { contourLevels, marchingSquares } from './marchingSquares';
import { slopeField, vectorField } from './vectorField';
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
}

export interface ChartRun {
  /** Already in draw order. A gap in the data splits the run rather than
   *  drawing a straight line across it — see `ChartSeries.values`. */
  points: Point[];
  color: string;
  seriesIndex: number;
}

export interface ChartArea extends ChartRun {
  /** The closed polygon, baseline included. */
  polygon: Point[];
}

export interface ChartDot extends Point {
  radius: number;
  color: string;
  seriesIndex: number;
  categoryIndex: number;
  value: number;
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
  /** The zero rule, when the axis crosses it. */
  baseline: ChartGridLine | null;
  axisLabels: ChartLabel[];
  categoryLabels: ChartLabel[];
  valueLabels: ChartLabel[];
  legend: ChartLegendEntry[];
  title: ChartLabel | null;
  /** Radar only: the value rings and the category spokes. */
  rings: ChartPolarRing[];
  spokes: ChartPolarSpoke[];
  /** The `reference` rule, when the spec carries one inside the domain. */
  reference: ChartReference | null;
  /** The resolved value-axis domain, exposed for tests and the panel. */
  domain: Domain;
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
          const { categories, counts } = bucketize(
            rawSpec.series.flatMap((s) => s.values),
            opts0.buckets
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

  // Sorting is a view, applied before layout and never written back --
  // see `sortSpec`. Done here so every kind gets it for free.
  const spec = sortSpec(normalizeSpec(bucketed));
  const opts = resolveChartOptions(spec);

  const empty: ChartLayout = {
    plot: { x: 0, y: 0, width: 0, height: 0 },
    bars: [], runs: [], areas: [], dots: [], slices: [],
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

  // The legend sits in a band of its own under the plot, clear of the
  // category labels above it.
  const legendHeight = opts.showLegend ? LEGEND_SIZE + 16 : 0;
  const bottomReserved = PAD + legendHeight;

  if (isRadial(spec.kind)) {
    return layoutRadial(spec, opts, width, height, top, bottomReserved, title, measure, empty);
  }
  if (isPolar(spec.kind)) {
    return layoutPolar(spec, opts, width, height, top, bottomReserved, title, measure, empty);
  }
  if (isTwoVariable(spec.kind)) {
    return layoutField(spec, opts, width, height, top, bottomReserved, title, measure, empty);
  }
  if (isPlot(spec.kind)) {
    return layoutPlot(spec, opts, width, height, top, bottomReserved, title, measure, empty);
  }

  /**
   * The two kinds that change the numbers before anything is placed.
   *
   * Done here, once, so every mark builder below sees ordinary data. The
   * alternative is a bucketing branch inside the bar builder and a normalising
   * branch inside the stack builder, which is two transforms living where the
   * geometry lives and no way to test either on its own.
   */
  // The histogram has already been bucketed above, before normalisation.
  let prepared = spec;
  if (isPercentStacked(spec.kind)) {
    prepared = toPercentStack(spec);
  }

  return layoutCartesian(prepared, opts, width, height, top, bottomReserved, title, measure, empty);
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
  const nice = niceDomain(spec.yMin ?? extent.min, spec.yMax ?? extent.max, 5, opts.includeZero);
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
          }
        : {
            x: bandStart, y: lo, width: lane.width, height: len,
            color, seriesIndex, categoryIndex, value: v, negative: v < 0,
          }
    );

    if (opts.showValues) {
      const text = formatValue(v, spec);
      valueLabels.push(
        transposed
          ? {
              text, x: lo + len + 4, y: bandStart + lane.width / 2 - LABEL_SIZE / 2,
              width: 60, align: 'left', fontSize: LABEL_SIZE,
            }
          : {
              text, x: bandStart, y: v >= 0 ? lo - LABEL_SIZE - 2 : lo + len + 2,
              width: lane.width, align: 'center', fontSize: LABEL_SIZE,
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
          step.delta >= 0 ? seriesColor(spec.series[0], 0) : seriesColor(undefined, 4),
          step.delta
        );
      });
    } else if (kind === 'funnel') {
      // One series, each stage its own colour, so the shape reads as stages
      // rather than as one quantity that happens to shrink.
      const s = spec.series[0];
      s?.values.forEach((v, ci) => {
        if (typeof v !== 'number') return;
        pushBar(ci, 0, { offset: 0, width: band.bandWidth }, 0, v, seriesColor(undefined, ci), v);
      });
    } else {
      const lanes = stacked ? 1 : Math.max(1, spec.series.length);
      const laneWidth = band.bandWidth / lanes;
      const runningPos = new Array(spec.categories.length).fill(0);
      const runningNeg = new Array(spec.categories.length).fill(0);

      spec.series.forEach((s, si) => {
        const color = seriesColor(s, si);
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
      const color = seriesColor(s, si);
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
          dots.push({ ...p, radius, color, seriesIndex: si, categoryIndex: ci, value: v });
        }
        // Every run kind, not three of them. `scatter`, `bubble` and
        // `stackedArea` were excluded for no reason anybody recorded, so the
        // Values toggle was offered on them and did nothing.
        if (opts.showValues) {
          valueLabels.push({
            text: formatValue(v, spec),
            x: p.x - band.step / 2,
            y: p.y - LABEL_SIZE - 5,
            width: band.step,
            align: 'center',
            fontSize: LABEL_SIZE,
          });
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
            ? toStaircase(points)
            : opts.curved
              ? catmullRomPoints(points)
              : points;
        runs.push({ points: drawn, color, seriesIndex: si });

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
          areas.push({ points: drawn, color, seriesIndex: si, polygon: [...drawn, ...floor] });
        }
        if (kind === 'line' || kind === 'step') {
          for (const p of points) {
            dots.push({
              ...p, radius: 3, color, seriesIndex: si,
              categoryIndex: -1, value: Number.NaN,
            });
          }
        }
      });
    });
  }

  return {
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
  // Room for the category names, which sit outside the outermost ring.
  const labelRoom = Math.max(...spec.categories.map((c) => measure(c, LABEL_SIZE)), 0) + 8;

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
  const radius = Math.max(
    8,
    Math.min(plot.width, plot.height) / 2 - Math.min(labelRoom, plot.width / 4)
  );

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
    const color = seriesColor(s, si);
    const points = s.values
      .slice(0, n)
      .map((v, i) => pointAt(i, scale(typeof v === 'number' ? v : 0)));
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
    const p = pointAt(i, radius + 10);
    // The label is placed by which side of the circle its spoke points at, so
    // it never overlaps the shape: left of the centre it is right-aligned.
    const dx = p.x - cx;
    const align: 'left' | 'center' | 'right' =
      Math.abs(dx) < radius * 0.25 ? 'center' : dx > 0 ? 'left' : 'right';
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
    if (opts.showGrid) gridLines.push({ x1: plot.x, y1: y, x2: plot.x + plot.width, y2: y });
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
    if (opts.showGrid) gridLines.push({ x1: x, y1: plot.y, x2: x, y2: plot.y + plot.height });
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
  if (xDomain[0] <= 0 && xDomain[1] >= 0) {
    const x = sx(0);
    gridLines.push({ x1: x, y1: plot.y, x2: x, y2: plot.y + plot.height });
  }

  const runs: ChartRun[] = [];
  const box = { xMin: xDomain[0], xMax: xDomain[1], yMin: yDomain[0], yMax: yDomain[1] };
  // Capped well below the module's own limit: this is recomputed on every
  // resize frame, and a contour at 300 is ninety thousand evaluations *per
  // level*. 120 is legible and stays interactive.
  const resolution = Math.min(160, Math.max(8, Math.round(spec.resolution ?? 80)));

  const toScreen = (seg: [{ x: number; y: number }, { x: number; y: number }]) => [
    { x: sx(seg[0].x), y: sy(seg[0].y) },
    { x: sx(seg[1].x), y: sy(seg[1].y) },
  ];

  if (spec.kind === 'implicit') {
    live.forEach((c, i) => {
      const f = (x: number, y: number) => c.compiled!.evaluate(x, y);
      const color = c.color ?? seriesColor(undefined, i);
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
        const color = c.color ?? seriesColor(undefined, li % 10);
        for (const seg of marchingSquares(f, { ...box, resolution, level })) {
          runs.push({ points: toScreen(seg), color, seriesIndex: li });
        }
      });
    }
  } else if (spec.kind === 'slopeField') {
    const c = live[0];
    if (c?.compiled) {
      const color = c.color ?? seriesColor(undefined, 0);
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
    }
  } else {
    // A vector field needs both components, so the first two expressions are
    // P and Q -- positional, for the reason a parametric curve's pair is.
    const [pc, qc] = live;
    if (pc?.compiled && qc?.compiled) {
      const color = pc.color ?? seriesColor(undefined, 0);
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
    }
  }

  return {
    plot,
    bars: [],
    runs,
    areas: [],
    dots: [],
    slices: [],
    gridLines,
    baseline,
    axisLabels,
    categoryLabels,
    valueLabels: [],
    legend: buildPlotLegend(spec, opts, curves, width, height, measure),
    title,
    rings: [],
    spokes: [],
    // A two-variable plot has a real y axis, so a rule at a value is as
    // meaningful here as on any other chart with one.
    reference: buildReference(spec, yDomain, plot, sy, false, measure),
    domain: yDomain,
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

  if (kind === 'function') {
    live.forEach((c, i) => {
      const samples = samplePlot((x) => c.compiled!.evaluate(x), {
        from, to, samples: spec.samples,
      });
      if (i === 0) firstSamples = samples;
      runsRaw.push({
        points: samples.map((s) => (s.y === null ? null : { x: s.x, y: s.y })),
        color: c.color ?? seriesColor(undefined, i),
      });
    });

    // The derivative is another curve, so it goes through the same pipeline
    // and gets the same hole-breaking and the same clipping for free.
    if (spec.showDerivative && firstSamples.length) {
      runsRaw.push({
        points: differentiate(firstSamples).map((s) => (s.y === null ? null : { x: s.x, y: s.y })),
        color: seriesColor(undefined, live.length),
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
        color: fx.color ?? seriesColor(undefined, 0),
      });
    }
  } else {
    live.forEach((c, i) => {
      runsRaw.push({
        points: samplePolar((a) => c.compiled!.evaluate(a), { from, to, samples: spec.samples }),
        color: c.color ?? seriesColor(undefined, i),
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
  let yDomain: Domain = [spec.yMin ?? niceY.domain[0], spec.yMax ?? niceY.domain[1]];

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
    if (opts.showGrid) gridLines.push({ x1: plot.x, y1: y, x2: plot.x + plot.width, y2: y });
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
    if (opts.showGrid) gridLines.push({ x1: x, y1: plot.y, x2: x, y2: plot.y + plot.height });
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
  if (xDomain[0] <= 0 && xDomain[1] >= 0) {
    const x = sx(0);
    gridLines.push({ x1: x, y1: plot.y, x2: x, y2: plot.y + plot.height });
  }

  const runs: ChartRun[] = [];
  runsRaw.forEach((r, si) => {
    let current: Point[] = [];
    const flush = () => {
      if (current.length > 1) runs.push({ points: current, color: r.color, seriesIndex: si });
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

  if (kind === 'function' && firstSamples.length && firstCurve?.compiled) {
    const inView = (x: number, y: number) =>
      x >= xDomain[0] && x <= xDomain[1] && y >= yDomain[0] && y <= yDomain[1];

    if (spec.showRoots) {
      for (const r of findRoots(firstSamples, (x) => firstCurve.compiled!.evaluate(x))) {
        if (!inView(r, 0)) continue;
        dots.push({
          x: sx(r), y: sy(0), radius: 4,
          color: firstCurve.color ?? seriesColor(undefined, 0),
          seriesIndex: 0, categoryIndex: -1, value: 0,
        });
        valueLabels.push({
          text: formatValue(r, spec),
          x: sx(r) - 30, y: sy(0) + 6, width: 60, align: 'center', fontSize: LABEL_SIZE,
        });
      }
    }

    if (spec.showExtrema) {
      for (const e of findExtrema(firstSamples)) {
        if (!inView(e.x, e.y)) continue;
        dots.push({
          x: sx(e.x), y: sy(e.y), radius: 4,
          color: firstCurve.color ?? seriesColor(undefined, 0),
          seriesIndex: 0, categoryIndex: -1, value: e.y,
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
          color: firstCurve.color ?? seriesColor(undefined, 0),
          seriesIndex: 0,
          categoryIndex: i,
          value: h,
          negative: h < 0,
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

    if (spec.fillArea) {
      const zeroY = sy(clamp(0, yDomain[0], yDomain[1]));
      let band: Point[] = [];
      const flushBand = () => {
        if (band.length > 1) {
          areas.push({
            points: band,
            color: firstCurve.color ?? seriesColor(undefined, 0),
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
      color: c.color ?? seriesColor(undefined, i),
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
        color: seriesColor({ name: '', values: [], color: series?.color }, i),
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
        // Under about six per cent there is no room for the text inside the
        // slice, and a percentage sitting over its neighbour is worse than an
        // unlabelled sliver the legend already names.
        if (pct >= 6) {
          valueLabels.push({
            text: `${share.toFixed(places)}%`,
            x: cx + Math.cos(mid) * labelR - 20,
            y: cy + Math.sin(mid) * labelR - LABEL_SIZE / 2,
            width: 40,
            align: 'center',
            fontSize: LABEL_SIZE,
          });
        }
      }
      angle += sweep;
    });
  }

  return {
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
        color: seriesColor({ name: '', values: [], color: spec.series[0]?.color }, i),
      }))
    : spec.series.map((s, i) => ({ label: s.name || `Series ${i + 1}`, color: seriesColor(s, i) }));

  if (entries.length === 0) return [];

  const GAP = 16;
  const out: ChartLegendEntry[] = [];
  let x = PAD;
  let y = height - PAD - LEGEND_SIZE;

  for (const e of entries) {
    const textWidth = measure(e.label, LEGEND_SIZE);
    const entryWidth = LEGEND_SWATCH + 5 + textWidth;

    if (x > PAD && x + entryWidth > width - PAD) {
      x = PAD;
      y -= LEGEND_SIZE + 5;
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

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}
