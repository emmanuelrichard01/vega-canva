import { CHART_SORT_LABELS, isPlot, isRadial, type ChartSpec } from './chartTypes';

/**
 * One line per panel section, saying what is set inside it.
 *
 * ## Why these are derived and not stored
 *
 * A summary is a second reading of state the spec already holds, and the
 * moment it is stored it is a second copy that can disagree — which is this
 * codebase's most-repeated defect and the reason `isUniform` reads the corner
 * radii rather than a `linked` flag beside them. Derived, a summary cannot be
 * stale.
 *
 * ## Why they are here and not in the component
 *
 * They are pure functions of a spec, so they belong with the spec and can be
 * asserted without rendering anything. It also keeps the panel from growing a
 * dozen inline ternaries that each decide, slightly differently, what "nothing
 * set" looks like.
 *
 * ## The wording rule
 *
 * A summary names *what is on*, never what is off, and never a count of
 * controls. "Legend, values" tells you the state; "3 options" tells you the
 * size of the section, which the reader can already see. Where nothing is on,
 * the section says so in a word rather than going blank — an empty slot reads
 * as a rendering fault, and "off" reads as an answer.
 */

/** The label for the labels-and-legend block. */
export function labelSummary(spec: ChartSpec): string {
  const on: string[] = [];
  if (spec.title) on.push('title');
  if (spec.showLegend ?? true) on.push('legend');
  if (spec.showValues) on.push('values');
  if ((spec.showGrid ?? true) && !isRadial(spec.kind)) on.push('grid');
  return on.length ? capitalise(on.join(', ')) : 'None';
}

/** The value axis: its bounds, however they were arrived at. */
export function axisSummary(spec: ChartSpec): string {
  const hasMin = typeof spec.yMin === 'number';
  const hasMax = typeof spec.yMax === 'number';

  if (hasMin && hasMax) return `${trim(spec.yMin!)}–${trim(spec.yMax!)}`;
  // "From 0" and "to 300" rather than "0–auto": a half-set range is a real and
  // common state, and a placeholder word in one half of a range reads as a
  // value rather than as its absence.
  if (hasMin) return `From ${trim(spec.yMin!)}`;
  if (hasMax) return `To ${trim(spec.yMax!)}`;
  return spec.includeZero === false ? 'Auto, not from zero' : 'Auto';
}

/** Number formatting: the affixes and the precision. */
export function numberSummary(spec: ChartSpec): string {
  const bits: string[] = [];
  if (spec.valuePrefix) bits.push(spec.valuePrefix);
  if (spec.valueSuffix) bits.push(spec.valueSuffix);
  if (typeof spec.decimals === 'number') bits.push(`${spec.decimals}dp`);
  return bits.length ? bits.join(' · ') : 'Plain';
}

/** The series block: how many, and whether any carry their own colour. */
export function seriesSummary(spec: ChartSpec): string {
  const n = spec.series.length;
  if (n === 0) return 'None';
  const custom = spec.series.filter((s) => s.color).length;
  const noun = n === 1 ? '1 series' : `${n} series`;
  return custom ? `${noun}, ${custom} recoloured` : noun;
}

/** The data block: the size of the table. */
export function dataSummary(spec: ChartSpec): string {
  if (isPlot(spec.kind)) {
    const fns = spec.functions?.length ?? 0;
    return fns === 1 ? '1 formula' : `${fns} formulae`;
  }
  const rows = spec.categories.length;
  const cols = spec.series.length;
  // "7 × 3" rather than "7 rows, 3 series": the shape of a table is read as a
  // pair of numbers, and the words are the part somebody already knows.
  return `${rows} × ${cols}`;
}

/** The order block. */
export function sortSummary(spec: ChartSpec): string {
  return CHART_SORT_LABELS[spec.sort ?? 'none'];
}

/** The plot domain, in the variable the kind actually uses. */
export function domainSummary(spec: ChartSpec): string {
  const v = spec.kind === 'parametric' ? 't' : spec.kind === 'polarPlot' ? 'a' : 'x';
  const from = spec.xMin ?? (spec.kind === 'function' ? -10 : 0);
  const to = spec.xMax ?? (spec.kind === 'function' ? 10 : Math.PI * 2);
  return `${v} ∈ [${trim(from)}, ${trim(to)}]`;
}

/** What is being read off the curve. */
export function analysisSummary(spec: ChartSpec): string {
  const on: string[] = [];
  if (spec.showRoots) on.push('roots');
  if (spec.showExtrema) on.push('turning points');
  if (spec.fillArea) on.push('area');
  if (spec.showDerivative) on.push('derivative');
  return on.length ? capitalise(on.join(', ')) : 'Nothing';
}

/** The reference rule. */
export function referenceSummary(spec: ChartSpec): string {
  if (!spec.reference) return 'None';
  const at = trim(spec.reference.value);
  return spec.reference.label ? `${spec.reference.label} at ${at}` : `At ${at}`;
}

/**
 * A number short enough for a header.
 *
 * Multiples of pi are written as such, because a plot's domain is almost
 * always one and `6.283185307179586` in a summary slot is both unreadable and
 * wrong about what the author meant.
 */
function trim(value: number): string {
  if (!Number.isFinite(value)) return '—';

  const ratio = value / Math.PI;
  const rounded = Math.round(ratio * 4) / 4;
  if (value !== 0 && Math.abs(ratio - rounded) < 1e-9 && Math.abs(rounded) <= 24) {
    if (rounded === 1) return 'π';
    if (rounded === -1) return '−π';
    return `${formatNumber(rounded)}π`;
  }
  return formatNumber(value);
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Math.round(value * 100) / 100);
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
