import type { ChartLayout, Point } from './chartLayout';
import { niceStep, roundToStep, type Domain } from './scales';
import { isPercentStacked, isSampleKind, type ChartKind, type ChartSpec } from './chartTypes';

/**
 * Setting a value by dragging the mark that shows it.
 *
 * A selected chart offers a handle on the end of each bar and on each point of
 * a line or area. Dragging it moves the value along the value axis, snapping to
 * a fiftieth of the axis rounded to 1, 2 or 5 of a power of ten, so the number
 * that lands is one somebody would have typed. Alt turns snapping off.
 *
 * The pointer is read against the axis as it stood when the drag began: the
 * layout re-scales as the value grows, and reading against the moving axis
 * would make the value run away from the pointer.
 */

export interface ValueHandle {
  seriesIndex: number;
  categoryIndex: number;
  value: number;
  /** Where the handle sits, in node coordinates. */
  x: number;
  y: number;
  /** 'v' when values run up the page, 'h' when they run across it. */
  axis: 'v' | 'h';
  /** The value axis this reading is drawn against. */
  domain: Domain;
}

const DRAGGABLE: ReadonlySet<ChartKind> = new Set<ChartKind>([
  'bar',
  'barHorizontal',
  'stackedBar',
  'line',
  'step',
  'area',
  'stackedArea',
  'funnel',
]);

/**
 * Whether this chart's values can be set by dragging, and if not, why.
 *
 * A linked chart's values belong to its table. Dragging one is offered only
 * when `writeBack` says the drop will ask to write the cell (editors), so
 * anyone else sees no handle at all.
 */
export function dragBlockedReason(spec: ChartSpec, writeBack = false): string | null {
  if (spec.link && !writeBack) return 'Values come from the linked table';
  if (spec.dataSource?.url) return 'Values come from the connected source';
  if (!DRAGGABLE.has(spec.kind) || isPercentStacked(spec.kind) || isSampleKind(spec.kind)) return 'This kind is not set by dragging';
  if (spec.yScale === 'log') return 'Log axes are not set by dragging';
  if (spec.sort && spec.sort !== 'none') return 'Turn sorting off to drag values';
  if (spec.topN) return 'Turn Top N off to drag values';
  return null;
}

export function valueHandles(layout: ChartLayout, spec: ChartSpec, writeBack = false): ValueHandle[] {
  if (dragBlockedReason(spec, writeBack)) return [];
  const rightSeries = new Set(spec.series.map((s, i) => (s.axis === 'right' ? i : -1)).filter((i) => i >= 0));
  const domainOf = (si: number) => (rightSeries.has(si) && layout.rightDomain ? layout.rightDomain : layout.domain);
  const transposed = layout.categoryAxis === 'y';
  const out: ValueHandle[] = [];
  const seen = new Set<string>();
  const n = spec.categories.length;
  // Reversal is a view: map drawn positions back to stored ones.
  const stored = (ci: number) => (spec.reverseCategories ? n - 1 - ci : ci);

  for (const b of layout.bars) {
    if (b.categoryIndex < 0) continue;
    const ci = stored(b.categoryIndex);
    seen.add(`${b.seriesIndex}:${ci}`);
    const end: Point = transposed
      ? { x: b.negative ? b.x : b.x + b.width, y: b.y + b.height / 2 }
      : { x: b.x + b.width / 2, y: b.negative ? b.y + b.height : b.y };
    out.push({ seriesIndex: b.seriesIndex, categoryIndex: ci, value: b.value, ...end, axis: transposed ? 'h' : 'v', domain: domainOf(b.seriesIndex) });
  }
  for (const c of layout.columns) {
    const ci = stored(c.categoryIndex);
    for (const e of c.entries) {
      const k = `${e.seriesIndex}:${ci}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ seriesIndex: e.seriesIndex, categoryIndex: ci, value: e.value, x: e.x, y: e.y, axis: transposed ? 'h' : 'v', domain: domainOf(e.seriesIndex) });
    }
  }
  return out;
}

/** The handle within `reach` of the pointer, nearest first. */
export function nearestHandle(handles: ValueHandle[], p: Point, reach: number): ValueHandle | null {
  let best: ValueHandle | null = null;
  let bestD = reach * reach;
  for (const h of handles) {
    const d = (h.x - p.x) ** 2 + (h.y - p.y) ** 2;
    if (d <= bestD) {
      best = h;
      bestD = d;
    }
  }
  return best;
}

export function snapStep(domain: Domain): number {
  return niceStep(Math.abs(domain[1] - domain[0]) / 50);
}

/**
 * The value a drag has reached.
 *
 * `start` is the pointer where the drag began; `plot` the plot box at that
 * moment. Up (or right, on a transposed chart) is more.
 */
export function draggedValue(
  handle: ValueHandle,
  start: Point,
  now: Point,
  plot: { width: number; height: number },
  snap = true
): number {
  const span = handle.domain[1] - handle.domain[0];
  const delta = handle.axis === 'v' ? (-(now.y - start.y) / Math.max(plot.height, 1)) * span : ((now.x - start.x) / Math.max(plot.width, 1)) * span;
  const raw = handle.value + delta;
  if (!snap) return Number(raw.toPrecision(6));
  const step = snapStep(handle.domain);
  return roundToStep(Math.round(raw / step) * step, step);
}

/** The spec with one stored value replaced. */
export function withValue(spec: ChartSpec, seriesIndex: number, categoryIndex: number, value: number): ChartSpec {
  return {
    ...spec,
    series: spec.series.map((s, i) =>
      i === seriesIndex ? { ...s, values: s.values.map((v, ci) => (ci === categoryIndex ? value : v)) } : s
    ),
  };
}
