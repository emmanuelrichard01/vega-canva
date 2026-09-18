import { FetchRefused, safeFetch, type SafeFetchOptions, type SafeFetchResult } from './safeFetch';
import { cleanText, decodeHtml, parseHtmlMeta, sniffImage, textFromEmbedHtml, type SniffedImage } from './unfurlParse';

/**
 * # Why a link preview is answered in two parts
 *
 * Unfurling one link is up to four round trips to somebody else's
 * infrastructure: an oEmbed endpoint, the page, its picture, its icon. The
 * picture is the slowest of them by a wide margin — it is the only one
 * measured in megabytes — and it is also the only one the card can be read
 * without. Waiting for all four before answering meant a card sat as a grey
 * skeleton for the length of the *worst* leg, and a board of ten links sat
 * there together.
 *
 * So the words are answered as soon as they are known and the pictures keep
 * going in the background: `{ preview, pending: true }` says "this is the
 * card, there is a picture coming, ask again". The client draws the title and
 * description immediately — which is the whole card for most links — and the
 * picture arrives into the same node a moment later.
 *
 * A fast site never sees this: the pictures are given a short grace to finish
 * before the answer goes out, so a quick page still resolves in one request
 * with `pending: false`.
 */

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

export interface UnfurlResult {
  preview: LinkPreview;
  /** The words are final; a picture is still on its way. Ask again to collect it. */
  pending: boolean;
}

export interface Unfurler {
  unfurl(roomId: string, url: string): Promise<UnfurlResult>;
}

/**
 * What a page said about itself, before anything was stored for a room.
 *
 * Room-independent by construction, which is the point: reading and parsing
 * somebody's HTML is the same work whichever board the link was dropped on,
 * so it is done once and shared. Only the *pictures* are per-room, because a
 * stored picture is room media — counted against that room's quota, deleted
 * with that room.
 */
interface PageText {
  preview: LinkPreview;
  /** Remote picture candidates, best first. */
  images: string[];
  /** Remote icon candidates, the page's own declarations first. */
  icons: string[];
  /** The link was itself a picture, and these are its bytes — already fetched, not to be fetched twice. */
  inline?: { bytes: Buffer; image: SniffedImage };
}

/** How long a refusal is remembered, so a dead link is not re-chased on every paste. */
const FAILURE_TTL_MS = 60_000;
/**
 * The largest picture whose bytes ride along in the shared page cache.
 *
 * A link that points straight at an image has already paid to download it, so
 * the second board to use that link should not pay again. Past this size the
 * saving is not worth the resident memory — hundreds of cached pages each
 * holding three megabytes is a leak with a plausible excuse.
 */
const INLINE_CACHE_BYTES = 512 * 1024;
/** How long the pictures may take before the words are sent on without them. */
const GRACE_MS = 600;

export function createUnfurler(deps: {
  fetch?: Fetcher;
  store: ImageStore;
  now?: () => number;
  ttlMs?: number;
  maxEntries?: number;
  /** How long the pictures are waited for before answering with words alone. `0` answers immediately. */
  graceMs?: number;
}): Unfurler {
  const fetcher = deps.fetch ?? safeFetch;
  const now = deps.now ?? Date.now;
  const ttl = deps.ttlMs ?? 10 * 60 * 1000;
  const maxEntries = deps.maxEntries ?? 500;
  const graceMs = deps.graceMs ?? GRACE_MS;

  /**
   * Finished previews by room and URL, and the picture work in progress.
   *
   * Keyed by room because the stored pictures are the room's. The in-flight
   * map means two collaborators (or one impatient double paste) share a single
   * fetch.
   */
  const cache = new Map<string, { at: number; preview: LinkPreview }>();
  const assetWork = new Map<string, Promise<LinkPreview>>();

  /**
   * The page itself, by URL and across rooms.
   *
   * The expensive half of an unfurl is reading somebody else's HTML, and it
   * does not depend on which board asked. Sharing it means the second board to
   * link an article — or the same board after a restart of the room cache —
   * pays for the pictures only. Failures are remembered too, briefly: a URL
   * that has just refused to load will refuse again, and re-chasing it on
   * every paste is how one dead link makes a whole board feel slow.
   */
  const textCache = new Map<string, { at: number; text: PageText }>();
  const textWork = new Map<string, Promise<PageText>>();
  const failures = new Map<string, { at: number; error: UnfurlError }>();

  /** Oldest first, since a Map iterates in insertion order. */
  const trim = (map: Map<string, unknown>, limit = maxEntries) => {
    while (map.size > limit) map.delete(map.keys().next().value as string);
  };

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

  /**
   * The first candidate that turns out to be a real picture.
   *
   * Tried a couple at a time rather than all at once, which is the difference
   * between a thorough preview and a small flood aimed at whoever was linked:
   * a page can declare five pictures and four icons, and firing nine requests
   * at a site to decorate one card is not a reasonable thing to do to it. Two
   * at a time keeps the common case — one good candidate, one spare — as fast
   * as it ever was, and only a page whose first choices are broken pays for a
   * second round.
   */
  async function firstImage(candidates: string[], kind: 'picture' | 'icon', width = 2) {
    const seen = new Set<string>();
    const queue = candidates.filter((u) => Boolean(u) && !seen.has(u) && Boolean(seen.add(u)));
    for (let i = 0; i < queue.length; i += width) {
      const batch = await Promise.all(queue.slice(i, i + width).map((u) => fetchImage(u, kind)));
      const found = batch.find(Boolean);
      if (found) return found;
    }
    return null;
  }

  /** Drop the empties, so the document holds only what was found. */
  const tidy = (preview: LinkPreview): LinkPreview =>
    Object.fromEntries(Object.entries(preview).filter(([, v]) => v !== undefined && v !== '')) as LinkPreview;

  /**
   * Read the page and everything it says about itself. No storing, no room.
   *
   * Throws `UnfurlError` for the two cases worth telling somebody about — a
   * page that cannot be reached and a page that does not exist. Everything
   * else degrades: a site that turns robots away still has a domain and an
   * icon, and that is a better card than an apology.
   */
  async function readPage(url: string): Promise<PageText> {
    const provider = OEMBED.find((p) => p.match.test(url));
    let oembed = provider ? await fetchJson<OEmbed>(provider.endpoint(url)) : null;

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
    const origin = new URL(finalUrl).origin;
    const preview: LinkPreview = {};
    let images: string[] = [];
    let icons: string[] = [];
    let inline: PageText['inline'];

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
        images = meta.images;
        icons = meta.icons.slice(0, 3).map((i) => i.href);

        /*
         * The page's own oEmbed endpoint, but only when the page was thin.
         *
         * A site that declares one is saying where the real answer lives, and
         * for a great many CMS-backed pages that is the difference between a
         * title alone and a title with a summary and a thumbnail. It costs a
         * round trip, so it is only spent when the markup did not already
         * answer: a page with a good description and a picture has nothing to
         * gain here.
         */
        if (meta.oembed && (!preview.description || images.length === 0)) {
          const found = await fetchJson<OEmbed>(meta.oembed);
          if (found) oembed = found;
        }
      } else if (type.startsWith('image/')) {
        // The link *is* a picture: it is its own preview. The bytes are already
        // here, so they travel with the text rather than being fetched twice.
        const image = sniffImage(page.body);
        if (image && !page.truncated) inline = { bytes: page.body, image };
        images = [finalUrl];
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
      if (oembed.thumbnail_url) images = [...images, oembed.thumbnail_url];
      // X's oEmbed has no title; the post's words are the card.
      if (provider?.site === 'X' && !oembed.title) {
        preview.title = oembed.author_name ? `${cleanText(oembed.author_name, 80)} on X` : 'Post on X';
      }
    }

    // YouTube's largest still leads when there is one, ahead of the letterboxed 480x360.
    const ytId = /youtu/.test(host) ? youTubeId(finalUrl) : null;
    if (ytId) images = [`https://i.ytimg.com/vi/${ytId}/maxresdefault.jpg`, ...images];

    if (!preview.title && !preview.description) preview.title = host;

    return {
      preview: tidy(preview),
      images,
      // The page's own declarations first: a site that names its icon is right
      // about it, and the two guesses after it are only worth a request when
      // it did not. Four icon fetches for every card was most of the tail.
      icons: [...icons, `${origin}/apple-touch-icon.png`, `${origin}/favicon.ico`],
      inline,
    };
  }

  /**
   * Give a room's copy of a page its pictures.
   *
   * Everything here is per-room and so cannot be shared: a stored picture is
   * room media, counted against that room's quota and deleted with that room.
   * It never throws — a card without a picture is still a card, and a quota
   * that has run out is not something the reader can act on.
   */
  async function dress(roomId: string, text: PageText): Promise<LinkPreview> {
    const preview: LinkPreview = { ...text.preview };

    const [picture, icon] = await Promise.all([
      text.inline ? Promise.resolve(text.inline) : firstImage(text.images, 'picture'),
      firstImage(text.icons, 'icon'),
    ]);

    const kept = await keep(roomId, picture);
    if (kept) Object.assign(preview, { image: kept.url, imageWidth: kept.width, imageHeight: kept.height });
    const favicon = await keep(roomId, icon);
    if (favicon) preview.favicon = favicon.url;

    return tidy(preview);
  }

  /** Wait a moment for the pictures, then stop waiting. `null` means "not yet". */
  function withGrace(work: Promise<LinkPreview>, ms: number): Promise<LinkPreview | null> {
    if (ms <= 0) return Promise.resolve(null);
    let timer: ReturnType<typeof setTimeout>;
    // Deliberately a plain, referenced timer. It is cleared the moment the race
    // settles, so it can hold the loop open for `ms` and no longer — and an
    // `unref`'d one would let a process whose only pending work is this grace
    // exit in the middle of answering.
    const lapsed = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), ms);
    });
    return Promise.race([work, lapsed]).finally(() => clearTimeout(timer));
  }

  /** The page, from whichever of the three places already has it. */
  async function getText(url: string): Promise<PageText> {
    const failed = failures.get(url);
    if (failed && now() - failed.at < FAILURE_TTL_MS) throw failed.error;

    const hit = textCache.get(url);
    if (hit && now() - hit.at < ttl) return hit.text;

    const pending = textWork.get(url);
    if (pending) return pending;

    const work = readPage(url)
      .then((text) => {
        // The bytes of a linked picture ride along to save a fetch, but they are
        // not worth a megabyte of shared cache each; past that, the URL alone.
        const light = text.inline && text.inline.bytes.length > INLINE_CACHE_BYTES ? { ...text, inline: undefined } : text;
        textCache.set(url, { at: now(), text: light });
        trim(textCache);
        return text;
      })
      .catch((err) => {
        if (err instanceof UnfurlError) {
          failures.set(url, { at: now(), error: err });
          trim(failures, 200);
        }
        throw err;
      })
      .finally(() => textWork.delete(url));
    textWork.set(url, work);
    return work;
  }

  return {
    async unfurl(roomId, url) {
      const key = `${roomId}\n${url}`;
      const hit = cache.get(key);
      if (hit && now() - hit.at < ttl) return { preview: hit.preview, pending: false };

      const text = await getText(url);

      let work = assetWork.get(key);
      if (!work) {
        work = dress(roomId, text)
          // A picture that could not be had leaves the words, which are the card.
          .catch(() => text.preview)
          .then((preview) => {
            cache.set(key, { at: now(), preview });
            trim(cache);
            return preview;
          })
          .finally(() => assetWork.delete(key));
        assetWork.set(key, work);
      }

      const finished = await withGrace(work, graceMs);
      return finished ? { preview: finished, pending: false } : { preview: text.preview, pending: true };
    },
  };
}
