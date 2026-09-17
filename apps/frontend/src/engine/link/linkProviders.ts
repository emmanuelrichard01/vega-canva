/**
 * What a URL is, before anything has been fetched.
 *
 * ## Adapters, not a list of the internet
 *
 * Most links need nothing special: the page's own metadata makes a good card.
 * A few are worth knowing about from the URL alone — a video that can play in
 * place, a Figma file, a repository — so each of those is an adapter that
 * recognises its URLs and says what it is, what it is called, and whether it
 * may be embedded and how.
 *
 * ## Embedding is an allowlist
 *
 * An `<iframe>` of an arbitrary page is a security decision made on behalf of
 * everyone who opens the board, and most sites forbid it anyway. So a link can
 * be embedded only when an adapter here builds the embed URL itself, from ids
 * it has parsed out of the link, against the provider's documented embed
 * endpoint. Nothing a page says about itself can make it embeddable.
 */

export type LinkKind = 'website' | 'video' | 'design' | 'repository' | 'document' | 'audio' | 'social' | 'code' | 'image' | 'pdf';

export interface LinkEmbed {
  src: string;
  /** Width over height of the player. */
  aspect: number;
  /** Feature policy for the iframe. */
  allow?: string;
}

export interface LinkProvider {
  id: string;
  name: string;
  kind: LinkKind;
  /** The brand's own colour, for the card's accent before a preview loads. */
  accent: string;
  embed?: LinkEmbed;
  /** A short description derivable from the URL: "Pull request #42". */
  detail?: string;
}

export interface ParsedUrl {
  url: URL;
  host: string;
  /** `github.com/vega/app`, for display. */
  display: string;
}

/**
 * A pasted string as a URL, or `null` if it is anything else.
 *
 * One URL and nothing more: a sentence containing a link is text and stays
 * text. A bare `example.com/path` is accepted because that is how people copy
 * addresses out of a browser bar, but only with a dot in the host, so a word
 * with a slash in it is not mistaken for a site.
 */
export function parseLink(text: string): ParsedUrl | null {
  const raw = text.trim();
  if (!raw || raw.length > 2048 || /\s/.test(raw)) return null;
  let candidate = raw;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) {
    if (!/^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/\S*)?$/i.test(candidate)) return null;
    candidate = `https://${candidate}`;
  }
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!url.hostname.includes('.') && url.hostname !== 'localhost') return null;
  if (url.username || url.password) return null;
  const host = url.hostname.replace(/^www\./, '');
  const path = url.pathname === '/' ? '' : decodeURIComponent(url.pathname).replace(/\/$/, '');
  return { url, host, display: `${host}${path}`.slice(0, 80) };
}

const youtubeId = (u: URL): string | null => {
  if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
  if (/(^|\.)youtube(-nocookie)?\.com$/.test(u.hostname)) {
    if (u.pathname === '/watch') return u.searchParams.get('v');
    const m = u.pathname.match(/^\/(shorts|embed|live)\/([\w-]{6,})/);
    return m ? m[2] : null;
  }
  return null;
};

const seconds = (t: string | null): number => {
  if (!t) return 0;
  if (/^\d+$/.test(t)) return Number(t);
  const m = t.match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/);
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : 0;
};

type Adapter = (u: URL, host: string) => LinkProvider | null;

const ADAPTERS: Adapter[] = [
  (u) => {
    const id = youtubeId(u);
    if (!id || !/^[\w-]{6,20}$/.test(id)) return null;
    const start = seconds(u.searchParams.get('t') ?? u.searchParams.get('start'));
    return {
      id: 'youtube', name: 'YouTube', kind: 'video', accent: '#FF0033',
      embed: {
        src: `https://www.youtube-nocookie.com/embed/${id}${start ? `?start=${start}` : ''}`,
        aspect: u.pathname.startsWith('/shorts/') ? 9 / 16 : 16 / 9,
        allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen',
      },
    };
  },
  (u, host) => {
    if (host !== 'vimeo.com') return null;
    const id = u.pathname.match(/^\/(\d{6,})/)?.[1];
    return id
      ? { id: 'vimeo', name: 'Vimeo', kind: 'video', accent: '#1AB7EA', embed: { src: `https://player.vimeo.com/video/${id}?dnt=1`, aspect: 16 / 9, allow: 'autoplay; fullscreen; picture-in-picture' } }
      : null;
  },
  (u, host) => {
    if (host !== 'loom.com') return null;
    const id = u.pathname.match(/^\/(share|embed)\/([\da-f]{20,})/)?.[2];
    return id
      ? { id: 'loom', name: 'Loom', kind: 'video', accent: '#625DF5', embed: { src: `https://www.loom.com/embed/${id}`, aspect: 16 / 9, allow: 'fullscreen' } }
      : null;
  },
  (u, host) => {
    if (host !== 'figma.com') return null;
    if (!/^\/(file|design|proto|board|slides)\//.test(u.pathname)) return null;
    const what = u.pathname.split('/')[1];
    return {
      id: 'figma', name: 'Figma', kind: 'design', accent: '#A259FF',
      detail: what === 'board' ? 'FigJam board' : what === 'proto' ? 'Prototype' : what === 'slides' ? 'Slides' : 'Design file',
      embed: {
        src: `https://embed.figma.com${u.pathname.replace(/^\/file\//, '/design/')}${u.search ? `${u.search}&` : '?'}embed-host=vega`,
        aspect: 16 / 10,
        allow: 'fullscreen; clipboard-write',
      },
    };
  },
  (u, host) => {
    if (host !== 'open.spotify.com') return null;
    const m = u.pathname.match(/^\/(?:intl-\w+\/)?(track|album|playlist|episode|show|artist)\/(\w+)/);
    return m
      ? {
          id: 'spotify', name: 'Spotify', kind: 'audio', accent: '#1DB954',
          detail: m[1][0].toUpperCase() + m[1].slice(1),
          embed: { src: `https://open.spotify.com/embed/${m[1]}/${m[2]}`, aspect: m[1] === 'track' || m[1] === 'episode' ? 460 / 152 : 460 / 352, allow: 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture' },
        }
      : null;
  },
  (u, host) => {
    if (host !== 'codepen.io') return null;
    const m = u.pathname.match(/^\/([\w-]+)\/(pen|full|details)\/(\w+)/);
    return m
      ? { id: 'codepen', name: 'CodePen', kind: 'code', accent: '#1E1F26', embed: { src: `https://codepen.io/${m[1]}/embed/${m[3]}?default-tab=result`, aspect: 16 / 10 } }
      : null;
  },
  (u, host) => {
    if (host !== 'codesandbox.io') return null;
    const id = u.pathname.match(/^\/(?:s|p\/sandbox|embed)\/([\w-]+)/)?.[1];
    return id
      ? { id: 'codesandbox', name: 'CodeSandbox', kind: 'code', accent: '#151515', embed: { src: `https://codesandbox.io/embed/${id}`, aspect: 16 / 10 } }
      : null;
  },
  (u, host) => {
    if (host !== 'docs.google.com') return null;
    const m = u.pathname.match(/^\/(document|spreadsheets|presentation)\/d\/([\w-]{20,})/);
    if (!m) return null;
    const names = { document: 'Google Docs', spreadsheets: 'Google Sheets', presentation: 'Google Slides' } as const;
    const kind = m[1] as keyof typeof names;
    return {
      id: `google-${kind}`, name: names[kind], kind: 'document',
      accent: kind === 'document' ? '#4285F4' : kind === 'spreadsheets' ? '#0F9D58' : '#F4B400',
      // `/preview` is Google's read-only embed view; it shows only what the
      // viewer's own Google account is allowed to see.
      embed: { src: `https://docs.google.com/${m[1]}/d/${m[2]}/preview`, aspect: kind === 'presentation' ? 16 / 9 : 4 / 5 },
    };
  },
  (u, host) => {
    if (host !== 'github.com') return null;
    const [owner, repo, section, number] = u.pathname.split('/').filter(Boolean);
    if (!owner) return null;
    const detail = !repo
      ? 'Profile'
      : section === 'pull' && number ? `Pull request #${number}`
        : section === 'issues' && number ? `Issue #${number}`
          : section === 'blob' || section === 'tree' ? 'Source'
            : section === 'releases' ? 'Releases'
              : 'Repository';
    return { id: 'github', name: 'GitHub', kind: repo ? 'repository' : 'social', accent: '#1F2328', detail };
  },
  (_u, host) => (host === 'gist.github.com' ? { id: 'gist', name: 'GitHub Gist', kind: 'code', accent: '#1F2328' } : null),
  (_u, host) => (host === 'notion.so' || host.endsWith('.notion.site') ? { id: 'notion', name: 'Notion', kind: 'document', accent: '#191919' } : null),
  (_u, host) => (host === 'x.com' || host === 'twitter.com' ? { id: 'x', name: 'X', kind: 'social', accent: '#0F1419' } : null),
  (_u, host) => (host === 'linkedin.com' ? { id: 'linkedin', name: 'LinkedIn', kind: 'social', accent: '#0A66C2' } : null),
  (_u, host) => (host === 'npmjs.com' ? { id: 'npm', name: 'npm', kind: 'code', accent: '#CB3837' } : null),
  (_u, host) => (host === 'stackoverflow.com' ? { id: 'stackoverflow', name: 'Stack Overflow', kind: 'code', accent: '#F48024' } : null),
  (_u, host) => (host === 'developer.mozilla.org' ? { id: 'mdn', name: 'MDN', kind: 'document', accent: '#1B1B1B' } : null),
  (_u, host) => (host.endsWith('wikipedia.org') ? { id: 'wikipedia', name: 'Wikipedia', kind: 'document', accent: '#202122' } : null),
  (_u, host) => (host === 'medium.com' || host.endsWith('.medium.com') ? { id: 'medium', name: 'Medium', kind: 'website', accent: '#000000' } : null),
  (_u, host) => (host === 'dribbble.com' ? { id: 'dribbble', name: 'Dribbble', kind: 'design', accent: '#EA4C89' } : null),
  (u) => (/\.pdf$/i.test(u.pathname) ? { id: 'pdf', name: 'PDF', kind: 'pdf', accent: '#D93025' } : null),
  (u) => (/\.(png|jpe?g|gif|webp|avif)$/i.test(u.pathname) ? { id: 'image', name: 'Image', kind: 'image', accent: '#64748B' } : null),
];

/** The provider a URL belongs to, or a generic website. */
export function providerFor(link: string | URL): LinkProvider {
  let u: URL;
  try {
    u = typeof link === 'string' ? new URL(link) : link;
  } catch {
    return { id: 'web', name: 'Website', kind: 'website', accent: '#64748B' };
  }
  const host = u.hostname.replace(/^www\./, '');
  for (const adapter of ADAPTERS) {
    const hit = adapter(u, host);
    if (hit) return hit;
  }
  return { id: 'web', name: host, kind: 'website', accent: '#64748B' };
}

/** The part of a host people recognise: `docs.github.com` → `github.com`. */
export function siteDomain(link: string): string {
  try {
    const host = new URL(link).hostname.replace(/^www\./, '');
    const parts = host.split('.');
    return parts.length > 2 && parts[parts.length - 2].length > 3 ? parts.slice(-2).join('.') : host;
  } catch {
    return link;
  }
}
