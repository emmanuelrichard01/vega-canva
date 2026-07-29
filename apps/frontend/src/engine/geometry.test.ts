import { describe, expect, it } from 'vitest';
import { SceneGraph } from './SceneGraph';
import { normalizeNode } from './document/normalize';
import type { AnyNode } from './model/schema';

function node(partial: Record<string, unknown>): AnyNode {
  return normalizeNode({ type: 'shape', ...partial });
}

describe('SceneGraph.getNodeBounds', () => {
  const graph = new SceneGraph();

  it('returns the plain box for an unrotated node', () => {
    expect(graph.getNodeBounds(node({ id: 'a', x: 10, y: 20, width: 100, height: 50 })))
      .toEqual({ minX: 10, minY: 20, maxX: 110, maxY: 70 });
  });

  it('accounts for scale', () => {
    const b = graph.getNodeBounds(node({ id: 'b', x: 0, y: 0, width: 100, height: 50, scaleX: 2, scaleY: 3 }));
    expect(b.maxX).toBe(200);
    expect(b.maxY).toBe(150);
  });

  it('treats a negative scale (a flip) as positive extent', () => {
    const b = graph.getNodeBounds(node({ id: 'c', x: 0, y: 0, width: 100, height: 50, scaleX: -1 }));
    expect(b.maxX).toBe(100);
    expect(b.minX).toBe(0);
  });

  it('expands the box for a rotated node', () => {
    // A 100x50 box rotated 90 degrees about its centre occupies a 50x100 box
    // centred on the same point. Ignoring rotation (the previous behaviour)
    // under-reported the extent, so a rotated object could be culled while
    // still partly on screen.
    const b = graph.getNodeBounds(node({ id: 'd', x: 0, y: 0, width: 100, height: 50, rotation: 90 }));
    expect(b.maxX - b.minX).toBeCloseTo(50, 5);
    expect(b.maxY - b.minY).toBeCloseTo(100, 5);
    // Centre is preserved.
    expect((b.minX + b.maxX) / 2).toBeCloseTo(50, 5);
    expect((b.minY + b.maxY) / 2).toBeCloseTo(25, 5);
  });

  it('a 45-degree rotation of a square grows the box by sqrt(2)', () => {
    const b = graph.getNodeBounds(node({ id: 'e', x: 0, y: 0, width: 100, height: 100, rotation: 45 }));
    expect(b.maxX - b.minX).toBeCloseTo(100 * Math.SQRT2, 4);
  });

  it('survives non-finite coordinates', () => {
    const b = graph.getNodeBounds(node({ id: 'f', x: NaN, y: undefined, width: 10, height: 10 }));
    expect(Number.isFinite(b.minX)).toBe(true);
    expect(Number.isFinite(b.maxY)).toBe(true);
  });
});

describe('SceneGraph hierarchy', () => {
  it('tracks parent/child relationships and cascades removal', () => {
    const graph = new SceneGraph();
    graph.upsertNode('p', node({ id: 'p', width: 10, height: 10 }));
    graph.upsertNode('c1', node({ id: 'c1', width: 10, height: 10, parentId: 'p' }));
    graph.upsertNode('c2', node({ id: 'c2', width: 10, height: 10, parentId: 'p' }));

    expect(graph.getChildren('p').sort()).toEqual(['c1', 'c2']);

    graph.removeNode('p');
    expect(graph.nodes.has('c1')).toBe(false);
    expect(graph.nodes.has('c2')).toBe(false);
  });

  it('reparents cleanly when parentId changes', () => {
    const graph = new SceneGraph();
    graph.upsertNode('x', node({ id: 'x', width: 10, height: 10, parentId: 'g1' }));
    expect(graph.getChildren('g1')).toEqual(['x']);

    graph.upsertNode('x', node({ id: 'x', width: 10, height: 10, parentId: 'g2' }));
    expect(graph.getChildren('g1')).toEqual([]);
    expect(graph.getChildren('g2')).toEqual(['x']);
  });
});
