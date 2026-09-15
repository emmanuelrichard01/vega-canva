import { bandScale, linearScale, niceDomain, type Domain } from './scales';
import { rampColorAt } from './colorRamps';
import { seriesColor, type ChartSpec, type ResolvedChartOptions } from './chartTypes';
import {
  PAD,
  LABEL_SIZE,
  TICK_GAP,
  buildLegend,
  buildReference,
  formatValue,
  type ChartBar,
  type ChartColorBar,
  type ChartColumn,
  type ChartDot,
  type ChartGridLine,
  type ChartLabel,
  type ChartLayout,
  type ChartArea,
  type ChartRun,
  type Measure,
  type Point,
  type Rect,
} from './chartLayout';

/**
 * The kinds that are neither a category axis nor a formula.
 *
 * Box plots and density plots summarise raw samples; a treemap nests parts of
 * a whole; a network draws relationships; a timeline places spans on a time
 * axis; a heat table paints a value into every cell of a grid.
 *
 * ## Same primitives, same painters
 *
 * Every one of them is expressed in the primitives `chartLayout.ts` already
 * emits — bars, runs, areas, dots and labels — so the Konva renderer, the SVG
 * exporter, the hover test and the sketch pen all draw them without learning
 * anything new. A box is a translucent bar with an outline run; a whisker is
 * a run; an edge is a run and a node is a dot; a tile and a cell are bars.
 * That is the rule the whole engine is built on: one layout, two painters, and
 * neither doing arithmetic.
 *
 * They live in their own file because `chartLayout.ts` is already the length
 * of a small book, and these six share nothing with the cartesian machinery
 * beyond a few helpers it exports.
 */

type Options = ResolvedChartOptions;

const finite = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

const clampTo = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Linear-interpolated quantile — the definition spreadsheets use. */
function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Each series as one group of samples, sorted, with its resolved colour. */
function groupsOf(spec: ChartSpec, opts: Options) {
  return spec.series
    .map((s, i) => ({
      name: s.name || `Group ${i + 1}`,
      color: seriesColor(s, i, opts.palette),
      index: i,
      values: s.values.filter(finite).sort((a, b) => a - b),
    }))
    .filter((g) => g.values.length > 0);
}

/** A string cut to a width, with an ellipsis where it was cut. */
function fit(text: string, room: number, fontSize: number, measure: Measure): string {
  if (room <= 0) return '';
  if (measure(text, fontSize) <= room) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(text.slice(0, mid) + '…', fontSize) <= room) lo = mid;
    else hi = mid - 1;
  }
  return lo <= 0 ? '' : text.slice(0, lo).trimEnd() + '…';
}

/** The labels down a vertical value axis, right-aligned to the gutter. */
function valueTicks(ticks: number[], y: (v: number) => number, spec: ChartSpec, gutterRight: number): ChartLabel[] {
  return ticks.map((t) => ({
    text: formatValue(t, spec),
    x: PAD,
    y: y(t) - LABEL_SIZE / 2,
    width: Math.max(1, gutterRight - PAD - TICK_GAP),
    align: 'right' as const,
    fontSize: LABEL_SIZE,
  }));
}

/** The labels along a horizontal axis, kept inside the chart at the ends. */
function axisTicksX(
  ticks: number[],
  x: (v: number) => number,
  spec: ChartSpec,
  y: number,
  width: number
): ChartLabel[] {
  const W = 64;
  return ticks.map((t) => ({
    text: formatValue(t, spec),
    x: clampTo(x(t) - W / 2, 0, Math.max(0, width - W)),
    y,
    width: W,
    align: 'center' as const,
    fontSize: LABEL_SIZE,
  }));
}

// ---------------------------------------------------------------------------
// Box plot
// ---------------------------------------------------------------------------

/**
 * One box per group: quartiles, median, Tukey whiskers, outliers and mean.
 *
 * Whiskers reach the furthest reading within 1.5 × IQR of the box, which is
 * the convention every statistics package shares; readings past that are
 * drawn as rings rather than silently folded into the whisker. The mean is a
 * small square beside the median line, because the distance between the two
 * is the skew, and that is the thing a box plot is usually opened to see.
 */
export function layoutBoxPlot(
  spec: ChartSpec,
  opts: Options,
  width: number,
  height: number,
  top: number,
  bottomReserved: number,
  title: ChartLabel | null,
  measure: Measure,
  empty: ChartLayout
): ChartLayout {
  const groups = groupsOf(spec, opts);
  if (groups.length === 0) return { ...empty, title };

  const stats = groups.map((g) => {
    const v = g.values;
    const q1 = quantile(v, 0.25);
    const median = quantile(v, 0.5);
    const q3 = quantile(v, 0.75);
    const iqr = q3 - q1;
    const loFence = q1 - 1.5 * iqr;
    const hiFence = q3 + 1.5 * iqr;
    const inside = v.filter((x) => x >= loFence && x <= hiFence);
    return {
      ...g,
      q1,
      median,
      q3,
      whiskerLo: inside.length ? inside[0] : v[0],
      whiskerHi: inside.length ? inside[inside.length - 1] : v[v.length - 1],
      outliers: v.filter((x) => x < loFence || x > hiFence),
      mean: v.reduce((a, b) => a + b, 0) / v.length,
    };
  });

  let lo = Math.min(...stats.map((s) => s.values[0]));
  let hi = Math.max(...stats.map((s) => s.values[s.values.length - 1]));
  // The axis reaches any annotation, so a target above every reading is still
  // on the chart rather than silently off it.
  if (spec.reference && finite(spec.reference.value)) {
    lo = Math.min(lo, spec.reference.value);
    hi = Math.max(hi, spec.reference.value);
  }
  if (spec.toleranceBand) {
    lo = Math.min(lo, spec.toleranceBand.min, spec.toleranceBand.max);
    hi = Math.max(hi, spec.toleranceBand.min, spec.toleranceBand.max);
  }

  const nice = niceDomain(spec.yMin ?? lo, spec.yMax ?? hi, 5, opts.includeZero);
  const domain: Domain = [spec.yMin ?? nice.domain[0], spec.yMax ?? nice.domain[1]];
  const ticks = nice.ticks.filter((t) => t >= domain[0] - 1e-9 && t <= domain[1] + 1e-9);
  const texts = ticks.map((t) => formatValue(t, spec));
  const gutterLeft = PAD + Math.max(0, ...texts.map((t) => measure(t, LABEL_SIZE))) + TICK_GAP;
  const bottomBand = LABEL_SIZE + TICK_GAP + 2;

  const plot: Rect = {
    x: gutterLeft,
    y: top,
    width: Math.max(1, width - gutterLeft - PAD),
    height: Math.max(1, height - top - bottomReserved - bottomBand),
  };
  if (plot.width < 8 || plot.height < 8) return { ...empty, title };

  const y = linearScale(domain, [plot.y + plot.height, plot.y]);
  const inPlot = (v: number) => clampTo(y(v), plot.y, plot.y + plot.height);
  const band = bandScale(stats.length, [plot.x, plot.x + plot.width], stats.length === 1 ? 0.6 : 0.42);

  const bars: ChartBar[] = [];
  const runs: ChartRun[] = [];
  const dots: ChartDot[] = [];
  const columns: ChartColumn[] = [];
  const categoryLabels: ChartLabel[] = [];

  stats.forEach((s, i) => {
    // Capped, so two groups on a wide chart are two boxes and not two walls.
    const w = Math.min(band.bandWidth, 96);
    const bx = band.at(i) + (band.bandWidth - w) / 2;
    const cx = bx + w / 2;
    const yq1 = inPlot(s.q1);
    const yq3 = inPlot(s.q3);
    const ym = inPlot(s.median);
    const yhi = inPlot(s.whiskerHi);
    const ylo = inPlot(s.whiskerLo);
    const cap = w * 0.28;
    const run = (points: Point[], extra: Partial<ChartRun> = {}): ChartRun => ({
      points,
      color: s.color,
      seriesIndex: s.index,
      width: 1.5,
      ...extra,
    });

    bars.push({
      x: bx,
      y: yq3,
      width: w,
      height: Math.max(1, yq1 - yq3),
      color: s.color,
      seriesIndex: s.index,
      categoryIndex: i,
      value: s.median,
      negative: false,
      cornerRadius: spec.cornerRadius ?? 3,
      opacity: 0.24,
    });
    runs.push(
      run([
        { x: bx, y: yq3 },
        { x: bx + w, y: yq3 },
        { x: bx + w, y: yq1 },
        { x: bx, y: yq1 },
        { x: bx, y: yq3 },
      ]),
      run([{ x: bx, y: ym }, { x: bx + w, y: ym }], { width: 2.75 }),
      run([{ x: cx, y: yq3 }, { x: cx, y: yhi }]),
      run([{ x: cx - cap, y: yhi }, { x: cx + cap, y: yhi }]),
      run([{ x: cx, y: yq1 }, { x: cx, y: ylo }]),
      run([{ x: cx - cap, y: ylo }, { x: cx + cap, y: ylo }])
    );

    for (const o of s.outliers) {
      const oy = y(o);
      if (oy < plot.y - 0.5 || oy > plot.y + plot.height + 0.5) continue;
      dots.push({ x: cx, y: oy, radius: 3, color: s.color, seriesIndex: s.index, categoryIndex: i, value: o, shape: 'ring' });
    }
    const my = y(s.mean);
    if (my >= plot.y && my <= plot.y + plot.height) {
      dots.push({
        x: cx + w * 0.3,
        y: my,
        radius: 2.5,
        color: s.color,
        seriesIndex: s.index,
        categoryIndex: i,
        value: s.mean,
        shape: 'square',
      });
    }

    columns.push({
      x: cx,
      y: ym,
      categoryIndex: i,
      entries: [{ seriesIndex: s.index, value: s.median, color: s.color, x: cx, y: ym }],
    });
    categoryLabels.push({
      text: fit(s.name, band.step - 4, LABEL_SIZE, measure),
      x: band.at(i) - (band.step - band.bandWidth) / 2,
      y: plot.y + plot.height + TICK_GAP,
      width: band.step,
      align: 'center',
      fontSize: LABEL_SIZE,
    });
  });

  const gridLines: ChartGridLine[] = opts.showGrid
    ? ticks.map((t) => ({ x1: plot.x, y1: y(t), x2: plot.x + plot.width, y2: y(t) }))
    : [];

  return {
    ...empty,
    plot,
    bars,
    runs,
    dots,
    columns,
    gridLines,
    baseline: { x1: plot.x, y1: plot.y + plot.height, x2: plot.x + plot.width, y2: plot.y + plot.height },
    axisLabels: valueTicks(ticks, y, spec, gutterLeft),
    categoryLabels,
    legend: buildLegend(spec, opts, width, height, measure),
    title,
    reference: buildReference(spec, domain, plot, y, false, measure),
    domain,
    categoryAxis: 'x',
  };
}

// ---------------------------------------------------------------------------
// Density
// ---------------------------------------------------------------------------

/**
 * Each group's distribution as a smooth curve: a Gaussian kernel density.
 *
 * Bandwidth is Silverman's rule of thumb per group, so a tight cluster and a
 * wide one are each smoothed by an amount that suits them — one bandwidth for
 * both would either over-smooth the tight one into a hump or leave the wide
 * one as noise. The mean is a dashed rule under each curve, and a short rug
 * of the raw readings sits on the baseline while there are few enough of them
 * to be read individually.
 */
export function layoutDensity(
  spec: ChartSpec,
  opts: Options,
  width: number,
  height: number,
  top: number,
  bottomReserved: number,
  title: ChartLabel | null,
  measure: Measure,
  empty: ChartLayout
): ChartLayout {
  const groups = groupsOf(spec, opts);
  if (groups.length === 0) return { ...empty, title };

  const all = groups.flatMap((g) => g.values);
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const span = hi - lo || Math.abs(hi) || 1;

  const bandwidthOf = (v: number[]) => {
    const n = v.length;
    const mean = v.reduce((a, b) => a + b, 0) / n;
    const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n - 1));
    return Math.max(1.06 * (sd || span / 6) * Math.pow(n, -0.2), span / 200);
  };
  const bandwidths = groups.map((g) => bandwidthOf(g.values));
  const reach = Math.max(...bandwidths) * 2.5;
  const nice = niceDomain(lo - reach, hi + reach, 6, false);
  const domain = nice.domain;
  const ticks = nice.ticks;

  const bottomBand = LABEL_SIZE + TICK_GAP + 2;
  const plot: Rect = {
    x: PAD,
    y: top,
    width: Math.max(1, width - PAD * 2),
    height: Math.max(1, height - top - bottomReserved - bottomBand),
  };
  if (plot.width < 8 || plot.height < 8) return { ...empty, title };

  const x = linearScale(domain, [plot.x, plot.x + plot.width]);
  const STEPS = 120;
  const densityAt = (values: number[], h: number, xv: number) => {
    let s = 0;
    for (const v of values) {
      const u = (xv - v) / h;
      s += Math.exp(-0.5 * u * u);
    }
    return s / (values.length * h * Math.sqrt(2 * Math.PI));
  };
  const curves = groups.map((g, gi) => ({
    g,
    h: bandwidths[gi],
    pts: Array.from({ length: STEPS + 1 }, (_, k) => {
      const xv = domain[0] + (k / STEPS) * (domain[1] - domain[0]);
      return { xv, d: densityAt(g.values, bandwidths[gi], xv) };
    }),
  }));
  const maxD = Math.max(...curves.flatMap((c) => c.pts.map((p) => p.d))) || 1;
  const y = linearScale([0, maxD * 1.08], [plot.y + plot.height, plot.y]);
  const baseY = plot.y + plot.height;

  const runs: ChartRun[] = [];
  const areas: ChartArea[] = [];

  for (const { g, h, pts } of curves) {
    const points = pts.map((p) => ({ x: x(p.xv), y: y(p.d) }));
    areas.push({
      points,
      polygon: [{ x: points[0].x, y: baseY }, ...points, { x: points[points.length - 1].x, y: baseY }],
      color: g.color,
      seriesIndex: g.index,
      gradient: false,
    });
    runs.push({ points, color: g.color, seriesIndex: g.index, width: 2.25 });

    const mean = g.values.reduce((a, b) => a + b, 0) / g.values.length;
    runs.push({
      points: [
        { x: x(mean), y: baseY },
        { x: x(mean), y: y(densityAt(g.values, h, mean)) },
      ],
      color: g.color,
      seriesIndex: g.index,
      width: 1.25,
      style: 'dashed',
    });

    if (g.values.length <= 80) {
      for (const v of g.values) {
        runs.push({
          points: [{ x: x(v), y: baseY }, { x: x(v), y: baseY - 6 }],
          color: g.color,
          seriesIndex: g.index,
          width: 1,
          opacity: 0.55,
        });
      }
    }
  }

  return {
    ...empty,
    plot,
    runs,
    areas,
    gridLines: opts.showGrid ? ticks.map((t) => ({ x1: x(t), y1: plot.y, x2: x(t), y2: baseY })) : [],
    baseline: { x1: plot.x, y1: baseY, x2: plot.x + plot.width, y2: baseY },
    axisLabels: axisTicksX(ticks, x, spec, baseY + TICK_GAP, width),
    legend: buildLegend(spec, opts, width, height, measure),
    title,
    domain,
    categoryAxis: 'x',
  };
}

// ---------------------------------------------------------------------------
// Treemap
// ---------------------------------------------------------------------------

interface Tile {
  x: number;
  y: number;
  w: number;
  h: number;
  index: number;
  value: number;
  name: string;
}

/**
 * Squarified tiling (Bruls, Huizing and van Wijk).
 *
 * Rows are grown while each addition makes the row's worst aspect ratio
 * better, and closed the moment it would make it worse — which is what keeps
 * tiles near-square and therefore comparable by eye. A slice-and-dice layout
 * is simpler and produces slivers, and a sliver's area cannot be judged.
 */
function squarify(items: Array<{ value: number; index: number; name: string }>, rect: Rect): Tile[] {
  const total = items.reduce((a, b) => a + b.value, 0);
  if (total <= 0) return [];
  const scale = (rect.width * rect.height) / total;
  const queue = items.map((it) => ({ ...it, area: it.value * scale }));
  const out: Tile[] = [];
  let r = { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
  let row: typeof queue = [];

  const worst = (list: typeof queue, side: number) => {
    const s = list.reduce((a, b) => a + b.area, 0);
    const max = Math.max(...list.map((t) => t.area));
    const min = Math.min(...list.map((t) => t.area));
    return Math.max((side * side * max) / (s * s), (s * s) / (side * side * min));
  };

  const place = (list: typeof queue) => {
    const s = list.reduce((a, b) => a + b.area, 0);
    if (r.w >= r.h) {
      const colW = s / r.h;
      let yy = r.y;
      for (const t of list) {
        const th = t.area / colW;
        out.push({ x: r.x, y: yy, w: colW, h: th, index: t.index, value: t.value, name: t.name });
        yy += th;
      }
      r = { x: r.x + colW, y: r.y, w: r.w - colW, h: r.h };
    } else {
      const rowH = s / r.w;
      let xx = r.x;
      for (const t of list) {
        const tw = t.area / rowH;
        out.push({ x: xx, y: r.y, w: tw, h: rowH, index: t.index, value: t.value, name: t.name });
        xx += tw;
      }
      r = { x: r.x, y: r.y + rowH, w: r.w, h: r.h - rowH };
    }
  };

  let i = 0;
  while (i < queue.length) {
    const side = Math.max(1e-6, Math.min(r.w, r.h));
    const next = queue[i];
    if (row.length === 0 || worst([...row, next], side) <= worst(row, side)) {
      row.push(next);
      i += 1;
    } else {
      place(row);
      row = [];
    }
  }
  if (row.length) place(row);
  return out;
}

export function layoutTreemap(
  spec: ChartSpec,
  opts: Options,
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

  const s0 = spec.series[0];
  // Only positive values have an area; a negative share is not drawn as a
  // positive tile, which would state something false.
  const items = spec.categories
    .map((name, index) => {
      const v = s0?.values[index];
      return { name: name || `Item ${index + 1}`, index, value: finite(v) && v > 0 ? v : 0 };
    })
    .filter((it) => it.value > 0)
    .sort((a, b) => b.value - a.value);
  const total = items.reduce((a, b) => a + b.value, 0);

  const bars: ChartBar[] = [];
  const categoryLabels: ChartLabel[] = [];
  const valueLabels: ChartLabel[] = [];
  const GAP = 2;

  for (const t of squarify(items, plot)) {
    const color = seriesColor({ name: '', values: [], color: s0?.color }, t.index, opts.palette);
    const rx = t.x + GAP / 2;
    const ry = t.y + GAP / 2;
    const rw = Math.max(0, t.w - GAP);
    const rh = Math.max(0, t.h - GAP);
    bars.push({
      x: rx,
      y: ry,
      width: rw,
      height: rh,
      color,
      seriesIndex: 0,
      categoryIndex: t.index,
      value: t.value,
      negative: false,
      cornerRadius: spec.cornerRadius ?? 4,
    });

    // Type scales with the tile, within limits: a tile's name is the thing
    // read first, and the largest tile is the one most worth reading.
    const fs = Math.round(clampTo(Math.sqrt(rw * rh) / 8, 10, 15));
    if (rw > 36 && rh > fs + 12) {
      categoryLabels.push({
        text: fit(t.name, rw - 16, fs, measure),
        x: rx + 8,
        y: ry + 7,
        width: rw - 16,
        align: 'left',
        fontSize: fs,
        on: color,
      });
    }
    if (opts.showValues && rw > 36 && rh > fs * 2 + 18) {
      const share = `${((t.value / total) * 100).toFixed(Math.min(3, Math.max(0, spec.decimals ?? 0)))}%`;
      const text =
        spec.valueFormat === 'percent'
          ? share
          : spec.valueFormat === 'both'
            ? `${formatValue(t.value, spec)} · ${share}`
            : formatValue(t.value, spec);
      valueLabels.push({
        text: fit(text, rw - 16, Math.max(10, fs - 2), measure),
        x: rx + 8,
        y: ry + 7 + fs + 4,
        width: rw - 16,
        align: 'left',
        fontSize: Math.max(10, fs - 2),
        on: color,
      });
    }
  }

  return {
    ...empty,
    plot,
    bars,
    categoryLabels,
    valueLabels,
    legend: buildLegend(spec, opts, width, height, measure),
    title,
    domain: [0, total || 1],
    categoryAxis: 'x',
  };
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

/**
 * Nodes and weighted links, laid out by force.
 *
 * Fruchterman–Reingold from a circle, fully deterministic: no random start, a
 * fixed number of cooling steps. The same table always draws the same graph —
 * which on a shared board matters more than a marginally better layout, since
 * two collaborators must see one picture, and a chart that reshuffles on every
 * redraw cannot be annotated.
 *
 * The data is an adjacency table: row *i*, column *j* is the weight of the
 * link between them, read symmetrically (the larger of the two directions),
 * so it pastes from any matrix and edits in the ordinary sheet. A node's size
 * is its weighted degree — how connected it is — and a link's weight is its
 * thickness.
 */
export function layoutNetwork(
  spec: ChartSpec,
  opts: Options,
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
  const n = spec.categories.length;
  if (n === 0 || plot.width < 8 || plot.height < 8) return { ...empty, title };

  const cell = (i: number, j: number) => {
    const v = spec.series[i]?.values[j];
    return finite(v) ? Math.abs(v) : 0;
  };
  const edges: Array<{ i: number; j: number; w: number }> = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const w = Math.max(cell(i, j), cell(j, i));
      if (w > 0) edges.push({ i, j, w });
    }
  }
  const maxW = Math.max(1e-9, ...edges.map((e) => e.w));

  // Positions in a unit square, starting on a circle.
  const pos = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    return { x: 0.5 + 0.35 * Math.cos(a), y: 0.5 + 0.35 * Math.sin(a) };
  });
  if (n > 2) {
    const k = Math.sqrt(1 / n) * 0.9;
    const ITER = 220;
    for (let it = 0; it < ITER; it++) {
      const temp = 0.08 * (1 - it / ITER) + 0.002;
      const disp = pos.map(() => ({ x: 0, y: 0 }));
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const dx = pos[i].x - pos[j].x;
          const dy = pos[i].y - pos[j].y;
          const d = Math.max(0.01, Math.hypot(dx, dy));
          const f = (k * k) / d;
          disp[i].x += (dx / d) * f;
          disp[i].y += (dy / d) * f;
          disp[j].x -= (dx / d) * f;
          disp[j].y -= (dy / d) * f;
        }
      }
      for (const e of edges) {
        const dx = pos[e.i].x - pos[e.j].x;
        const dy = pos[e.i].y - pos[e.j].y;
        const d = Math.max(0.01, Math.hypot(dx, dy));
        const f = ((d * d) / k) * (0.4 + 0.6 * (e.w / maxW));
        disp[e.i].x -= (dx / d) * f;
        disp[e.i].y -= (dy / d) * f;
        disp[e.j].x += (dx / d) * f;
        disp[e.j].y += (dy / d) * f;
      }
      for (let i = 0; i < n; i++) {
        // A gentle pull to the centre, so a disconnected node does not drift
        // off and leave the rest of the graph squeezed into a corner.
        disp[i].x += (0.5 - pos[i].x) * 0.5;
        disp[i].y += (0.5 - pos[i].y) * 0.5;
        const len = Math.max(1e-9, Math.hypot(disp[i].x, disp[i].y));
        const step = Math.min(len, temp);
        pos[i].x += (disp[i].x / len) * step;
        pos[i].y += (disp[i].y / len) * step;
      }
    }
  }

  const degree = Array.from({ length: n }, (_, i) =>
    edges.reduce((sum, e) => sum + (e.i === i || e.j === i ? e.w : 0), 0)
  );
  const maxDeg = Math.max(0, ...degree);
  const radius = degree.map((d) => (maxDeg > 0 ? 6 + 11 * Math.sqrt(d / maxDeg) : 8));
  const maxR = Math.max(...radius);

  // Fit the graph into the plot, leaving room for the largest node and the
  // names under the nodes.
  const xs = pos.map((p) => p.x);
  const ys = pos.map((p) => p.y);
  const bx = Math.min(...xs);
  const by = Math.min(...ys);
  const bw = Math.max(1e-6, Math.max(...xs) - bx);
  const bh = Math.max(1e-6, Math.max(...ys) - by);
  const mx = maxR + 4;
  const myTop = maxR + 4;
  const myBottom = maxR + LABEL_SIZE + 8;
  const availW = Math.max(1, plot.width - mx * 2);
  const availH = Math.max(1, plot.height - myTop - myBottom);
  const s = n === 1 ? 0 : Math.min(availW / bw, availH / bh);
  const offX = plot.x + mx + (availW - bw * s) / 2;
  const offY = plot.y + myTop + (availH - bh * s) / 2;
  const P = pos.map((p) => (n === 1
    ? { x: plot.x + plot.width / 2, y: plot.y + plot.height / 2 }
    : { x: offX + (p.x - bx) * s, y: offY + (p.y - by) * s }));

  const colorOf = (i: number) => seriesColor({ name: '', values: [], color: spec.series[i]?.color }, i, opts.palette);
  const inside = (p: Point) => ({
    x: clampTo(p.x, plot.x, plot.x + plot.width),
    y: clampTo(p.y, plot.y, plot.y + plot.height),
  });

  const runs: ChartRun[] = edges.map((e) => {
    const a = P[e.i];
    const b = P[e.j];
    const len = Math.max(1e-6, Math.hypot(b.x - a.x, b.y - a.y));
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    const start = { x: a.x + ux * radius[e.i], y: a.y + uy * radius[e.i] };
    const end = { x: b.x - ux * radius[e.j], y: b.y - uy * radius[e.j] };
    let points: Point[] = [start, end];
    if (spec.curved) {
      // A quadratic bend off the straight line, sampled: curved links read as
      // relationships rather than as a wiring diagram, and cross less.
      const c = { x: (a.x + b.x) / 2 - uy * len * 0.18, y: (a.y + b.y) / 2 + ux * len * 0.18 };
      points = Array.from({ length: 17 }, (_, k) => {
        const t = k / 16;
        const q = 1 - t;
        return inside({
          x: q * q * start.x + 2 * q * t * c.x + t * t * end.x,
          y: q * q * start.y + 2 * q * t * c.y + t * t * end.y,
        });
      });
    }
    return {
      points,
      color: colorOf(e.i),
      seriesIndex: e.i,
      width: 1 + 3 * (e.w / maxW),
      opacity: 0.5,
    };
  });

  const dots: ChartDot[] = P.map((p, i) => ({
    x: p.x,
    y: p.y,
    radius: radius[i],
    color: colorOf(i),
    seriesIndex: i,
    categoryIndex: i,
    value: degree[i],
    shape: 'circle',
  }));

  const LW = 104;
  const categoryLabels: ChartLabel[] = P.map((p, i) => ({
    text: fit(spec.categories[i] || `Node ${i + 1}`, LW, 10, measure),
    x: clampTo(p.x - LW / 2, 0, Math.max(0, width - LW)),
    y: Math.min(p.y + radius[i] + 3, height - 12),
    width: LW,
    align: 'center',
    fontSize: 10,
  }));

  return {
    ...empty,
    plot,
    runs,
    dots,
    categoryLabels,
    legend: buildLegend(spec, opts, width, height, measure),
    title,
    domain: [0, maxDeg || 1],
    categoryAxis: 'x',
  };
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

/**
 * Spans on a shared time axis: one row per item, start to end.
 *
 * The first series is the start and the second the end, so a timeline is the
 * same two-column table a Gantt export or a project sheet already is. A row
 * with no end is a milestone and is drawn as a point rather than as a bar of
 * zero width. The reference line runs *down* the chart here — a "today" —
 * because time is the horizontal axis.
 */
export function layoutTimeline(
  spec: ChartSpec,
  opts: Options,
  width: number,
  height: number,
  top: number,
  bottomReserved: number,
  title: ChartLabel | null,
  measure: Measure,
  empty: ChartLayout
): ChartLayout {
  const start = spec.series[0]?.values ?? [];
  const end = spec.series[1]?.values ?? [];
  const rows = spec.categories.map((name, i) => ({
    name: name || `Item ${i + 1}`,
    i,
    start: start[i],
    end: end[i],
  }));
  const known = rows.filter((r) => finite(r.start));
  if (known.length === 0) return { ...empty, title };

  const values = known.flatMap((r) => (finite(r.end) ? [r.start as number, r.end] : [r.start as number]));
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (spec.reference && finite(spec.reference.value)) {
    lo = Math.min(lo, spec.reference.value);
    hi = Math.max(hi, spec.reference.value);
  }
  if (hi === lo) hi = lo + 1;
  const nice = niceDomain(lo, hi, 6, false);
  const domain = nice.domain;

  const nameW = Math.min(width * 0.32, Math.max(0, ...rows.map((r) => measure(r.name, LABEL_SIZE))));
  const gutterLeft = PAD + nameW + TICK_GAP;
  const bottomBand = LABEL_SIZE + TICK_GAP + 2;
  const plot: Rect = {
    x: gutterLeft,
    y: top,
    width: Math.max(1, width - gutterLeft - PAD),
    height: Math.max(1, height - top - bottomReserved - bottomBand),
  };
  if (plot.width < 8 || plot.height < 8) return { ...empty, title };

  const x = linearScale(domain, [plot.x, plot.x + plot.width]);
  const inX = (v: number) => clampTo(x(v), plot.x, plot.x + plot.width);
  const band = bandScale(rows.length, [plot.y, plot.y + plot.height], 0.34);

  const bars: ChartBar[] = [];
  const dots: ChartDot[] = [];
  const columns: ChartColumn[] = [];
  const categoryLabels: ChartLabel[] = [];
  const valueLabels: ChartLabel[] = [];

  rows.forEach((r, i) => {
    const color = seriesColor({ name: '', values: [], color: spec.series[0]?.color }, r.i, opts.palette);
    const y0 = band.at(i);
    const h = Math.min(band.bandWidth, 34);
    const yc = y0 + band.bandWidth / 2;
    categoryLabels.push({
      text: fit(r.name, nameW, LABEL_SIZE, measure),
      x: PAD,
      y: yc - LABEL_SIZE / 2,
      width: nameW,
      align: 'right',
      fontSize: LABEL_SIZE,
    });
    if (!finite(r.start)) return;

    let rightEdge: number;
    if (finite(r.end) && r.end !== r.start) {
      const a = inX(Math.min(r.start, r.end));
      const b = inX(Math.max(r.start, r.end));
      bars.push({
        x: a,
        y: yc - h / 2,
        width: Math.max(2, b - a),
        height: h,
        color,
        seriesIndex: 0,
        categoryIndex: r.i,
        value: Math.abs(r.end - r.start),
        negative: false,
        cornerRadius: spec.cornerRadius ?? Math.min(6, h / 2),
      });
      rightEdge = b;
    } else {
      dots.push({
        x: inX(r.start),
        y: yc,
        radius: Math.max(4, Math.min(8, h / 2.4)),
        color,
        seriesIndex: 0,
        categoryIndex: r.i,
        value: r.start,
        shape: 'square',
      });
      rightEdge = inX(r.start) + 8;
    }

    columns.push({
      x: inX(r.start),
      y: yc,
      categoryIndex: r.i,
      entries: [{ seriesIndex: 0, value: r.start, color, x: inX(r.start), y: yc }],
    });

    if (opts.showValues) {
      const text = finite(r.end) ? `${formatValue(r.start, spec)}–${formatValue(r.end, spec)}` : formatValue(r.start, spec);
      const w = measure(text, LABEL_SIZE) + 4;
      const fitsOutside = rightEdge + 6 + w <= plot.x + plot.width;
      valueLabels.push({
        text,
        x: fitsOutside ? rightEdge + 6 : Math.max(plot.x, rightEdge - w - 6),
        y: yc - LABEL_SIZE / 2,
        width: w,
        align: 'left',
        fontSize: LABEL_SIZE,
        on: fitsOutside ? undefined : color,
      });
    }
  });

  return {
    ...empty,
    plot,
    bars,
    dots,
    columns,
    gridLines: opts.showGrid
      ? nice.ticks.map((t) => ({ x1: x(t), y1: plot.y, x2: x(t), y2: plot.y + plot.height }))
      : [],
    baseline: { x1: plot.x, y1: plot.y + plot.height, x2: plot.x + plot.width, y2: plot.y + plot.height },
    axisLabels: axisTicksX(nice.ticks, x, spec, plot.y + plot.height + TICK_GAP, width),
    categoryLabels,
    valueLabels,
    legend: buildLegend(spec, opts, width, height, measure),
    title,
    reference: buildReference(spec, domain, plot, x, true, measure),
    domain,
    categoryAxis: 'y',
  };
}

// ---------------------------------------------------------------------------
// Heat table
// ---------------------------------------------------------------------------

/**
 * A value in every cell of a rows × columns grid, painted on a ramp.
 *
 * Rows are the categories and columns are the series — the table as it is
 * typed, drawn as it is read. The ramp and its direction are the surface
 * map's, from `colorRamps`, so the two heat views share one colour language
 * and one colour bar.
 */
export function layoutMatrix(
  spec: ChartSpec,
  opts: Options,
  width: number,
  height: number,
  top: number,
  bottomReserved: number,
  title: ChartLabel | null,
  measure: Measure,
  empty: ChartLayout
): ChartLayout {
  const rows = spec.categories.length;
  const cols = spec.series.length;
  if (rows === 0 || cols === 0) return { ...empty, title };

  const values = spec.series.flatMap((s) => s.values.filter(finite));
  if (values.length === 0) return { ...empty, title };
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;

  const nameW = Math.min(width * 0.28, Math.max(0, ...spec.categories.map((c) => measure(c, LABEL_SIZE))));
  const gutterLeft = PAD + nameW + TICK_GAP;
  const headBand = LABEL_SIZE + TICK_GAP;

  // The colour bar's own gutter, reserved only when it is shown.
  const barTexts = [hi, (lo + hi) / 2, lo].map((v) => formatValue(v, spec));
  const barTextW = Math.max(...barTexts.map((t) => measure(t, LABEL_SIZE)));
  const BAR_W = 10;
  const barGutter = opts.showLegend ? BAR_W + TICK_GAP + barTextW + TICK_GAP * 2 : 0;

  const plot: Rect = {
    x: gutterLeft,
    y: top + headBand,
    width: Math.max(1, width - gutterLeft - PAD - barGutter),
    height: Math.max(1, height - top - headBand - bottomReserved),
  };
  if (plot.width < 8 || plot.height < 8) return { ...empty, title };

  const colBand = bandScale(cols, [plot.x, plot.x + plot.width], 0.06);
  const rowBand = bandScale(rows, [plot.y, plot.y + plot.height], 0.08);
  const ramp = spec.ramp ?? 'viridis';

  const bars: ChartBar[] = [];
  const valueLabels: ChartLabel[] = [];
  const categoryLabels: ChartLabel[] = [];

  for (let r = 0; r < rows; r++) {
    categoryLabels.push({
      text: fit(spec.categories[r], nameW, LABEL_SIZE, measure),
      x: PAD,
      y: rowBand.centre(r) - LABEL_SIZE / 2,
      width: nameW,
      align: 'right',
      fontSize: LABEL_SIZE,
    });
    for (let c = 0; c < cols; c++) {
      const v = spec.series[c].values[r];
      if (!finite(v)) continue;
      const color = rampColorAt(ramp, (v - lo) / span, spec.rampReversed);
      const cell = { x: colBand.at(c), y: rowBand.at(r), width: colBand.bandWidth, height: rowBand.bandWidth };
      bars.push({
        ...cell,
        color,
        seriesIndex: c,
        categoryIndex: r,
        value: v,
        negative: v < 0,
        rounded: false,
        cornerRadius: 3,
      });
      const fs = Math.round(clampTo(cell.height * 0.42, 9, 13));
      if (opts.showValues && cell.width > 22 && cell.height > fs + 4) {
        valueLabels.push({
          text: fit(formatValue(v, spec), cell.width - 4, fs, measure),
          x: cell.x,
          y: cell.y + cell.height / 2 - fs / 2,
          width: cell.width,
          align: 'center',
          fontSize: fs,
          on: color,
        });
      }
    }
  }
  for (let c = 0; c < cols; c++) {
    categoryLabels.push({
      text: fit(spec.series[c].name || `Column ${c + 1}`, colBand.step - 2, LABEL_SIZE, measure),
      x: colBand.at(c) - (colBand.step - colBand.bandWidth) / 2,
      y: top,
      width: colBand.step,
      align: 'center',
      fontSize: LABEL_SIZE,
    });
  }

  let colorBar: ChartColorBar | null = null;
  if (opts.showLegend) {
    const barH = Math.max(40, Math.min(plot.height, 180));
    const bx = plot.x + plot.width + TICK_GAP * 2;
    const by = plot.y + (plot.height - barH) / 2;
    const STOPS = 9;
    colorBar = {
      x: bx,
      y: by,
      width: BAR_W,
      height: barH,
      stops: Array.from({ length: STOPS }, (_, i) => ({
        offset: i / (STOPS - 1),
        color: rampColorAt(ramp, i / (STOPS - 1), spec.rampReversed),
      })),
      ticks: [
        { y: by + LABEL_SIZE * 0.8, text: barTexts[0] },
        { y: by + barH / 2 + LABEL_SIZE * 0.3, text: barTexts[1] },
        { y: by + barH, text: barTexts[2] },
      ],
      fontSize: LABEL_SIZE,
      textX: bx + BAR_W + TICK_GAP,
    };
  }

  return {
    ...empty,
    plot,
    bars,
    valueLabels,
    categoryLabels,
    colorBar,
    title,
    domain: [lo, hi],
    categoryAxis: 'y',
  };
}
