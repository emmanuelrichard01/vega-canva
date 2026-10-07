import { useSyncExternalStore } from 'react';
import { drawSettings, type DrawSettings } from '../../../engine/tools/drawSettings';

/** The drawing preferences, re-rendering when any of them changes. */
export function useDrawSettings(): DrawSettings {
  return useSyncExternalStore(drawSettings.subscribe, drawSettings.get, drawSettings.get);
}
