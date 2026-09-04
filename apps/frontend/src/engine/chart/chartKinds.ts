import type { ChartKind } from './chartTypes';

/**
 * What each chart kind is called, and what it is *for*.
 *
 * The hint answers "which of these do I want", which is a different question
 * from "what is this called" and the only one somebody opening the flyout is
 * actually asking. A menu of seven nouns makes them read all seven; a menu
 * that says what each one compares lets them stop at the right one.
 *
 * Kept beside the kinds rather than in the dock component, for the reason
 * `toolNames.ts` gives about its own list: the engine must not depend on the
 * UI, and a label that lives in a component cannot be reused by the command
 * palette or the properties panel without becoming a second copy.
 */
export const CHART_LABELS: Record<ChartKind, string> = {
  bar: 'Bar',
  stackedBar: 'Stacked bar',
  line: 'Line',
  area: 'Area',
  scatter: 'Scatter',
  pie: 'Pie',
  donut: 'Donut',
};

export const CHART_HINTS: Record<ChartKind, string> = {
  bar: 'compare categories',
  stackedBar: 'compare, and show what each is made of',
  line: 'a value over an ordered run',
  area: 'a run, with the quantity under it',
  scatter: 'two measures against each other',
  pie: 'parts of one whole',
  donut: 'parts of one whole, with a middle',
};

/**
 * The order the picker offers them in.
 *
 * By how often they are wanted rather than alphabetically or by the order the
 * union happens to declare — bar first because it is the answer most of the
 * time, radial last because it is the one with the narrowest correct use.
 *
 * A separate array from `CHART_KINDS` because that one is the *set* and this
 * is a *presentation*, and `chartKinds.test.ts` holds them together: a kind
 * added to the schema and forgotten here would be a chart type nothing in the
 * interface could reach, which is the dead capability rule wearing a
 * different hat.
 */
export const CHART_PICKER_ORDER: ChartKind[] = [
  'bar',
  'stackedBar',
  'line',
  'area',
  'scatter',
  'pie',
  'donut',
];
