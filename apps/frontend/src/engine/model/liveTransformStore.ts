/**
 * Transient in-memory store for active gestures (dragging, transforming, corner radius adjustments).
 *
 * ## Why this lives outside Zustand and CRDT
 *
 * Moving an object across the canvas produces 60 events per second. Writing
 * each frame to the CRDT or root Zustand store would trigger full document
 * re-renders, thrash the undo stack, and flood the network provider with
 * transient coordinates.
 *
 * `liveTransformStore` maintains an in-memory map of active transient overrides
 * with granular per-node subscriptions. Only components attached to the
 * actively moving node (such as connectors and handles) subscribe and re-render.
 *
 * ## Snapshot identity contract
 *
 * `useSyncExternalStore` requires that `getSnapshot` returns the same reference
 * between renders when nothing changed, so React can skip work. Every `set()`
 * and `delete()` allocates a new object for the affected id — the identity
 * *is* the signal, and Object.is comparison is what makes the hook cheap.
 *
 * ## Notification coalescing
 *
 * A group drag publishes N siblings on every `handleDragMove`. Notifying after
 * each `.set()` would fire N × listeners per frame. `setBatch` absorbs all of
 * them and fires one round of notifications at the end, cutting React commit
 * work from O(siblings × connectors) to O(unique-ids × connectors-per-id).
 */

import { useSyncExternalStore } from 'react';

export interface LiveTransform {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  cornerRadius?: number;
  typography?: import('./schema').Typography;
  resize?: import('./schema').TextResize;
}

type Listener = () => void;

class LiveTransformStore {
  private transforms = new Map<string, LiveTransform>();
  private listeners = new Map<string, Set<Listener>>();
  private globalListeners = new Set<Listener>();

  /** How many ids are currently live. Useful for guards that skip work when nobody is dragging. */
  get size(): number {
    return this.transforms.size;
  }

  /** Whether any gesture is active at all. Cheaper than checking a specific id. */
  get active(): boolean {
    return this.transforms.size > 0;
  }

  get(id: string): LiveTransform | undefined {
    return this.transforms.get(id);
  }

  /**
   * Publish or update a transient transform for a single node.
   * Merges with any existing entry and notifies listeners immediately.
   */
  set(id: string, patch: Partial<LiveTransform>): void {
    const existing = this.transforms.get(id);
    this.transforms.set(id, { ...(existing ?? {}), ...patch });
    this.notify(id);
  }

  /**
   * Publish transforms for multiple nodes in a single notification pass.
   *
   * Used by group drag where N siblings all move on the same frame — calling
   * `set()` N times would fire N separate notification rounds, each causing
   * every attached connector to re-render before the batch is complete. This
   * collects the unique dirty ids and notifies once per id at the end.
   */
  setBatch(entries: Array<[id: string, patch: Partial<LiveTransform>]>): void {
    const dirty = new Set<string>();
    for (const [id, patch] of entries) {
      const existing = this.transforms.get(id);
      this.transforms.set(id, { ...(existing ?? {}), ...patch });
      dirty.add(id);
    }
    for (const id of dirty) {
      this.listeners.get(id)?.forEach((fn) => fn());
    }
    if (dirty.size > 0) {
      this.globalListeners.forEach((fn) => fn());
    }
  }

  /**
   * Remove transient transforms for multiple nodes in a single notification pass.
   */
  deleteBatch(ids: string[]): void {
    const dirty: string[] = [];
    for (const id of ids) {
      if (this.transforms.delete(id)) dirty.push(id);
    }
    for (const id of dirty) {
      this.listeners.get(id)?.forEach((fn) => fn());
    }
    if (dirty.length > 0) {
      this.globalListeners.forEach((fn) => fn());
    }
  }

  delete(id: string): void {
    if (this.transforms.delete(id)) {
      this.notify(id);
    }
  }

  clear(): void {
    const ids = Array.from(this.transforms.keys());
    this.transforms.clear();
    for (const id of ids) {
      this.listeners.get(id)?.forEach((fn) => fn());
    }
    if (ids.length > 0) {
      this.globalListeners.forEach((fn) => fn());
    }
  }

  subscribe(id: string, listener: Listener): () => void {
    let set = this.listeners.get(id);
    if (!set) {
      set = new Set();
      this.listeners.set(id, set);
    }
    set.add(listener);
    return () => {
      set?.delete(listener);
      if (set && set.size === 0) {
        this.listeners.delete(id);
      }
    };
  }

  subscribeGlobal(listener: Listener): () => void {
    this.globalListeners.add(listener);
    return () => {
      this.globalListeners.delete(listener);
    };
  }

  private notify(id: string): void {
    this.listeners.get(id)?.forEach((fn) => fn());
    this.globalListeners.forEach((fn) => fn());
  }
}

export const liveTransformStore = new LiveTransformStore();

/**
 * React hook: subscribes to the transient transform for a single node.
 *
 * Returns `undefined` when the node is not mid-gesture, letting every consumer
 * fall through to the committed store values with a simple `??` chain.
 *
 * The subscription is keyed on `id` so a connector watching two endpoints
 * creates two independent subscriptions, each firing only when its own end
 * moves.
 */
export function useLiveTransform(id: string | undefined): LiveTransform | undefined {
  return useSyncExternalStore(
    (onStoreChange) => (id ? liveTransformStore.subscribe(id, onStoreChange) : () => {}),
    () => (id ? liveTransformStore.get(id) : undefined),
    () => (id ? liveTransformStore.get(id) : undefined)
  );
}
