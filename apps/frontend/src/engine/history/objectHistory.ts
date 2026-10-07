/**
 * "Show history" for one object: the hand-off from wherever it is asked for
 * (the object's context menu, the command palette) to the replay timeline.
 *
 * The request is parked here and announced with a window event. An open
 * timeline listens for the event; a timeline that opens afterwards takes the
 * parked id on mount. Whoever owns opening Time Travel listens for the same
 * event to open it.
 */
export const OBJECT_HISTORY_EVENT = 'vega:object-history';

let pending: string | null = null;

export function requestObjectHistory(id: string): void {
  pending = id;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(OBJECT_HISTORY_EVENT, { detail: { id } }));
  }
}

/** The parked request, cleared as it is read. */
export function takeObjectHistoryRequest(): string | null {
  const id = pending;
  pending = null;
  return id;
}
