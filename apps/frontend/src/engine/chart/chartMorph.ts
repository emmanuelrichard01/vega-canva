import type { ChartBar, ChartDot, ChartLayout, ChartRun, ChartSlice, Point } from './chartLayout';

/**
 * The tween between two layouts of the same data, when a chart changes kind.
 *
 * Marks are matched by series and category, so a bar becomes the point it is
 * drawn as on a line, and a slice opens from where the same category's slice
 * was. Anything with no counterpart grows from its baseline or fades in.
 * Chrome (axes, labels, the legend) is the destination's from the first frame,
 * because text that slides around is harder to read than text that changes.
 *
 * `t` runs 0 → 1 and is already eased by the caller. At 0 the matched marks
 * stand where they stood; at 1 the result is the destination layout itself.
 */

export const MORPH_MS = 240;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Ease-out cubic: fast start, gentle settle. */
export function easeOut(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return 1 - (1 - c) ** 3;
}

const key = (si: number, ci: number) => `${si}:${ci}`;

/** Where each (series, category) reading was drawn in a layout. */
function anchors(layout: ChartLayout): Map<string, Point> {
  const out = new Map<string, Point>();
  for (const c of layout.columns) for (const e of c.entries) out.set(key(e.seriesIndex, c.categoryIndex), { x: e.x, y: e.y });
  for (const b of layout.bars) {
    const k = key(b.seriesIndex, b.categoryIndex);
    if (!out.has(k)) out.set(k, { x: b.x + b.width / 2, y: b.negative ? b.y + b.height : b.y });
  }
  return out;
}

function baselineOf(layout: ChartLayout): number {
  const p = layout.plot;
  return layout.baseline ? layout.baseline.y1 : p.y + p.height;
}

function morphBar(b: ChartBar, from: ChartLayout, prevBars: Map<string, ChartBar>, prevPoints: Map<string, Point>, t: number): ChartBar {
  const k = key(b.seriesIndex, b.categoryIndex);
  const was = prevBars.get(k);
  if (was) {
    return { ...b, x: lerp(was.x, b.x, t), y: lerp(was.y, b.y, t), width: lerp(was.width, b.width, t), height: lerp(was.height, b.height, t) };
  }
  const pt = prevPoints.get(k);
  if (pt) {
    // From a point: a sliver at that point, widening and dropping to the bar.
    return {
      ...b,
      x: lerp(pt.x - 1, b.x, t),
      y: lerp(pt.y, b.y, t),
      width: lerp(2, b.width, t),
      height: lerp(0, b.height, t),
    };
  }
  // Nothing to come from: grow out of the baseline.
  const base = baselineOf(from);
  return { ...b, y: lerp(base, b.y, t), height: lerp(0, b.height, t) };
}

function morphRun(
  r: ChartRun,
  to: ChartLayout,
  prevRuns: Map<number, ChartRun>,
  prevPoints: Map<string, Point>,
  t: number
): ChartRun {
  const was = prevRuns.get(r.seriesIndex);
  if (was && was.points.length === r.points.length) {
    return { ...r, points: r.points.map((p, i) => ({ x: lerp(was.points[i].x, p.x, t), y: lerp(was.points[i].y, p.y, t) })) };
  }
  // A straight run through every reading has one point per category, in order,
  // so each point can rise from where its reading was drawn before: a line
  // grows out of the tops of the bars it replaces.
  const cats = to.columns.filter((c) => c.entries.some((e) => e.seriesIndex === r.seriesIndex)).map((c) => c.categoryIndex);
  const starts = cats.map((ci) => prevPoints.get(key(r.seriesIndex, ci)));
  if (cats.length === r.points.length && starts.every(Boolean)) {
    return { ...r, points: r.points.map((p, i) => ({ x: lerp(starts[i]!.x, p.x, t), y: lerp(starts[i]!.y, p.y, t) })) };
  }
  return { ...r, opacity: (r.opacity ?? 1) * t };
}

function morphDot(d: ChartDot, prevPoints: Map<string, Point>, t: number): ChartDot {
  const was = d.categoryIndex >= 0 ? prevPoints.get(key(d.seriesIndex, d.categoryIndex)) : undefined;
  if (!was) return { ...d, radius: d.radius * t };
  return { ...d, x: lerp(was.x, d.x, t), y: lerp(was.y, d.y, t) };
}

function morphSlice(s: ChartSlice, prev: Map<number, ChartSlice>, t: number): ChartSlice {
  const was = prev.get(s.index);
  if (was) {
    return {
      ...s,
      startAngle: lerp(was.startAngle, s.startAngle, t),
      endAngle: lerp(was.endAngle, s.endAngle, t),
      innerRadius: lerp(was.innerRadius, s.innerRadius, t),
      outerRadius: lerp(was.outerRadius, s.outerRadius, t),
    };
  }
  return { ...s, endAngle: lerp(s.startAngle, s.endAngle, t) };
}

export function morphLayout(from: ChartLayout, to: ChartLayout, t: number): ChartLayout {
  if (t >= 1) return to;
  const prevBars = new Map(from.bars.map((b) => [key(b.seriesIndex, b.categoryIndex), b]));
  const prevPoints = anchors(from);
  const prevRuns = new Map(from.runs.map((r) => [r.seriesIndex, r]));
  const prevSlices = new Map(from.slices.map((s) => [s.index, s]));

  return {
    ...to,
    bars: to.bars.map((b) => morphBar(b, from, prevBars, prevPoints, t)),
    runs: to.runs.map((r) => morphRun(r, to, prevRuns, prevPoints, t)),
    // An area's fill is a polygon whose floor depends on the kind, so it fades
    // in over its destination shape rather than bending from a line.
    areas: to.areas.map((a) => ({ ...a, opacity: (a.opacity ?? 1) * t })),
    dots: to.dots.map((d) => morphDot(d, prevPoints, t)),
    slices: to.slices.map((s) => morphSlice(s, prevSlices, t)),
  };
}
