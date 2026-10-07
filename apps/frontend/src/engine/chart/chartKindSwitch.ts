import {
  defaultChartSpec,
  isPlot,
  isTwoVariable,
  type ChartKind,
  type ChartSpec,
  type ChartStash,
  type PlotPayload,
  type PlotShape,
} from './chartTypes';

/**
 * Switching a chart's kind without ever leaving it empty.
 *
 * Within one family the data is kept as it is: comparison is the point of the
 * control, the same numbers as bars and then as a line. Between families a
 * table chart and a formula plot read different fields, so the outgoing
 * family's payload goes into `stash` and the incoming one is restored from
 * there, or seeded from the kind's example when there is nothing to restore.
 * Bar → function → bar gives back the original values, and the switch is one
 * document write, so one undo step reverses it.
 */

export type KindShape = 'data' | PlotShape;

export function shapeOf(kind: ChartKind): KindShape {
  if (!isPlot(kind)) return 'data';
  if (kind === 'parametric') return 'parametric';
  if (kind === 'polarPlot') return 'polar';
  if (kind === 'vectorField') return 'vector';
  if (isTwoVariable(kind)) return 'field';
  return 'curve';
}

function plotPayloadOf(spec: ChartSpec): PlotPayload | null {
  if (!spec.functions || spec.functions.length === 0) return null;
  const out: PlotPayload = { functions: spec.functions };
  if (spec.xMin !== undefined) out.xMin = spec.xMin;
  if (spec.xMax !== undefined) out.xMax = spec.xMax;
  if (spec.yPlotMin !== undefined) out.yPlotMin = spec.yPlotMin;
  if (spec.yPlotMax !== undefined) out.yPlotMax = spec.yPlotMax;
  return out;
}

function hasData(spec: ChartSpec): boolean {
  return spec.categories.length > 0 || spec.series.some((s) => s.values.length > 0);
}

/** Drop a stash that no longer holds anything, so documents stay small. */
function tidyStash(stash: ChartStash): ChartStash | undefined {
  const plot = stash.plot && Object.keys(stash.plot).length > 0 ? stash.plot : undefined;
  if (!stash.data && !plot) return undefined;
  return { ...(stash.data ? { data: stash.data } : {}), ...(plot ? { plot } : {}) };
}

export function switchChartKind(spec: ChartSpec, kind: ChartKind): ChartSpec {
  if (spec.kind === kind) return spec;

  const from = shapeOf(spec.kind);
  const to = shapeOf(kind);
  const next: ChartSpec = { ...spec, kind };
  if (kind !== 'donut') delete next.innerRadius;

  if (from === to) {
    // Same family: keep the data. A data kind with nothing in it still gets
    // its example, so a fresh switch never lands on an empty axis.
    if (to === 'data' && !hasData(spec) && !spec.link) {
      const seed = defaultChartSpec(kind);
      next.categories = seed.categories;
      next.series = seed.series;
    }
    return next;
  }

  const stash: ChartStash = {
    ...(spec.stash?.data ? { data: spec.stash.data } : {}),
    plot: { ...(spec.stash?.plot ?? {}) },
  };

  // Set the outgoing payload aside.
  if (from === 'data') {
    if (hasData(spec)) stash.data = { categories: spec.categories, series: spec.series };
  } else {
    const payload = plotPayloadOf(spec);
    if (payload) stash.plot![from] = payload;
  }

  // Clear what the incoming family does not read.
  if (to === 'data') {
    delete next.functions;
    delete next.xMin;
    delete next.xMax;
    delete next.yPlotMin;
    delete next.yPlotMax;
  } else {
    next.categories = [];
    next.series = [];
    delete next.functions;
    delete next.xMin;
    delete next.xMax;
    delete next.yPlotMin;
    delete next.yPlotMax;
  }

  // Bring in the incoming payload: what was set aside, or the kind's example.
  if (to === 'data') {
    if (stash.data) {
      next.categories = stash.data.categories;
      next.series = stash.data.series;
      delete stash.data;
    } else {
      const seed = defaultChartSpec(kind);
      next.categories = seed.categories;
      next.series = seed.series;
    }
  } else {
    const kept = stash.plot![to];
    const payload = kept ?? plotPayloadOf(defaultChartSpec(kind));
    if (kept) delete stash.plot![to];
    if (payload) {
      next.functions = payload.functions;
      if (payload.xMin !== undefined) next.xMin = payload.xMin;
      if (payload.xMax !== undefined) next.xMax = payload.xMax;
      if (payload.yPlotMin !== undefined) next.yPlotMin = payload.yPlotMin;
      if (payload.yPlotMax !== undefined) next.yPlotMax = payload.yPlotMax;
    }
  }

  const tidy = tidyStash(stash);
  if (tidy) next.stash = tidy;
  else delete next.stash;
  return next;
}
