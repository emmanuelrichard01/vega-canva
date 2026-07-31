/**
 * "The node I am about to create should open ready to type in."
 *
 * Dropping a sticky note and then having to find it again and double-click it
 * is the single worst thing about the note-taking flow: the whole point of a
 * sticky is that you had a thought. Every board of this kind — FigJam, Miro,
 * Apple's Freeform — puts a caret in the note the moment it appears.
 *
 * ## Why a latch and not an event
 *
 * The obvious approach is to create the node and then dispatch
 * `requestEditNode`. That is a race: the renderer for the new node has not
 * mounted yet, so nothing is listening, and the event lands in an empty room.
 * Waiting a frame to dispatch makes it *usually* work, which is worse than
 * never working, and it fails exactly when the board is busy.
 *
 * A latch inverts it. The tool sets the id before the node exists; the
 * renderer asks, once, during its first render. There is no window to miss
 * because the question is asked by the thing that was waiting to be asked.
 */

let pendingId: string | null = null;

/** Ask for the node with this id to open in edit mode as soon as it mounts. */
export function requestEditOnMount(id: string): void {
  pendingId = id;
}

/**
 * Claim the request, if it is for `id`. Returns true at most once.
 *
 * Consuming rather than peeking is what stops a note re-entering edit mode
 * every time it re-renders, and what stops a stale request opening some
 * unrelated node minutes later.
 */
export function consumePendingEdit(id: string): boolean {
  if (pendingId !== id) return false;
  pendingId = null;
  return true;
}

/** Abandon any outstanding request — e.g. the tool changed before it mounted. */
export function clearPendingEdit(): void {
  pendingId = null;
}
