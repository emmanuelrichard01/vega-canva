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

/** One link. Directed charts read it as `i` → `j`. */
interface NetworkEdge {
  i: number;
  j: number;
  w: number;
}

/**
 * Links between groups, and nodes with no links at all.
 *
 * A mid slate rather than a theme token: the layout does not know the board it
 * lands on, and this reads as "quieter than the colours" on light and dark
 * alike, which is the whole of its job.
 */
export const NETWORK_NEUTRAL = '#94A3B8';

/**
 * Which nodes belong together.
 *
 * ## Why groups at all
 *
 * The network used to give every node its own palette colour, so a graph of
 * nine people was nine unrelated colours -- a legend of names, and no answer to
 * the question a network is drawn to answer, which is *what clusters*. The
 * force layout already puts close collaborators near each other; colouring by
 * group says so outright, and makes the links *between* groups -- the bridges,
 * usually the interesting ones -- stand out by being the grey ones.
 *
 * ## How
 *
 * The local-moving phase of Louvain: each node in turn joins whichever
 * neighbouring group raises modularity most, until nothing moves. One level,
 * no aggregation -- boards hold tens of nodes, not thousands, and the first
 * level already finds the groups a person would circle. Fixed visiting order
 * and ties broken toward staying put, so it is **deterministic**: two
 * collaborators see the same colours, which matters more on a shared board
 * than a marginally better partition.
 *
 * Groups are numbered by size, then weight, then first member, so the largest
 * takes the palette's first colour. Nodes with no links get -1.
 */
export function networkGroups(n: number, edges: readonly NetworkEdge[]): number[] {
  const adj = Array.from({ length: n }, () => new Map<number, number>());
  for (const e of edges) {
    if (e.i === e.j || e.w <= 0) continue;
    adj[e.i].set(e.j, (adj[e.i].get(e.j) ?? 0) + e.w);
    adj[e.j].set(e.i, (adj[e.j].get(e.i) ?? 0) + e.w);
  }
  const k = adj.map((m) => [...m.values()].reduce((a, b) => a + b, 0));
  const twoM = k.reduce((a, b) => a + b, 0);
  const community = Array.from({ length: n }, (_, i) => i);
  const total = k.slice();

  if (twoM > 0) {
    for (let pass = 0; pass < 40; pass++) {
      let moved = false;
      for (let i = 0; i < n; i++) {
        if (k[i] === 0) continue;
        const own = community[i];
        total[own] -= k[i];
        const into = new Map<number, number>();
        for (const [j, w] of adj[i]) into.set(community[j], (into.get(community[j]) ?? 0) + w);
        let best = own;
        let bestGain = (into.get(own) ?? 0) - (total[own] * k[i]) / twoM;
        for (const [c, w] of into) {
          const gain = w - (total[c] * k[i]) / twoM;
          if (gain > bestGain + 1e-9) {
            best = c;
            bestGain = gain;
          }
        }
        total[best] += k[i];
        community[i] = best;
        if (best !== own) moved = true;
      }
      if (!moved) break;
    }
  }

  const members = new Map<number, number[]>();
  community.forEach((c, i) => {
    if (k[i] > 0) members.set(c, [...(members.get(c) ?? []), i]);
  });
  const weight = (list: number[]) => list.reduce((s, i) => s + k[i], 0);
  const ordered = [...members.values()].sort(
    (a, b) => b.length - a.length || weight(b) - weight(a) || a[0] - b[0]
  );
  const out = new Array<number>(n).fill(-1);
  ordered.forEach((list, g) => list.forEach((i) => (out[i] = g)));
  return out;
}

/**
 * Nodes and weighted links.
 *
 * ## The table
 *
 * An adjacency table: row *i*, column *j* is the weight of the link between
 * them, so it pastes from any matrix and edits in the ordinary sheet. Two-way
 * (the default) reads the pair symmetrically, the larger of the two
 * directions. **One-way** (`directed`) reads row → column and draws an arrow
 * per direction that exists; a pair linked both ways gets two arrows bowed to
 * opposite sides rather than one line with two heads, because the two weights
 * are usually different and a single line can only be one thickness.
 *
 * ## What each mark means
 *
 * A node's size is its weighted degree -- how connected it is. Its colour is
 * its group (see `networkGroups`), or its own colour with `networkColor:
 * 'node'`. A link's thickness is its weight; a link inside a group takes the
 * group's colour and a link between groups is grey, drawn first so the groups
 * sit on top of their bridges. With values on, each link carries its weight.
 *
 * ## Placement
 *
 * **Force** (the default): Fruchterman–Reingold, fully deterministic -- a
 * fixed start and a fixed number of cooling steps, so the same table always
 * draws the same graph and a chart on a shared board can be annotated. It
 * starts from a circle ordered by group, so groups begin together instead of
 * having to find each other; links inside a group pull harder than bridges;
 * and it runs in a box shaped like the plot, so a wide chart gets a wide graph
 * instead of a round one floating in the middle.
 *
 * **Ring**: every node on one ellipse, grouped and most-connected first --
 * the arrangement that makes every link comparable, at the cost of proximity
 * meaning anything. Curved links bow toward the centre, the way a chord
 * diagram's do.
 *
 * Either way a final pass pushes apart any nodes that still overlap, and each
 * name sits on the side of its node away from the middle of the graph, where
 * the links are not.
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

  const directed = spec.directed === true;
  const ring = spec.networkLayout === 'ring';
  const byNode = spec.networkColor === 'node';
  const nameOf = (i: number) => spec.categories[i] || `Node ${i + 1}`;

  const cell = (i: number, j: number) => {
    const v = spec.series[i]?.values[j];
    return finite(v) ? Math.abs(v) : 0;
  };

  // The structure: one link per linked pair, at the heavier direction.
  const links: NetworkEdge[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const w = Math.max(cell(i, j), cell(j, i));
      if (w > 0) links.push({ i, j, w });
    }
  }

  // What is drawn: the links, or one arrow per direction that exists.
  const drawn: Array<NetworkEdge & { mutual: boolean }> = [];
  if (directed) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const there = cell(i, j);
        const back = cell(j, i);
        const mutual = there > 0 && back > 0;
        if (there > 0) drawn.push({ i, j, w: there, mutual });
        if (back > 0) drawn.push({ i: j, j: i, w: back, mutual });
      }
    }
  } else {
    for (const e of links) drawn.push({ ...e, mutual: false });
  }
  const maxW = Math.max(1e-9, ...drawn.map((e) => e.w));
  const maxLink = Math.max(1e-9, ...links.map((e) => e.w));

  const group = networkGroups(n, links);
  const groupCount = Math.max(-1, ...group) + 1;
  const sameGroup = (a: number, b: number) => group[a] >= 0 && group[a] === group[b];

  const degree = Array.from({ length: n }, (_, i) =>
    links.reduce((sum, e) => sum + (e.i === i || e.j === i ? e.w : 0), 0)
  );
  const maxDeg = Math.max(0, ...degree);

  // Node sizes scale with the room and the count, within limits.
  const largest = clampTo(Math.min(plot.width, plot.height) / (4 + 2.2 * Math.sqrt(n)), 9, 20);
  const radius = degree.map((d) =>
    maxDeg > 0 ? 5 + (largest - 5) * Math.sqrt(d / maxDeg) : Math.min(largest, 8)
  );
  const maxR = Math.max(...radius);

  const NAME_H = 13;
  const mx = maxR + 6;
  const my = maxR + NAME_H + 6;
  const avail: Rect = {
    x: plot.x + mx,
    y: plot.y + my,
    width: Math.max(1, plot.width - mx * 2),
    height: Math.max(1, plot.height - my * 2),
  };
  const aspect = clampTo(avail.width / avail.height, 0.6, 2.2);

  // Around the circle by group, most connected first within each.
  const groupKey = (i: number) => (group[i] < 0 ? groupCount : group[i]);
  const around = Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => groupKey(a) - groupKey(b) || degree[b] - degree[a] || a - b
  );
  const pos: Point[] = new Array(n);
  around.forEach((node, slot) => {
    const a = (slot / n) * Math.PI * 2 - Math.PI / 2;
    const r = ring ? 0.5 : 0.35;
    pos[node] = { x: aspect / 2 + r * aspect * Math.cos(a), y: 0.5 + r * Math.sin(a) };
  });

  if (!ring && n > 2) {
    const k = Math.sqrt(aspect / n) * 0.9;
    const ITER = 300;
    for (let it = 0; it < ITER; it++) {
      const temp = 0.1 * (1 - it / ITER) + 0.002;
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
      for (const e of links) {
        const dx = pos[e.i].x - pos[e.j].x;
        const dy = pos[e.i].y - pos[e.j].y;
        const d = Math.max(0.01, Math.hypot(dx, dy));
        // Inside a group pulls harder than across one, so groups read as
        // groups and their bridges stretch.
        const f = ((d * d) / k) * (0.35 + 0.65 * (e.w / maxLink)) * (sameGroup(e.i, e.j) ? 1.2 : 0.7);
        disp[e.i].x -= (dx / d) * f;
        disp[e.i].y -= (dy / d) * f;
        disp[e.j].x += (dx / d) * f;
        disp[e.j].y += (dy / d) * f;
      }
      for (let i = 0; i < n; i++) {
        // A gentle pull to the centre, so a disconnected node does not drift
        // off and leave the rest of the graph squeezed into a corner.
        disp[i].x += (aspect / 2 - pos[i].x) * 0.4;
        disp[i].y += (0.5 - pos[i].y) * 0.4;
        const len = Math.max(1e-9, Math.hypot(disp[i].x, disp[i].y));
        const step = Math.min(len, temp);
        pos[i].x += (disp[i].x / len) * step;
        pos[i].y += (disp[i].y / len) * step;
      }
    }
  }

  // Fit into the room left for nodes and names. Stretching is allowed a
  // little, so a wide plot is used, but not so much that distance stops
  // meaning distance.
  const xs = pos.map((p) => p.x);
  const ys = pos.map((p) => p.y);
  const bx = Math.min(...xs);
  const by = Math.min(...ys);
  const bw = Math.max(1e-6, Math.max(...xs) - bx);
  const bh = Math.max(1e-6, Math.max(...ys) - by);
  const fitScale = Math.min(avail.width / bw, avail.height / bh);
  const sx = Math.min(avail.width / bw, fitScale * 1.35);
  const sy = Math.min(avail.height / bh, fitScale * 1.35);
  const P: Point[] = pos.map((p) =>
    n === 1
      ? { x: plot.x + plot.width / 2, y: plot.y + plot.height / 2 }
      : {
          x: avail.x + (avail.width - bw * sx) / 2 + (p.x - bx) * sx,
          y: avail.y + (avail.height - bh * sy) / 2 + (p.y - by) * sy,
        }
  );

  // No two nodes on top of each other.
  for (let pass = 0; pass < 60; pass++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = P[i].x - P[j].x;
        const dy = P[i].y - P[j].y;
        const d = Math.hypot(dx, dy);
        const want = radius[i] + radius[j] + 6;
        if (d >= want) continue;
        const angle = (i * 2.399963 + j) % (Math.PI * 2);
        const ux = d > 1e-6 ? dx / d : Math.cos(angle);
        const uy = d > 1e-6 ? dy / d : Math.sin(angle);
        const push = (want - d) / 2;
        P[i] = { x: P[i].x + ux * push, y: P[i].y + uy * push };
        P[j] = { x: P[j].x - ux * push, y: P[j].y - uy * push };
        moved = true;
      }
    }
    for (let i = 0; i < n; i++) {
      P[i] = {
        x: clampTo(P[i].x, plot.x + radius[i] + 2, plot.x + plot.width - radius[i] - 2),
        y: clampTo(P[i].y, plot.y + radius[i] + 2, plot.y + plot.height - radius[i] - 2),
      };
    }
    if (!moved) break;
  }

  const groupColor = (g: number) => (g < 0 ? NETWORK_NEUTRAL : seriesColor(undefined, g, opts.palette));
  const nodeColor = (i: number) =>
    byNode ? seriesColor({ name: '', values: [], color: spec.series[i]?.color }, i, opts.palette) : groupColor(group[i]);
  const inside = (p: Point) => ({
    x: clampTo(p.x, plot.x, plot.x + plot.width),
    y: clampTo(p.y, plot.y, plot.y + plot.height),
  });
  const toward = (from: Point, to: Point) => {
    const d = Math.max(1e-6, Math.hypot(to.x - from.x, to.y - from.y));
    return { x: (to.x - from.x) / d, y: (to.y - from.y) / d };
  };
  const quad = (a: Point, c: Point, b: Point, t: number) => {
    const q = 1 - t;
    return { x: q * q * a.x + 2 * q * t * c.x + t * t * b.x, y: q * q * a.y + 2 * q * t * c.y + t * t * b.y };
  };
  const middle = { x: plot.x + plot.width / 2, y: plot.y + plot.height / 2 };

  // Bridges first, lighter first, so groups and heavy links sit on top.
  const order = drawn
    .map((e, index) => ({ e, index }))
    .sort(
      (a, b) =>
        Number(sameGroup(a.e.i, a.e.j)) - Number(sameGroup(b.e.i, b.e.j)) ||
        a.e.w - b.e.w ||
        a.index - b.index
    );

  const runs: ChartRun[] = [];
  const valueLabels: ChartLabel[] = [];
  for (const { e } of order) {
    const a = P[e.i];
    const b = P[e.j];
    const len = Math.max(1e-6, Math.hypot(b.x - a.x, b.y - a.y));
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;

    // Where the link bows through, if it bows.
    let ctrl: Point | null = null;
    if (ring && spec.curved) {
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      // A third of the way in: enough to lift a link off the rim, not so much
      // that two neighbours are joined by a loop through the middle.
      ctrl = { x: mid.x + (middle.x - mid.x) * 0.3, y: mid.y + (middle.y - mid.y) * 0.3 };
    } else if (spec.curved || e.mutual) {
      // The perpendicular follows the direction of travel, so the two arrows
      // of a mutual pair bow to opposite sides by construction.
      const bend = e.mutual ? 0.2 : 0.18;
      ctrl = { x: (a.x + b.x) / 2 - uy * len * bend, y: (a.y + b.y) / 2 + ux * len * bend };
    }

    const gap = directed ? 2 : 0;
    const out = toward(a, ctrl ?? b);
    const into = toward(ctrl ?? a, b);
    const start = { x: a.x + out.x * radius[e.i], y: a.y + out.y * radius[e.i] };
    const end = { x: b.x - into.x * (radius[e.j] + gap), y: b.y - into.y * (radius[e.j] + gap) };
    const points = ctrl
      ? Array.from({ length: 17 }, (_, s) => inside(quad(start, ctrl as Point, end, s / 16)))
      : [start, end];

    const color = byNode ? nodeColor(e.i) : sameGroup(e.i, e.j) ? groupColor(group[e.i]) : NETWORK_NEUTRAL;
    const strokeWidth = Math.min(5, 1 + 3.5 * (e.w / maxW));
    const opacity = byNode ? 0.5 : 0.6;
    runs.push({ points, color, seriesIndex: e.i, width: strokeWidth, opacity });

    if (directed) {
      // A chevron rather than a filled head: it is drawn by the same run
      // painter as the link, so the board, the SVG and the sketch pen all
      // draw it without learning a new mark.
      const size = 5 + strokeWidth * 1.3;
      const wing = (angle: number) => ({
        x: end.x - size * (into.x * Math.cos(angle) - into.y * Math.sin(angle)),
        y: end.y - size * (into.x * Math.sin(angle) + into.y * Math.cos(angle)),
      });
      runs.push({
        points: [inside(wing(0.45)), inside(end), inside(wing(-0.45))],
        color,
        seriesIndex: e.i,
        width: Math.max(1.5, strokeWidth * 0.85),
        opacity: Math.min(1, opacity + 0.3),
      });
    }

    if (opts.showValues && drawn.length <= 80) {
      const at = ctrl ? quad(start, ctrl, end, 0.5) : { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
      const LABEL_W = 56;
      valueLabels.push({
        text: fit(formatValue(e.w, spec), LABEL_W, 10, measure),
        x: clampTo(at.x - LABEL_W / 2, 0, Math.max(0, width - LABEL_W)),
        y: at.y - 7,
        width: LABEL_W,
        align: 'center',
        fontSize: 10,
      });
    }
  }

  const dots: ChartDot[] = P.map((p, i) => ({
    x: p.x,
    y: p.y,
    radius: radius[i],
    color: nodeColor(i),
    seriesIndex: i,
    categoryIndex: i,
    value: degree[i],
    shape: 'circle',
  }));

  // Each name on the side of its node away from the middle of the graph.
  const centreY = P.reduce((s, p) => s + p.y, 0) / n;
  const LW = 104;
  const categoryLabels: ChartLabel[] = P.map((p, i) => {
    const above = n > 1 && p.y < centreY - 1;
    return {
      text: fit(nameOf(i), LW, 10, measure),
      x: clampTo(p.x - LW / 2, 0, Math.max(0, width - LW)),
      y: above ? Math.max(0, p.y - radius[i] - 3 - NAME_H) : Math.min(p.y + radius[i] + 3, height - 12),
      width: LW,
      align: 'center',
      fontSize: 10,
    };
  });

  // Coloured by group, the key names the groups -- each by its most connected
  // member -- rather than listing every node in the colour of its group.
  const legendSpec: ChartSpec =
    byNode || groupCount === 0
      ? spec
      : {
          ...spec,
          categories: Array.from({ length: groupCount }, (_, g) => {
            const list = group.map((gi, i) => (gi === g ? i : -1)).filter((i) => i >= 0);
            const hub = list.reduce((best, i) => (degree[i] > degree[best] ? i : best), list[0]);
            return list.length > 1 ? `${nameOf(hub)} +${list.length - 1}` : nameOf(hub);
          }),
          series: [{ name: '', values: [] }],
        };

  return {
    ...empty,
    plot,
    runs,
    dots,
    categoryLabels,
    valueLabels,
    legend: buildLegend(legendSpec, opts, width, height, measure),
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
