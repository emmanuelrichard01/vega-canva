import { describe, it, expect } from 'vitest';
import { outlineStroke } from './strokeOutline';
import { contourBounds } from './pathGeometry';
import type { BezierGeometry } from './schema';

const line = (): BezierGeometry => ({
  kind: 'bezier',
  segments: [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ],
  closed: false,
});

const square = (): BezierGeometry => ({
  kind: 'bezier',
  segments: [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ],
  closed: true,
});

describe('outlineStroke', () => {
  it('turns a line into a rectangle of the stroke width', () => {
    const region = outlineStroke(line(), { width: 10 });
    expect(contourBounds(region!)).toMatchObject({ x: 0, y: -5, width: 100, height: 10 });
  });

  it('runs a square cap past the end, and a butt cap not at all', () => {
    expect(contourBounds(outlineStroke(line(), { width: 10, cap: 'square' })!).width).toBeCloseTo(110, 6);
    expect(contourBounds(outlineStroke(line(), { width: 10, cap: 'butt' })!).width).toBeCloseTo(100, 6);
  });

  it('gives a closed outline a hole, because a stroked square is a frame', () => {
    const region = outlineStroke(square(), { width: 10 });
    expect(region!.subpaths.length).toBe(2);
    expect(contourBounds(region!)).toMatchObject({ x: -5, y: -5, width: 110, height: 110 });
  });

  it('lets a miter run past the corner, and cuts it off at the limit', () => {
    // A corner sharp enough that the miter runs about three widths past it —
    // kept under a limit of 50 and cut off by a limit of 1.
    const hairpin: BezierGeometry = {
      kind: 'bezier',
      segments: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 20, y: 60 },
      ],
      closed: false,
    };
    const long = contourBounds(outlineStroke(hairpin, { width: 10, join: 'miter', miterLimit: 50 })!);
    const cut = contourBounds(outlineStroke(hairpin, { width: 10, join: 'miter', miterLimit: 1 })!);
    expect(long.width).toBeGreaterThan(cut.width);
    // And a bevel is the shape the cut-off miter falls back to.
    const bevel = contourBounds(outlineStroke(hairpin, { width: 10, join: 'bevel' })!);
    expect(cut.width).toBeCloseTo(bevel.width, 6);
  });

  it('has nothing to outline at zero width', () => {
    expect(outlineStroke(line(), { width: 0 })).toBeNull();
  });
});
