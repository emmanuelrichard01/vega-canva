import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { homePath, homeTitle, HOME_TITLE, pageHtml, PUBLIC_PAGES, sitemapXml, TEMPLATES_TITLE } from './sitePages';

const site = 'https://vscanva.vercel.app';
const index = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8').replaceAll('%SITE_URL%', site);
const meta = (html: string, key: string) => html.match(new RegExp(`(?:property|name)="${key}" content="([^"]*)"`))?.[1];

describe('public pages', () => {
  it('keeps the home title in step with index.html', () => {
    expect(index).toContain(`<title>${HOME_TITLE}</title>`);
    expect(homeTitle('boards')).toBe(HOME_TITLE);
    expect(homeTitle('templates')).toBe(TEMPLATES_TITLE);
    expect(homePath('templates')).toBe('/templates');
  });

  it('re-addresses and re-titles index.html as the templates page', () => {
    const html = pageHtml(index, site, PUBLIC_PAGES[0]);
    expect(html).toContain(`<title>${TEMPLATES_TITLE}</title>`);
    expect(html).toContain(`<link rel="canonical" href="${site}/templates" />`);
    expect(meta(html, 'og:url')).toBe(`${site}/templates`);
    expect(meta(html, 'og:title')).toBe(TEMPLATES_TITLE);
    expect(meta(html, 'twitter:title')).toBe(TEMPLATES_TITLE);
    expect(meta(html, 'description')).toBe(PUBLIC_PAGES[0].description);
    expect(meta(html, 'og:description')).toBe(PUBLIC_PAGES[0].description);
    expect(meta(html, 'og:image')).toBe(`${site}/og-image.png`);
    // Nothing else about the document changes: the app inside is the same.
    expect(html.length - index.length).toBeLessThan(400);
  });

  it('lists only public pages in the sitemap', () => {
    const xml = sitemapXml(site);
    expect(xml).toContain(`<loc>${site}/</loc>`);
    expect(xml).toContain(`<loc>${site}/templates</loc>`);
    expect(xml).not.toContain('/room/');
  });

  it('describes the home page fully for search and unfurlers', () => {
    for (const key of ['description', 'og:title', 'og:description', 'og:image', 'og:image:alt', 'twitter:card', 'twitter:image']) {
      expect(meta(index, key), key).toBeTruthy();
    }
    expect(meta(index, 'twitter:card')).toBe('summary_large_image');
    expect(meta(index, 'og:image:width')).toBe('1200');
    expect(meta(index, 'og:image:height')).toBe('630');
    // The square follows the wide card, for unfurlers that crop to a square.
    const images = [...index.matchAll(/property="og:image" content="([^"]*)"/g)].map((m) => m[1]);
    expect(images).toEqual([`${site}/og-image.png`, `${site}/og-square.png`]);
    expect(index).toContain('<meta property="og:image:height" content="1200" />');
    const ld = JSON.parse(index.match(/application\/ld\+json">([\s\S]*?)<\/script>/)![1]);
    expect(ld['@graph'].map((n: { '@type': string }) => n['@type'])).toEqual(['Organization', 'WebSite', 'WebApplication']);
  });
});
