import { engineEvents } from './EventBus';
import type { AnyNode } from './model/schema';

export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export class SceneGraph {
  nodes: Map<string, AnyNode> = new Map();
  
  // Hierarchy tracking
  private childrenMap: Map<string, Set<string>> = new Map();
  private rootNodes: Set<string> = new Set();

  constructor() {
    this.childrenMap.set('root', this.rootNodes);
  }

  upsertNode(id: string, data: AnyNode) {
    const isNew = !this.nodes.has(id);
    const oldNode = this.nodes.get(id);
    
    this.nodes.set(id, data);
    
    // Update Hierarchy Tracking
    if (isNew) {
      this.addToHierarchy(id, data.parentId);
    } else if (oldNode?.parentId !== data.parentId) {
      this.removeFromHierarchy(id, oldNode?.parentId);
      this.addToHierarchy(id, data.parentId);
    }
    
    if (isNew) {
      engineEvents.emit('ObjectAdded', data);
    } else {
      // Very naive check for bounds movement.
      // In a real robust system, we would compare the transform explicitly.
      const moved = oldNode?.x !== data.x || oldNode?.y !== data.y || oldNode?.scaleX !== data.scaleX || oldNode?.scaleY !== data.scaleY;
      
      if (moved) {
        engineEvents.emit('ObjectMoved', data);
      } else {
        engineEvents.emit('ObjectModified', data);
      }
    }
  }

  removeNode(id: string) {
    const node = this.nodes.get(id);
    if (node) {
      this.removeFromHierarchy(id, node.parentId);
      this.nodes.delete(id);
      engineEvents.emit('ObjectRemoved', node);
      
      // Cascade delete children (or reparent them to root)
      const children = this.childrenMap.get(id);
      if (children) {
        Array.from(children).forEach(childId => {
           this.removeNode(childId); // recursive cascade
        });
        this.childrenMap.delete(id);
      }
    }
  }

  private addToHierarchy(id: string, parentId?: string) {
    const parent = parentId || 'root';
    if (!this.childrenMap.has(parent)) {
      this.childrenMap.set(parent, new Set());
    }
    this.childrenMap.get(parent)!.add(id);
  }

  private removeFromHierarchy(id: string, parentId?: string) {
    const parent = parentId || 'root';
    this.childrenMap.get(parent)?.delete(id);
  }

  getChildren(parentId: string = 'root'): string[] {
    const set = this.childrenMap.get(parentId);
    return set ? Array.from(set) : [];
  }

  /**
   * Axis-aligned world bounds, used by the spatial index for culling.
   *
   * Reads `width`/`height` directly. It used to walk
   * `geometry?.width ?? width ?? content?.width ?? 100` — one of six such
   * chains across the codebase, each with its own precedence — which meant
   * the culling bounds could disagree with what the renderer actually drew.
   *
   * Rotation is accounted for by taking the bounding box of the rotated
   * rectangle. Ignoring it (as before) under-reported the extent of any
   * rotated object, so one could be culled while still partly on screen.
   */
  getNodeBounds(node: AnyNode): BoundingBox {
    const x = Number.isFinite(node.x) ? node.x : 0;
    const y = Number.isFinite(node.y) ? node.y : 0;
    const w = (Number.isFinite(node.width) ? node.width : 100) * Math.abs(node.scaleX || 1);
    const h = (Number.isFinite(node.height) ? node.height : 100) * Math.abs(node.scaleY || 1);

    const rotation = node.rotation || 0;
    if (!rotation) {
      return { minX: x, minY: y, maxX: x + w, maxY: y + h };
    }

    // Objects rotate about their centre (see ObjectRenderer's offset).
    const rad = (rotation * Math.PI) / 180;
    const cos = Math.abs(Math.cos(rad));
    const sin = Math.abs(Math.sin(rad));
    const rw = w * cos + h * sin;
    const rh = w * sin + h * cos;
    const cx = x + w / 2;
    const cy = y + h / 2;

    return {
      minX: cx - rw / 2,
      minY: cy - rh / 2,
      maxX: cx + rw / 2,
      maxY: cy + rh / 2,
    };
  }
}

// Global Singleton
export const sceneGraph = new SceneGraph();
