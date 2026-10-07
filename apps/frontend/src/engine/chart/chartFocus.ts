import { useSyncExternalStore } from 'react';

/**
 * Which objects this client has selected, for the chart's own affordances.
 *
 * A chart offers direct manipulation (legend toggles, value handles, inline
 * titles) only while it is selected, so the first click on a chart selects it
 * rather than editing it. The selection itself lives in the room; the data
 * link overlay publishes it here, and each chart subscribes to its own id, so
 * a selection change re-renders only the charts whose answer changed.
 */

let selected = new Set<string>();
const listeners = new Set<() => void>();

export function setChartFocus(ids: readonly string[]): void {
  const next = new Set(ids);
  if (next.size === selected.size && [...next].every((id) => selected.has(id))) return;
  selected = next;
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** True when `id` is part of this client's selection. */
export function useChartSelected(id: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => selected.has(id),
    () => false
  );
}

/** True when `id` is the whole selection: the condition for editing it in place. */
export function useChartSoleSelection(id: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => selected.size === 1 && selected.has(id),
    () => false
  );
}
