import { describe, it, expect } from 'vitest';
import { cleanName, describeContents, normalizeCard, normalizePreview, MAX_CARD_ITEMS, MAX_NAME } from './cardData';
import { boardCardSvg, polygonPoints, previewArt, privateCardSvg, siteCardSvg } from './cardSvg';
import { measure, wrap } from './text';
import { MARK_SPARKLE, MARK_V, markSvg } from './brand';

describe('normalizeCard', () => {
  it('rebuilds a card field by field and drops anything unknown', () => {
    const card = normalizeCard({
      name: '  Q3   planning ',
      extra: 'ignored',
      preview: { ratio: 1.5, total: 3, items: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.4, c: '#FFE9A8', r: 0.08, evil: 'x' }] },
    });
    expect(card).toEqual({
      name: 'Q3 planning',
      hidden: false,
      preview: { ratio: 1.5, total: 3, items: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.4, c: '#FFE9A8', r: 0.08 }] },
    });
  });

  it('refuses colours that are not colours, so nothing can break out of an attribute', () => {
    const preview = normalizePreview({
      ratio: 1,
      total: 4,
      items: [
        { x: 0, y: 0, w: 1, h: 1, c: 'red"/><script>alert(1)</script>' },
        { x: 0, y: 0, w: 1, h: 1, c: 'url(javascript:alert(1))' },
        { x: 0, y: 0, w: 1, h: 1, c: 'rgba(0, 0, 0, 0.5)' },
        { x: 0, y: 0, w: 1, h: 1, c: 'hsl(210deg, 40%, 50%)' },
      ],
    })!;
    expect(preview.items.map((i) => i.c)).toEqual(['#94A3B8', '#94A3B8', 'rgba(0, 0, 0, 0.5)', 'hsl(210deg, 40%, 50%)']);
  });

  it('clamps numbers and drops items that are not numbers at all', () => {
    const preview = normalizePreview({
      ratio: 1e9,
      total: -5,
      items: [
        { x: 1e308, y: -1e308, w: 5, h: 0.5, c: '#fff', p: 1000, rot: 9999, l: [0, 0, 1, 'x', 2, 2] },
        { x: 'a', y: 0, w: 1, h: 1, c: '#fff' },
      ],
    })!;
    expect(preview.ratio).toBe(50);
    expect(preview.total).toBe(0);
    expect(preview.items).toHaveLength(1);
    expect(preview.items[0]).toMatchObject({ x: 2, y: -1, w: 3, p: 64, rot: 360 });
    // A polyline stops at the first bad number, and never ends on a lone x.
    expect(preview.items[0].l).toBeUndefined();
  });

  it('caps the number of items', () => {
    const items = Array.from({ length: 500 }, () => ({ x: 0, y: 0, w: 0.1, h: 0.1, c: '#000' }));
    expect(normalizePreview({ ratio: 1, total: 500, items })!.items).toHaveLength(MAX_CARD_ITEMS);
  });

  it('keeps nothing of a hidden board but the fact that it is hidden', () => {
    expect(normalizeCard({ hidden: true, name: 'Secret', preview: { ratio: 1, total: 1, items: [] } })).toEqual({
      name: '',
      hidden: true,
      preview: null,
    });
  });

  it('strips controls, zero-width marks and direction overrides from a name', () => {
    const rlo = String.fromCharCode(0x202e);
    const zwsp = String.fromCharCode(0x200b);
    const nul = String.fromCharCode(0);
    expect(cleanName(`Road${zwsp}map${nul} ${rlo}gpj.exe`)).toBe('Road map gpj.exe');
    expect(cleanName('x'.repeat(500))).toHaveLength(MAX_NAME);
    expect(cleanName(42)).toBe('');
  });

  it('says what is on a board in words', () => {
    expect(describeContents(null)).toBe('An empty board, ready to draw on');
    expect(describeContents({ ratio: 1, total: 1, items: [] })).toBe('1 object on the board');
    expect(describeContents({ ratio: 1, total: 1280, items: [] })).toBe('1,280 objects on the board');
  });
});

describe('text', () => {
  it('measures wider text as wider, and bold as wider than regular', () => {
    expect(measure('Planning', { size: 40 })).toBeGreaterThan(measure('Plan', { size: 40 }));
    expect(measure('Planning', { size: 40, weight: 700 })).toBeGreaterThan(measure('Planning', { size: 40, weight: 400 }));
  });

  it('wraps by word, and ellipsises what does not fit', () => {
    const style = { size: 40, weight: 700 as const };
    const lines = wrap('Quarterly planning for the platform team and everyone else who asked', 300, style, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith('…')).toBe(true);
    lines.forEach((line) => expect(measure(line, style)).toBeLessThanOrEqual(300));
  });

  it('breaks a single word longer than the line', () => {
    const style = { size: 40 };
    const lines = wrap('https://example.com/a/very/long/path/that/never/ends', 200, style, 5);
    expect(lines.length).toBeGreaterThan(1);
    lines.forEach((line) => expect(measure(line.replace('…', ''), style)).toBeLessThanOrEqual(200));
  });

  it('sets Serbian Latin and Cyrillic, which the Latin subset alone cannot', () => {
    expect(measure('čćšžđ', { size: 40 })).toBeGreaterThan(40);
    expect(measure('Дорожная карта', { size: 40 })).toBeGreaterThan(200);
  });
});

describe('cards', () => {
  const card = {
    name: '<script>alert("x")</script> & friends',
    hidden: false,
    preview: { ratio: 1.6, total: 3, items: [{ x: 0, y: 0, w: 0.5, h: 0.5, c: '#FFE9A8', r: 0.08 }] },
  };

  it('draws the name as outlines, so no text node can carry markup', () => {
    const svg = boardCardSvg(card);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).not.toContain('<script');
    expect(svg).not.toContain('<text');
    expect(svg).not.toContain('friends');
  });

  it('draws a hidden or nameless board as the private card', () => {
    expect(boardCardSvg({ ...card, hidden: true })).toBe(privateCardSvg());
    expect(boardCardSvg({ ...card, name: '' })).toBe(privateCardSvg());
  });

  it('puts cursors only on the site card, which is openly an illustration', () => {
    expect(siteCardSvg()).toContain('#7C3AED');
    expect(boardCardSvg(card)).not.toContain('#7C3AED');
    expect(privateCardSvg()).not.toContain('#7C3AED');
  });

  it('fits a preview inside its box without stretching it', () => {
    const art = previewArt({ ratio: 2, total: 1, items: [{ x: 0, y: 0, w: 1, h: 1, c: '#000' }] }, { x: 10, y: 20, w: 400, h: 400 });
    // A 2:1 board in a square box: full width, half height, centred.
    expect(art).toContain('translate(10 20) scale(4)');
    expect(art).toContain('width="100" height="50"');
  });

  it('starts polygons at twelve o\'clock, as the shape tool draws them', () => {
    const [top] = polygonPoints({ s: 'polygon', p: 6 }, 0, 0, 10, 10);
    expect(top[0]).toBeCloseTo(5);
    expect(top[1]).toBeCloseTo(0);
    expect(polygonPoints({ s: 'star', p: 5, ir: 0.5 }, 0, 0, 10, 10)).toHaveLength(10);
  });
});

describe('brand', () => {
  it('draws the mark inside its 100-unit box', () => {
    for (const d of [MARK_V, MARK_SPARKLE]) {
      const numbers = (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
      numbers.forEach((n) => {
        expect(n).toBeGreaterThanOrEqual(0);
        expect(n).toBeLessThanOrEqual(100);
      });
    }
  });

  it('scales and insets the mark for maskable icons', () => {
    expect(markSvg({ size: 512, radius: 0, inset: 0.5 })).toContain('translate(25 25) scale(0.5)');
    expect(markSvg({ size: 48, tile: false })).not.toContain('<rect');
  });
});
