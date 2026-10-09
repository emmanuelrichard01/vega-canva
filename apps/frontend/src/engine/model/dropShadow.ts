import type { Paint } from './paint';
import { DEFAULT_SHADOW_COLOR, type Appearance, type Shadow } from './schema';

/**
 * The drop shadow, as geometry: what casts it, how far it reaches, and the
 * presets the panel offers. Pure, so the rules are tested without a canvas;
 * `ShapeEffects.DropShadow` is the part that paints.
 *
 * ## One silhouette, one shadow
 *
 * A shadow is cast by everything the object inks — its fill, its stroke, its
 * arrowheads — taken together. Casting from each of those separately is how a
 * shape ends up with two shadows laid over each other (darker wherever the
 * stroke overlaps the fill) or with none at all (Konva skips a stroke's shadow
 * unless told otherwise, so an unfilled outline cast nothing). The renderer
 * paints the whole silhouette once, into a scratch bitmap, and casts from that.
 *
 * ## Units
 *
 * Blur, offset and spread are world units, so a shadow scales with the board
 * the way the object does. Blur follows Canvas2D: `blur` is twice the Gaussian
 * sigma, which is what `shadowBlur` and CSS `box-shadow` both mean by it, so
 * the SVG export writes `stdDeviation = blur / 2`.
 *
 * The offset falls in the screen's frame, not the object's: a rotated card
 * still casts its shadow downwards, as it would on a desk under a ceiling
 * light. That is what Konva's own shadows do, and the export matches it.
 */

/** A named shadow, for the panel's preset menu. */
export interface ShadowPreset<Id extends string = string> {
  id: Id;
  label: string;
  shadow: Shadow;
}

/**
 * Three elevations, close to how FigJam and Figma step theirs: a contact
 * shadow, a resting card, and something held above the board.
 *
 * Opacity is tuned to read on the dark board as well as the light one — a
 * 25% black at a 12px blur all but disappears on a near-black canvas, so the
 * larger lifts carry more ink than a light-only scale would. The lifted step
 * pulls its silhouette in by a few units, so the long blur reads as height
 * rather than as a grey halo spreading past the card's sides.
 */
export const SHADOW_PRESETS: readonly ShadowPreset<'subtle' | 'medium' | 'lifted'>[] = [
  {
    id: 'subtle',
    label: 'Subtle',
    shadow: { color: DEFAULT_SHADOW_COLOR, offsetX: 0, offsetY: 1, blur: 3, spread: 0, opacity: 0.18 },
  },
  {
    id: 'medium',
    label: 'Medium',
    shadow: { color: DEFAULT_SHADOW_COLOR, offsetX: 0, offsetY: 4, blur: 12, spread: 0, opacity: 0.25 },
  },
  {
    id: 'lifted',
    label: 'Lifted',
    shadow: { color: DEFAULT_SHADOW_COLOR, offsetX: 0, offsetY: 12, blur: 28, spread: -4, opacity: 0.3 },
  },
];

/** What a new drop shadow starts as: the resting card. */
export const DEFAULT_DROP_SHADOW: Shadow = SHADOW_PRESETS[1].shadow;

/**
 * Three inner shadows: a soft inset along the top edge, a pressed well, and a
 * deep recess. Inner shadows read darker than drop shadows at the same
 * opacity, because they sit on the object's own fill rather than on the board.
 */
export const INNER_SHADOW_PRESETS: readonly ShadowPreset<'soft' | 'pressed' | 'deep'>[] = [
  {
    id: 'soft',
    label: 'Soft',
    shadow: { color: DEFAULT_SHADOW_COLOR, offsetX: 0, offsetY: 1, blur: 4, spread: 0, opacity: 0.2 },
  },
  {
    id: 'pressed',
    label: 'Pressed',
    shadow: { color: DEFAULT_SHADOW_COLOR, offsetX: 0, offsetY: 2, blur: 8, spread: 0, opacity: 0.35 },
  },
  {
    id: 'deep',
    label: 'Deep',
    shadow: { color: DEFAULT_SHADOW_COLOR, offsetX: 0, offsetY: 4, blur: 16, spread: 2, opacity: 0.4 },
  },
];

/** What a new inner shadow starts as: the pressed well. */
export const DEFAULT_INNER_SHADOW: Shadow = INNER_SHADOW_PRESETS[1].shadow;

/** The preset a shadow matches exactly, ignoring its colour and visibility, or null. */
export function presetOf<Id extends string = ShadowPreset['id']>(
  shadow: Shadow | undefined,
  presets: readonly ShadowPreset<Id>[] = SHADOW_PRESETS as unknown as readonly ShadowPreset<Id>[]
): Id | null {
  if (!shadow) return null;
  const same = (a: number | undefined, b: number | undefined) => Math.abs((a ?? 0) - (b ?? 0)) < 1e-6;
  const hit = presets.find(
    ({ shadow: p }) =>
      same(shadow.offsetX, p.offsetX) &&
      same(shadow.offsetY, p.offsetY) &&
      same(shadow.blur, p.blur) &&
      same(shadow.spread, p.spread) &&
      same(shadow.opacity ?? 1, p.opacity)
  );
  return hit ? hit.id : null;
}

/** Fine control: half a unit per step, as Figma's effect fields move. */
export const SHADOW_STEP = 0.5;
export const MAX_SHADOW_BLUR = 200;
export const MAX_SHADOW_SPREAD = 100;
/** Spread goes negative as far as it goes positive: a shrunk silhouette under a long blur. */
export const MIN_SHADOW_SPREAD = -MAX_SHADOW_SPREAD;
export const MAX_SHADOW_OFFSET = 500;

/**
 * How far past the ink a shadow can show, in the object's own units.
 *
 * The Gaussian behind a canvas shadow has sigma `blur / 2`, and three sigma —
 * `1.5 * blur` — is where nothing worth drawing is left. Spread grows the
 * silhouette before the blur, and the offset moves the lot.
 */
export function shadowReach(shadow: Shadow): number {
  const blur = Math.max(0, shadow.blur);
  const spread = Math.max(0, shadow.spread ?? 0);
  return Math.ceil(spread + blur * 1.5 + Math.max(Math.abs(shadow.offsetX), Math.abs(shadow.offsetY))) + 1;
}

/**
 * Whether a colour string carries any transparency of its own.
 *
 * `#rgba` / `#rrggbbaa`, `rgba()` / `hsla()` with an alpha below one, the
 * slash form (`rgb(0 0 0 / 50%)`), and `transparent`. Anything unrecognised is
 * treated as opaque, which only costs a knockout that was not needed.
 */
export function colorHasAlpha(color: string | undefined): boolean {
  if (!color) return false;
  const c = color.trim().toLowerCase();
  if (c === 'transparent') return true;
  if (c[0] === '#') {
    const body = c.slice(1);
    if (body.length === 4) return body[3] !== 'f';
    if (body.length === 8) return body.slice(6) !== 'ff';
    return false;
  }
  const fn = /^(?:rgba?|hsla?)\((.*)\)$/.exec(c);
  if (!fn) return false;
  const args = fn[1].includes('/') ? fn[1].split('/') : fn[1].split(',');
  if (fn[1].includes('/') ? args.length < 2 : args.length < 4) return false;
  const raw = args[args.length - 1].trim();
  const alpha = raw.endsWith('%') ? parseFloat(raw) / 100 : parseFloat(raw);
  return Number.isFinite(alpha) && alpha < 1;
}

/** Whether a paint covers what is beneath it completely. */
export function paintIsOpaque(paint: Paint | undefined): boolean {
  if (!paint) return false;
  if ((paint.opacity ?? 1) < 1) return false;
  if (paint.type === 'solid') return !colorHasAlpha(paint.color);
  return paint.stops.every((s) => (s.opacity ?? 1) >= 1 && !colorHasAlpha(s.color));
}

/** What an object inks, as far as its shadow is concerned. */
export interface ShadowInkSummary {
  /** It has an interior painted with something. */
  filled: boolean;
  /** That interior hides what is under it completely. */
  fillOpaque: boolean;
  /** It draws a visible line. */
  stroked: boolean;
  /** That line hides what is under it completely. */
  strokeOpaque: boolean;
}

/** Whether a paint puts anything on the board at all. `NO_FILL` is a transparent solid. */
export function paintDraws(paint: Paint | undefined): boolean {
  if (!paint || (paint.opacity ?? 1) <= 0) return false;
  return paint.type !== 'solid' || paint.color !== 'transparent';
}

/**
 * Read the ink summary straight off an appearance.
 *
 * `absentFill` says what a missing fill draws for this renderer: a crisp shape
 * falls back to its default paint (opaque), a path draws no interior at all.
 * `stroked` overrides the stored stroke for a renderer that always draws a
 * line (a run with no weight stored still draws one at 2).
 */
export function inkOf(
  appearance: Appearance | undefined,
  opts: { absentFill?: boolean; stroked?: boolean } = {}
): ShadowInkSummary {
  const fill = appearance?.fill?.[0];
  const stroke = appearance?.stroke;
  const filled = fill ? paintDraws(fill) : Boolean(opts.absentFill);
  const stroked = opts.stroked ?? Boolean(stroke && stroke.width > 0 && stroke.color && stroke.color !== 'transparent');
  return {
    filled,
    fillOpaque: filled && (fill ? paintIsOpaque(fill) : true),
    stroked,
    strokeOpaque: stroked && !colorHasAlpha(stroke?.color),
  };
}

/**
 * Whether the shadow must be cut away from under the object's own ink.
 *
 * CSS clips `box-shadow` to outside the border box and Figma hides a shadow
 * behind transparent areas by default, for the same reason: a shadow seen
 * *through* a translucent fill reads as a dirty fill, not as depth. An opaque
 * object hides the shadow under it anyway, so the cut is only made where it
 * would show — and only there, because cutting along an opaque edge leaves a
 * faint light seam where the edge's own anti-aliasing used to sit on shadow.
 */
export function needsKnockout(ink: ShadowInkSummary): boolean {
  if (ink.filled) return !ink.fillOpaque || (ink.stroked && !ink.strokeOpaque);
  return ink.stroked && !ink.strokeOpaque;
}

/** A shadow worth drawing: present, shown, and not fully transparent. */
export function castsShadow(shadow: Shadow | undefined): shadow is Shadow {
  return Boolean(shadow) && shadow!.visible !== false && (shadow!.opacity ?? 1) > 0 && shadow!.color !== 'transparent';
}

/**
 * The corner radii of a rounded rectangle grown by `grow` on every side.
 *
 * A rounded corner keeps its centre and gains the growth, so it stays
 * concentric with the shape: `r + grow`, never below zero. A square corner
 * stays square, as CSS `box-shadow` and Figma both draw a spread square card:
 * rounding it by the spread would make a sharp card cast a soft-cornered
 * shadow. Fitted to the grown box, so a shrunk silhouette cannot invert.
 */
export function grownRadii(
  radii: readonly [number, number, number, number],
  width: number,
  height: number,
  grow: number
): [number, number, number, number] {
  const w = Math.max(0, width + grow * 2);
  const h = Math.max(0, height + grow * 2);
  const out = radii.map((r) => (r > 0 ? Math.max(0, r + grow) : 0)) as [number, number, number, number];
  // The same rule as `fitRadii`: scale every corner by the worst edge.
  const [tl, tr, br, bl] = out;
  const ratio = Math.min(
    1,
    tl + tr > 0 ? w / (tl + tr) : Infinity,
    bl + br > 0 ? w / (bl + br) : Infinity,
    tl + bl > 0 ? h / (tl + bl) : Infinity,
    tr + br > 0 ? h / (tr + br) : Infinity
  );
  return out.map((r) => r * ratio) as [number, number, number, number];
}

/**
 * How far into an object its inner shadow starts: the inner half of a centred
 * stroke, all of an inside one, none of an outside one. The shadow is cast by
 * the stroke's inner edge, as CSS casts an inset shadow from the padding box,
 * so it never paints over the object's own outline.
 */
export function innerShadowInset(stroke: { width: number; align?: string } | undefined, stroked: boolean): number {
  if (!stroked || !stroke || !(stroke.width > 0)) return 0;
  const align = stroke.align ?? 'center';
  if (align === 'outside') return 0;
  return align === 'inside' ? stroke.width : stroke.width / 2;
}

/**
 * The device-pixel rectangles an inner shadow works in.
 *
 * `out` is the object's own box on the canvas: an inner shadow never lands
 * outside it. `ink` is the part of "everything outside the hole" that can
 * reach `out` once offset and blurred, so it is `out` moved back by the
 * offset and grown by three sigma.
 */
export function innerCastRegions(
  box: DeviceRect,
  canvas: { width: number; height: number },
  blurPx: number,
  offset: { x: number; y: number }
): { ink: DeviceRect; out: DeviceRect } | null {
  const x0 = Math.max(0, Math.floor(box.x));
  const y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(canvas.width, Math.ceil(box.x + box.width));
  const y1 = Math.min(canvas.height, Math.ceil(box.y + box.height));
  if (x1 <= x0 || y1 <= y0) return null;
  const reach = Math.ceil(Math.max(0, blurPx) * 1.5) + 2;
  const out = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  const ink = {
    x: Math.floor(out.x - offset.x - reach),
    y: Math.floor(out.y - offset.y - reach),
    width: Math.ceil(out.width + reach * 2) + 1,
    height: Math.ceil(out.height + reach * 2) + 1,
  };
  return { ink, out };
}

/**
 * The device-pixel rectangles one cast works in.
 *
 * `ink` is the silhouette's own box (already in device pixels). The shadow
 * lands at `ink` moved by the offset and grown by three sigma; only the part
 * of that on the canvas is computed, and only the ink that can reach it is
 * painted. Both are clipped so that a shape zoomed to fill the screen never
 * asks for a scratch bitmap larger than the screen.
 */
export interface DeviceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function castRegions(
  ink: DeviceRect,
  canvas: { width: number; height: number },
  blurPx: number,
  offset: { x: number; y: number }
): { ink: DeviceRect; shadow: DeviceRect } | null {
  const reach = Math.ceil(Math.max(0, blurPx) * 1.5) + 2;
  const sx0 = Math.max(0, Math.floor(ink.x + offset.x - reach));
  const sy0 = Math.max(0, Math.floor(ink.y + offset.y - reach));
  const sx1 = Math.min(canvas.width, Math.ceil(ink.x + ink.width + offset.x + reach));
  const sy1 = Math.min(canvas.height, Math.ceil(ink.y + ink.height + offset.y + reach));
  if (sx1 <= sx0 || sy1 <= sy0) return null;
  // Only ink within one reach of the visible shadow can contribute to it.
  const ix0 = Math.max(Math.floor(ink.x), sx0 - offset.x - reach);
  const iy0 = Math.max(Math.floor(ink.y), sy0 - offset.y - reach);
  const ix1 = Math.min(Math.ceil(ink.x + ink.width), sx1 - offset.x + reach);
  const iy1 = Math.min(Math.ceil(ink.y + ink.height), sy1 - offset.y + reach);
  if (ix1 <= ix0 || iy1 <= iy0) return null;
  return {
    ink: { x: Math.floor(ix0), y: Math.floor(iy0), width: Math.ceil(ix1 - ix0), height: Math.ceil(iy1 - iy0) },
    shadow: { x: sx0, y: sy0, width: sx1 - sx0, height: sy1 - sy0 },
  };
}

/** The device box of a local rectangle under a 2D affine transform. */
export function deviceBox(
  m: { a: number; b: number; c: number; d: number; e: number; f: number },
  r: DeviceRect
): DeviceRect {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [x, y] of [
    [r.x, r.y],
    [r.x + r.width, r.y],
    [r.x + r.width, r.y + r.height],
    [r.x, r.y + r.height],
  ]) {
    xs.push(m.a * x + m.c * y + m.e);
    ys.push(m.b * x + m.d * y + m.f);
  }
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}
