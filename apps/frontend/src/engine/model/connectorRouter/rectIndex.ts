/**
 * Boxes by id, searchable by area: the route store's index of its own routes.
 *
 * The store asks "which routes come near this box?" on every live event and
 * for every route it routes, so a walk over every connector there costs
 * connectors x segments per pointer move. An R-tree answers the same question
 * by area, and the store then checks only the few routes it returns.
 */

import RBush from 'rbush';
import type { Rect } from './geometry';

interface Item extends Rect {
  id: string;
}

export class RectIndex {
  private tree = new RBush<Item>(9);
  private items = new Map<string, Item>();

  get size(): number {
    return this.items.size;
  }

  /** Record a box for an id, replacing the one it had. */
  set(id: string, rect: Rect): void {
    const old = this.items.get(id);
    if (old) {
      if (old.minX === rect.minX && old.minY === rect.minY && old.maxX === rect.maxX && old.maxY === rect.maxY) return;
      this.tree.remove(old);
    }
    const item: Item = { id, minX: rect.minX, minY: rect.minY, maxX: rect.maxX, maxY: rect.maxY };
    this.items.set(id, item);
    this.tree.insert(item);
  }

  delete(id: string): void {
    const old = this.items.get(id);
    if (!old) return;
    this.tree.remove(old);
    this.items.delete(id);
  }

  get(id: string): Rect | undefined {
    return this.items.get(id);
  }

  /** Ids whose box meets `rect`, edges included. Unordered. */
  search(rect: Rect): string[] {
    if (this.items.size === 0) return [];
    return this.tree.search(rect).map((item) => item.id);
  }

  clear(): void {
    this.tree.clear();
    this.items.clear();
  }
}
