import { useEffect } from 'react';

/**
 * The browser tab, as a surface.
 *
 * A board spends most of its life in a background tab while someone is in a
 * call or another document, and the tab strip is the only part of it still on
 * screen. So the tab says which board it is, and says when a comment is
 * waiting — a count in the title and a dot on the icon, the way Figma, Slack
 * and Linear tabs do — without anyone having to switch back to find out.
 *
 * Also keeps a board out of search for crawlers that run scripts. The server
 * already sends `X-Robots-Tag: noindex` for board URLs; this is the same
 * statement in the document, for anything that only reads that.
 */

interface Options {
  /** The page's own name; the product name is appended. */
  title: string;
  /** Unresolved comment threads with something new in them. */
  unread?: number;
  /** `false` adds `noindex` for as long as the page is mounted. */
  indexable?: boolean;
}

const PRODUCT = 'Vega Studio';
const BADGE_COLOR = '#E5484D';

let faviconSource: Promise<string | null> | null = null;

/** The plain favicon's markup, fetched once and reused for every badge. */
function loadFavicon(): Promise<string | null> {
  faviconSource ??= fetch('/favicon.svg')
    .then((res) => (res.ok ? res.text() : null))
    .catch(() => null);
  return faviconSource;
}

/**
 * The favicon with a dot in its corner.
 *
 * Drawn into the SVG itself rather than onto a canvas: it stays sharp at every
 * density, keeps the icon's own dark-mode tile, and costs a string replace.
 * The ring is the tab strip's own colour in each scheme, so the dot reads as
 * sitting on top of the mark rather than bleeding into it.
 */
export function badgedFavicon(svg: string): string {
  const badge =
    '<style>.b{stroke:#fff}@media (prefers-color-scheme:dark){.b{stroke:#202124}}</style>' +
    `<circle class="b" cx="78" cy="22" r="19" fill="${BADGE_COLOR}" stroke-width="8"/>`;
  return svg.replace(/<\/svg>\s*$/, `${badge}</svg>`);
}

export function tabTitle(title: string, unread = 0): string {
  const name = title.trim() ? `${title.trim()} · ${PRODUCT}` : PRODUCT;
  return unread > 0 ? `(${unread > 99 ? '99+' : unread}) ${name}` : name;
}

export function useDocumentHead({ title, unread = 0, indexable = true }: Options) {
  // Title. The previous one comes back when the page goes, so the dashboard
  // does not inherit a board's name.
  useEffect(() => {
    const previous = document.title;
    return () => {
      document.title = previous;
    };
  }, []);

  useEffect(() => {
    document.title = tabTitle(title, unread);
  }, [title, unread]);

  // Icon badge.
  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"][type="image/svg+xml"]');
    if (!link) return;
    const plain = '/favicon.svg';
    if (unread <= 0) {
      link.href = plain;
      return;
    }
    let cancelled = false;
    void loadFavicon().then((svg) => {
      if (cancelled || !svg) return;
      link.href = `data:image/svg+xml,${encodeURIComponent(badgedFavicon(svg))}`;
    });
    return () => {
      cancelled = true;
      link.href = plain;
    };
  }, [unread]);

  // Robots.
  useEffect(() => {
    if (indexable) return;
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    return () => meta.remove();
  }, [indexable]);
}
