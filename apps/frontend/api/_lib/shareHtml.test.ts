import { describe, it, expect } from 'vitest';
import { escapeHtml, imageMeta, safeFrameId, safeId, shareHtml } from './shareHtml.js';

const site = 'https://vscanva.vercel.app';
const meta = (html: string, key: string) => html.match(new RegExp(`(?:property|name)="${key}" content="([^"]*)"`))?.[1];

describe('shareHtml', () => {
  it("describes a board by its own name and contents", () => {
    const html = shareHtml({ kind: 'room', id: 'abc123', site, reachable: true, facts: { found: true, name: 'Q3 retro', total: 128, version: 'lx9' } });
    expect(meta(html, 'og:title')).toBe('Q3 retro | Vega Studio');
    expect(meta(html, 'og:url')).toBe(`${site}/room/abc123`);
    expect(meta(html, 'og:image')).toBe(`${site}/api/card-image?kind=room&amp;id=abc123&amp;v=lx9`);
    expect(meta(html, 'twitter:data1')).toBe('128 objects on the board');
    expect(meta(html, 'twitter:data2')).toBe('Can edit');
    expect(meta(html, 'robots')).toBe('noindex, nofollow');
  });

  it("says what an invite allows, and never puts a room id in it", () => {
    const html = shareHtml({ kind: 'invite', id: 'tok.sig', site, reachable: true, facts: { found: true, name: 'Roadmap', total: 1, role: 'viewer' } });
    expect(meta(html, 'twitter:data2')).toBe('View only');
    expect(meta(html, 'og:url')).toBe(`${site}/i/tok.sig`);
    expect(html).not.toContain('/room/');
    expect(meta(html, 'og:description')).toContain('look around');
  });

  it('falls back to a generic card, and a static picture when the server is unreachable', () => {
    const html = shareHtml({ kind: 'room', id: 'abc123', site, reachable: false, facts: null });
    expect(meta(html, 'og:title')).toBe('A board on Vega Studio');
    expect(meta(html, 'og:image')).toBe(`${site}/og-board.png`);
    expect(meta(html, 'twitter:label1')).toBe('This link');
    expect(meta(html, 'twitter:data1')).toBe('Can edit');
    expect(meta(html, 'og:image:alt')).toBe('A board on Vega Studio');
  });

  it('names the frame a frame link opens on, and keeps the frame in the link', () => {
    const facts = { found: true as const, name: 'Q3 retro', total: 12, frame: { name: 'Sprint goals', icon: '🎯' } };
    const html = shareHtml({ kind: 'room', id: 'abc123', site, reachable: true, facts, frame: 'frameA1' });
    expect(meta(html, 'og:title')).toBe('🎯 Sprint goals · Q3 retro | Vega Studio');
    expect(meta(html, 'og:url')).toBe(`${site}/room/abc123?frame=frameA1`);
    expect(meta(html, 'og:description')).toContain('“Sprint goals” frame on Q3 retro');
    expect(meta(html, 'twitter:label1')).toBe('Frame');
    expect(html).toContain('content="0;url=/room/abc123?frame=frameA1&amp;app=1"');
  });

  it('says only "a frame" when the board cannot be described', () => {
    const html = shareHtml({ kind: 'room', id: 'abc123', site, reachable: true, facts: null, frame: 'frameA1' });
    expect(meta(html, 'og:title')).toBe('A frame on a Vega Studio board');
  });

  it('never lets a search engine index a board, and marks every card for large images', () => {
    for (const facts of [null, { found: true as const, name: 'Plan', total: 1 }]) {
      const html = shareHtml({ kind: 'room', id: 'abc123', site, reachable: true, facts });
      expect(meta(html, 'robots')).toBe('noindex, nofollow');
      expect(meta(html, 'twitter:card')).toBe('summary_large_image');
      expect(meta(html, 'og:image:width')).toBe('1200');
      expect(meta(html, 'og:image:height')).toBe('630');
      expect(meta(html, 'og:image:type')).toBe('image/png');
      expect(meta(html, 'og:image:secure_url')).toBe(meta(html, 'og:image'));
    }
  });

  it('gives a board link only its own wide card, never the site square', () => {
    const html = shareHtml({ kind: 'room', id: 'abc123', site, reachable: true, facts: { found: true, name: 'Plan', total: 1 } });
    expect(html.match(/property="og:image"/g)).toHaveLength(1);
    expect(html).not.toContain('og-square.png');
  });

  it('lists a square after the wide card, each with its own size and type', () => {
    const tags = imageMeta(`${site}/og-image.png`, 'Alt', `${site}/og-square.png`);
    const props = tags.filter(([, key]) => key.startsWith('og:image')).map(([, key, value]) => `${key}=${value}`);
    expect(props).toEqual([
      `og:image=${site}/og-image.png`,
      `og:image:secure_url=${site}/og-image.png`,
      'og:image:type=image/png',
      'og:image:width=1200',
      'og:image:height=630',
      'og:image:alt=Alt',
      `og:image=${site}/og-square.png`,
      `og:image:secure_url=${site}/og-square.png`,
      'og:image:type=image/png',
      'og:image:width=1200',
      'og:image:height=1200',
      'og:image:alt=Alt',
    ]);
    expect(tags.find(([, key]) => key === 'twitter:image')?.[2]).toBe(`${site}/og-image.png`);
  });

  it('truncates a long name at a word, keeping the product name', () => {
    const name = 'An extremely long board name that goes on and on about quarterly planning for every team';
    const html = shareHtml({ kind: 'room', id: 'abc123', site, reachable: true, facts: { found: true, name, total: 3 } });
    const title = meta(html, 'og:title')!;
    expect(Array.from(title).length).toBeLessThanOrEqual(70);
    expect(title.endsWith('… | Vega Studio')).toBe(true);
    expect(Array.from(meta(html, 'og:description')!).length).toBeLessThanOrEqual(200);
  });

  it('escapes a hostile board name everywhere it lands', () => {
    const html = shareHtml({ kind: 'room', id: 'abc123', site, reachable: true, facts: { found: true, name: '"><script>alert(1)</script>', total: 2 } });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&quot;&gt;&lt;script&gt;');
  });

  it('sends people on to the app with a marker the crawler rewrite skips', () => {
    const html = shareHtml({ kind: 'room', id: 'abc123', site, reachable: true, facts: null });
    expect(html).toContain('content="0;url=/room/abc123?app=1"');
  });

  it('accepts only ids and tokens as path segments', () => {
    expect(safeId('abc-123_x.y')).toBe('abc-123_x.y');
    expect(safeId('../etc')).toBe(null);
    expect(safeId('a b')).toBe(null);
    expect(safeId('')).toBe(null);
    expect(safeFrameId('frame_A-1')).toBe('frame_A-1');
    expect(safeFrameId('a.b')).toBe(null);
    expect(safeFrameId('x'.repeat(65))).toBe(null);
    expect(safeFrameId(null)).toBe(null);
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });
});
