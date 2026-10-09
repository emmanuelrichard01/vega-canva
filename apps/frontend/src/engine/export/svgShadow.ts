import type { AnyNode, Appearance, Shadow } from '../model/schema';
import { castsShadow, shadowReach } from '../model/dropShadow';
import { attr, num } from './markup';

/**
 * The drop shadow in an SVG file, matching the board.
 *
 * A filter on a `<g>` around everything the object inks works on the group's
 * combined alpha, so the file casts one shadow from the whole silhouette for
 * the same reason the canvas does (`DropShadow`): fill and stroke are never
 * cast twice. The chain, primitive by primitive:
 *
 * - `feMorphology` grows the silhouette by the spread (`dilate`), or shrinks
 *   it for a negative one (`erode`). Morphology is a square: it keeps a
 *   rounded corner's radius instead of growing it, so a filled rectangle or
 *   ellipse casts from an explicit grown outline instead (`silhouette`);
 * - `feGaussianBlur` at `blur / 2`, because a canvas `shadowBlur` is twice the
 *   Gaussian's sigma (CSS's `box-shadow` blur means the same thing);
 * - `feOffset` moves it. The group carries no transform of its own, so the
 *   offset is in the board's frame: a rotated object casts downwards here as
 *   it does on the canvas;
 * - flood and `in` colour it; `out` against the source cuts it from under
 *   translucent ink, as the canvas knockout does;
 * - merged under the artwork.
 *
 * The region is in user space and sized from the object's box and the
 * shadow's reach. The default region (the bounding box plus 10%) cuts a large
 * blur off flat.
 */

/** A filter id that is safe in a URL reference and unique per object. */
export function shadowFilterId(nodeId: string): string {
  return `ds-${nodeId.replace(/[^A-Za-z0-9_-]/g, '')}`;
}

export function dropShadowFilter(
  id: string,
  shadow: Shadow,
  region: { x: number; y: number; width: number; height: number },
  knockout = false,
  /** Only the shadow, for a silhouette element drawn on its own: no spread, no artwork merged back. */
  shadowOnly = false
): string {
  const spread = shadowOnly ? 0 : (shadow.spread ?? 0);
  const blur = Math.max(0, shadow.blur);
  const opacity = Math.min(1, Math.max(0, shadow.opacity ?? 1));
  const steps: string[] = [];
  let source = 'SourceAlpha';
  if (spread !== 0) {
    const op = spread > 0 ? 'dilate' : 'erode';
    steps.push(`<feMorphology in="SourceAlpha" operator="${op}" radius="${num(Math.abs(spread))}" result="spread" />`);
    source = 'spread';
  }
  steps.push(`<feGaussianBlur in="${source}" stdDeviation="${num(blur / 2)}" result="blur" />`);
  steps.push(`<feOffset in="blur" dx="${num(shadow.offsetX)}" dy="${num(shadow.offsetY)}" result="offset" />`);
  steps.push(`<feFlood flood-color="${attr(shadow.color)}" flood-opacity="${num(opacity)}" />`);
  steps.push(`<feComposite in2="offset" operator="in" result="shadow" />`);
  if (knockout && !shadowOnly) steps.push(`<feComposite in="shadow" in2="SourceAlpha" operator="out" result="shadow" />`);
  if (!shadowOnly) steps.push(`<feMerge><feMergeNode in="shadow" /><feMergeNode in="SourceGraphic" /></feMerge>`);
  return (
    `<filter id="${attr(id)}" filterUnits="userSpaceOnUse" x="${num(region.x)}" y="${num(region.y)}" ` +
    `width="${num(region.width)}" height="${num(region.height)}" color-interpolation-filters="sRGB">` +
    steps.join('') +
    `</filter>`
  );
}

/**
 * An inner shadow as an SVG filter, applied to the object's outline filled in
 * any opaque colour. Its output is the shadow alone, so the outline itself
 * never shows.
 *
 * - `erode` by the stroke's inner reach: the shadow is cast by the stroke's
 *   inner edge and stays off the stroke, as on the canvas;
 * - the alpha inverted: everything outside the hole;
 * - grown inward by the spread (`dilate`), or pulled back (`erode`);
 * - blurred at `blur / 2`, offset, coloured;
 * - cut back to the hole.
 */
export function innerShadowFilter(
  id: string,
  shadow: Shadow,
  region: { x: number; y: number; width: number; height: number },
  inset = 0
): string {
  const spread = shadow.spread ?? 0;
  const blur = Math.max(0, shadow.blur);
  const opacity = Math.min(1, Math.max(0, shadow.opacity ?? 1));
  const steps: string[] = [];
  let hole = 'SourceAlpha';
  if (inset > 0) {
    steps.push(`<feMorphology in="SourceAlpha" operator="erode" radius="${num(inset)}" result="hole" />`);
    hole = 'hole';
  }
  steps.push(`<feComponentTransfer in="${hole}" result="outside"><feFuncA type="table" tableValues="1 0" /></feComponentTransfer>`);
  let outside = 'outside';
  if (spread !== 0) {
    const op = spread > 0 ? 'dilate' : 'erode';
    steps.push(`<feMorphology in="outside" operator="${op}" radius="${num(Math.abs(spread))}" result="grown" />`);
    outside = 'grown';
  }
  steps.push(`<feGaussianBlur in="${outside}" stdDeviation="${num(blur / 2)}" result="blur" />`);
  steps.push(`<feOffset in="blur" dx="${num(shadow.offsetX)}" dy="${num(shadow.offsetY)}" result="offset" />`);
  steps.push(`<feFlood flood-color="${attr(shadow.color)}" flood-opacity="${num(opacity)}" />`);
  steps.push(`<feComposite in2="offset" operator="in" result="shadow" />`);
  steps.push(`<feComposite in="shadow" in2="${hole}" operator="in" />`);
  return (
    `<filter id="${attr(id)}" filterUnits="userSpaceOnUse" x="${num(region.x)}" y="${num(region.y)}" ` +
    `width="${num(region.width)}" height="${num(region.height)}" color-interpolation-filters="sRGB">` +
    steps.join('') +
    `</filter>`
  );
}

/**
 * The user-space region a node's shadow can occupy: its box, rotated any way
 * (so the circle through its corners), its stroke and markers, and the reach.
 */
export function shadowRegion(node: Pick<AnyNode, 'x' | 'y' | 'width' | 'height'>, shadow: Shadow, inkPad = 0) {
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  const r = Math.hypot(node.width, node.height) / 2 + inkPad + shadowReach(shadow);
  return { x: cx - r, y: cy - r, width: r * 2, height: r * 2 };
}

/**
 * An explicit silhouette for the shadow: the object's outline already grown
 * by its stroke and the spread, as path data in board units before the
 * object's own transform. `hole` is the ungrown outline, which the shadow is
 * cut away from under when the ink is translucent.
 */
export interface ShadowSilhouetteMarkup {
  d: string;
  hole: string;
  /** The object's ` transform="…"` attribute, or ''. */
  transform: string;
}

/**
 * `markup` with the node's drop shadow, or `markup` untouched when it has none.
 *
 * `inkPad` covers ink beyond the box: a stroke's outer half, an arrowhead.
 * With a `silhouette`, the shadow is cast by that outline instead of by the
 * artwork's grown alpha, which keeps a grown rounded corner round.
 */
export function withDropShadow(
  node: Pick<AnyNode, 'id' | 'x' | 'y' | 'width' | 'height'> & { appearance?: Appearance },
  markup: string,
  opts: { knockout?: boolean; inkPad?: number; silhouette?: ShadowSilhouetteMarkup } = {}
): string {
  const shadow = node.appearance?.shadow;
  if (!markup || !castsShadow(shadow)) return markup;
  const id = shadowFilterId(node.id);
  const region = shadowRegion(node, shadow, opts.inkPad ?? 0);
  const sil = opts.silhouette;
  if (sil) {
    const filter = dropShadowFilter(id, shadow, region, false, true);
    const maskId = `${id}-k`;
    const mask = opts.knockout
      ? `<mask id="${attr(maskId)}" maskUnits="userSpaceOnUse" x="${num(region.x)}" y="${num(region.y)}" width="${num(region.width)}" height="${num(region.height)}">` +
        `<rect x="${num(region.x)}" y="${num(region.y)}" width="${num(region.width)}" height="${num(region.height)}" fill="#fff" />` +
        `<path d="${sil.hole}" fill="#000"${sil.transform} /></mask>`
      : '';
    const masked = opts.knockout ? ` mask="url(#${attr(maskId)})"` : '';
    return (
      `<defs>${filter}${mask}</defs>` +
      `<g filter="url(#${attr(id)})"${masked}><path d="${sil.d}" fill="#000"${sil.transform} /></g>` +
      markup
    );
  }
  const filter = dropShadowFilter(id, shadow, region, opts.knockout);
  return `<defs>${filter}</defs><g filter="url(#${attr(id)})">${markup}</g>`;
}

/**
 * The node's inner shadow, drawn over its artwork, or ''.
 *
 * `hole` is the object's outline as path data before its transform; `rule` is
 * its fill rule. The group carries no transform, so the offset falls in the
 * board's frame, as on the canvas.
 */
export function innerShadowMarkup(
  node: Pick<AnyNode, 'id' | 'x' | 'y' | 'width' | 'height'> & { appearance?: Appearance },
  hole: string,
  opts: { transform?: string; inset?: number; rule?: 'nonzero' | 'evenodd' } = {}
): string {
  const shadow = node.appearance?.innerShadow;
  if (!hole || !castsShadow(shadow)) return '';
  const id = `is-${shadowFilterId(node.id).slice(3)}`;
  const filter = innerShadowFilter(id, shadow, shadowRegion(node, shadow), opts.inset ?? 0);
  const rule = opts.rule === 'evenodd' ? ' fill-rule="evenodd"' : '';
  return `<defs>${filter}</defs><g filter="url(#${attr(id)})"><path d="${hole}" fill="#000"${rule}${opts.transform ?? ''} /></g>`;
}
