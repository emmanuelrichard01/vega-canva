import { describe, it, expect, beforeEach } from 'vitest';
import { spatialIndex } from './SpatialIndex';
import { engineEvents } from './EventBus';
import type { ShapeNode } from './model/schema';

describe('SpatialIndex', () => {
  beforeEach(() => {
    spatialIndex.clear();
  });

  const createDummyShape = (id: string, x: number, y: number, width = 100, height = 100): ShapeNode =>
    ({
      id,
      type: 'shape',
      x,
      y,
      width,
      height,
      zIndex: 1,
      updatedAt: Date.now(),
      geometry: { kind: 'rect' },
      appearance: { fill: [{ type: 'solid', color: '#000000' }] },
    }) as unknown as ShapeNode;

  it('indexes added nodes and retrieves them with intersecting queries', () => {
    const node1 = createDummyShape('node-1', 0, 0, 100, 100);
    const node2 = createDummyShape('node-2', 500, 500, 100, 100);

    engineEvents.emit('ObjectAdded', node1);
    engineEvents.emit('ObjectAdded', node2);

    // Query covering node1 only
    const query1 = spatialIndex.query({ minX: -50, minY: -50, maxX: 150, maxY: 150 });
    expect(query1.map((n) => n.id)).toEqual(['node-1']);

    // Query covering both
    const queryBoth = spatialIndex.query({ minX: -100, minY: -100, maxX: 1000, maxY: 1000 });
    expect(queryBoth.map((n) => n.id).sort()).toEqual(['node-1', 'node-2']);

    // Query covering empty space
    const queryEmpty = spatialIndex.query({ minX: 200, minY: 200, maxX: 300, maxY: 300 });
    expect(queryEmpty).toEqual([]);
  });

  it('updates bounding boxes and node references on ObjectMoved', () => {
    const node = createDummyShape('node-move', 0, 0, 100, 100);
    engineEvents.emit('ObjectAdded', node);

    // Verify initial location
    let res = spatialIndex.query({ minX: -10, minY: -10, maxX: 110, maxY: 110 });
    expect(res.length).toBe(1);
    expect(res[0].x).toBe(0);

    // Move node to 1000, 1000
    const movedNode: ShapeNode = { ...node, x: 1000, y: 1000 };
    engineEvents.emit('ObjectMoved', movedNode);

    // Old location returns empty
    res = spatialIndex.query({ minX: -10, minY: -10, maxX: 110, maxY: 110 });
    expect(res).toEqual([]);

    // New location returns updated node
    res = spatialIndex.query({ minX: 950, minY: 950, maxX: 1150, maxY: 1150 });
    expect(res.length).toBe(1);
    expect(res[0].id).toBe('node-move');
    expect(res[0].x).toBe(1000);
    expect(res[0].y).toBe(1000);
  });

  it('self-heals and inserts untracked nodes on ObjectMoved', () => {
    const node = createDummyShape('untracked-node', 300, 300, 100, 100);
    // Emit ObjectMoved without ObjectAdded first
    engineEvents.emit('ObjectMoved', node);

    const res = spatialIndex.query({ minX: 250, minY: 250, maxX: 450, maxY: 450 });
    expect(res.length).toBe(1);
    expect(res[0].id).toBe('untracked-node');
  });

  it('removes nodes on ObjectRemoved', () => {
    const node = createDummyShape('node-remove', 100, 100, 100, 100);
    engineEvents.emit('ObjectAdded', node);

    expect(spatialIndex.query({ minX: 50, minY: 50, maxX: 250, maxY: 250 }).length).toBe(1);

    engineEvents.emit('ObjectRemoved', node);
    expect(spatialIndex.query({ minX: 50, minY: 50, maxX: 250, maxY: 250 })).toEqual([]);
  });
});
