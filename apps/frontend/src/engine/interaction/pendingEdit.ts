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
 *
 * ## And a nudge, for the node that is already there
 *
 * The latch alone only serves nodes that are *about* to mount, which is why
 * asking an existing object to open for editing had exactly one route: a
 * double-click on the object itself. That is fine for a sticky and poor for a
 * line, where double-click is now how you open the vertex editor and where a
 * label was the one thing you could never find. So a mounted renderer can
 * subscribe, and a caller that sets the latch for a node already on screen
 * wakes it.
 *
 * The latch is still the mechanism; the subscription only says "look again".
 * Making it an event instead would put the race back for the case the latch
 * was written for.
 */

type Listener = () => void;

let pendingId: string | null = null;
const listeners = new Set<Listener>();

/** Ask for the node with this id to open in edit mode as soon as it mounts. */
export function requestEditOnMount(id: string): void {
  pendingId = id;
  listeners.forEach((fn) => fn());
}

/**
 * Be told when a request is made, for a node that has already mounted.
 *
 * The listener still has to `consumePendingEdit` with its own id — being woken
 * is not being chosen, and every mounted renderer is woken by every request.
 */
export function onPendingEdit(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
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

/**
 * Where the caret should land when the editor opens.
 *
 * A second latch beside the one above, and for the same reason it exists at
 * all: the editor mounts a frame after the click that asked for it, so there
 * is no way to hand it anything except by leaving it somewhere to collect.
 *
 * Kept separate from `requestEditOnMount` rather than folded into it because
 * most callers have no caret to offer — a sticky chained with Tab wants the
 * start, a shape label wants the whole thing — and an optional second argument
 * on the existing function would make those callers look like they had made a
 * decision they never made.
 */
let pendingCaret: { id: string; offset: number } | null = null;

export function requestCaretOnMount(id: string, offset: number): void {
  pendingCaret = { id, offset };
}

/** Read and clear. Returns null when this node was not the one asked for. */
export function consumePendingCaret(id: string): number | null {
  if (pendingCaret?.id !== id) return null;
  const { offset } = pendingCaret;
  pendingCaret = null;
  return offset;
}
