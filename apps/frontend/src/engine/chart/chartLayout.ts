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
  niceDomain,
  type Domain,
} from './scales';
import {
  isRadial,
  isStacked,
  normalizeSpec,
  resolveChartOptions,
  seriesColor,
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
  /** The resolved value-axis domain, exposed for tests and the panel. */
  domain: Domain;
}

const PAD = 14;
const TITLE_SIZE = 15;
const LABEL_SIZE = 11;
const LEGEND_SIZE = 11;
const LEGEND_SWATCH = 10;
const TICK_GAP = 6;

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
  const spec = normalizeSpec(rawSpec);
  const opts = resolveChartOptions(spec);

  const empty: ChartLayout = {
    plot: { x: 0, y: 0, width: 0, height: 0 },
    bars: [], runs: [], areas: [], dots: [], slices: [],
    gridLines: [], baseline: null,
    axisLabels: [], categoryLabels: [], valueLabels: [], legend: [],
    title: null,
    domain: [0, 1],
  };

  // A chart smaller than its own furniture draws nothing rather than drawing
  // it overlapping. Konva will happily render a negative-width rect.
  if (!(width > 40) || !(height > 40)) return empty;

  let top = PAD;
  let title: ChartLabel | null = null;

  if (spec.title) {
    title = {
      text: spec.title,
      x: PAD,
      y: top,
      width: width - PAD * 2,
      align: 'left',
      fontSize: TITLE_SIZE,
    };
    top += TITLE_SIZE + 10;
  }

  const legendHeight = opts.showLegend ? LEGEND_SIZE + 12 : 0;
  const bottomReserved = PAD + legendHeight;

  if (isRadial(spec.kind)) {
    return layoutRadial(spec, opts, width, height, top, bottomReserved, title, measure, empty);
  }

  return layoutCartesian(spec, opts, width, height, top, bottomReserved, title, measure, empty);
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
  const stacked = isStacked(spec.kind) && spec.kind === 'stackedBar';

  // ---- the value domain -------------------------------------------------
  // Stacked bars are measured against the *sum* at each category, not against
  // the tallest single series: an axis topping out at the largest component
  // would have every stack running off the top of the plot.
  const totals: number[] = [];
  for (let i = 0; i < spec.categories.length; i += 1) {
    if (stacked) {
      let sum = 0;
      let any = false;
      for (const s of spec.series) {
        const v = s.values[i];
        if (typeof v === 'number') { sum += v; any = true; }
      }
      if (any) totals.push(sum);
    } else {
      for (const s of spec.series) {
        const v = s.values[i];
        if (typeof v === 'number') totals.push(v);
      }
    }
  }

  const dataMin = totals.length ? Math.min(...totals) : 0;
  const dataMax = totals.length ? Math.max(...totals) : 1;

  const nice = niceDomain(
    spec.yMin ?? dataMin,
    spec.yMax ?? dataMax,
    5,
    opts.includeZero
  );
  // An explicit bound is honoured exactly — someone who typed 100 wants 100,
  // not the nearest round number above it.
  const domain: Domain = [spec.yMin ?? nice.domain[0], spec.yMax ?? nice.domain[1]];
  const ticks = nice.ticks.filter((t) => t >= domain[0] && t <= domain[1]);

  // ---- the gutters, measured ---------------------------------------------
  const tickTexts = ticks.map(formatTick);
  const gutterLeft =
    PAD + Math.max(...tickTexts.map((t) => measure(t, LABEL_SIZE)), 0) + TICK_GAP;

  const categoryBand = LABEL_SIZE + TICK_GAP;
  const plot: Rect = {
    x: gutterLeft,
    y: top,
    width: Math.max(1, width - gutterLeft - PAD),
    height: Math.max(1, height - top - bottomReserved - categoryBand),
  };

  if (plot.width < 8 || plot.height < 8) return { ...empty, title };

  const y = linearScale(domain, [plot.y + plot.height, plot.y]);
  const zeroY = y(clamp(0, domain[0], domain[1]));

  // ---- axis furniture -----------------------------------------------------
  const gridLines: ChartGridLine[] = [];
  const axisLabels: ChartLabel[] = [];

  ticks.forEach((t, i) => {
    const ty = y(t);
    if (opts.showGrid) {
      gridLines.push({ x1: plot.x, y1: ty, x2: plot.x + plot.width, y2: ty });
    }
    axisLabels.push({
      text: tickTexts[i],
      // Right-aligned into the gutter, so the digits line up against the plot
      // rather than ragging away from it.
      x: PAD,
      y: ty - LABEL_SIZE / 2,
      width: gutterLeft - PAD - TICK_GAP,
      align: 'right',
      fontSize: LABEL_SIZE,
    });
  });

  const baseline: ChartGridLine | null =
    domain[0] <= 0 && domain[1] >= 0
      ? { x1: plot.x, y1: zeroY, x2: plot.x + plot.width, y2: zeroY }
      : null;

  // ---- the marks ----------------------------------------------------------
  const bars: ChartBar[] = [];
  const runs: ChartRun[] = [];
  const areas: ChartArea[] = [];
  const dots: ChartDot[] = [];
  const valueLabels: ChartLabel[] = [];

  const isBar = spec.kind === 'bar' || spec.kind === 'stackedBar';
  const band = bandScale(spec.categories.length, [plot.x, plot.x + plot.width], isBar ? 0.28 : 0);

  const categoryLabels: ChartLabel[] = spec.categories.map((text, i) => ({
    text,
    x: band.centre(i) - band.step / 2,
    y: plot.y + plot.height + TICK_GAP,
    width: band.step,
    align: 'center',
    fontSize: LABEL_SIZE,
  }));

  if (isBar) {
    // Grouped bars share the band; stacked bars each take the whole of it.
    const lanes = stacked ? 1 : Math.max(1, spec.series.length);
    const laneWidth = band.bandWidth / lanes;
    const runningPos = new Array(spec.categories.length).fill(0);
    const runningNeg = new Array(spec.categories.length).fill(0);

    spec.series.forEach((s, si) => {
      const color = seriesColor(s, si);
      s.values.forEach((v, ci) => {
        if (typeof v !== 'number') return;

        let y0: number;
        let y1: number;
        if (stacked) {
          const base = v >= 0 ? runningPos[ci] : runningNeg[ci];
          const next = base + v;
          y0 = y(base);
          y1 = y(next);
          if (v >= 0) runningPos[ci] = next;
          else runningNeg[ci] = next;
        } else {
          y0 = zeroY;
          y1 = y(v);
        }

        const x = stacked ? band.at(ci) : band.at(ci) + si * laneWidth;
        const barTop = Math.min(y0, y1);
        const barHeight = Math.abs(y1 - y0);

        bars.push({
          x,
          y: barTop,
          width: stacked ? band.bandWidth : laneWidth,
          height: barHeight,
          color,
          seriesIndex: si,
          categoryIndex: ci,
          value: v,
          negative: v < 0,
        });

        if (opts.showValues) {
          valueLabels.push({
            text: formatTick(v),
            x,
            y: v >= 0 ? barTop - LABEL_SIZE - 2 : barTop + barHeight + 2,
            width: stacked ? band.bandWidth : laneWidth,
            align: 'center',
            fontSize: LABEL_SIZE,
          });
        }
      });
    });
  } else {
    // Lines, areas and scatter all place a point per category; they differ in
    // what is drawn through them.
    spec.series.forEach((s, si) => {
      const color = seriesColor(s, si);
      const segments: Point[][] = [];
      let current: Point[] = [];

      s.values.forEach((v, ci) => {
        if (typeof v !== 'number') {
          // A hole ends the run. Joining across it would draw a straight line
          // over missing data and present an outage as a smooth decline.
          if (current.length) segments.push(current);
          current = [];
          return;
        }
        const p = { x: band.centre(ci), y: y(v) };
        current.push(p);

        if (spec.kind === 'scatter') {
          dots.push({ ...p, radius: 4, color, seriesIndex: si, categoryIndex: ci, value: v });
        }
        if (opts.showValues) {
          valueLabels.push({
            text: formatTick(v),
            x: p.x - band.step / 2,
            y: p.y - LABEL_SIZE - 5,
            width: band.step,
            align: 'center',
            fontSize: LABEL_SIZE,
          });
        }
      });
      if (current.length) segments.push(current);

      for (const points of segments) {
        if (spec.kind === 'scatter') continue;
        runs.push({ points, color, seriesIndex: si });

        if (spec.kind === 'area' && points.length > 1) {
          areas.push({
            points,
            color,
            seriesIndex: si,
            polygon: [
              { x: points[0].x, y: zeroY },
              ...points,
              { x: points[points.length - 1].x, y: zeroY },
            ],
          });
        }
        if (spec.kind === 'line') {
          for (const p of points) {
            dots.push({
              ...p, radius: 3, color, seriesIndex: si,
              categoryIndex: -1, value: Number.NaN,
            });
          }
        }
      }
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
    domain,
  };
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
        const pct = Math.round((v / total) * 100);
        // Under about six per cent there is no room for the text inside the
        // slice, and a percentage sitting over its neighbour is worse than an
        // unlabelled sliver the legend already names.
        if (pct >= 6) {
          valueLabels.push({
            text: `${pct}%`,
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

  // A pie's legend names its categories; every other kind names its series.
  const entries = isRadial(spec.kind)
    ? spec.categories.map((label, i) => ({
        label,
        color: seriesColor({ name: '', values: [], color: spec.series[0]?.color }, i),
      }))
    : spec.series.map((s, i) => ({ label: s.name || `Series ${i + 1}`, color: seriesColor(s, i) }));

  if (entries.length === 0) return [];

  const GAP = 14;
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
