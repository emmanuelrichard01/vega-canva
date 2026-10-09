import {
  SITE_NAME,
  unfurlCopy,
  type InviteRole,
  type UnfurlFacts,
} from '../../src/engine/share/unfurl.js';

/**
 * The page a link unfurler reads for a board link.
 *
 * Slack, iMessage, X, LinkedIn, Teams and Discord never run the app: they
 * fetch the URL, read the `<meta>` tags and leave. So a board link used to
 * unfurl as the home page — the same title and picture for every board anyone
 * ever shared. This page is what they get instead (see `vercel.json`): the
 * board's own name, what is on it, whether the link can edit or only view, and
 * a picture of the board. A `?frame=` link names its frame.
 *
 * The words come from `src/engine/share/unfurl.ts`, which the Share dialog's
 * preview also draws from, so the preview there is this page's card.
 *
 * Pure, so it can be tested; `api/share.ts` does the fetching.
 */

export type LinkKind = 'room' | 'invite';
export type { InviteRole };

export interface CardFacts extends UnfurlFacts {
  found: true;
  updatedAt?: string;
  role?: InviteRole;
  version?: string;
}

export interface ShareInput {
  kind: LinkKind;
  id: string;
  site: string;
  facts: CardFacts | null;
  /** The card service answered. When it did not, the picture is a static one. */
  reachable: boolean;
  /** The frame id a `?frame=` link carries, already checked by `safeFrameId`. */
  frame?: string | null;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}

/** A board path that is safe to put back into a URL: ids and tokens only. */
export function safeId(id: string): string | null {
  return /^[A-Za-z0-9_.-]{1,1024}$/.test(id) ? id : null;
}

/** A frame id, as `readFrameTarget` in the app accepts one. */
export function safeFrameId(id: string | null | undefined): string | null {
  return id && /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
}

export function linkPath(kind: LinkKind, id: string, frame?: string | null): string {
  const path = kind === 'room' ? `/room/${id}` : `/i/${id}`;
  return frame ? `${path}?frame=${encodeURIComponent(frame)}` : path;
}

/** The app's own address for a link, with the flag that stops the crawler rewrite from catching it again. */
function onwardPath(kind: LinkKind, id: string, frame?: string | null): string {
  const path = linkPath(kind, id, frame);
  return `${path}${path.includes('?') ? '&' : '?'}app=1`;
}

type Meta = Array<[attr: 'name' | 'property', key: string, value: string]>;

const IMAGE_W = '1200';
const IMAGE_H = '630';
const SQUARE = '1200';

/** One `og:image` and the structured properties that belong to it, in order. */
function ogImage(image: string, width: string, height: string, alt: string): Meta {
  return [
    ['property', 'og:image', image],
    ...(image.startsWith('https:') ? ([['property', 'og:image:secure_url', image]] as Meta) : []),
    ['property', 'og:image:type', 'image/png'],
    ['property', 'og:image:width', width],
    ['property', 'og:image:height', height],
    ['property', 'og:image:alt', alt],
  ];
}

/**
 * The card, 1200×630, first — the one X, Slack, LinkedIn and Discord use —
 * and optionally a 1200×1200 square after it, which WhatsApp and iMessage can
 * pick instead of centre-cropping the wide one.
 *
 * A board's own link never passes a square: its card is the board, and the
 * site's square would put a slogan where the board should be.
 */
export function imageMeta(image: string, alt: string, square?: string): Meta {
  return [
    ...ogImage(image, IMAGE_W, IMAGE_H, alt),
    ...(square ? ogImage(square, SQUARE, SQUARE, alt) : []),
    ['name', 'twitter:image', image],
    ['name', 'twitter:image:alt', alt],
  ];
}

function page(options: { title: string; description: string; url: string; site: string; onward: string; meta: Meta; linkText: string }): string {
  const { title, description, url, site, onward, meta, linkText } = options;
  const all: Meta = [
    ['name', 'description', description],
    // Boards are private by address: never indexed, whoever asks.
    ['name', 'robots', 'noindex, nofollow'],
    ['property', 'og:type', 'website'],
    ['property', 'og:site_name', SITE_NAME],
    ['property', 'og:locale', 'en_US'],
    ['property', 'og:url', url],
    ['property', 'og:title', title],
    ['property', 'og:description', description],
    ['name', 'twitter:card', 'summary_large_image'],
    ['name', 'twitter:title', title],
    ['name', 'twitter:description', description],
    ...meta,
  ];
  // A person who somehow lands here — an in-app browser that looks like a
  // crawler — is sent on. `app=1` is what `vercel.json` checks, so the hop
  // cannot come back to this page and loop.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<link rel="canonical" href="${escapeHtml(url)}">
<link rel="icon" href="${escapeHtml(site)}/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="${escapeHtml(site)}/apple-touch-icon.png">
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#FFFFFF">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#18181B">
${all.map(([attr, key, value]) => `<meta ${attr}="${key}" content="${escapeHtml(value)}">`).join('\n')}
<meta http-equiv="refresh" content="0;url=${escapeHtml(onward)}">
</head>
<body>
<p><a href="${escapeHtml(onward)}">${escapeHtml(linkText)}</a></p>
</body>
</html>
`;
}

export function shareHtml({ kind, id, site, facts, reachable, frame = null }: ShareInput): string {
  const path = linkPath(kind, id, frame);
  const url = `${site}${path}`;
  // A room link edits; an invite says what it allows only when the service
  // vouched for the token.
  const access: InviteRole | null = kind === 'room' ? 'editor' : (facts?.role ?? null);
  const copy = unfurlCopy({ facts, access, framed: !!frame });

  // The picture comes from this site's own edge cache, keyed by the card's
  // version, so a changed board is a new URL and an unchanged one is instant.
  const params = new URLSearchParams({ kind, id });
  if (facts?.version) params.set('v', facts.version);
  // A board that cannot be described gets the static private card, the same
  // picture the server would draw for it, without asking the server at all.
  const image = reachable && facts ? `${site}/api/card-image?${params}` : `${site}/og-board.png`;

  const meta: Meta = imageMeta(image, copy.imageAlt);
  copy.facts.slice(0, 2).forEach((fact, i) => {
    meta.push(['name', `twitter:label${i + 1}`, fact.label], ['name', `twitter:data${i + 1}`, fact.value]);
  });

  return page({
    title: copy.title,
    description: copy.description,
    url,
    site,
    onward: onwardPath(kind, id, frame),
    meta,
    linkText: `Open ${facts?.name ?? 'the board'} on ${SITE_NAME}`,
  });
}
