import { describe, expect, it } from 'vitest';
import { glyphContours, outlineToGeometry, type GlyphCommand } from './glyphOutline';

/** A unit square, drawn the way a font would: y upward from the baseline. */
const square: GlyphCommand[] = [
  { command: 'moveTo', args: [0, 0] },
  { command: 'lineTo', args: [1000, 0] },
  { command: 'lineTo', args: [1000, 1000] },
  { command: 'lineTo', args: [0, 1000] },
  { command: 'closePath', args: [] },
];

/** 1000 font units to 10 pixels, drawn at the origin. */
const place = { x: 0, y: 0, scale: 0.01 };

describe('glyphContours', () => {
  it('turns the y axis over, because a font grows upward and a canvas downward', () => {
    const [contour] = glyphContours(square, place);
    expect(contour.closed).toBe(true);
    expect(contour.segments.map((s) => [s.x, s.y])).toEqual([
      [0, 0], [10, 0], [10, -10], [0, -10],
    ]);
  });

  it('places the glyph at the pen, on the baseline', () => {
    const [contour] = glyphContours(square, { x: 40, y: 100, scale: 0.01 });
    // The baseline is y = 100, and the square sits *above* it.
    expect(contour.segments[0]).toMatchObject({ x: 40, y: 100 });
    expect(contour.segments[2]).toMatchObject({ x: 50, y: 90 });
  });

  it('scales from the font\'s own units per em', () => {
    // A CFF face at 1000 upm and a TrueType one at 2048 must come out the same
    // size on the canvas; only the scale differs.
    const cff = glyphContours(square, { x: 0, y: 0, scale: 16 / 1000 })[0];
    const tt = glyphContours(
      [
        { command: 'moveTo', args: [0, 0] },
        { command: 'lineTo', args: [2048, 0] },
        { command: 'lineTo', args: [2048, 2048] },
        { command: 'lineTo', args: [0, 2048] },
        { command: 'closePath', args: [] },
      ],
      { x: 0, y: 0, scale: 16 / 2048 }
    )[0];
    expect(cff.segments[2].x).toBeCloseTo(tt.segments[2].x, 9);
    expect(cff.segments[2].y).toBeCloseTo(tt.segments[2].y, 9);
  });

  it('converts a quadratic exactly, not through its midpoint', () => {
    /**
     * The two-thirds rule. Taking the midpoint instead is the approximation
     * people reach for, and it visibly flattens the bowl of an `o`.
     */
    const geo = glyphContours(
      [
        { command: 'moveTo', args: [0, 0] },
        { command: 'quadraticCurveTo', args: [300, 600, 600, 0] },
        { command: 'closePath', args: [] },
      ],
      { x: 0, y: 0, scale: 1 }
    );
    // Nothing to close: two anchors have no area, so the contour is dropped.
    expect(geo).toHaveLength(0);

    const open = glyphContours(
      [
        { command: 'moveTo', args: [0, 0] },
        { command: 'quadraticCurveTo', args: [300, 600, 600, 0] },
        { command: 'lineTo', args: [600, -10] },
        { command: 'closePath', args: [] },
      ],
      { x: 0, y: 0, scale: 1 }
    )[0];
    const curve = open.segments[1];
    // c1 = p0 + 2/3 (q - p0) = (200, 400) in font space, so (200, -400) here.
    expect(curve.cp1x).toBeCloseTo(200, 9);
    expect(curve.cp1y).toBeCloseTo(-400, 9);
    // c2 = p1 + 2/3 (q - p1) = (400, 400) -> (400, -400).
    expect(curve.cp2x).toBeCloseTo(400, 9);
    expect(curve.cp2y).toBeCloseTo(-400, 9);
  });

  it('carries a cubic through untouched but for the flip', () => {
    const [contour] = glyphContours(
      [
        { command: 'moveTo', args: [0, 0] },
        { command: 'bezierCurveTo', args: [10, 20, 30, 40, 50, 60] },
        { command: 'lineTo', args: [50, 0] },
        { command: 'closePath', args: [] },
      ],
      { x: 0, y: 0, scale: 1 }
    );
    expect(contour.segments[1]).toMatchObject({
      cp1x: 10, cp1y: -20, cp2x: 30, cp2y: -40, x: 50, y: -60,
    });
  });

  it('keeps a counter as its own contour, so an o has a hole', () => {
    const o: GlyphCommand[] = [
      ...square,
      { command: 'moveTo', args: [200, 200] },
      { command: 'lineTo', args: [800, 200] },
      { command: 'lineTo', args: [800, 800] },
      { command: 'lineTo', args: [200, 800] },
      { command: 'closePath', args: [] },
    ];
    expect(glyphContours(o, place)).toHaveLength(2);
  });

  it('closes a contour a font left open', () => {
    // Not every face ends on closePath. An unclosed glyph contour would fill as
    // a wedge running off to wherever the fill rule decided.
    const unclosed = square.slice(0, -1);
    const [contour] = glyphContours(unclosed, place);
    expect(contour.closed).toBe(true);
    expect(contour.segments).toHaveLength(4);
  });

  it('drops a stray moveTo rather than storing an anchor with no shape', () => {
    expect(glyphContours([{ command: 'moveTo', args: [5, 5] }], place)).toEqual([]);
  });
});

describe('outlineToGeometry', () => {
  it('fills every contour as one object, so holes stay holes', () => {
    const contours = glyphContours(square, place);
    expect(outlineToGeometry(contours)).toEqual({ kind: 'compound', subpaths: contours });
  });

  it('is null when there was nothing to draw', () => {
    // A run of spaces, or characters the font has no glyphs for. The caller
    // then leaves the text alone rather than replacing it with an empty object.
    expect(outlineToGeometry([])).toBeNull();
  });
});
