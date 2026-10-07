import type { Template } from '../../engine/templates/templates';
import type { AnyNode } from '../../engine/model/schema';
import { buildPreview, MAX_ITEMS_RICH, type BoardPreview } from '../../engine/model/boardPreview';
import { previewColorOf, previewPointsOf } from '../../engine/model/previewPaint';
import { parseExpression } from '../../engine/chart/expression';

/** Enough to read a board's shape, cheap enough to draw forty of. */
const NODE_LIMIT = 150;
const SAMPLES = 64;
/** How far inside a chart's box its curve is drawn, as a fraction of each side. */
const INSET = 0.14;

interface ChartLike {
  kind?: string;
  functions?: Array<{ source?: string; hidden?: boolean }>;
  series?: Array<{ values?: Array<number | null> }>;
  xMin?: number;
  xMax?: number;
}

/** Fit a run of points into a box, keeping the curve's own aspect out of it. */
function fitInto(points: Array<[number, number]>, node: AnyNode): number[] | null {
  const finite = points.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (finite.length < 2) return null;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of finite) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const left = node.x + node.width * INSET;
  const top = node.y + node.height * INSET;
  const w = node.width * (1 - 2 * INSET);
  const h = node.height * (1 - 2 * INSET);
  const out: number[] = [];
  for (const [x, y] of finite) {
    out.push(left + ((x - minX) / spanX) * w, top + (1 - (y - minY) / spanY) * h);
  }
  return out;
}

function sample(fn: (t: number) => [number, number], from: number, to: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i <= SAMPLES; i += 1) out.push(fn(from + ((to - from) * i) / SAMPLES));
  return out;
}

/**
 * The line a chart actually draws, where it draws one: a plotted function, a
 * parametric or polar curve, or the first series of a line or area chart.
 * Other kinds keep their box.
 */
export function chartCurve(node: AnyNode): number[] | null {
  if (node.type !== 'chart') return null;
  const chart = (node as unknown as { chart?: ChartLike }).chart;
  if (!chart?.kind) return null;
  const curves = (chart.functions ?? []).filter((f) => !f.hidden && typeof f.source === 'string');
  const from = Number.isFinite(chart.xMin) ? chart.xMin! : -2 * Math.PI;
  const to = Number.isFinite(chart.xMax) ? chart.xMax! : 2 * Math.PI;

  if (chart.kind === 'function' && curves[0]) {
    const parsed = parseExpression(curves[0].source!, 'x');
    if (!parsed.ok) return null;
    return fitInto(sample((x) => [x, parsed.expression.evaluate(x)], from, to), node);
  }
  if (chart.kind === 'parametric' && curves.length >= 2) {
    const fx = parseExpression(curves[0].source!, 't');
    const fy = parseExpression(curves[1].source!, 't');
    if (!fx.ok || !fy.ok) return null;
    return fitInto(sample((t) => [fx.expression.evaluate(t), fy.expression.evaluate(t)], from, to), node);
  }
  if (chart.kind === 'polarPlot' && curves[0]) {
    const fr = parseExpression(curves[0].source!, ['a']);
    if (!fr.ok) return null;
    return fitInto(sample((a) => {
      const r = fr.expression.evaluate(a);
      return [r * Math.cos(a), r * Math.sin(a)];
    }, from, to), node);
  }
  if ((chart.kind === 'line' || chart.kind === 'area') && chart.series?.[0]?.values?.length) {
    const values = chart.series[0].values;
    return fitInto(values.map((v, i) => [i, v ?? NaN] as [number, number]), node);
  }
  return null;
}

/**
 * A template's cover, drawn from the board it builds.
 *
 * The same summary the gallery always drew, except that a chart is drawn as
 * the line it plots rather than as a filled box — "Functions & waves" shows
 * waves.
 */
export function templateCover(template: Template): BoardPreview | null {
  const nodes = template.build(NODE_LIMIT).map((node, i) => ({
    ...node,
    zIndex: i,
    hidden: false,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
  })) as unknown as AnyNode[];
  const byId: Record<string, AnyNode> = {};
  nodes.forEach((node) => { byId[node.id] = node; });
  return buildPreview(nodes, previewColorOf, (node) => chartCurve(node) ?? previewPointsOf(node, byId), MAX_ITEMS_RICH);
}
