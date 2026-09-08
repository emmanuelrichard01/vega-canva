import type { ShapeGeometry, ShapeKind } from './schema';

/**
 * What each parametric shape lets you change, in one table.
 *
 * ## Why this exists
 *
 * Twelve of the shape kinds carry a dial of their own -- a trapezoid's top
 * inset, a gear's tooth count, a cylinder's rim. Each of those dials had a
 * range written down in three places and a default written in four:
 *
 *   - the clamp in `normalize`, which decides what the document may hold;
 *   - the `min`/`max` on the panel's stepper, which decides what you can ask
 *     for;
 *   - the clamp inside the geometry function, which decides what is drawn;
 *   - and the `?? fallback` in each of those, for the untouched case.
 *
 * Four copies of one number is four chances to disagree, and by the time this
 * table was written they already had, in four different ways:
 *
 *   - A CPU's pins were offered up to 16 and stored up to 16, and the outline
 *     clamped them at 6. Pins seven through sixteen were a stepper that moved
 *     and a shape that did not.
 *   - A callout's tail was stored up to 80px and offered up to 64.
 *   - An untouched CPU drew three pins while the panel said six, and an
 *     untouched badge drew a 0.82 scallop while the panel said 0.85. In both
 *     cases the number on screen described a shape nobody was looking at.
 *   - Two of the seven callout tails were implemented, storable, and absent
 *     from the picker.
 *
 * None of those are interesting bugs. They are all the same bug, and the only
 * fix that stays fixed is to stop writing the number down more than once.
 *
 * ## The range is what the geometry honours
 *
 * Where the panel and the outline disagreed the outline won, because it is
 * the one telling the truth: a control whose top half does nothing is worse
 * than a control with a lower ceiling. So the CPU's pins are 2 to 6 here --
 * the cap its author chose deliberately, for a legible package silhouette --
 * rather than the 16 the schema had been claiming.
 */

/** Every geometry field a parametric dial can write. */
export type ShapeParamField =
  | 'skew'
  | 'inset'
  | 'armRatio'
  | 'rimRatio'
  | 'indent'
  | 'tailSize'
  | 'waveHeight'
  | 'pinCount'
  | 'teeth'
  | 'shelfCount'
  | 'innerRatio'
  | 'points';

/**
 * How a stored number is written and edited.
 *
 * `percent` and `depth` are both 0-to-1 ratios shown as percentages; they
 * differ in direction. A donut's hole reads naturally as "how much of it is
 * hole", and a star's spikes read as "how deep they cut" -- which is the
 * *complement* of the inner radius that is actually stored. Storing the ratio
 * and showing the complement is what lets one field serve both without the
 * panel doing arithmetic the table cannot see.
 */
export type ShapeParamUnit = 'percent' | 'depth' | 'px' | 'count';

export interface ShapeParam {
  field: ShapeParamField;
  /** Sentence case, like every other row label in the panel. */
  label: string;
  /** What it does, when the label cannot say it in two words. */
  hint?: string;
  /** Bounds and grain, in the units the field is *stored* in. */
  min: number;
  max: number;
  step: number;
  /** What the shape draws when the field is absent. */
  fallback: number;
  unit: ShapeParamUnit;
}

const PERCENT = (
  field: ShapeParamField,
  label: string,
  [min, max, step]: [number, number, number],
  fallback: number,
  hint?: string
): ShapeParam => ({ field, label, min, max, step, fallback, unit: 'percent', hint });

const COUNT = (
  field: ShapeParamField,
  label: string,
  [min, max]: [number, number],
  fallback: number,
  hint?: string
): ShapeParam => ({ field, label, min, max, step: 1, fallback, unit: 'count', hint });

/** One shape's dials, under the name the panel puts on the group. */
export interface ShapeParamGroup {
  /**
   * The shape's own name.
   *
   * Held here rather than read from the toolbar's `SHAPE_LABELS`, which is
   * keyed by the *presets a user can place* -- a nearly-identical set that
   * omits `polygon` and would need a cast to index by kind. A cast between
   * two lists that are nearly the same is precisely how they stop being the
   * same without anyone noticing.
   */
  label: string;
  params: readonly ShapeParam[];
}

/**
 * The dials, by kind. A kind absent from here has no parametric control, and
 * the panel draws nothing for it rather than an empty group.
 */
export const SHAPE_PARAMS: Partial<Record<ShapeKind, ShapeParamGroup>> = {
  parallelogram: { label: 'Parallelogram', params: [
    PERCENT('skew', 'Slant', [-0.45, 0.45, 0.05], 0.2, 'Which way the sides lean, and how far'),
  ] },
  trapezoid: { label: 'Trapezoid', params: [PERCENT('inset', 'Top inset', [0.05, 0.45, 0.05], 0.2, 'How far the top edge is drawn in')] },
  chevron: { label: 'Chevron', params: [PERCENT('indent', 'Notch', [0.05, 0.5, 0.05], 0.25, 'Depth of the point and the notch behind it')] },
  cross: { label: 'Cross', params: [PERCENT('armRatio', 'Arm width', [0.1, 0.8, 0.05], 0.33)] },
  cylinder: { label: 'Cylinder', params: [PERCENT('rimRatio', 'Rim', [0.05, 0.4, 0.02], 0.18, 'How much of an ellipse the top reads as')] },
  document: { label: 'Document', params: [PERCENT('waveHeight', 'Wave', [0.05, 0.35, 0.02], 0.15, 'Amplitude of the torn bottom edge')] },
  donut: { label: 'Donut', params: [PERCENT('innerRatio', 'Hole', [0.1, 0.9, 0.05], 0.5, 'The hole, as a share of the outer radius')] },
  callout: { label: 'Callout', params: [
    {
      field: 'tailSize',
      label: 'Tail length',
      min: 8,
      max: 64,
      step: 2,
      fallback: 16,
      unit: 'px',
      // The outline also holds it to 40% of the short side, so a tail cannot
      // grow longer than the balloon it comes out of. That is a function of
      // the box rather than of the field, so it is not a bound here.
      hint: 'Capped at 40% of the short side, so the tail stays shorter than the balloon',
    },
  ] },
  cpu: { label: 'Processor', params: [COUNT('pinCount', 'Pins per side', [2, 6], 3, 'Contacts on each edge of the package')] },
  gear: { label: 'Gear', params: [COUNT('teeth', 'Teeth', [4, 24], 8)] },
  server: { label: 'Server rack', params: [COUNT('shelfCount', 'Bays', [2, 6], 3, 'Rack units drawn across the face')] },
  badge: { label: 'Badge', params: [
    COUNT('points', 'Scallops', [6, 36], 12),
    {
      field: 'innerRatio',
      label: 'Depth',
      hint: 'How far the scallops cut in',
      min: 0.55,
      max: 0.95,
      step: 0.05,
      fallback: 0.82,
      unit: 'depth',
    },
  ] },
};

/** The dials for one kind. Never undefined, so a caller can map it directly. */
export function shapeParams(kind: ShapeKind): readonly ShapeParam[] {
  return SHAPE_PARAMS[kind]?.params ?? [];
}

/** The name the panel puts on the group, or nothing if the kind has no dials. */
export function shapeParamLabel(kind: ShapeKind): string | undefined {
  return SHAPE_PARAMS[kind]?.label;
}

/** Held inside its bounds, and whole where whole is the only sensible thing. */
export function clampParam(p: ShapeParam, value: number): number {
  if (!Number.isFinite(value)) return p.fallback;
  const held = Math.max(p.min, Math.min(p.max, value));
  return p.unit === 'count' ? Math.round(held) : held;
}

/** What the geometry currently says, or what it would draw if asked now. */
export function paramValue(geometry: Partial<ShapeGeometry>, p: ShapeParam): number {
  const raw = geometry[p.field];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : p.fallback;
}

/** The stored number as the panel shows it. */
export function toDisplay(p: ShapeParam, stored: number): number {
  if (p.unit === 'percent') return Math.round(stored * 100);
  if (p.unit === 'depth') return Math.round((1 - stored) * 100);
  return Math.round(stored);
}

/** The shown number back as it is stored. Exactly inverts `toDisplay`. */
export function fromDisplay(p: ShapeParam, shown: number): number {
  if (p.unit === 'percent') return shown / 100;
  if (p.unit === 'depth') return 1 - shown / 100;
  return shown;
}

/**
 * The bounds a stepper should carry, in shown units.
 *
 * `depth` reverses them: the smallest stored ratio is the deepest cut, so the
 * bounds swap ends rather than staying put and quietly excluding half the
 * range -- which is what happens if a caller converts `min` and `max`
 * independently and forgets the direction.
 */
export function displayBounds(p: ShapeParam): { min: number; max: number; step: number } {
  if (p.unit === 'depth') {
    return {
      min: Math.round((1 - p.max) * 100),
      max: Math.round((1 - p.min) * 100),
      step: Math.round(p.step * 100),
    };
  }
  if (p.unit === 'percent') {
    return { min: Math.round(p.min * 100), max: Math.round(p.max * 100), step: Math.round(p.step * 100) };
  }
  return { min: p.min, max: p.max, step: p.step };
}

/** The suffix a stepper shows, if any. */
export function paramSuffix(p: ShapeParam): string | undefined {
  if (p.unit === 'percent' || p.unit === 'depth') return '%';
  if (p.unit === 'px') return 'px';
  return undefined;
}

/**
 * Where a callout's tail comes out.
 *
 * All seven are drawn by `calloutAnchors` and all seven are storable, so all
 * seven are offered -- two of them were not, which made them a capability
 * reachable only by editing the document by hand.
 */
export const CALLOUT_TAILS = [
  'top-left',
  'top-right',
  'left',
  'right',
  'bottom-left',
  'bottom',
  'bottom-right',
] as const;

/** Row, column, in a 3x3 pad with the balloon in the middle. */
export const CALLOUT_TAIL_CELLS: Record<(typeof CALLOUT_TAILS)[number], { row: number; col: number }> = {
  'top-left': { row: 1, col: 1 },
  'top-right': { row: 1, col: 3 },
  left: { row: 2, col: 1 },
  right: { row: 2, col: 3 },
  'bottom-left': { row: 3, col: 1 },
  bottom: { row: 3, col: 2 },
  'bottom-right': { row: 3, col: 3 },
};
