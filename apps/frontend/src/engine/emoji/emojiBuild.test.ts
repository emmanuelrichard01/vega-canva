import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { codeFromSequence, compactPathData, sanitizeSvg } from '../../../scripts/emoji/sanitizeSvg.mjs';
import { EMOJI_COUNT, EMOJI_VERSION } from './emojiVersion';

const PUBLIC = join(__dirname, '../../../public/emoji');

const HOSTILE = `<?xml version="1.0"?>
<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 32 32" onload="alert(1)">
  <!-- a comment -->
  <script>alert(2)</script>
  <style>path { fill: url(https://evil.example/x) }</style>
  <foreignObject><div xmlns="http://www.w3.org/1999/xhtml">hi</div></foreignObject>
  <image href="https://evil.example/p.png" width="5" height="5"/>
  <a xlink:href="javascript:alert(3)"><path d="M0 0H5V5Z" fill="#ff0000"/></a>
  <use href="https://evil.example/s.svg#a"/>
  <use xlink:href="javascript:alert(5)"/>
  <path d="M1 1L9 9" fill="url(https://evil.example/g)" stroke="url( 'http://evil.example/s' )" onclick="alert(4)"/>
  <rect width="4" height="4" fill="&#x6A;avascript:alert(6)" ONMOUSEOVER="alert(7)" style="fill:red"/>
  <circle cx="16" cy="16" r="4" fill="data:image/png;base64,AAAA" mask="url(http://x/#m)"/>
  <text>hello</text>
</svg>`;

const GRADIENT = `<svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
<g clip-path="url(#clip0)">
<path d="M15.9989 29.9978C25.3333 29.9978 29.9978 23.7303 29.9978 15.9989Z" fill="url(#paint0_linear)"/>
<use href="#shape" transform="translate(1.23456 0)"/>
</g>
<defs>
<path id="shape" d="M1 1L2 2L3 1Z" fill="#FFFFFF"/>
<linearGradient id="paint0_linear" x1="16.0312" y1="7.0156" x2="16.0312" y2="17.0156" gradientUnits="userSpaceOnUse">
<stop stop-color="#D52C38"/>
<stop offset="1" stop-color="#DF1F81" stop-opacity="1"/>
</linearGradient>
<clipPath id="clip0"><rect width="32" height="32" fill="white"/></clipPath>
</defs>
</svg>`;

describe('sanitizeSvg', () => {
  const out = sanitizeSvg(HOSTILE, 'x_')!;

  it('drops scripts, styles, foreign content, links and event handlers', () => {
    expect(out).not.toBeNull();
    const s = out.svg;
    expect(s).not.toMatch(/<script/i);
    expect(s).not.toMatch(/<style/i);
    expect(s).not.toMatch(/foreignObject/i);
    expect(s).not.toMatch(/<image/i);
    expect(s).not.toMatch(/<a[\s>]/);
    expect(s).not.toMatch(/<text/);
    expect(s).not.toMatch(/\son\w+=/i);
    expect(s).not.toMatch(/javascript:/i);
    expect(s).not.toMatch(/data:/i);
    expect(s).not.toMatch(/style=/);
    expect(s).not.toMatch(/ENTITY|DOCTYPE|<!--|<\?xml/);
    expect(s.replace('xmlns="http://www.w3.org/2000/svg"', '')).not.toMatch(/http/);
    expect(out.warnings.length).toBeGreaterThan(0);
  });

  it('removes external href and url() while keeping the shapes', () => {
    expect(out.svg).not.toMatch(/<use/);
    expect(out.svg).toContain('<path d="M1 1 9 9"/>');
    expect(out.svg).toContain('<rect width="4" height="4"/>');
    expect(out.svg).toContain('<circle cx="16" cy="16" r="4"/>');
  });

  it('keeps the root contract: xmlns, viewBox and an intrinsic size', () => {
    expect(out.svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="32" height="32" viewBox="0 0 32 32"/);
    const sized = sanitizeSvg('<svg viewBox="0 0 32 32"><path d="M0 0L5 5"/></svg>', 'p')!;
    expect(sized.svg).toContain('width="32" height="32"');
  });

  it('keeps paths and gradients and prefixes ids and references consistently', () => {
    const r = sanitizeSvg(GRADIENT, 'e1f600_')!;
    expect(r.warnings).toEqual([]);
    const s = r.svg;
    expect(s).toContain('<linearGradient id="e1f600_paint0_linear"');
    expect(s).toContain('fill="url(#e1f600_paint0_linear)"');
    expect(s).toContain('clip-path="url(#e1f600_clip0)"');
    expect(s).toContain('<clipPath id="e1f600_clip0">');
    expect(s).toContain('href="#e1f600_shape"');
    expect(s).toContain('<path id="e1f600_shape"');
    expect(s).toContain('stop-color="#d52c38"');
    expect(s).toContain('fill="#fff"');
    // Every referenced id exists.
    const ids = new Set([...s.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));
    const refs = [...s.matchAll(/(?:url\(#|href="#)([^)"]+)/g)].map((m) => m[1]);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) expect(ids.has(ref)).toBe(true);
    // Default stop-opacity is dropped; offset kept.
    expect(s).not.toContain('stop-opacity');
    expect(s).toContain('offset="1"');
  });

  it('rounds numbers to two decimals and strips trailing zeros', () => {
    const s = sanitizeSvg(GRADIENT, 'p')!.svg;
    expect(s).toContain('d="M16 30c9.33 0 14-6.27 14-14Z"');
    expect(s).toContain('x1="16.03" y1="7.02" x2="16.03" y2="17.02"');
    expect(s).toContain('transform="translate(1.23 0)"');
    expect(compactPathData('M 0.500 10.000 L 20.004 10.000 L 20.004 0.1')).toBe('M.5 10H20V.1');
    // Relative input resolves without accumulating rounding error.
    expect(compactPathData('m1.004 1.004 l1.004 0 1.004 0 1.004 0')).toBe('M1 1H2.01h1H4.02'); // 2.01, 3.01, 4.02: not 1 + 3 x 1.00
  });

  it('returns null when nothing drawable remains', () => {
    expect(sanitizeSvg('<svg viewBox="0 0 32 32"><script>x()</script><text>hi</text></svg>', 'p')).toBeNull();
    expect(sanitizeSvg('<svg viewBox="0 0 32 32"><defs><path id="a" d="M0 0L1 1"/></defs><g></g></svg>', 'p')).toBeNull();
    expect(sanitizeSvg('<html><body>not svg</body></html>', 'p')).toBeNull();
    expect(sanitizeSvg('', 'p')).toBeNull();
  });
});

describe('codeFromSequence', () => {
  it('joins lowercase code points and strips U+FE0F', () => {
    expect(codeFromSequence('😀')).toBe('1f600');
    expect(codeFromSequence('👍🏽')).toBe('1f44d-1f3fd');
    expect(codeFromSequence('❤️')).toBe('2764');
    expect(codeFromSequence('🏳️‍🌈')).toBe('1f3f3-200d-1f308');
  });
});

interface IndexEmoji {
  c: string;
  u: string;
  n: string;
  k: string[];
  g: number;
  s?: string[];
}

describe('emoji index', () => {
  const index = JSON.parse(readFileSync(join(PUBLIC, 'index.json'), 'utf8')) as {
    version: string;
    categories: { id: string; label: string }[];
    emoji: IndexEmoji[];
  };
  const files = new Set(readdirSync(PUBLIC).filter((f) => f.endsWith('.svg')));

  it('matches the generated version module', () => {
    expect(index.version).toBe(EMOJI_VERSION);
    expect(index.version).toMatch(/^[0-9a-f]{10}$/);
    expect(index.emoji.length).toBe(EMOJI_COUNT);
    expect(Object.keys(index)).toEqual(['version', 'categories', 'emoji']);
  });

  it('has at least 1400 emoji with unique codes, files, names and valid groups', () => {
    expect(index.emoji.length).toBeGreaterThanOrEqual(1400);
    expect(index.categories.map((c) => c.id)).toEqual([
      'smileys', 'people', 'animals', 'food', 'travel', 'activities', 'objects', 'symbols', 'flags',
    ]);
    const seen = new Set<string>();
    for (const e of index.emoji) {
      expect(seen.has(e.c), e.c).toBe(false);
      seen.add(e.c);
      expect(files.has(`${e.c}.svg`), e.c).toBe(true);
      expect(codeFromSequence(e.u)).toBe(e.c);
      expect(e.n.length).toBeGreaterThan(0);
      expect(e.n).toBe(e.n.toLowerCase());
      expect(e.k.length).toBeLessThanOrEqual(12);
      expect(Number.isInteger(e.g) && e.g >= 0 && e.g < index.categories.length).toBe(true);
    }
    // Groups appear in category order.
    for (let i = 1; i < index.emoji.length; i++) expect(index.emoji[i].g).toBeGreaterThanOrEqual(index.emoji[i - 1].g);
  });

  it('lists exactly five skin tones, each with a file', () => {
    const modifiers = ['1f3fb', '1f3fc', '1f3fd', '1f3fe', '1f3ff'];
    for (const e of index.emoji) {
      if (!e.s) continue;
      expect(e.s.length, e.c).toBe(5);
      e.s.forEach((code, i) => {
        expect(files.has(`${code}.svg`), code).toBe(true);
        expect(code.split('-')).toContain(modifiers[i]);
        expect(seen(code)).toBe(false);
      });
    }
    function seen(code: string) {
      return index.emoji.some((e) => e.c === code);
    }
    const thumbs = index.emoji.find((e) => e.c === '1f44d');
    expect(thumbs?.s).toEqual(['1f44d-1f3fb', '1f44d-1f3fc', '1f44d-1f3fd', '1f44d-1f3fe', '1f44d-1f3ff']);
  });

  it('ships no unsafe or external content and no orphan files', () => {
    const expected = new Set(index.emoji.flatMap((e) => [`${e.c}.svg`, ...(e.s ?? []).map((c) => `${c}.svg`)]));
    expect([...files].filter((f) => !expected.has(f))).toEqual([]);
    for (const f of files) {
      const s = readFileSync(join(PUBLIC, f), 'utf8');
      const stripped = s
        .replace('xmlns="http://www.w3.org/2000/svg"', '')
        .replace('xmlns:xlink="http://www.w3.org/1999/xlink"', '');
      if (/<script|\son[a-z]+=|javascript:|http/i.test(stripped)) throw new Error(`unsafe content in ${f}`);
      if (!s.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')) throw new Error(`bad root in ${f}`);
    }
    expect(existsSync(join(PUBLIC, 'LICENSE.md'))).toBe(true);
    // Reads every one of ~3,000 files; slow on a synced or busy disk.
  }, 60_000);
});
