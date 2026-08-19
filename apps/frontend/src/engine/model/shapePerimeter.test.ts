import { describe, it, expect } from 'vitest';
import { outlineOfNode, projectToOutline } from './shapePerimeter';
import { connectorPoints, type Box } from './connector';
import type { AnyNode } from './schema';

/** A square outline, so expected crossings are obvious by inspection. */
const SQUARE = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];

/** A triangle pointing up, inside a 100x100 box — the motivating case. */
const TRIANGLE = [
  { x: 50, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];

const centre = { x: 50, y: 50 };

describe('projectToOutline', () => {
  it('lands on the outline along the ray', () => {
    expect(projectToOutline(SQUARE, centre, { x: 100, y: 50 })).toEqual({ x: 100, y: 50 });
  });

  it('pulls a box point inwards onto a triangle', () => {
    // The whole reason this module exists: the box's left-middle is empty air
    // on a triangle, tens of units from anything drawn, and an arrow ending
    // there ends nowhere.
    const hit = projectToOutline(TRIANGLE, centre, { x: 0, y: 50 })!;
    expect(hit.x).toBeGreaterThan(0);
    expect(hit.x).toBeCloseTo(25);
    expect(hit.y).toBeCloseTo(50);
  });

  it('takes the outermost crossing, so a spike is not cut through', () => {
    // A concave outline means the ray leaves and re-enters. The silhouette is
    // what an arrow should touch, so the farthest crossing wins.
    const star = [
      { x: 50, y: 0 },
      { x: 60, y: 40 },
      { x: 100, y: 50 },
      { x: 60, y: 60 },
      { x: 50, y: 100 },
      { x: 40, y: 60 },
      { x: 0, y: 50 },
      { x: 40, y: 40 },
    ];
    const hit = projectToOutline(star, centre, { x: 100, y: 50 })!;
    expect(hit.x).toBeCloseTo(100);
  });

  it('returns null when there is no direction to cast', () => {
    expect(projectToOutline(SQUARE, centre, centre)).toBeNull();
  });

  it('returns null rather than guessing when the ray misses', () => {
    const far = [
      { x: 500, y: 500 },
      { x: 510, y: 500 },
      { x: 510, y: 510 },
    ];
    expect(projectToOutline(far, centre, { x: 0, y: 50 })).toBeNull();
  });
});

describe('outlineOfNode', () => {
  const shape = (kind: string, extra: Record<string, unknown> = {}): AnyNode =>
    ({
      id: 'n', type: 'shape', x: 10, y: 20, width: 100, height: 60,
      geometry: { kind, ...extra },
    } as unknown as AnyNode);

  it('is null where the box already tells the truth', () => {
    // Rectangles and every box-shaped node type: no ray cast, no flatten, and
    // that is most of the objects on most boards.
    expect(outlineOfNode(shape('rect'))).toBeNull();
    for (const type of ['sticky', 'image', 'frame', 'text']) {
      expect(outlineOfNode({ ...shape('rect'), type } as AnyNode)).toBeNull();
    }
  });

  it('gives a real outline for a triangle, in world space', () => {
    const out = outlineOfNode(shape('triangle'))!;
    expect(out.length).toBeGreaterThanOrEqual(3);
    // Offset by the node origin, not left in local coordinates.
    expect(Math.min(...out.map((p) => p.x))).toBeGreaterThanOrEqual(10);
    expect(Math.min(...out.map((p) => p.y))).toBeGreaterThanOrEqual(20);
  });

  it('never returns a NaN', () => {
    for (const kind of ['triangle', 'ellipse', 'star', 'polygon']) {
      const out = outlineOfNode(shape(kind, { points: 5, innerRadius: 0.5 }));
      if (out) expect(out.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
    }
  });
});

describe('connectorPoints with an outline lookup', () => {
  const boxes: Record<string, Box> = {
    tri: { x: 0, y: 0, width: 100, height: 100 },
    b: { x: 300, y: 0, width: 100, height: 100 },
  };
  const boxOf = (id: string) => boxes[id] ?? null;

  it('keeps the box answer when no lookup is given', () => {
    // Every existing caller and every existing test passes four arguments and
    // must keep the answer it had.
    const pts = connectorPoints({ nodeId: 'tri' }, { nodeId: 'b' }, 'straight', boxOf);
    expect(pts.slice(0, 2)).toEqual([100, 50]);
  });

  it('moves the end onto the shape when one is', () => {
    const outlineOf = (id: string) => (id === 'tri' ? TRIANGLE : null);
    const pts = connectorPoints({ nodeId: 'tri' }, { nodeId: 'b' }, 'straight', boxOf, outlineOf);
    // The triangle's right edge at mid-height is at x=75, not the box's 100.
    expect(pts[0]).toBeCloseTo(75);
    expect(pts[1]).toBeCloseTo(50);
  });

  it('falls back to the box point when the outline is unusable', () => {
    for (const outlineOf of [() => null, () => [{ x: 0, y: 0 }]]) {
      const pts = connectorPoints({ nodeId: 'tri' }, { nodeId: 'b' }, 'straight', boxOf, outlineOf);
      expect(pts.slice(0, 2)).toEqual([100, 50]);
    }
  });
});
