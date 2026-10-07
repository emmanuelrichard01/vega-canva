import { attr, escapeXml, num } from '../export/markup';
import type { AnyNode } from '../model/schema';
import { ensureIcons, iconEntryNow } from './iconPacks';
import { fitBox, tinted } from './iconCache';
import type { IconEntry } from './iconTypes';

/**
 * An icon as SVG, for export.
 *
 * The same sanitised path records the canvas draws, laid out by the same
 * `fitBox`, so the file matches the board. Every value interpolated is a
 * validated colour or a number; there is no markup in the pack to copy across.
 */
export const ICON_LABEL_GAP = 6;
export const ICON_LABEL_SIZE = 13;

/** Wait for the packs behind every icon in `nodes`, so the walk can stay synchronous. */
export async function preloadIcons(nodes: AnyNode[]): Promise<void> {
  const refs = nodes.flatMap((n) => (n.type === 'icon' ? [{ pack: n.pack, iconId: n.iconId }] : []));
  if (refs.length) await ensureIcons(refs);
}

const placeholder = (w: number, h: number) =>
  `<rect width="${num(w)}" height="${num(h)}" rx="${num(Math.min(w, h) * 0.12)}" fill="#e7e7ea" stroke="#9a9ca3" stroke-width="1"/>`;

export function iconArtToSvg(entry: IconEntry, w: number, h: number, colour?: string): string {
  const fit = fitBox({ w: entry.v[0], h: entry.v[1] }, w, h);
  const body = entry.p
    .map((p) => {
      const a: string[] = [`d="${attr(p.d)}"`];
      a.push(p.f ? `fill="${attr(tinted(p.f, colour))}"` : 'fill="none"');
      if (p.f && p.fo !== undefined) a.push(`fill-opacity="${num(p.fo)}"`);
      if (p.eo) a.push('fill-rule="evenodd"');
      if (p.s) {
        a.push(`stroke="${attr(tinted(p.s, colour))}"`, `stroke-width="${num(p.sw ?? 1)}"`);
        if (p.so !== undefined) a.push(`stroke-opacity="${num(p.so)}"`);
        if (p.lc === 'round' || p.lc === 'square') a.push(`stroke-linecap="${p.lc}"`);
        if (p.lj === 'round' || p.lj === 'bevel') a.push(`stroke-linejoin="${p.lj}"`);
      }
      if (p.m && p.m.length === 6) a.push(`transform="matrix(${p.m.map(num).join(' ')})"`);
      return `<path ${a.join(' ')}/>`;
    })
    .join('');
  return `<g transform="translate(${num(fit.x)} ${num(fit.y)}) scale(${num(fit.s)})">${body}</g>`;
}

/** The icon and its caption, with the origin at the node's top-left. */
export function iconToSvg(node: { pack: string; iconId: string; colour?: string; label?: string }, w: number, h: number): string {
  const entry = iconEntryNow(node.pack, node.iconId);
  let out = entry ? iconArtToSvg(entry, w, h, node.colour) : placeholder(w, h);
  if (node.label) {
    out +=
      `<text x="${num(w / 2)}" y="${num(h + ICON_LABEL_GAP + ICON_LABEL_SIZE)}" text-anchor="middle" ` +
      `font-family="Inter, sans-serif" font-size="${ICON_LABEL_SIZE}" fill="#222427">${escapeXml(node.label)}</text>`;
  }
  return out;
}
