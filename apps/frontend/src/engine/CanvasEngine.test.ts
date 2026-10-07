import { describe, it, expect, beforeEach } from 'vitest';
import { canvasEngine } from './CanvasEngine';
import { cameraSystem } from './CameraSystem';
import { sceneGraph } from './SceneGraph';
import { engineEvents } from './EventBus';
import type { AnyNode } from './model/schema';

const shape = (id: string, x: number, y: number) =>
  ({ id, type: 'shape', x, y, width: 50, height: 50, rotation: 0, scaleX: 1, scaleY: 1, zIndex: 1 }) as unknown as AnyNode;

describe('CanvasEngine culling', () => {
  beforeEach(() => {
    for (const id of Array.from(sceneGraph.nodes.keys())) sceneGraph.removeNode(id);
    cameraSystem.resize(800, 600);
    cameraSystem.setPose(0, 0, 1);
    canvasEngine.updateVisibleSet();
  });

  it('mounts only what is in view, including objects loaded off-screen', () => {
    sceneGraph.upsertNode('on', shape('on', 100, 100));
    for (let i = 0; i < 999; i++) sceneGraph.upsertNode(`off-${i}`, shape(`off-${i}`, 10_000 + i * 60, 10_000));
    canvasEngine.updateVisibleSet();
    expect(canvasEngine.visibleSet.size).toBe(1);
    expect(canvasEngine.visibleSet.has('on')).toBe(true);
    expect(canvasEngine.metrics.visibleCount).toBe(1);
    expect(canvasEngine.metrics.totalCount).toBe(1000);
  });

  it('publishes once per pass, not once per added node', () => {
    let emits = 0;
    const off = engineEvents.on('VisibleSetUpdated', () => emits++);
    for (let i = 0; i < 200; i++) sceneGraph.upsertNode(`n-${i}`, shape(`n-${i}`, i, i));
    expect(emits).toBe(0);
    canvasEngine.updateVisibleSet();
    expect(emits).toBe(1);
    off();
  });

  it('shows a node added in view immediately, before the next query', () => {
    sceneGraph.upsertNode('fresh', shape('fresh', 10, 10));
    expect(canvasEngine.visibleSet.has('fresh')).toBe(true);
    sceneGraph.upsertNode('far', shape('far', 50_000, 50_000));
    expect(canvasEngine.visibleSet.has('far')).toBe(false);
  });

  it('empties the set when the camera pans to empty space', () => {
    sceneGraph.upsertNode('a', shape('a', 100, 100));
    canvasEngine.updateVisibleSet();
    expect(canvasEngine.visibleSet.size).toBe(1);
    cameraSystem.setPose(-100_000, -100_000, 1);
    canvasEngine.updateVisibleSet();
    expect(canvasEngine.visibleSet.size).toBe(0);
    expect(canvasEngine.hasReported).toBe(true);
  });

  it('drops a removed node from the set', () => {
    sceneGraph.upsertNode('gone', shape('gone', 100, 100));
    canvasEngine.updateVisibleSet();
    sceneGraph.removeNode('gone');
    expect(canvasEngine.visibleSet.has('gone')).toBe(false);
  });
});
