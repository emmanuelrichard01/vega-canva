import * as Y from 'yjs';
import { groupsMap, objectsMap } from './doc';
import type { GroupRecord } from '../model/groupTree';

export interface NodeChangeSet {
  /** Ids whose data was added or modified (including deep changes to nested fields). */
  changed: Set<string>;
  /** Ids removed from the document. */
  removed: Set<string>;
}

/**
 * Resolve the top-level node id that owns a deeply-nested Yjs event target.
 *
 * A change to `node.appearance.stroke.width` reports its event target as the
 * nested map, not the node — so subscribers have to walk back up to the entry
 * in `objectsMap` to know which node actually changed. That walk was
 * hand-rolled twice (once in the sync module, once in the store), and both
 * copies ran on every single change, producing two identical scene-graph
 * upserts per edit and therefore doubled `ObjectMoved` traffic into the
 * spatial index and the visible-set hook.
 */
function resolveRootId(target: unknown): string | null {
  let cursor = target as { parent?: unknown } | null;

  while (cursor && cursor !== (objectsMap as unknown)) {
    if (cursor.parent === (objectsMap as unknown)) {
      for (const [id, value] of objectsMap.entries()) {
        if ((value as unknown) === (cursor as unknown)) return id;
      }
      return null;
    }
    cursor = cursor.parent as { parent?: unknown } | null;
  }

  return null;
}

/**
 * Subscribe to node-level changes. Returns an unsubscribe function.
 *
 * This is the single observer over `objectsMap`; everything that needs to
 * react to document changes composes on top of the change set it publishes
 * rather than registering its own `observeDeep`.
 */
export function observeNodes(handler: (changes: NodeChangeSet) => void): () => void {
  const listener = (events: Y.YEvent<any>[]) => {
    const changed = new Set<string>();
    const removed = new Set<string>();

    events.forEach((event) => {
      if (event.target === (objectsMap as unknown)) {
        event.keys.forEach((change, key) => {
          if (change.action === 'delete') {
            removed.add(key);
            changed.delete(key);
          } else {
            changed.add(key);
            removed.delete(key);
          }
        });
      } else {
        const rootId = resolveRootId(event.target);
        // A node deleted in the same transaction that touched its internals
        // must not be resurrected into `changed`.
        if (rootId && objectsMap.has(rootId)) changed.add(rootId);
      }
    });

    if (changed.size > 0 || removed.size > 0) handler({ changed, removed });
  };

  objectsMap.observeDeep(listener);
  return () => objectsMap.unobserveDeep(listener);
}

/**
 * Subscribe to group changes. Returns an unsubscribe function.
 *
 * Shallow, deliberately. A group record is three scalar fields with no nested
 * structure to reach into, so the deep walk `observeNodes` needs — resolving a
 * change to `node.appearance.stroke.width` back to the node that owns it — has
 * nothing to do here and would only cost a traversal per edit.
 */
export function observeGroups(handler: (groups: Record<string, GroupRecord>) => void): () => void {
  const listener = () => handler(Object.fromEntries(groupsMap.entries()));
  groupsMap.observe(listener);
  return () => groupsMap.unobserve(listener);
}
