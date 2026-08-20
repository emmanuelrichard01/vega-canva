import { engineEvents } from './EventBus';
import type { AnyNode } from './model/schema';

export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Axis-aligned world bounds for one node.
 *
 * A free function rather than only a method, because the docstring on
 * `getNodeBounds` has always claimed these are "what an export frames to" and
 * that was not true: `engine/export/bounds.ts` carried its own copy that read
 * position and scale and ignored rotation and skew entirely. So a rotated
 * object at the edge of a board was cropped out of every export, while the
 * culling that used *this* function saw it correctly — the two disagreed
 * exactly where it was least visible.
 *
 * Invariant 7: one source of truth, or a test holding the copies together.
 * There is one now.
 */
export function nodeBounds(node: AnyNode): BoundingBox {
  const x = Number.isFinite(node.x) ? node.x : 0;
  const y = Number.isFinite(node.y) ? node.y : 0;
  const w = (Number.isFinite(node.width) ? node.width : 100) * Math.abs(node.scaleX || 1);
  const h = (Number.isFinite(node.height) ? node.height : 100) * Math.abs(node.scaleY || 1);

  const rotation = node.rotation || 0;
  const skewX = node.skewX || 0;
  const skewY = node.skewY || 0;

  if (!rotation && !skewX && !skewY) {
    return { minX: x, minY: y, maxX: x + w, maxY: y + h };
  }

  // Objects rotate and shear about their centre (see ObjectRenderer's offset).
  const cx = x + w / 2;
  const cy = y + h / 2;

  /**
   * The four corners through the node's own transform.
   *
   * The rotation-only case had a closed form — `w·cos + h·sin` — and shear
   * has no equivalent, because a sheared rectangle is a parallelogram whose
   * extent depends on both angles at once. Transforming the corners and
   * taking their extremes is exact for any composition of the three, and it
   * is four points rather than a special case per combination.
   *
   * Getting this wrong is not cosmetic: these bounds are what the spatial
   * index culls by, what a marquee tests against and what an export frames
   * to, so an under-reported box is an object that vanishes at the edge of
   * the viewport and is missing from the file.
   */
  const kx = Math.tan((skewX * Math.PI) / 180);
  const ky = Math.tan((skewY * Math.PI) / 180);
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const hw = w / 2;
  const hh = h / 2;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (const [ox, oy] of [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]] as const) {
    // Shear first, then rotate — the order Konva composes them in, so the
    // box describes what is actually drawn rather than a plausible variant.
    const sx = ox + kx * oy;
    const sy = oy + ky * ox;
    const px = cx + sx * cos - sy * sin;
    const py = cy + sx * sin + sy * cos;
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }

  return { minX, minY, maxX, maxY };
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
      /**
       * Every field `getNodeBounds` reads, compared explicitly.
       *
       * This used to check position and scale only, which left the spatial
       * index stale for the two gestures most likely to change an object's
       * extent: rotating it and resizing it. A node rotated 45° kept the
       * bounds of its unrotated box in the index, so culling and marquee
       * selection both worked from a rectangle the object had grown out of.
       * Skew joins the list for the same reason — the note above asked for
       * exactly this and it is cheaper than the bug.
       */
      const moved =
        oldNode?.x !== data.x ||
        oldNode?.y !== data.y ||
        oldNode?.width !== data.width ||
        oldNode?.height !== data.height ||
        oldNode?.rotation !== data.rotation ||
        oldNode?.scaleX !== data.scaleX ||
        oldNode?.scaleY !== data.scaleY ||
        oldNode?.skewX !== data.skewX ||
        oldNode?.skewY !== data.skewY;
      
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
   * Delegates to the free `nodeBounds` above so the exporters can reach the
   * same arithmetic without holding a scene graph. Kept as a method because
   * the spatial index and the marquee both call it this way.
   */
  getNodeBounds(node: AnyNode): BoundingBox {
    return nodeBounds(node);
  }
}

// Global Singleton
export const sceneGraph = new SceneGraph();
