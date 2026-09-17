/**
 * A link on the board: a URL, what it turned out to be, and how it is shown.
 *
 * ## Metadata lives in the document
 *
 * The preview — title, description, image — is fetched once, by whoever placed
 * the link, and written into the node. Every collaborator then draws the same
 * card from the document instead of each fetching their own, which would cost a
 * request per viewer, show different cards when a page changed between two
 * fetches, and leak every viewer's address to the site. "Refresh preview" is
 * the explicit way to fetch again.
 *
 * Images in the preview are stored copies on this app's own media store, for
 * the same reasons: they cannot vanish or change under a board, and loading a
 * board does not announce its viewers to a third party.
 */

export type LinkDisplay = 'auto' | 'compact' | 'horizontal' | 'vertical' | 'embed';
export type ResolvedLinkDisplay = Exclude<LinkDisplay, 'auto'>;

export const LINK_DISPLAYS: readonly LinkDisplay[] = ['auto', 'compact', 'horizontal', 'vertical', 'embed'];

export type LinkStatus = 'loading' | 'ready' | 'error';

export interface LinkMeta {
  title?: string;
  description?: string;
  siteName?: string;
  /** A stored copy, on this app's media store. */
  image?: string;
  imageWidth?: number;
  imageHeight?: number;
  favicon?: string;
  themeColor?: string;
  author?: string;
  /** What the page says it is: `article`, `video.other`, `profile`. */
  type?: string;
  /** When this preview was fetched, epoch ms. */
  fetchedAt: number;
}

export interface LinkSpec {
  url: string;
  display: LinkDisplay;
  status: LinkStatus;
  meta: LinkMeta | null;
  /** When a fetch was started, so two collaborators do not both start one. */
  requestedAt?: number;
  /** A short reason, shown on a card whose preview could not be fetched. */
  error?: string;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const str = (v: unknown, max = 500) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);

/** Only http(s) and our own media paths survive into a drawn `src`. */
const safeUrl = (v: unknown) => {
  const s = str(v, 2000);
  return s && /^https?:\/\//i.test(s) ? s : undefined;
};

export function normalizeLinkSpec(raw: unknown): LinkSpec {
  const src = isObj(raw) ? raw : {};
  const m = isObj(src.meta) ? src.meta : null;
  return {
    url: safeUrl(src.url) ?? 'https://example.com',
    display: LINK_DISPLAYS.includes(src.display as LinkDisplay) ? (src.display as LinkDisplay) : 'auto',
    status: src.status === 'ready' || src.status === 'error' ? src.status : 'loading',
    meta: m
      ? {
          title: str(m.title, 300),
          description: str(m.description, 600),
          siteName: str(m.siteName, 80),
          image: safeUrl(m.image),
          imageWidth: num(m.imageWidth),
          imageHeight: num(m.imageHeight),
          favicon: safeUrl(m.favicon),
          themeColor: typeof m.themeColor === 'string' && /^#[0-9a-f]{3,8}$/i.test(m.themeColor) ? m.themeColor : undefined,
          author: str(m.author, 120),
          type: str(m.type, 40),
          fetchedAt: num(m.fetchedAt) ?? 0,
        }
      : null,
    requestedAt: num(src.requestedAt),
    error: str(src.error, 160),
  };
}
