import { useSyncExternalStore } from 'react';

/**
 * The active tool's in-progress preview: the marquee, a shape being dragged
 * out, the pen's live stroke, the audio recorder's levels.
 *
 * A store of its own rather than state on `Canvas`, because tools publish it
 * on every pointer move. As \`Canvas\` state each publish re-rendered the whole
 * board; here only the overlay that draws it re-renders.
 */
type Listener = () => void;

let current: any = null;
const listeners = new Set<Listener>();

export const toolOverlay = {
  set(next: any) {
    if (next === current) return;
    current = next;
    listeners.forEach((l) => l());
  },
  get(): any {
    return current;
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export function useToolOverlay(): any {
  return useSyncExternalStore(toolOverlay.subscribe, toolOverlay.get, toolOverlay.get);
}
