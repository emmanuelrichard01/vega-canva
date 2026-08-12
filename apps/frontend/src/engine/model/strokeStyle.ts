import { DEFAULT_MITER_LIMIT, type Stroke } from './schema';

/**
 * Stroke styles: the dash patterns a user can actually pick.
 *
 * `Stroke.dash` has been on the schema for the whole life of the project,
 * written by nothing and read by nothing. This module is the half that gives
 * it a purpose — the same judgment `tags` got, where a field with no way to
 * act on it is decoration.
 *
 * ## Why presets rather than a dash-array editor
 *
 * The stored value is an absolute `number[]`, exactly as SVG and Canvas2D
 * define it, so nothing here invents a private format. But a raw array field
 * is the wrong control: "4,2,1,2" is a thing you tune in Illustrator's stroke
 * panel after you already know what you want, not a thing you pick from. Three
 * named styles cover what a canvas actually needs, and a full pattern editor
 * belongs with cap and join controls when the vector work lands.
 *
 * ## Why the geometry is derived from the stroke weight
 *
 * A fixed `[6, 4]` is a clear dashed line on a 1px stroke and a nearly solid
 * one on a 12px stroke, because the gaps stop reading once they are much
 * smaller than the line is thick. Deriving from the weight keeps a dashed line
 * looking dashed at every weight, and `restyleForWidth` re-derives when the
 * weight changes so the style survives the edit instead of quietly degrading.
 */
export type StrokeStyleId = 'solid' | 'dashed' | 'dotted';

export const STROKE_STYLE_IDS: StrokeStyleId[] = ['solid', 'dashed', 'dotted'];

export const STROKE_STYLE_LABELS: Record<StrokeStyleId, string> = {
  solid: 'Solid',
  dashed: 'Dashed',
  dotted: 'Dotted',
};

/** The dash-dependent half of a stroke. Absent keys mean "remove this". */
export interface DashGeometry {
  dash?: number[];
  cap?: Stroke['cap'];
}

/**
 * The weight a pattern is derived from.
 *
 * Clamped at 1 because a 0-width stroke draws nothing at all, and a fractional
 * weight would otherwise produce a dash shorter than a device pixel.
 */
const patternWeight = (width: number): number =>
  Number.isFinite(width) && width > 1 ? width : 1;

/**
 * Dash geometry for a style at a given stroke weight.
 *
 * Dotted is `[0, gap]` with a round cap, which is how both Canvas2D and SVG
 * spell "dot": a zero-length dash has no extent of its own, so what gets drawn
 * is the round cap at each end of nothing. With a butt cap the same array
 * draws nothing whatsoever, which is why the cap travels with the pattern
 * rather than being left to a separate control.
 */
export function dashFor(style: StrokeStyleId, width: number): DashGeometry {
  const w = patternWeight(width);
  switch (style) {
    case 'dashed':
      // Three-on, two-off reads as deliberate at every weight. Equal on/off
      // reads as a ladder, and anything sparser stops reading as one line.
      return { dash: [w * 3, w * 2] };
    case 'dotted':
      return { dash: [0, w * 2], cap: 'round' };
    case 'solid':
    default:
      return {};
  }
}

/**
 * Which style a stored stroke represents.
 *
 * Recognised by *shape*, not by matching the exact numbers `dashFor` would
 * produce. The weight may have changed since the pattern was written, the
 * document may have been authored by an older build, and a future pattern
 * editor will produce arrays no preset would ever generate — all three still
 * have to answer this question, and "dashed" is the honest answer for an
 * arbitrary pattern.
 */
export function styleOf(stroke: Stroke | undefined): StrokeStyleId {
  const dash = stroke?.dash;
  if (!dash || dash.length === 0) return 'solid';
  // Every segment zero is not a pattern, it is an invisible line. Treat it as
  // solid so a corrupt value cannot make a stroke disappear with no way back.
  if (dash.every((n) => n === 0)) return 'solid';
  return dash[0] === 0 ? 'dotted' : 'dashed';
}

/**
 * Re-derive a stroke's dash geometry for a new weight, preserving its style.
 *
 * A solid stroke stays solid and returns nothing to apply, so callers can use
 * this unconditionally on every width change.
 */
export function restyleForWidth(stroke: Stroke | undefined, width: number): DashGeometry {
  return dashFor(styleOf(stroke), width);
}

/**
 * Build a complete `Stroke` for storage.
 *
 * Undefined keys are *omitted* rather than written. `updateNode` treats a
 * top-level `undefined` as "delete this field", but this object is nested
 * inside `appearance`, where it is stored as a plain value — and `undefined`
 * is not representable in a Y.Map, so writing one leaves a literal `undefined`
 * that survives `toJSON()` and defeats every `?? fallback` read downstream.
 * Switching a stroke back to solid has to drop the keys, not blank them.
 */
export function buildStroke(
  base: Pick<Stroke, 'color' | 'width' | 'align' | 'join' | 'miterLimit'>,
  geometry: DashGeometry
): Stroke {
  const stroke: Stroke = { color: base.color, width: base.width };
  if (geometry.dash && geometry.dash.length > 0) stroke.dash = geometry.dash;
  if (geometry.cap) stroke.cap = geometry.cap;
  // `center` is the absent case, so switching back to it drops the key rather
  // than storing the default — the same rule the dash keys follow, and for the
  // same reason.
  if (base.align && base.align !== 'center') stroke.align = base.align;
  // And `miter` is the absent case for the join, with the same reasoning: it
  // is what every stroke already draws.
  if (base.join && base.join !== 'miter') stroke.join = base.join;
  // The limit is only meaningful while the join is a miter, so it is dropped
  // along with it — storing a cutoff for a join that has been switched to
  // round leaves a number that does nothing and reappears if you switch back.
  if ((!base.join || base.join === 'miter') && base.miterLimit !== undefined && base.miterLimit !== DEFAULT_MITER_LIMIT) {
    stroke.miterLimit = base.miterLimit;
  }
  return stroke;
}
