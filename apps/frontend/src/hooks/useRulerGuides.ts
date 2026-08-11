import { useEffect, useState } from 'react';
import { readGuides, rulerGuidesArray, type RulerGuide } from '../engine/document/guides';

/**
 * The room's ruler guides, kept in step with the CRDT.
 *
 * A plain observer rather than `useSyncExternalStore`: the snapshot has to be
 * a *new* array whenever the Y.Array changes, and `useSyncExternalStore`
 * compares snapshots by identity — so it would either loop forever on a fresh
 * array every read, or need a cache layer that is exactly this `useState`
 * written less directly.
 */
export function useRulerGuides(): RulerGuide[] {
  const [guides, setGuides] = useState<RulerGuide[]>(readGuides);

  useEffect(() => {
    const sync = () => setGuides(readGuides());
    rulerGuidesArray.observe(sync);
    // The document may have synced between the initial read and this effect.
    sync();
    return () => rulerGuidesArray.unobserve(sync);
  }, []);

  return guides;
}
