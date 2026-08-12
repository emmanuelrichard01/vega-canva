import { describe, it, expect } from 'vitest';
import { booleanPaths } from './pathBoolean';
import { contourBounds, flattenPath } from './pathGeometry';
import { shapeToPath } from './shapeToPath';
import type { BezierGeometry, ShapeNode } from './schema';

/** An axis-aligned box as a closed path, in world coordinates. */
const box = (x: number, y: number, w: number, h: number): BezierGeometry => ({
  kind: 'bezier',
  segments: [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ],
  closed: true,
});

/** Rough area by the shoelace formula, for asserting on results without pinning point counts. */
function area(geo: BezierGeometry): number {
  const p = flattenPath(geo);
  let sum = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length];
    sum += p[i].x * q.y - q.x * p[i].y;
  }
  return Math.abs(sum) / 2;
}

const totalArea = (subpaths: readonly BezierGeometry[]) => subpaths.reduce((n, s) => n + area(s), 0);

describe('booleanPaths', () => {
  it('unions two overlapping squares into one contour', () => {
    const result = booleanPaths('union', [box(0, 0, 100, 100), box(50, 0, 100, 100)]);
    expect(result?.subpaths).toHaveLength(1);
    expect(contourBounds(result!)).toMatchObject({ x: 0, y: 0, width: 150, height: 100 });
  });

  it('intersects them down to the overlap', () => {
    const result = booleanPaths('intersect', [box(0, 0, 100, 100), box(50, 0, 100, 100)]);
    expect(contourBounds(result!)).toMatchObject({ x: 50, y: 0, width: 50, height: 100 });
  });

  it('subtracts the later shapes from the first, in that order', () => {
    const result = booleanPaths('subtract', [box(0, 0, 100, 100), box(50, 0, 100, 100)]);
    expect(contourBounds(result!)).toMatchObject({ x: 0, y: 0, width: 50, height: 100 });
    // And the other way round is a different answer, which is the point.
    const reversed = booleanPaths('subtract', [box(50, 0, 100, 100), box(0, 0, 100, 100)]);
    expect(contourBounds(reversed!)).toMatchObject({ x: 100, y: 0, width: 50, height: 100 });
  });

  it('excludes the overlap and keeps both remainders', () => {
    const result = booleanPaths('exclude', [box(0, 0, 100, 100), box(50, 0, 100, 100)]);
    expect(totalArea(result!.subpaths)).toBeCloseTo(10000, 0);
  });

  it('produces a hole as a second contour, which is why compound paths exist', () => {
    const result = booleanPaths('subtract', [box(0, 0, 100, 100), box(25, 25, 50, 50)]);
    expect(result?.subpaths).toHaveLength(2);
    // Outer box unchanged, inner one removed from the middle of it.
    expect(contourBounds(result!)).toMatchObject({ x: 0, y: 0, width: 100, height: 100 });
    expect(totalArea(result!.subpaths)).toBeCloseTo(10000 + 2500, 0);
  });

  it('cuts one shape into two disjoint pieces', () => {
    const result = booleanPaths('subtract', [box(0, 0, 100, 100), box(-10, 40, 120, 20)]);
    expect(result?.subpaths).toHaveLength(2);
    expect(totalArea(result!.subpaths)).toBeCloseTo(8000, 0);
  });

  it('declines when the result is nothing, rather than making an invisible node', () => {
    expect(booleanPaths('intersect', [box(0, 0, 10, 10), box(500, 500, 10, 10)])).toBeNull();
  });

  it('declines with fewer than two shapes, there being nothing to combine', () => {
    expect(booleanPaths('union', [box(0, 0, 10, 10)])).toBeNull();
  });

  it('ignores an operand that encloses nothing', () => {
    const openLine: BezierGeometry = { kind: 'bezier', segments: [{ x: 0, y: 0 }, { x: 10, y: 0 }], closed: false };
    expect(booleanPaths('union', [box(0, 0, 10, 10), openLine])).toBeNull();
  });

  it('works on a converted primitive, which is the whole point of flattening one', () => {
    const disc = shapeToPath({
      geometry: { kind: 'ellipse' },
      width: 100,
      height: 100,
      appearance: {},
    } as Pick<ShapeNode, 'geometry' | 'width' | 'height' | 'appearance'>);
    const result = booleanPaths('subtract', [box(0, 0, 100, 100), disc]);
    expect(result).not.toBeNull();
    // The disc is inscribed, touching all four edges, so what is left is the
    // four corner pieces: 10000 less the disc. A shade over, because the
    // flattened disc is a polygon inside its own circle.
    const remainder = 10000 - Math.PI * 2500;
    expect(totalArea(result!.subpaths)).toBeGreaterThan(remainder);
    expect(totalArea(result!.subpaths)).toBeLessThan(remainder * 1.02);
  });

  it('returns straight segments — the curves do not survive, and that is documented', () => {
    const disc = shapeToPath({
      geometry: { kind: 'ellipse' },
      width: 100,
      height: 100,
      appearance: {},
    } as Pick<ShapeNode, 'geometry' | 'width' | 'height' | 'appearance'>);
    const result = booleanPaths('union', [disc, box(40, 40, 100, 100)]);
    expect(result!.subpaths[0].segments.every((s) => s.cp1x === undefined)).toBe(true);
  });
});
