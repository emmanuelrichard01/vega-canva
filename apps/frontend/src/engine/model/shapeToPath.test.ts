import { describe, it, expect } from 'vitest';
import { shapeToPath, KAPPA } from './shapeToPath';
import { flattenPath, pathBounds, toAnchors, toCubics } from './pathGeometry';
import type { ShapeNode } from './schema';

const shape = (partial: Partial<ShapeNode>): Pick<ShapeNode, 'geometry' | 'width' | 'height' | 'appearance'> =>
  ({
    geometry: { kind: 'rect' },
    width: 100,
    height: 100,
    appearance: {},
    ...partial,
  }) as never;

describe('shapeToPath', () => {
  it('turns a plain rectangle into four straight sides', () => {
    const path = shapeToPath(shape({ geometry: { kind: 'rect' } }));
    expect(path.closed).toBe(true);
    expect(path.segments.map((s) => [s.x, s.y])).toEqual([
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ]);
    expect(path.segments.every((s) => s.cp1x === undefined)).toBe(true);
  });

  it('draws a rounded rectangle as four arcs between four straight edges', () => {
    const path = shapeToPath(shape({ appearance: { cornerRadius: 20 } }));
    expect(path.segments).toHaveLength(8);
    // Eight points, all on the boundary, none of them outside the box.
    const b = pathBounds(path);
    expect(b).toMatchObject({ x: 0, y: 0 });
    expect(b.width).toBeCloseTo(100, 6);
    expect(b.height).toBeCloseTo(100, 6);
    // The corner is round: the point nearest the top-left corner of the box
    // stands off it by the radius less what the arc cuts.
    const nearestToCorner = Math.min(...flattenPath(path).map((p) => Math.hypot(p.x, p.y)));
    expect(nearestToCorner).toBeGreaterThan(4);
  });

  it('rounds the top-left corner on the closing curve, which used to be a straight cut', () => {
    const path = shapeToPath(shape({ appearance: { cornerRadius: 20 } }));
    // The closing curve's controls live on segment zero, and here they are.
    expect(path.segments[0].cp1x).toBeDefined();
    expect(path.segments[0].cp2x).toBeDefined();
    const closing = toCubics(path)[toCubics(path).length - 1];
    expect(closing.x1).toBeCloseTo(20, 6);
    expect(closing.y1).toBeCloseTo(0, 6);
  });

  it('clamps the corner radius the way the renderer does, so the path matches the shape', () => {
    const path = shapeToPath(shape({ width: 40, height: 40, appearance: { cornerRadius: 999 } }));
    // Radius pinned at half the shorter side turns the rectangle into a disc:
    // the two anchors of each edge collapse onto each other.
    expect(path.segments[0].x).toBeCloseTo(20, 6);
    expect(path.segments[1].x).toBeCloseTo(20, 6);
  });

  it('approximates an ellipse well enough that no one can see the difference', () => {
    const path = shapeToPath(shape({ geometry: { kind: 'ellipse' }, width: 200, height: 200 }));
    for (const p of flattenPath(path)) {
      expect(Math.abs(Math.hypot(p.x - 100, p.y - 100) - 100)).toBeLessThan(0.3);
    }
  });

  it('starts an ellipse at twelve o’clock and runs clockwise, as the primitives do', () => {
    const path = shapeToPath(shape({ geometry: { kind: 'ellipse' } }));
    const anchors = toAnchors(path);
    expect([anchors[0].x, anchors[0].y]).toEqual([50, 0]);
    expect([anchors[1].x, anchors[1].y]).toEqual([100, 50]);
    // The handle leaving the top points to the right, which is the direction
    // of travel.
    expect(anchors[0].outX).toBeCloseTo(50 + 50 * KAPPA, 6);
  });

  it('gives a polygon one anchor per side', () => {
    const path = shapeToPath(shape({ geometry: { kind: 'polygon', points: 7 } }));
    expect(path.segments).toHaveLength(7);
    expect(path.closed).toBe(true);
  });

  it('gives a star two anchors per point', () => {
    const path = shapeToPath(shape({ geometry: { kind: 'star', points: 5, innerRatio: 0.5 } }));
    expect(path.segments).toHaveLength(10);
  });

  it('leaves a line open, because closing it would invent an interior', () => {
    const path = shapeToPath(shape({ geometry: { kind: 'line' } }));
    expect(path.closed).toBe(false);
    expect(path.segments).toHaveLength(2);
  });
});
