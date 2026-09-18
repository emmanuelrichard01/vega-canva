import { describe, it, expect } from 'vitest';
import { escapeHtml, safeId, shareHtml } from './shareHtml.js';

const site = 'https://vscanva.vercel.app';
const meta = (html: string, key: string) => html.match(new RegExp(`(?:property|name)="${key}" content="([^"]*)"`))?.[1];

describe('shareHtml', () => {
  it("describes a board by its own name and contents", () => {
    const html = shareHtml({ kind: 'room', id: 'abc123', site, reachable: true, facts: { found: true, name: 'Q3 retro', total: 128, version: 'lx9' } });
    expect(meta(html, 'og:title')).toBe('Q3 retro · Vega Studio');
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
    expect(meta(html, 'twitter:label1')).toBeUndefined();
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
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });
});
