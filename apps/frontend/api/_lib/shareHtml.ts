/**
 * The page a link unfurler reads for a board link.
 *
 * Slack, iMessage, X, LinkedIn, Teams and Discord never run the app: they
 * fetch the URL, read the `<meta>` tags and leave. So a board link used to
 * unfurl as the home page — the same title and picture for every board anyone
 * ever shared. This page is what they get instead (see `vercel.json`): the
 * board's own name, what is on it, whether the link can edit or only view, and
 * a picture of the board.
 *
 * Pure, so it can be tested; `api/share.ts` does the fetching.
 */

export type LinkKind = 'room' | 'invite';
export type InviteRole = 'viewer' | 'commenter' | 'editor';

export interface CardFacts {
  found: true;
  name: string;
  total: number;
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
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}

const ACCESS: Record<InviteRole, string> = {
  editor: 'Can edit',
  commenter: 'Can comment',
  viewer: 'View only',
};

/** A board path that is safe to put back into a URL: ids and tokens only. */
export function safeId(id: string): string | null {
  return /^[A-Za-z0-9_.-]{1,1024}$/.test(id) ? id : null;
}

export function linkPath(kind: LinkKind, id: string): string {
  return kind === 'room' ? `/room/${id}` : `/i/${id}`;
}

export function shareHtml({ kind, id, site, facts, reachable }: ShareInput): string {
  const path = linkPath(kind, id);
  const url = `${site}${path}`;
  const access = kind === 'room' ? ACCESS.editor : facts?.role ? ACCESS[facts.role] : null;

  const title = facts ? `${facts.name} | Vega Studio` : 'A board on Vega Studio';
  const contents = facts
    ? facts.total === 0
      ? 'An empty board'
      : `${facts.total.toLocaleString('en-US')} object${facts.total === 1 ? '' : 's'} on the board`
    : null;
  const description = facts
    ? `${contents}. Open it to ${access === ACCESS.viewer ? 'look around' : 'draw, write and comment together'}, live, on Vega Studio.`
    : 'Open the link to see the board and work on it together, live.';

  // The picture comes from this site's own edge cache, keyed by the card's
  // version, so a changed board is a new URL and an unchanged one is instant.
  const params = new URLSearchParams({ kind, id });
  if (facts?.version) params.set('v', facts.version);
  const image = reachable ? `${site}/api/card-image?${params}` : `${site}/og-board.png`;
  const alt = facts ? `${facts.name}: a picture of the board` : 'A board on Vega Studio';

  const meta: Array<[string, string, string]> = [
    ['name', 'description', description],
    ['name', 'robots', 'noindex, nofollow'],
    ['name', 'theme-color', '#FFFFFF'],
    ['property', 'og:type', 'website'],
    ['property', 'og:site_name', 'Vega Studio'],
    ['property', 'og:url', url],
    ['property', 'og:title', title],
    ['property', 'og:description', description],
    ['property', 'og:image', image],
    ['property', 'og:image:type', 'image/png'],
    ['property', 'og:image:width', '1200'],
    ['property', 'og:image:height', '630'],
    ['property', 'og:image:alt', alt],
    ['name', 'twitter:card', 'summary_large_image'],
    ['name', 'twitter:title', title],
    ['name', 'twitter:description', description],
    ['name', 'twitter:image', image],
    ['name', 'twitter:image:alt', alt],
  ];
  // Slack shows these as a pair of labelled facts under the card.
  if (contents) meta.push(['name', 'twitter:label1', 'On the board'], ['name', 'twitter:data1', contents]);
  if (access) meta.push(['name', 'twitter:label2', 'This link'], ['name', 'twitter:data2', access]);

  // A person who somehow lands here — an in-app browser that looks like a
  // crawler — is sent on to the board. `app=1` is what `vercel.json` checks,
  // so the hop cannot come back to this page and loop.
  const onward = `${path}?app=1`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<link rel="canonical" href="${escapeHtml(url)}">
<link rel="icon" href="${escapeHtml(site)}/favicon.svg" type="image/svg+xml">
${meta.map(([attr, key, value]) => `<meta ${attr}="${key}" content="${escapeHtml(value)}">`).join('\n')}
<meta http-equiv="refresh" content="0;url=${escapeHtml(onward)}">
</head>
<body>
<p><a href="${escapeHtml(onward)}">Open ${escapeHtml(facts?.name ?? 'the board')} on Vega Studio</a></p>
</body>
</html>
`;
}
