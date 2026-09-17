import { FetchRefused, safeFetch, type SafeFetchOptions, type SafeFetchResult } from './safeFetch';
import { cleanText, decodeHtml, parseHtmlMeta, sniffImage, textFromEmbedHtml, type SniffedImage } from './unfurlParse';

/**
 * A link's preview, as the board stores it.
 *
 * The client writes this into the document once and every collaborator draws
 * from there — see `linkTypes.ts` in the frontend. Pictures are copied into the
 * room's own media store first, so a card cannot change or vanish under a
 * board, and opening a board does not announce its viewers to a third party.
 */
export interface LinkPreview {
  title?: string;
  description?: string;
  siteName?: string;
  image?: string;
  imageWidth?: number;
  imageHeight?: number;
  favicon?: string;
  themeColor?: string;
  author?: string;
  type?: string;
}

export type Fetcher = (url: string, options?: SafeFetchOptions) => Promise<SafeFetchResult>;
/** Store a picture for a room; resolves to the URL it will be served from, or null when refused (quota). */
export type ImageStore = (roomId: string, bytes: Buffer, image: SniffedImage) => Promise<string | null>;

export class UnfurlError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = 'UnfurlError';
  }
}

const IMAGE_BYTES = 3 * 1024 * 1024;
const ICON_BYTES = 256 * 1024;
const HTML_BYTES = 768 * 1024;
/** Below this on either side, a "preview image" is a spacer or a tracking pixel. */
const MIN_IMAGE_SIDE = 80;

interface OEmbed {
  title?: string;
  author_name?: string;
  provider_name?: string;
  thumbnail_url?: string;
  thumbnail_width?: number;
  thumbnail_height?: number;
  html?: string;
  description?: string;
}

/**
 * Providers whose pages are a poor source and whose oEmbed is a good one.
 *
 * YouTube serves a consent wall to a server in Europe; X serves an empty shell
 * to anything without JavaScript; Spotify's and Loom's pages are app bundles.
 * Their oEmbed endpoints answer the same question directly and are what those
 * services intend previews to use.
 */
const OEMBED: Array<{ match: RegExp; endpoint: (url: string) => string; site: string }> = [
  { match: /^https?:\/\/(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\//i, endpoint: (u) => `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(u)}`, site: 'YouTube' },
  { match: /^https?:\/\/(www\.|player\.)?vimeo\.com\//i, endpoint: (u) => `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(u)}`, site: 'Vimeo' },
  { match: /^https?:\/\/open\.spotify\.com\//i, endpoint: (u) => `https://open.spotify.com/oembed?url=${encodeURIComponent(u)}`, site: 'Spotify' },
  { match: /^https?:\/\/(www\.)?loom\.com\/(share|embed)\//i, endpoint: (u) => `https://www.loom.com/v1/oembed?url=${encodeURIComponent(u)}`, site: 'Loom' },
  { match: /^https?:\/\/codepen\.io\//i, endpoint: (u) => `https://codepen.io/api/oembed?format=json&url=${encodeURIComponent(u)}`, site: 'CodePen' },
  { match: /^https?:\/\/(www\.)?(twitter|x)\.com\/[^/]+\/status\//i, endpoint: (u) => `https://publish.twitter.com/oembed?omit_script=1&dnt=1&url=${encodeURIComponent(u)}`, site: 'X' },
];

function youTubeId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.endsWith('youtu.be')) return u.pathname.slice(1).split('/')[0] || null;
    if (u.searchParams.get('v')) return u.searchParams.get('v');
    const m = u.pathname.match(/^\/(shorts|embed|live)\/([\w-]{6,})/);
    return m ? m[2] : null;
  } catch {
    return null;
  }
}

export interface Unfurler {
  unfurl(roomId: string, url: string): Promise<LinkPreview>;
}

export function createUnfurler(deps: { fetch?: Fetcher; store: ImageStore; now?: () => number; ttlMs?: number; maxEntries?: number }): Unfurler {
  const fetcher = deps.fetch ?? safeFetch;
  const now = deps.now ?? Date.now;
  const ttl = deps.ttlMs ?? 10 * 60 * 1000;
  const maxEntries = deps.maxEntries ?? 500;
  /**
   * Finished previews by room and URL, and the ones in progress.
   *
   * Keyed by room because the stored pictures are the room's: the same URL
   * previewed in two boards is two copies, each counted against its own quota
   * and deleted with its own board. The in-flight map means two collaborators
   * (or one impatient double paste) share a single fetch.
   */
  const cache = new Map<string, { at: number; preview: LinkPreview }>();
  const inFlight = new Map<string, Promise<LinkPreview>>();

  async function fetchJson<T>(url: string): Promise<T | null> {
    try {
      const res = await fetcher(url, { maxBytes: 256 * 1024, timeoutMs: 4000, accept: 'application/json' });
      if (res.status !== 200) return null;
      return JSON.parse(res.body.toString('utf-8')) as T;
    } catch {
      return null;
    }
  }

  /**
   * Fetch a picture and check it is one, or quietly have none: a card without
   * a picture is still a card. Not stored yet — candidates are fetched side by
   * side and only the one chosen is kept, so a losing favicon costs no quota.
   */
  async function fetchImage(url: string | undefined, kind: 'picture' | 'icon') {
    if (!url) return null;
    const maxBytes = kind === 'icon' ? ICON_BYTES : IMAGE_BYTES;
    const minSide = kind === 'icon' ? 16 : MIN_IMAGE_SIDE;
    try {
      const res = await fetcher(url, { maxBytes, timeoutMs: 5000, accept: 'image/webp,image/png,image/jpeg,image/gif,image/*;q=0.8' });
      if (res.status !== 200) return null;
      const image = sniffImage(res.body);
      // An .ico is a favicon, never a preview picture.
      if (!image || (image.ext === '.ico' && kind === 'picture')) return null;
      if (image.width !== undefined && image.height !== undefined && (image.width < minSide || image.height < minSide)) return null;
      return { bytes: res.body, image };
    } catch {
      return null;
    }
  }

  async function keep(roomId: string, found: Awaited<ReturnType<typeof fetchImage>>) {
    if (!found) return null;
    try {
      const url = await deps.store(roomId, found.bytes, found.image);
      return url ? { url, width: found.image.width, height: found.image.height } : null;
    } catch {
      return null;
    }
  }

  async function build(roomId: string, url: string): Promise<LinkPreview> {
    const provider = OEMBED.find((p) => p.match.test(url));
    const oembed = provider ? await fetchJson<OEmbed>(provider.endpoint(url)) : null;

    let page: SafeFetchResult | null = null;
    let pageError: unknown = null;
    // A good oEmbed answer is the whole preview; the page is only read without one.
    if (!oembed?.title) {
      try {
        page = await fetcher(url, {
          maxBytes: HTML_BYTES,
          truncate: true,
          timeoutMs: 6000,
          accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
        });
      } catch (err) {
        pageError = err;
      }
    }

    if (!oembed && !page) {
      throw pageError instanceof FetchRefused
        ? new UnfurlError(pageError.message, pageError.code === 'blocked' || pageError.code === 'unsupported' ? 422 : 502)
        : new UnfurlError('That page could not be reached', 502);
    }
    // A missing page is worth saying. A page that turns robots away (401, 403,
    // 429, a 5xx) still exists for the person who pasted it, so it gets the
    // plain card — its domain and icon — rather than an error they cannot fix.
    if (!oembed && page && (page.status === 404 || page.status === 410)) {
      throw new UnfurlError('That page does not exist', 502);
    }

    const finalUrl = page?.url ?? url;
    const host = new URL(finalUrl).hostname.replace(/^www\./, '');
    const preview: LinkPreview = {};
    let imageUrl: string | undefined;
    let iconCandidates: string[] = [];

    if (page && page.status < 400) {
      const type = page.contentType.split(';')[0].trim();
      const lastSegment = new URL(finalUrl).pathname.split('/').pop() || '';
      const fileName = (() => {
        try {
          return decodeURIComponent(lastSegment);
        } catch {
          return lastSegment;
        }
      })() || host;
      if (type === 'text/html' || type === 'application/xhtml+xml' || (!type && page.body.subarray(0, 512).toString('latin1').match(/<html|<!doctype/i))) {
        const meta = parseHtmlMeta(decodeHtml(page.contentType, page.body), finalUrl);
        Object.assign(preview, {
          title: meta.title,
          description: meta.description,
          siteName: meta.siteName,
          themeColor: meta.themeColor,
          author: meta.author,
          type: meta.type,
        });
        imageUrl = meta.image;
        iconCandidates = meta.icons.map((i) => i.href);
      } else if (type.startsWith('image/')) {
        // The link *is* a picture: it is its own preview.
        const image = sniffImage(page.body);
        if (image && !page.truncated) {
          const stored = await deps.store(roomId, page.body, image);
          if (stored) Object.assign(preview, { image: stored, imageWidth: image.width, imageHeight: image.height });
        }
        preview.title = cleanText(fileName, 200);
        preview.type = 'image';
      } else if (type === 'application/pdf') {
        preview.title = cleanText(fileName, 200);
        preview.type = 'pdf';
      } else {
        preview.title = cleanText(fileName, 200);
        preview.type = type || 'file';
      }
    }

    if (oembed) {
      preview.title = cleanText(oembed.title, 200) ?? preview.title;
      preview.author = cleanText(oembed.author_name, 80) ?? preview.author;
      preview.siteName = cleanText(oembed.provider_name, 80) ?? provider?.site ?? preview.siteName;
      preview.description = preview.description ?? cleanText(oembed.description, 320) ?? textFromEmbedHtml(oembed.html);
      imageUrl = imageUrl ?? oembed.thumbnail_url;
      // X's oEmbed has no title; the post's words are the card.
      if (provider?.site === 'X' && !oembed.title) {
        preview.title = oembed.author_name ? `${cleanText(oembed.author_name, 80)} on X` : 'Post on X';
      }
    }

    // Every picture candidate at once, in priority order; the first good one wins.
    // YouTube's largest still leads when there is one, ahead of the letterboxed 480×360.
    const ytId = /youtu/.test(host) ? youTubeId(finalUrl) : null;
    const origin = new URL(finalUrl).origin;
    const imageCandidates = [ytId ? `https://i.ytimg.com/vi/${ytId}/maxresdefault.jpg` : undefined, imageUrl].filter(Boolean) as string[];
    const icons = [...new Set([...iconCandidates.slice(0, 2), `${origin}/apple-touch-icon.png`, `${origin}/favicon.ico`])];
    const [images, favicons] = await Promise.all([
      Promise.all(imageCandidates.map((u) => fetchImage(u, 'picture'))),
      Promise.all(icons.map((u) => fetchImage(u, 'icon'))),
    ]);
    if (preview.image === undefined) {
      const image = await keep(roomId, images.find(Boolean) ?? null);
      if (image) Object.assign(preview, { image: image.url, imageWidth: image.width, imageHeight: image.height });
    }
    const favicon = await keep(roomId, favicons.find(Boolean) ?? null);
    if (favicon) preview.favicon = favicon.url;

    if (!preview.title && !preview.description && !preview.image) {
      preview.title = host;
    }
    // Drop the empties, so the document holds only what was found.
    return Object.fromEntries(Object.entries(preview).filter(([, v]) => v !== undefined && v !== '')) as LinkPreview;
  }

  return {
    async unfurl(roomId, url) {
      const key = `${roomId}\n${url}`;
      const hit = cache.get(key);
      if (hit && now() - hit.at < ttl) return hit.preview;
      const pending = inFlight.get(key);
      if (pending) return pending;

      const work = build(roomId, url)
        .then((preview) => {
          cache.set(key, { at: now(), preview });
          // Oldest first, since a Map iterates in insertion order.
          while (cache.size > maxEntries) cache.delete(cache.keys().next().value as string);
          return preview;
        })
        .finally(() => inFlight.delete(key));
      inFlight.set(key, work);
      return work;
    },
  };
}
