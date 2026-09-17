import { describe, expect, it } from 'vitest';
import { parseLink, providerFor, siteDomain } from './linkProviders';
import { coverCrop, layoutLinkCard, naturalLinkSize, resolveDisplay } from './linkLayout';
import { normalizeLinkSpec } from './linkTypes';

describe('parseLink', () => {
  it('accepts a URL, or an address copied from a browser bar', () => {
    expect(parseLink('https://github.com/vega/app')?.display).toBe('github.com/vega/app');
    expect(parseLink('  www.figma.com/file/abc  ')?.url.href).toBe('https://www.figma.com/file/abc');
    expect(parseLink('example.co.uk')?.host).toBe('example.co.uk');
  });

  it('refuses text that merely contains or resembles one', () => {
    expect(parseLink('see https://x.com for more')).toBeNull();
    expect(parseLink('javascript:alert(1)')).toBeNull();
    expect(parseLink('and/or')).toBeNull();
    expect(parseLink('https://user:pass@example.com')).toBeNull();
    expect(parseLink('ftp://example.com/file')).toBeNull();
  });
});

describe('providers', () => {
  it('builds embeds only from ids it parsed', () => {
    expect(providerFor('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s').embed?.src).toBe(
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=90'
    );
    expect(providerFor('https://youtu.be/dQw4w9WgXcQ').id).toBe('youtube');
    expect(providerFor('https://www.youtube.com/shorts/abcdefghijk').embed?.aspect).toBeCloseTo(9 / 16);
    expect(providerFor('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC').embed?.src).toBe(
      'https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC'
    );
    expect(providerFor('https://www.figma.com/file/AbC123/Design').embed?.src).toBe(
      'https://embed.figma.com/design/AbC123/Design?embed-host=vega'
    );
  });

  it('describes GitHub from the path, and never embeds it', () => {
    const pr = providerFor('https://github.com/vega/app/pull/42');
    expect(pr).toMatchObject({ id: 'github', detail: 'Pull request #42', kind: 'repository' });
    expect(pr.embed).toBeUndefined();
  });

  it('falls back to a generic website, with no embed', () => {
    const p = providerFor('https://blog.example.com/post');
    expect(p.id).toBe('web');
    expect(p.embed).toBeUndefined();
    expect(siteDomain('https://docs.github.com/en')).toBe('github.com');
  });
});

describe('card layout', () => {
  it('reads its display from the box when left on auto', () => {
    expect(resolveDisplay('auto', 340, 64, false)).toBe('compact');
    expect(resolveDisplay('auto', 520, 144, false)).toBe('horizontal');
    expect(resolveDisplay('auto', 340, 330, false)).toBe('vertical');
    expect(resolveDisplay('embed', 560, 360, false)).toBe('vertical');
  });

  it('sizes an embed to its player plus the header', () => {
    expect(naturalLinkSize('embed', 16 / 9)).toEqual({ width: 560, height: 44 + 315 });
  });

  it('gives a horizontal card its picture on the left and clamps the text', () => {
    const l = layoutLinkCard('horizontal', 520, 144, true, true);
    expect(l.media).toEqual({ x: 0, y: 0, width: 208, height: 144 });
    expect(l.title.lines).toBe(2);
    expect(l.description?.lines).toBeGreaterThan(0);
    const noImage = layoutLinkCard('horizontal', 520, 144, false, false);
    expect(noImage.media).toBeNull();
    expect(noImage.description).toBeNull();
  });

  it('cover-crops a picture about its centre', () => {
    expect(coverCrop(1200, 600, 100, 100)).toEqual({ x: 300, y: 0, width: 600, height: 600 });
  });
});

describe('spec', () => {
  it('drops unsafe image sources and unknown displays', () => {
    const s = normalizeLinkSpec({ url: 'javascript:x', display: 'poster', meta: { image: 'data:image/png;base64,x', title: ' T ' } });
    expect(s.url).toBe('https://example.com');
    expect(s.display).toBe('auto');
    expect(s.meta?.image).toBeUndefined();
    expect(s.meta?.title).toBe('T');
  });
});
