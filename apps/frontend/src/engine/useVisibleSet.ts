import { useSyncExternalStore } from 'react';
import { engineEvents } from './EventBus';
import { canvasEngine } from './CanvasEngine';

/**
 * The set of node ids currently inside the viewport (plus overscan), or `null`
 * before the culler has run its first query.
 *
 * Published by `CanvasEngine`'s spatial query. Consumers use it purely for
 * culling — node *data* comes from the store, subscribed per object by each
 * renderer, so a node moving re-renders only that node. `null` and an empty set
 * mean different things: the first is "not known yet, mount everything", the
 * second is "nothing is in view".
 */
let cached: { version: number; ids: ReadonlySet<string> } | null = null;

function subscribe(onChange: () => void) {
  return engineEvents.on('VisibleSetUpdated', onChange);
}

function getSnapshot(): ReadonlySet<string> | null {
  if (!canvasEngine.hasReported) return null;
  if (!cached || cached.version !== canvasEngine.visibleVersion) {
    cached = { version: canvasEngine.visibleVersion, ids: new Set(canvasEngine.visibleSet) };
  }
  return cached.ids;
}

export function useVisibleSet() {
  const visibleIds = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { visibleIds };
}
