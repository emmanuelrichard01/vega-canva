import { describe, it, expect } from 'vitest';
import { boxOfNode, outlineFor, attachPoint, portPointsFor, bodyOutlinePoints,
  connectorDragPatch, CONNECTABLE, isConnectable, bindCandidates,
} from './connectorTargets';
import { NODE_TYPES, type AnyNode } from './schema';

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


describe('connectorDragPatch', () => {
  const bound = (id: string) => ({ nodeId: id, x: 0, y: 0 });
  const loose = (x: number, y: number) => ({ x, y });

  it('refuses to move a connector held at both ends', () => {
    /**
     * The bug this exists to stop. A connector's box is derived, so translating
     * it shifts the frame its route is drawn in and the route compensates the
     * other way -- the arrow slides away from the objects it joins for the
     * length of a group drag and jumps back on release.
     */
    expect(connectorDragPatch({ from: bound('a'), to: bound('b') }, 40, 25)).toBeNull();
  });

  it('carries a loose end and leaves a bound one alone', () => {
    const patch = connectorDragPatch({ from: bound('a'), to: loose(100, 200) }, 40, 25)!;
    expect(patch.from).toEqual(bound('a'));
    expect(patch.to).toMatchObject({ x: 140, y: 225 });
  });

  it('carries both ends of a free-floating connector', () => {
    const patch = connectorDragPatch({ from: loose(0, 0), to: loose(50, 50) }, -10, 5)!;
    expect(patch.from).toMatchObject({ x: -10, y: 5 });
    expect(patch.to).toMatchObject({ x: 40, y: 55 });
  });

  it('treats an end with no coordinates as sitting at the origin', () => {
    // A detached end is written with `x`/`y`, but a document need not have
    // them, and `undefined + 40` is `NaN` -- which Konva renders as nothing.
    const patch = connectorDragPatch({ from: {}, to: {} }, 40, 25)!;
    expect(patch.from).toMatchObject({ x: 40, y: 25 });
  });
});

/**
 * Every node type is connectable unless somebody said otherwise.
 *
 * `CONNECTABLE` was an **allow-list**, written when there were six node types,
 * and `grid` and `audio` arrived without being added to it. Pointing the
 * connector tool at a grid therefore did nothing at all — no port under the
 * pointer, no error, nothing to suggest the tool had even seen it.
 *
 * The failure has a shape worth naming: a list that must be updated when a type
 * is added, with nothing to say so. Inverting it makes a new type connectable
 * by default, which is wrong in the safe direction — a control that works
 * rather than one that is quietly absent — and this block is what keeps the set
 * honest against `NODE_TYPES` rather than against a copy of it.
 */
describe('the connectable set is derived from the node types', () => {
  it('covers every type except the stated exclusions', () => {
    const excluded = NODE_TYPES.filter((t) => !CONNECTABLE.has(t));
    expect([...excluded].sort()).toEqual(['comment', 'connector']);
  });

  it('contains nothing that is not a node type', () => {
    // A stale entry is the other half of the same failure: a type renamed and
    // the list left holding the old spelling, matching nothing forever.
    for (const type of CONNECTABLE) {
      expect(NODE_TYPES as readonly string[], type).toContain(type);
    }
  });

  it('includes the two that were missing', () => {
    /**
     * The bug, stated. `audio` shows how the omission happens: it is already
     * in `BOX_IS_THE_SHAPE` one module over, so somebody had thought about it
     * there and not here.
     */
    expect(CONNECTABLE.has('grid')).toBe(true);
    expect(CONNECTABLE.has('audio')).toBe(true);
  });

  it('still refuses a connector', () => {
    // An arrow bound to an arrow has no box to take a side of, and the chain
    // of derivations it creates has no natural end.
    expect(CONNECTABLE.has('connector')).toBe(false);
  });

  it('still refuses a comment pin', () => {
    // A 32px marker anchored to a point, and chrome about the board rather
    // than part of it. `objectSnap` excludes it from alignment for the same
    // reason.
    expect(CONNECTABLE.has('comment')).toBe(false);
  });
});

describe('a grid is a real binding target', () => {
  it('accepts an ordinary one', () => {
    expect(isConnectable(makeNode({ id: 'g', type: 'grid' }))).toBe(true);
  });

  it('refuses a hidden or locked one', () => {
    // Both mean "you cannot interact with this", and an arrow bound to
    // something invisible is a connector pointing at nothing.
    expect(isConnectable(makeNode({ id: 'g', type: 'grid', hidden: true }))).toBe(false);
    expect(isConnectable(makeNode({ id: 'g', type: 'grid', locked: true }))).toBe(false);
  });

  it('appears among the candidates with its box', () => {
    const grid = makeNode({ id: 'g', type: 'grid', x: 0, y: 0, width: 100, height: 80 });
    const candidates = bindCandidates({ g: grid });
    expect(candidates.map((c) => c.id)).toEqual(['g']);
    expect(candidates[0].box).toEqual({ x: 0, y: 0, width: 100, height: 80 });
  });

  it('presents a turned grid as its rotated silhouette', () => {
    /**
     * `grid` was missing from `BOX_IS_THE_SHAPE` as well, which left a rotated
     * grid handing the connector system its axis-aligned box — a side attached
     * at the wrong place on any grid somebody had turned.
     */
    const turned = makeNode({ id: 'gr', type: 'grid', rotation: 45 });
    expect(outlineFor(turned)).toHaveLength(4);
  });
});
