import { CHART_FAMILY_OF, type ChartFamily, type ChartKind } from './chartTypes';

/**
 * What each chart kind is called, and what it is *for*.
 *
 * The hint answers "which of these do I want", which is a different question
 * from "what is this called" and the only one somebody opening the picker is
 * actually asking. Sixteen nouns makes them read all sixteen; sixteen lines
 * saying what each one compares lets them stop at the right one.
 *
 * Kept beside the kinds rather than in the dock component, for the reason
 * `toolNames.ts` gives about its own list: the engine must not depend on the
 * UI, and a label living in a component cannot be reused by the command
 * palette or the properties panel without becoming a second copy.
 */
export const CHART_LABELS: Record<ChartKind, string> = {
  bar: 'Bar',
  barHorizontal: 'Horizontal bar',
  stackedBar: 'Stacked bar',
  stackedBar100: '100% stacked',
  line: 'Line',
  step: 'Step',
  area: 'Area',
  stackedArea: 'Stacked area',
  scatter: 'Scatter',
  bubble: 'Bubble',
  histogram: 'Histogram',
  pie: 'Pie',
  donut: 'Donut',
  funnel: 'Funnel',
  waterfall: 'Waterfall',
  radar: 'Radar',
  function: 'Function',
  parametric: 'Parametric',
  polarPlot: 'Polar',
  implicit: 'Implicit',
  contour: 'Contour',
  slopeField: 'Slope field',
  vectorField: 'Vector field',
};

/**
 * One line each, and every one of them says what the mark *asserts*.
 *
 * Written as claims rather than descriptions on purpose. "Shows values over
 * time" describes a line chart; "a value over an ordered run" tells you when
 * it is the wrong choice, which is the useful half.
 */
export const CHART_HINTS: Record<ChartKind, string> = {
  bar: 'compare categories',
  barHorizontal: 'compare, with long category names',
  stackedBar: 'compare totals, and their composition',
  stackedBar100: 'compare composition, ignoring totals',
  line: 'a value over an ordered run',
  step: 'a value that changes at a point, not between',
  area: 'a run, with the quantity under it',
  stackedArea: 'how a total split up, over a run',
  scatter: 'two measures against each other',
  bubble: 'two measures, and a third as size',
  histogram: 'how often values fall in each range',
  pie: 'parts of one whole',
  donut: 'parts of one whole, with a middle',
  funnel: 'what survives each stage',
  waterfall: 'how a total was arrived at',
  radar: 'several measures at once, per category',
  function: 'y = f(x), plotted',
  parametric: 'x(t) and y(t), a curve in the plane',
  polarPlot: 'r(a), swept around a centre',
  // Starts lower case like every other hint: they read as sentence fragments
  // after the name, not as titles. `chartKinds.test.ts` holds that rule and
  // caught this one opening with a capital F.
  implicit: 'the curve where F(x, y) = 0',
  contour: 'level curves of a surface',
  slopeField: "dy/dx, as a direction at every point",
  vectorField: 'a vector at every point of the plane',
};

export const FAMILY_LABELS: Record<ChartFamily, string> = {
  comparison: 'Compare',
  trend: 'Over a run',
  distribution: 'Relationship',
  partToWhole: 'Parts of a whole',
  specialist: 'Specialist',
  plot: 'Maths',
  field: 'Two variables',
};

/**
 * The order the picker offers them in, within each family.
 *
 * By how often each is wanted rather than alphabetically or by the order the
 * union happens to declare — bar first because it is the answer most of the
 * time, radar last because it is the one with the narrowest correct use.
 *
 * A separate array from `CHART_KINDS` because that one is the *set* and this
 * is a *presentation*, and `chartKinds.test.ts` holds them together: a kind
 * added to the schema and forgotten here would be a chart type nothing in the
 * interface could reach, which is the dead capability rule wearing a
 * different hat. The compiler catches a missing `CHART_LABELS` entry because
 * that is a full `Record`; it has nothing to say about an array that is short.
 */
export const CHART_PICKER_ORDER: ChartKind[] = [
  'bar',
  'barHorizontal',
  'stackedBar',
  'stackedBar100',
  'line',
  'step',
  'area',
  'stackedArea',
  'scatter',
  'bubble',
  'histogram',
  'pie',
  'donut',
  'funnel',
  'waterfall',
  'radar',
  'function',
  'parametric',
  'polarPlot',
  'implicit',
  'contour',
  'slopeField',
  'vectorField',
];

/** The picker's rows, grouped, in family order then picker order. */
export function chartPickerGroups(): Array<{ family: ChartFamily; label: string; kinds: ChartKind[] }> {
  const order: ChartFamily[] = [
    'comparison',
    'trend',
    'distribution',
    'partToWhole',
    'specialist',
    'plot',
    'field',
  ];
  return order.map((family) => ({
    family,
    label: FAMILY_LABELS[family],
    kinds: CHART_PICKER_ORDER.filter((k) => CHART_FAMILY_OF[k] === family),
  }));
}
