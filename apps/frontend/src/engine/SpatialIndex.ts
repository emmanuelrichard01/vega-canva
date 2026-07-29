import RBush from 'rbush';
import { engineEvents } from './EventBus';
import { sceneGraph } from './SceneGraph';
import type { AnyNode } from './model/schema';

export interface SpatialNode {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  id: string;
  node: AnyNode;
}

export class SpatialIndex {
  private tree = new RBush<SpatialNode>(9); // Node capacity of 9 (default)
  private itemMap = new Map<string, SpatialNode>();

  constructor() {
    engineEvents.on('ObjectAdded', this.handleAdded);
    engineEvents.on('ObjectMoved', this.handleMoved);
    engineEvents.on('ObjectRemoved', this.handleRemoved);
  }

  private handleAdded = (node: AnyNode) => {
    const bounds = sceneGraph.getNodeBounds(node);
    const item: SpatialNode = {
      id: node.id,
      minX: bounds.minX,
      minY: bounds.minY,
      maxX: bounds.maxX,
      maxY: bounds.maxY,
      node
    };
    this.tree.insert(item);
    this.itemMap.set(node.id, item);
  };

  private handleMoved = (node: AnyNode) => {
    const item = this.itemMap.get(node.id);
    if (item) {
      const bounds = sceneGraph.getNodeBounds(node);
      // Must remove the old bbox, update, then reinsert.
      this.tree.remove(item);
      item.minX = bounds.minX;
      item.minY = bounds.minY;
      item.maxX = bounds.maxX;
      item.maxY = bounds.maxY;
      this.tree.insert(item);
    }
  };

  private handleRemoved = (node: AnyNode) => {
    const item = this.itemMap.get(node.id);
    if (item) {
      this.tree.remove(item);
      this.itemMap.delete(node.id);
    }
  };

  /**
   * Instantly retrieve all SceneNodes intersecting the given bounds.
   */
  query(bounds: { minX: number, minY: number, maxX: number, maxY: number }): AnyNode[] {
    return this.tree.search(bounds).map(item => item.node);
  }
}

// Global Singleton
export const spatialIndex = new SpatialIndex();
