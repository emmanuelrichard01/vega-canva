import { describe, expect, it, vi } from 'vitest';
import type { TextNode } from '../model/schema';
import { contourBounds } from '../model/pathGeometry';
import { booleanPaths } from '../model/pathBoolean';

/**
 * A font of squares, 1000 units per em.
 *
 * `o` is a 500-unit square with a counter wound the other way, as real fonts
 * wind holes. Every glyph advances 600 units, except that `A` before `V` is
 * kerned to 400: the pair a font tightens, and the number the outline must use.
 */
const square = (x0: number, y0: number, s: number, reverse = false) => {
  const pts = [
    [x0, y0],
    [x0 + s, y0],
    [x0 + s, y0 + s],
    [x0, y0 + s],
  ];
  if (reverse) pts.reverse();
  return [
    { command: 'moveTo', args: pts[0] },
    { command: 'lineTo', args: pts[1] },
    { command: 'lineTo', args: pts[2] },
    { command: 'lineTo', args: pts[3] },
    { command: 'closePath', args: [] },
  ];
};

const font = {
  unitsPerEm: 1000,
  layout(text: string) {
    const glyphs = [...text].map((ch) => ({
      path: {
        commands: ch === ' ' ? [] : ch === 'o' ? [...square(0, 0, 500), ...square(150, 150, 200, true)] : square(0, 0, 500),
      },
    }));
    const positions = [...text].map((ch, i) => ({
      xAdvance: ch === 'A' && text[i + 1] === 'V' ? 400 : 600,
      xOffset: 0,
      yOffset: 0,
    }));
    return { glyphs, positions };
  },
};

vi.mock('./fontBinary', () => ({ loadFont: vi.fn(async () => font) }));
// Six tenths of the size per character: the same advance the mock font uses,
// so the layout and the shaping agree except where the font kerns.
vi.mock('./measure', () => ({
  measurerFor: (t: { fontSize: number; letterSpacing: number }) => (s: string) => s.length * t.fontSize * 0.6,
}));

const { outlineText } = await import('./textOutline');

function textNode(text: string, extra: Partial<TextNode['typography']> = {}, width = 1000): TextNode {
  return {
    id: 't',
    type: 'text',
    x: 0,
    y: 0,
    width,
    height: 200,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
    zIndex: 1,
    locked: false,
    resize: 'width',
    text,
    typography: {
      fontFamily: 'Inter',
      fontSize: 100,
      fontWeight: 400,
      italic: false,
      lineHeight: 1.2,
      letterSpacing: 0,
      align: 'left',
      color: '#111111',
      ...extra,
    },
  } as unknown as TextNode;
}

describe('outlineText', () => {
  it('fills nonzero, the rule fonts are drawn with', async () => {
    const out = await outlineText(textNode('o'));
    expect(out!.geometry.fillRule).toBe('nonzero');
    // The counter is a separate contour.
    expect(out!.geometry.subpaths).toHaveLength(2);
  });

  it('places glyphs by the font’s kerned advances', async () => {
    const plain = await outlineText(textNode('AN'));
    const kerned = await outlineText(textNode('AV'));
    const secondX = (g: NonNullable<typeof plain>) => Math.min(...g.geometry.subpaths[1].segments.map((s) => s.x));
    expect(secondX(plain!) - secondX(kerned!)).toBeCloseTo(20, 6); // 200 units at 0.1 px/unit
  });

  it('keeps counters as holes once combined: the even-odd area of an o', async () => {
    const out = await outlineText(textNode('o'));
    // Union with a far-away speck forces the region through the clipper.
    const merged = booleanPaths('union', [out!.geometry, { kind: 'bezier', closed: true, segments: [{ x: 900, y: 0 }, { x: 901, y: 0 }, { x: 901, y: 1 }, { x: 900, y: 1 }] }]);
    // Outer 50×50 ring, its 20×20 counter, and the speck.
    expect(merged!.subpaths).toHaveLength(3);
  });

  it('splits a paragraph into one geometry per line, in order', async () => {
    const out = await outlineText(textNode('AA\nAA'));
    expect(out!.lines).toHaveLength(2);
    const top0 = contourBounds(out!.lines[0]).y;
    const top1 = contourBounds(out!.lines[1]).y;
    expect(top1).toBeGreaterThan(top0);
  });

  it('re-centres a centred line on its shaped width, so kerning does not push it off centre', async () => {
    const out = await outlineText(textNode('AV', { align: 'center' }));
    const b = contourBounds(out!.geometry);
    // The layout measured 120 px (two characters at 60) and centred that; the
    // kerned run is 40 + 60 = 100 px, so it starts 10 px in, keeping the
    // centre where the layout put it.
    expect(b.x).toBeCloseTo(10, 6);
  });
});
