import { describe, expect, it } from 'vitest';
import { contourBounds, mapPath, pathBounds } from './pathGeometry';
import type { BezierGeometry, CompoundGeometry } from './schema';

/** A 100 × 100 square at the origin, as a closed bezier. */
const square = (): BezierGeometry => ({
  kind: 'bezier',
  closed: true,
  segments: [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ],
});

/** A quarter-circle-ish arc, so the control points have somewhere to go. */
const curved = (): BezierGeometry => ({
  kind: 'bezier',
  closed: true,
  segments: [
    { x: 0, y: 0 },
    { x: 100, y: 100, cp1x: 60, cp1y: 0, cp2x: 100, cp2y: 40 },
    { x: 0, y: 100 },
  ],
});

/** The transform `ObjectRenderer` applies: scale in the object's frame, then turn. */
const nodeTransform = (
  node: { x: number; y: number; width: number; height: number; rotation?: number; scaleX?: number; scaleY?: number }
) => {
  const sx = node.scaleX ?? 1;
  const sy = node.scaleY ?? 1;
  const rad = ((node.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const halfW = node.width / 2;
  const halfH = node.height / 2;
  return (p: { x: number; y: number }) => {
    const dx = (p.x - halfW) * sx;
    const dy = (p.y - halfH) * sy;
    return {
      x: node.x + halfW + dx * cos - dy * sin,
      y: node.y + halfH + dx * sin + dy * cos,
    };
  };
};

describe('mapPath', () => {
  it('moves every anchor', () => {
    const moved = mapPath(square(), (p) => ({ x: p.x + 10, y: p.y - 5 }));
    expect(moved.segments.map((s) => [s.x, s.y])).toEqual([
      [10, -5], [110, -5], [110, 95], [10, 95],
    ]);
  });

  it('moves the control points too, which is what makes it exact', () => {
    /**
     * A cubic is affine-invariant: transform its four control points and the
     * curve through them *is* the transformed curve. Leaving the handles behind
     * would keep the anchors right and bend the shape between them.
     */
    const moved = mapPath(curved(), (p) => ({ x: p.x * 2, y: p.y * 3 }));
    expect(moved.segments[1]).toMatchObject({
      cp1x: 120, cp1y: 0, cp2x: 200, cp2y: 120, x: 200, y: 300,
    });
  });

  it('keeps a compound compound, mapping every contour', () => {
    const compound: CompoundGeometry = { kind: 'compound', subpaths: [square(), square()] };
    const moved = mapPath(compound, (p) => ({ x: p.x + 1, y: p.y }));
    expect(moved.kind).toBe('compound');
    expect(moved.subpaths).toHaveLength(2);
    expect(moved.subpaths[1].segments[0].x).toBe(1);
  });

  it('leaves an absent handle absent rather than inventing one at the origin', () => {
    // A straight run has no control points. Mapping `undefined` through the
    // function would put a handle at whatever the transform does to (0, 0).
    const moved = mapPath(square(), (p) => ({ x: p.x + 500, y: p.y + 500 }));
    expect(moved.segments[1].cp1x).toBeUndefined();
    expect(moved.segments[1].cp2x).toBeUndefined();
  });
});

describe('a node\'s outline under its own transform', () => {
  it('puts a turned square where the turned square is', () => {
    /**
     * The restriction this removes: the vector operations refused any operand
     * with a rotation, so two shapes could not be combined if one of them had
     * been turned a few degrees. Nothing about the clipper needed that — there
     * was simply no way to express the transform.
     */
    const node = { x: 200, y: 200, width: 100, height: 100, rotation: 45 };
    const world = mapPath(square(), nodeTransform(node));
    const box = pathBounds(world);
    const diagonal = Math.sqrt(2) * 100;
    expect(box.width).toBeCloseTo(diagonal, 6);
    // Still centred on the node's own centre.
    expect(box.x + box.width / 2).toBeCloseTo(250, 6);
    expect(box.y + box.height / 2).toBeCloseTo(250, 6);
  });

  it('scales about the centre, the way the canvas draws it', () => {
    const node = { x: 0, y: 0, width: 100, height: 100, scaleX: 2, scaleY: 0.5 };
    const box = pathBounds(mapPath(square(), nodeTransform(node)));
    expect(box.width).toBeCloseTo(200, 6);
    expect(box.height).toBeCloseTo(50, 6);
    expect(box.x + box.width / 2).toBeCloseTo(50, 6);
  });

  it('scales before it turns, so a stretched square does not shear', () => {
    // Rotating first and scaling after would skew the shape into a rhombus --
    // a different shape from the one on the screen.
    const node = { x: 0, y: 0, width: 100, height: 100, rotation: 90, scaleX: 2, scaleY: 1 };
    const box = pathBounds(mapPath(square(), nodeTransform(node)));
    // Two hundred wide, turned a right angle: two hundred tall.
    expect(box.width).toBeCloseTo(100, 6);
    expect(box.height).toBeCloseTo(200, 6);
  });

  it('leaves an untransformed node exactly where it was', () => {
    const node = { x: 40, y: 60, width: 100, height: 100 };
    const box = contourBounds(mapPath(square(), nodeTransform(node)));
    expect(box).toMatchObject({ x: 40, y: 60, width: 100, height: 100 });
  });
});
