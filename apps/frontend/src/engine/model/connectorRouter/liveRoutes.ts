/**
 * The board's route store, bound to the live document, the gesture store and
 * the spatial index, plus the hook renderers read it through.
 */

import { useSyncExternalStore } from 'react';
import { useStore } from '../../../hooks/useStore';
import { liveTransformStore } from '../liveTransformStore';
import { spatialIndex } from '../../SpatialIndex';
import { RouteStore, type RouteOutput } from './routeStore';

const hasWindow = typeof window !== 'undefined';

export const routeStore = new RouteStore({
  getObjects: () => useStore.getState().objects,
  getChanges: () => {
    const s = useStore.getState();
    return { changed: s.lastChangedIds ?? [], removed: s.lastRemovedIds ?? [], version: s.version };
  },
  subscribeObjects: (fn) => {
    let last = useStore.getState().objects;
    return useStore.subscribe((state) => {
      if (state.objects === last) return;
      last = state.objects;
      fn();
    });
  },
  getLive: (id) => liveTransformStore.get(id),
  liveIds: () => liveTransformStore.ids(),
  subscribeLive: (fn) => liveTransformStore.subscribeGlobal(fn),
  query: (rect) => spatialIndex.query(rect),
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  frame: (fn) => {
    if (!hasWindow || typeof requestAnimationFrame !== 'function') {
      const t = setTimeout(fn, 0);
      return () => clearTimeout(t);
    }
    // A frame, or a timeout when the tab is hidden and frames stop, so routes
    // are never left half-finished in the document's own derived boxes.
    let done = false;
    const run = () => {
      if (done) return;
      done = true;
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      fn();
    };
    const raf = requestAnimationFrame(run);
    const timer = setTimeout(run, 120);
    return () => {
      done = true;
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  },
  boardJumps: () => null,
});

/** A connector's finished route, re-rendering only that connector when it changes. */
export function useConnectorRoute(id: string): RouteOutput | null {
  return useSyncExternalStore(
    (fn) => routeStore.subscribe(id, fn),
    () => routeStore.get(id),
    () => routeStore.get(id)
  );
}
