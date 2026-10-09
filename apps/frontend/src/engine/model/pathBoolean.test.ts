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

  it('hands back curves: a union of a disc and a box is a few smooth anchors, not hundreds of facets', () => {
    const disc = shapeToPath({
      geometry: { kind: 'ellipse' },
      width: 100,
      height: 100,
      appearance: {},
    } as Pick<ShapeNode, 'geometry' | 'width' | 'height' | 'appearance'>);
    const result = booleanPaths('union', [disc, box(40, 40, 100, 100)]);
    const ring = result!.subpaths[0];
    expect(result!.subpaths).toHaveLength(1);
    expect(ring.segments.length).toBeLessThan(24);
    expect(ring.segments.some((s) => s.cp1x !== undefined)).toBe(true);
    // The box's straight edges stay straight: at least three plain segments.
    expect(ring.segments.filter((s) => s.cp1x === undefined).length).toBeGreaterThanOrEqual(3);
    // Disc ∪ box: both areas less their overlap, within 2%.
    const union = 10000 + Math.PI * 2500 - overlapArea();
    expect(Math.abs(totalArea(result!.subpaths) - union) / union).toBeLessThan(0.02);
  });

  it('keeps every contour of a compound operand: disjoint letters are not holes', () => {
    const letters = {
      kind: 'compound' as const,
      subpaths: [box(0, 0, 10, 10), box(20, 0, 10, 10)],
    };
    const result = booleanPaths('union', [letters, box(100, 100, 5, 5)]);
    expect(result!.subpaths).toHaveLength(3);
    expect(totalArea(result!.subpaths)).toBeCloseTo(225, 3);
  });

  it('reads an even-odd compound as such: a ring with its counter stays a ring', () => {
    const ring = { kind: 'compound' as const, subpaths: [box(0, 0, 30, 30), box(10, 10, 10, 10)] };
    const result = booleanPaths('union', [ring, box(100, 0, 5, 5)]);
    // The outer ring and its hole both survive as contours.
    const outer = result!.subpaths.map(area).sort((a, b) => b - a);
    expect(outer[0]).toBeCloseTo(900, 3);
    expect(outer[1]).toBeCloseTo(100, 3);
  });

  it('reads a nonzero compound by winding: overlapping parts of one glyph fill solid', () => {
    // Two overlapping outers wound the same way (a variable font's crossbar
    // over a stem) and a counter wound the other way.
    const reversed = (g: BezierGeometry): BezierGeometry => ({ ...g, segments: [...g.segments].reverse() });
    const glyph = {
      kind: 'compound' as const,
      fillRule: 'nonzero' as const,
      subpaths: [box(0, 0, 40, 40), box(20, 0, 40, 40), reversed(box(5, 5, 5, 5))],
    };
    const result = booleanPaths('union', [glyph, box(200, 0, 1, 1)]);
    // 40×60 solid, less the 5×5 counter, plus the 1×1 box. Even-odd would have
    // punched out the 20×40 overlap instead.
    const sizes = result!.subpaths.map(area).sort((a, b) => b - a);
    expect(sizes[0]).toBeCloseTo(2400, 3);
    expect(sizes).toContainEqual(expect.closeTo(25, 3));
  });

  it('drops degenerate slivers where two edges nearly coincide', () => {
    const result = booleanPaths('subtract', [box(0, 0, 100, 100), box(0, 0, 100, 99.999)]);
    expect(result).toBeNull();
  });
});

/** Area of the disc centred (50, 50), radius 50, inside the box [40, 140]². */
function overlapArea(): number {
  // Numerical integration over x of the disc's chord clipped to y ≥ 40.
  let sum = 0;
  const steps = 20000;
  for (let i = 0; i < steps; i++) {
    const x = 40 + ((i + 0.5) / steps) * 60;
    const h = Math.sqrt(Math.max(0, 2500 - (x - 50) ** 2));
    const top = 50 + h;
    sum += Math.max(0, top - Math.max(40, 50 - h)) * (60 / steps);
  }
  return sum;
}
