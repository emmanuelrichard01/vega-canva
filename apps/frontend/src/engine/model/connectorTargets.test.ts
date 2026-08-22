import { describe, it, expect } from 'vitest';
import { boxOfNode, outlineFor, attachPoint, portPointsFor, bodyOutlinePoints } from './connectorTargets';
import type { AnyNode } from './schema';

/** Minimal shape node factory — only the fields the functions under test read. */
function makeNode(overrides: Partial<AnyNode> & { id: string; type: string }): AnyNode {
  return {
    x: 100,
    y: 100,
    width: 80,
    height: 60,
    zIndex: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    createdBy: 'test',
    ...overrides,
  } as AnyNode;
}

describe('boxOfNode', () => {
  it('returns the box at face value for an unscaled node', () => {
    const box = boxOfNode({ x: 10, y: 20, width: 100, height: 50 });
    expect(box).toEqual({ x: 10, y: 20, width: 100, height: 50 });
  });

  it('folds scale into the dimensions', () => {
    const box = boxOfNode({ x: 0, y: 0, width: 100, height: 50, scaleX: 2, scaleY: 0.5 });
    expect(box.width).toBe(200);
    expect(box.height).toBe(25);
  });

  it('treats negative scale as an absolute value (mirror)', () => {
    const box = boxOfNode({ x: 0, y: 0, width: 100, height: 50, scaleX: -1, scaleY: -2 });
    expect(box.width).toBe(100);
    expect(box.height).toBe(100);
  });
});

describe('outlineFor', () => {
  it('returns null for an unrotated sticky (box is the shape)', () => {
    const node = makeNode({ id: 'sticky-1', type: 'sticky' });
    expect(outlineFor(node)).toBeNull();
  });

  it('returns four rotated corners for a rotated sticky', () => {
    const node = makeNode({ id: 'sticky-rot', type: 'sticky', rotation: 45 });
    const outline = outlineFor(node);
    expect(outline).not.toBeNull();
    expect(outline).toHaveLength(4);
  });

  it('caches by identity — same node returns the same array reference', () => {
    const node = makeNode({ id: 'sticky-cache', type: 'sticky', rotation: 30 });
    const first = outlineFor(node);
    const second = outlineFor(node);
    expect(first).toBe(second);
  });

  it('invalidates when rotation changes', () => {
    const node0 = makeNode({ id: 'sticky-inv', type: 'sticky', rotation: 0 });
    const node45 = makeNode({ id: 'sticky-inv', type: 'sticky', rotation: 45 });
    const a = outlineFor(node0);
    const b = outlineFor(node45);
    // Unrotated returns null, rotated returns points — they must differ.
    expect(a).toBeNull();
    expect(b).not.toBeNull();
  });
});

describe('attachPoint', () => {
  it('returns the box midpoint for a simple unrotated sticky', () => {
    // For a box-is-the-shape node with no rotation, outlineFor returns null,
    // so attachOnOutline falls through to just rotating the boxPoint (which
    // with 0° rotation is the identity).
    const node = makeNode({ id: 'ap-1', type: 'sticky', x: 0, y: 0, width: 100, height: 100 });
    const p = attachPoint(node, { x: 50, y: 0 });
    // Top-centre of the box, no rotation → should come back unchanged.
    expect(p.x).toBeCloseTo(50);
    expect(p.y).toBeCloseTo(0);
  });

  it('rotates the attachment point for a rotated node', () => {
    const node = makeNode({
      id: 'ap-rot',
      type: 'sticky',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 90,
    });
    // The box's top-centre (50, 0) rotated 90° about the box centre (50, 50)
    // should land at (100, 50).
    const p = attachPoint(node, { x: 50, y: 0 });
    expect(p.x).toBeCloseTo(100);
    expect(p.y).toBeCloseTo(50);
  });
});

describe('portPointsFor', () => {
  it('returns four ports', () => {
    const node = makeNode({ id: 'pp-1', type: 'sticky', x: 0, y: 0, width: 100, height: 100 });
    const ports = portPointsFor(node);
    expect(ports).toHaveLength(4);
    const sides = ports.map((p) => p.side);
    expect(sides).toEqual(expect.arrayContaining(['top', 'right', 'bottom', 'left']));
  });
});

describe('bodyOutlinePoints', () => {
  it('returns the box corners as flat coords for a box-shaped node', () => {
    const node = makeNode({ id: 'bo-1', type: 'sticky', x: 0, y: 0, width: 100, height: 50 });
    const pts = bodyOutlinePoints(node);
    // 4 corners × 2 coords = 8
    expect(pts).toHaveLength(8);
    expect(pts).toEqual([0, 0, 100, 0, 100, 50, 0, 50]);
  });

  it('returns the rotated outline for a rotated box-shaped node', () => {
    const node = makeNode({ id: 'bo-rot', type: 'sticky', x: 0, y: 0, width: 100, height: 100, rotation: 45 });
    const pts = bodyOutlinePoints(node);
    // Should be 4 rotated corners × 2 = 8 flat coords
    expect(pts).toHaveLength(8);
    // The corners should NOT be axis-aligned (i.e. they should differ from the unrotated box).
    const unrotated = [0, 0, 100, 0, 100, 100, 0, 100];
    expect(pts).not.toEqual(unrotated);
  });
});
