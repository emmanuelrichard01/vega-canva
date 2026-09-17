import { layoutLinkCard, resolveDisplay } from './linkLayout';
import { providerFor, siteDomain } from './linkProviders';
import type { LinkSpec } from './linkTypes';
import { LINK_CARD } from './linkStyle';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * A link card as SVG.
 *
 * An embed exports as its card: a live player cannot be a file, and a
 * rectangle where the video was would be worse than the poster and the title.
 * The whole card is an `<a>`, so an exported board still goes where it pointed.
 */
export function linkToSvg(spec: LinkSpec, width: number, height: number, id: string): string {
  const provider = providerFor(spec.url);
  const display = resolveDisplay(spec.display, width, height, Boolean(provider.embed));
  const meta = spec.meta;
  const layout = layoutLinkCard(display, width, height, Boolean(meta?.image), Boolean(meta?.description));
  const clip = `link-clip-${id.replace(/[^\w-]/g, '')}`;
  const title = meta?.title || siteDomain(spec.url);
  const site = meta?.siteName || provider.detail || siteDomain(spec.url);
  const font = LINK_CARD.font;

  const parts = [
    `<a href="${esc(spec.url)}" target="_blank">`,
    `<defs><clipPath id="${clip}"><rect width="${width}" height="${height}" rx="${layout.radius}"/></clipPath></defs>`,
    `<g clip-path="url(#${clip})">`,
    `<rect width="${width}" height="${height}" fill="${LINK_CARD.background}"/>`,
  ];

  if (layout.media) {
    const r = layout.media;
    parts.push(`<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" fill="${LINK_CARD.mediaGround}"/>`);
    if (meta?.image) {
      parts.push(`<image href="${esc(meta.image)}" x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" preserveAspectRatio="xMidYMid slice"/>`);
    }
  }

  const i = layout.icon;
  parts.push(`<rect x="${i.x}" y="${i.y}" width="${i.size}" height="${i.size}" rx="${i.size * 0.25}" fill="${provider.accent}" fill-opacity="0.14"/>`);
  if (meta?.favicon) {
    const pad = display === 'compact' ? i.size * 0.22 : 0;
    parts.push(`<image href="${esc(meta.favicon)}" x="${i.x + pad}" y="${i.y + pad}" width="${i.size - pad * 2}" height="${i.size - pad * 2}"/>`);
  }

  if (layout.site.width > 0) {
    parts.push(`<text x="${layout.site.x}" y="${layout.site.y + 12}" font-family="${esc(font)}" font-size="12" font-weight="500" fill="${LINK_CARD.muted}">${esc(site)}</text>`);
  }
  if (display === 'compact') {
    parts.push(`<text x="${layout.title.x}" y="${layout.site.y + 12}" font-family="${esc(font)}" font-size="12" fill="${LINK_CARD.muted}">${esc(siteDomain(spec.url))}</text>`);
  }
  parts.push(
    `<text x="${layout.title.x}" y="${layout.title.y + layout.title.fontSize}" font-family="${esc(font)}" font-size="${layout.title.fontSize}" font-weight="600" fill="${LINK_CARD.text}">${esc(title.slice(0, 90))}</text>`
  );
  if (layout.description && meta?.description) {
    const d = layout.description;
    parts.push(`<text x="${d.x}" y="${d.y + d.fontSize}" font-family="${esc(font)}" font-size="${d.fontSize}" fill="${LINK_CARD.muted}">${esc(meta.description.slice(0, 120))}</text>`);
  }
  parts.push('</g>');
  parts.push(`<rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="${layout.radius}" fill="none" stroke="${LINK_CARD.border}"/>`);
  parts.push('</a>');
  return parts.join('');
}
