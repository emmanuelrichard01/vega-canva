/**
 * Public pages besides the home page, as static HTML.
 *
 * The app is one `index.html`; every route is the same document until the
 * script runs. That is fine for people and for Google, which runs scripts, but
 * an unfurler reads the HTML and leaves — so a link to the templates gallery
 * unfurled as the home page, and a search result for it carried the home
 * page's title. The build writes each public page as its own copy of
 * `index.html` with its own title, description, canonical and card, and
 * `vercel.json` serves it at its path. The app inside is identical.
 *
 * Pure string work so it can be tested; `vite.config.ts` calls it on the built
 * `index.html`. No imports, so the build config can load it as it is.
 */

/** The home page's title, also in `index.html`; keep the two in step. */
export const HOME_TITLE = 'Vega Studio | The real-time whiteboard for thinking together';

export const TEMPLATES_TITLE = 'Whiteboard templates | Vega Studio';
export const TEMPLATES_DESCRIPTION =
  'Start from a retro, a roadmap, a flowchart, a mind map or a sprint board. Open any template as a live board and work on it together, free, with no account.';

/** The tab title for the dashboard's views, matching the static page each is served as. */
export function homeTitle(view: 'boards' | 'templates'): string {
  return view === 'templates' ? TEMPLATES_TITLE : HOME_TITLE;
}

/** The address each dashboard view is canonically served at. */
export function homePath(view: 'boards' | 'templates'): string {
  return view === 'templates' ? '/templates' : '/';
}

export interface PageMeta {
  path: string;
  title: string;
  description: string;
}

export const PUBLIC_PAGES: PageMeta[] = [{ path: '/templates', title: TEMPLATES_TITLE, description: TEMPLATES_DESCRIPTION }];

const attr = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Set the `content` of every `<meta>` whose name or property is `key`. */
function setMeta(html: string, key: string, value: string): string {
  const pattern = new RegExp(`(<meta\\s+(?:name|property)="${key.replace(/[.:]/g, '\\$&')}"\\s+content=")[^"]*(")`, 'g');
  return html.replace(pattern, `$1${attr(value)}$2`);
}

/** `index.html`, re-addressed and re-titled as one of the public pages. */
export function pageHtml(indexHtml: string, site: string, page: PageMeta): string {
  const url = `${site}${page.path}`;
  let html = indexHtml.replace(/<title>[^<]*<\/title>/, `<title>${attr(page.title)}</title>`);
  html = html.replace(/(<link\s+rel="canonical"\s+href=")[^"]*(")/, `$1${attr(url)}$2`);
  html = setMeta(html, 'og:url', url);
  for (const key of ['og:title', 'twitter:title']) html = setMeta(html, key, page.title);
  for (const key of ['description', 'og:description', 'twitter:description']) html = setMeta(html, key, page.description);
  return html;
}

export function sitemapXml(site: string): string {
  const entry = (path: string, priority: string) =>
    `  <url><loc>${site}${path}</loc><changefreq>weekly</changefreq><priority>${priority}</priority></url>\n`;
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    entry('/', '1.0') +
    PUBLIC_PAGES.map((p) => entry(p.path, '0.8')).join('') +
    '</urlset>\n'
  );
}
