import { useEffect, useState } from 'react';
import { engineEvents } from './EventBus';
import { canvasEngine } from './CanvasEngine';

/**
 * The set of node ids currently inside the viewport (plus overscan).
 *
 * Published by `CanvasEngine`'s spatial query. Consumers use it purely for
 * culling — node *data* comes from the store, subscribed per object by each
 * renderer, so a node moving re-renders only that node.
 *
 * This hook used to additionally maintain a full `objects` map: on every
 * `ObjectAdded`/`Moved`/`Modified`/`Removed` it walked the whole scene graph,
 * shallow-copied every node into a fresh object, and pushed that through
 * `setState`. That is O(n) allocation plus a React commit *per physics frame
 * and per drag frame* — and nothing ever read it; Canvas only ever
 * destructured `visibleIds`.
 */
export function useVisibleSet() {
  const [visibleIds, setVisibleIds] = useState<string[]>(() => Array.from(canvasEngine.visibleSet));

  useEffect(() => {
    const handleVisibleSetUpdated = (ids: string[]) => setVisibleIds(ids);

    engineEvents.on('VisibleSetUpdated', handleVisibleSetUpdated);
    setVisibleIds(Array.from(canvasEngine.visibleSet));

    return () => {
      engineEvents.off('VisibleSetUpdated', handleVisibleSetUpdated);
    };
  }, []);

  return { visibleIds };
}
