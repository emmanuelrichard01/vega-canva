import {
  buildLegend,
  buildReference,
  categoryLabelPlan,
  categoryLabelsFor,
  formatValue,
  LABEL_SIZE,
  PAD,
  TICK_GAP,
  type ChartArea,
  type ChartBar,
  type ChartColumn,
  type ChartDot,
  type ChartGridLine,
  type ChartLabel,
  type ChartLayout,
  type ChartRun,
  type Measure,
  type Point,
  type Rect,
} from './chartLayout';
import { bandScale, linearScale, niceDomain, type Domain } from './scales';
import { monotoneSplinePoints } from './monotoneSpline';
import { seriesColor, type ChartSpec, type ResolvedChartOptions, type SeriesMark } from './chartTypes';

/**
 * Bars, lines and areas together, on one or two value axes.
 *
 * Used for `bar`, `line` and `area` charts as soon as one series asks for a
 * different mark or for the right-hand axis (see `usesCombo`); otherwise those
 * kinds keep the ordinary cartesian layout, so nothing changes for a chart
 * that never asked for this.
 *
 * Each axis is scaled on its own series, with zero included whenever a bar or
 * an area reads against it, because a filled extent from a non-zero baseline
 * misstates the quantity. Grid lines follow the left axis only: two sets of
 * rules over one plot is a pattern nobody can read.
 */
export function layoutCombo(
  spec: ChartSpec,
  opts: ResolvedChartOptions,
  width: number,
  height: number,
  top: number,
  bottomReserved: number,
  title: ChartLabel | null,
  measure: Measure,
  empty: ChartLayout
): ChartLayout {
  const base = spec.kind as SeriesMark;
  const marks: SeriesMark[] = spec.series.map((s) => s.mark ?? base);
  const onRight = spec.series.map((s) => s.axis === 'right');
  const hasRight = onRight.some(Boolean);

  const sideValues = (right: boolean) => {
    const out: number[] = [];
    spec.series.forEach((s, i) => {
      if (onRight[i] !== right) return;
      for (const v of s.values) if (typeof v === 'number' && Number.isFinite(v)) out.push(v);
    });
    return out;
  };
  const filled = (right: boolean) => marks.some((m, i) => onRight[i] === right && m !== 'line');

  // The left axis also holds the annotations, as the single-axis layout does.
  const left = sideValues(false);
  if (spec.reference) left.push(spec.reference.value);
  if (spec.toleranceBand) left.push(spec.toleranceBand.min, spec.toleranceBand.max);
  const right = sideValues(true);

  const axisOf = (values: number[], zero: boolean, min?: number, max?: number) => {
    const lo = values.length ? Math.min(...values) : 0;
    const hi = values.length ? Math.max(...values) : 1;
    const nice = niceDomain(min ?? lo, max ?? hi, 5, zero || opts.includeZero);
    const domain: Domain = [min ?? nice.domain[0], max ?? nice.domain[1]];
    const ticks = nice.ticks.filter((t) => t >= domain[0] && t <= domain[1]);
    return { domain, ticks, texts: ticks.map((t) => formatValue(t, spec)) };
  };
  const leftAxis = axisOf(left, filled(false), spec.yMin, spec.yMax);
  const rightAxis = hasRight ? axisOf(right, filled(true)) : null;

  const widest = (texts: string[]) => Math.max(0, ...texts.map((t) => measure(t, LABEL_SIZE)));
  const gutterLeft = PAD + widest(leftAxis.texts) + TICK_GAP;
  const gutterRight = rightAxis ? TICK_GAP + widest(rightAxis.texts) + PAD : PAD;
  const plan = categoryLabelPlan(spec, spec.categories, Math.max(1, width - gutterLeft - gutterRight), height, measure);
  const bottomBand = LABEL_SIZE + TICK_GAP + plan.extra;

  const plot: Rect = {
    x: gutterLeft,
    y: top,
    width: Math.max(1, width - gutterLeft - gutterRight),
    height: Math.max(1, height - top - bottomReserved - bottomBand),
  };
  if (plot.width < 8 || plot.height < 8) return { ...empty, title };

  const yRange: Domain = [plot.y + plot.height, plot.y];
  const vLeft = linearScale(leftAxis.domain, yRange);
  const vRight = rightAxis ? linearScale(rightAxis.domain, yRange) : vLeft;
  const scaleOf = (si: number) => (onRight[si] ? vRight : vLeft);
  const domainOf = (si: number) => (onRight[si] && rightAxis ? rightAxis.domain : leftAxis.domain);
  const zeroOf = (si: number) => {
    const d = domainOf(si);
    return scaleOf(si)(Math.min(d[1], Math.max(d[0], 0)));
  };

  const barSeries = spec.series.map((_, i) => i).filter((i) => marks[i] === 'bar');
  const band = bandScale(spec.categories.length, [plot.x, plot.x + plot.width], barSeries.length ? 0.28 : 0);
  const laneWidth = band.bandWidth / Math.max(1, barSeries.length);

  const gridLines: ChartGridLine[] = [];
  const axisLabels: ChartLabel[] = [];
  leftAxis.ticks.forEach((t, i) => {
    const at = vLeft(t);
    if (opts.showGrid) gridLines.push({ x1: plot.x, y1: at, x2: plot.x + plot.width, y2: at });
    axisLabels.push({
      text: leftAxis.texts[i],
      x: PAD,
      y: at - LABEL_SIZE / 2,
      width: gutterLeft - PAD - TICK_GAP,
      align: 'right',
      fontSize: LABEL_SIZE,
    });
  });
  rightAxis?.ticks.forEach((t, i) => {
    const at = vRight(t);
    axisLabels.push({
      text: rightAxis.texts[i],
      x: plot.x + plot.width + TICK_GAP,
      y: at - LABEL_SIZE / 2,
      width: Math.max(1, gutterRight - TICK_GAP - PAD),
      align: 'left',
      fontSize: LABEL_SIZE,
    });
  });

  const leftZero = leftAxis.domain[0] <= 0 && leftAxis.domain[1] >= 0 ? vLeft(0) : null;
  const baseline: ChartGridLine | null =
    leftZero === null ? null : { x1: plot.x, y1: leftZero, x2: plot.x + plot.width, y2: leftZero };

  const bars: ChartBar[] = [];
  const runs: ChartRun[] = [];
  const areas: ChartArea[] = [];
  const dots: ChartDot[] = [];
  const valueLabels: ChartLabel[] = [];
  const columnBuild = new Map<number, ChartColumn>();

  const record = (ci: number, si: number, v: number, color: string, p: Point) => {
    const column = columnBuild.get(ci) ?? { x: band.centre(ci), y: p.y, categoryIndex: ci, entries: [] };
    column.entries.push({ seriesIndex: si, value: v, color, x: p.x, y: p.y });
    columnBuild.set(ci, column);
    if (opts.showValues) {
      valueLabels.push({
        text: formatValue(v, spec),
        x: p.x - band.step / 2,
        y: p.y - LABEL_SIZE - 4,
        width: band.step,
        align: 'center',
        fontSize: LABEL_SIZE,
      });
    }
  };

  // Areas first, bars over them, lines on top: the order that keeps every
  // series readable whatever its mark.
  const order = [
    ...spec.series.map((_, i) => i).filter((i) => marks[i] === 'area'),
    ...barSeries,
    ...spec.series.map((_, i) => i).filter((i) => marks[i] === 'line'),
  ];

  for (const si of order) {
    const s = spec.series[si];
    const color = seriesColor(s, si, opts.palette);
    const scale = scaleOf(si);
    const zero = zeroOf(si);

    if (marks[si] === 'bar') {
      const lane = barSeries.indexOf(si);
      s.values.forEach((v, ci) => {
        if (typeof v !== 'number') return;
        const y = scale(v);
        const x = band.at(ci) + lane * laneWidth;
        bars.push({
          x,
          y: Math.min(y, zero),
          width: laneWidth,
          height: Math.abs(zero - y),
          color,
          seriesIndex: si,
          categoryIndex: ci,
          value: v,
          negative: v < 0,
          cornerRadius: spec.cornerRadius,
        });
        record(ci, si, v, color, { x: x + laneWidth / 2, y });
      });
      continue;
    }

    const segments: Point[][] = [];
    let current: Point[] = [];
    s.values.forEach((v, ci) => {
      if (typeof v !== 'number') {
        if (current.length) segments.push(current);
        current = [];
        return;
      }
      const p = { x: band.centre(ci), y: scale(v) };
      current.push(p);
      record(ci, si, v, color, p);
    });
    if (current.length) segments.push(current);

    for (const points of segments) {
      const drawn = opts.curved ? monotoneSplinePoints(points, false) : points;
      runs.push({ points: drawn, color, seriesIndex: si, width: spec.lineWidth ?? 2 });
      if (marks[si] === 'area' && drawn.length > 1) {
        areas.push({
          points: drawn,
          color,
          seriesIndex: si,
          polygon: [...drawn, { x: drawn[drawn.length - 1].x, y: zero }, { x: drawn[0].x, y: zero }],
          gradient: spec.gradient,
        });
      }
      if (marks[si] === 'line' && spec.markerShape !== 'none') {
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
  }

  return {
    ...empty,
    plot,
    bars,
    runs,
    areas,
    dots,
    gridLines,
    baseline,
    zeroRule: null,
    axisLabels,
    categoryLabels: categoryLabelsFor(spec.categories, plan, band, plot.y + plot.height + TICK_GAP, measure),
    valueLabels,
    legend: buildLegend(spec, opts, width, height, measure),
    columns: [...columnBuild.values()].sort((a, b) => a.categoryIndex - b.categoryIndex),
    categoryAxis: 'x',
    title,
    reference: buildReference(spec, leftAxis.domain, plot, vLeft, false, measure),
    domain: leftAxis.domain,
    ...(rightAxis ? { rightDomain: rightAxis.domain } : {}),
  };
}
