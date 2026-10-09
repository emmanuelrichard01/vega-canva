import { useSyncExternalStore } from 'react';
import { isPresenting, subscribePresenting } from './presenting';

/**
 * Whether a presentation is running, for components.
 *
 * The same state `presenting.ts` holds and marks on the root as
 * `data-presenting`, so there is one answer to "is the board being
 * presented": the room unmounts its panels, dock and rails on it, and the
 * stylesheet hides every other piece of chrome on the attribute.
 */
export function usePresenting(): boolean {
  return useSyncExternalStore(subscribePresenting, isPresenting, () => false);
}
