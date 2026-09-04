import { nanoid } from 'nanoid';
import { editor } from '../api/EditorAPI';
import { nextZIndex } from '../document/mutations';
import { defaultChartSpec, type ChartKind, type ChartSpec } from './chartTypes';

/**
 * Creating and editing chart nodes.
 *
 * Goes through `EditorAPI` -> `CommandManager` -> `mutations.ts` like every
 * other write, so a chart lands on top of the stacking order, carries its
 * authorship and timestamps, and is refused for a read-only session — none of
 * which this file has to remember. `gridApply.ts` is the same shape for the
 * same reason.
 */

/** A chart big enough to read. Smaller than this and the axis labels collide. */
export const CHART_DEFAULT_SIZE = { width: 480, height: 320 };

/** The smallest box that still draws something; below it `layoutChart` bails. */
export const CHART_MIN_SIZE = { width: 200, height: 160 };

export function createChart(
  box: { x: number; y: number; width: number; height: number },
  spec: ChartSpec
): string | null {
  if (!(box.width > 0) || !(box.height > 0)) return null;

  const id = nanoid();
  editor.createNode({
    id,
    type: 'chart',
    ...box,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
    zIndex: nextZIndex(),
    chart: spec,
  } as never);
  return id;
}

/**
 * Change a chart's data or its reading of it.
 *
 * Takes a whole spec rather than a patch. A chart's fields interact — `kind`
 * decides whether `innerRadius` means anything, and changing `categories`
 * changes what a series' values line up against — so a partial update is a
 * request to merge two states that may not be consistent with each other.
 * Assembling the new spec in the caller, where the current one is in hand, is
 * the version that cannot produce a chart nobody asked for.
 */
export function updateChart(id: string, spec: ChartSpec): void {
  editor.updateNode(id, { chart: spec });
}

/**
 * Switch a chart to another kind, keeping the data.
 *
 * The point of the control is comparison — the same numbers as bars, then as a
 * line — so the data has to survive the switch. What does *not* survive is
 * anything meaningless in the new kind: a donut's hole is dropped when it
 * stops being a donut rather than lying dormant in the document, which is the
 * dead-field rule applied to a field that is only sometimes alive.
 */
export function setChartKind(id: string, spec: ChartSpec, kind: ChartKind): void {
  const next: ChartSpec = { ...spec, kind };
  if (kind !== 'donut') delete next.innerRadius;
  updateChart(id, next);
}

/** The chart a click (rather than a drag) should produce. */
export function defaultChartAt(
  x: number,
  y: number,
  kind: ChartKind = 'bar'
): { box: { x: number; y: number; width: number; height: number }; spec: ChartSpec } {
  return {
    box: { x, y, ...CHART_DEFAULT_SIZE },
    spec: defaultChartSpec(kind),
  };
}
