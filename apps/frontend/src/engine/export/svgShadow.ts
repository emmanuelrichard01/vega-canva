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
 * - `feMorphology dilate` grows the silhouette by the spread;
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
  knockout = false
): string {
  const spread = Math.max(0, shadow.spread ?? 0);
  const blur = Math.max(0, shadow.blur);
  const opacity = Math.min(1, Math.max(0, shadow.opacity ?? 1));
  const steps: string[] = [];
  let source = 'SourceAlpha';
  if (spread > 0) {
    steps.push(`<feMorphology in="SourceAlpha" operator="dilate" radius="${num(spread)}" result="spread" />`);
    source = 'spread';
  }
  steps.push(`<feGaussianBlur in="${source}" stdDeviation="${num(blur / 2)}" result="blur" />`);
  steps.push(`<feOffset in="blur" dx="${num(shadow.offsetX)}" dy="${num(shadow.offsetY)}" result="offset" />`);
  steps.push(`<feFlood flood-color="${attr(shadow.color)}" flood-opacity="${num(opacity)}" />`);
  steps.push(`<feComposite in2="offset" operator="in" result="shadow" />`);
  if (knockout) steps.push(`<feComposite in="shadow" in2="SourceAlpha" operator="out" result="shadow" />`);
  steps.push(`<feMerge><feMergeNode in="shadow" /><feMergeNode in="SourceGraphic" /></feMerge>`);
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
 * `markup` with the node's drop shadow, or `markup` untouched when it has none.
 *
 * `inkPad` covers ink beyond the box: a stroke's outer half, an arrowhead.
 */
export function withDropShadow(
  node: Pick<AnyNode, 'id' | 'x' | 'y' | 'width' | 'height'> & { appearance?: Appearance },
  markup: string,
  opts: { knockout?: boolean; inkPad?: number } = {}
): string {
  const shadow = node.appearance?.shadow;
  if (!markup || !castsShadow(shadow)) return markup;
  const id = shadowFilterId(node.id);
  const filter = dropShadowFilter(id, shadow, shadowRegion(node, shadow, opts.inkPad ?? 0), opts.knockout);
  return `<defs>${filter}</defs><g filter="url(#${attr(id)})">${markup}</g>`;
}
