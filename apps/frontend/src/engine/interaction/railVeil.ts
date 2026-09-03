/**
 * Hiding the contextual rail while a gesture is under way — and getting it back.
 *
 * ## What the rail does, and why
 *
 * The rail anchors to the selection's committed bounds, so while an object is
 * being dragged or resized it would either trail behind the object or have to
 * be recomputed sixty times a second against geometry that is deliberately
 * stale. Neither is worth it: nobody reaches for a toolbar mid-drag. So a
 * gesture hides it, and finishing the gesture brings it back.
 *
 * ## The bug
 *
 * That was a single boolean, flipped by two `window` events — `canvas-drag-start`
 * and `canvas-drag-end` — dispatched from **six** places: object drags, the
 * transformer, the line and connector handle editors, the corner-radius handle,
 * and the text editor's mount and unmount.
 *
 * Six senders and one boolean means the rail stays hidden for the life of the
 * page if any one of them ever sends a start without its end. And they can:
 * Konva does not fire `dragend` for a node that is destroyed mid-drag, and
 * every one of those handles is conditionally rendered, so a selection change,
 * a collaborator's delete, or a re-render that swaps the handle out during the
 * drag ends the gesture with no event. The rail then never comes back, whatever
 * you select, and the only way out is to reload the page.
 *
 * A missing `end` is not a bug you can finish finding — it is a shape. There
 * will always be one more path that skips it.
 *
 * ## The fix
 *
 * Stop treating "a gesture is in progress" as something only the gesture can
 * revoke, and make it **falsifiable**. Every one of those gestures is a pointer
 * drag, with exactly one exception: the text editor holds the veil across the
 * whole edit, which outlives the click that started it. So:
 *
 *   > a pointer release, with nothing being edited, ends any gesture.
 *
 * That is a fact about the world rather than a promise from a sender, and it
 * cannot be forgotten by a component that unmounted. `end()` remains the fast,
 * exact path for every gesture that does finish normally; `settle()` is the
 * floor under the ones that do not.
 *
 * The state is a module singleton because the events are global — the rail is
 * one element, and which gesture hid it is not interesting to it.
 */

/**
 * What kind of gesture is holding the veil.
 *
 * ## Why the kind is on this state and not a second one beside it
 *
 * The rail does not care which gesture hid it, and this module was written
 * saying so. Something else does: the **selection chrome** — the bounding box,
 * its handles, the rotate zones and the size badge — should get out of the way
 * while an object is being *moved*, and must emphatically stay while it is
 * being *resized*, because the handles are what the pointer is holding.
 *
 * That is a strict subset of "a gesture is in progress", and the tempting
 * shape is a second boolean fed by the same events. This module exists because
 * that shape failed once already: six senders, one flag, and any missing
 * `end` leaves it stuck for the life of the page. A second flag is a second
 * chance at exactly that bug, with its own `settle` to remember to call.
 *
 * So the kind rides along with the state that already has a floor under it.
 * One machine, one falsifier, and `move` cannot outlive the gesture that set
 * it because clearing `held` clears the kind with it.
 */
export type VeilKind =
  /** An object is being dragged across the board. */
  | 'move'
  /** Anything else: a resize, a handle drag, an open text editor. */
  | 'gesture';

type Listener = () => void;

let held = false;
let kind: VeilKind = 'gesture';
const listeners = new Set<Listener>();

function set(next: boolean, nextKind: VeilKind = 'gesture'): boolean {
  // The kind can change without the flag doing so — a drag that begins inside
  // an open text edit, say — and subscribers reading it need telling.
  if (held === next && kind === nextKind) return false;
  held = next;
  kind = next ? nextKind : 'gesture';
  listeners.forEach((fn) => fn());
  return true;
}

export const railVeil = {
  /** Whether the rail should currently be hidden. */
  get held(): boolean {
    return held;
  },

  /** A gesture began. Idempotent: overlapping senders are not counted. */
  begin(as: VeilKind = 'gesture'): void {
    set(true, as);
  },

  /**
   * Whether what is happening is an object being moved.
   *
   * Read by the selection chrome, which stands down for a move and stays for
   * everything else. `false` whenever nothing is held, so a caller does not
   * have to check both.
   */
  get moving(): boolean {
    return held && kind === 'move';
  },

  /** The moving flag, for `useSyncExternalStore`. */
  getMoveSnapshot(): boolean {
    return held && kind === 'move';
  },

  /**
   * A gesture ended.
   *
   * Not reference-counted, deliberately. Counting makes a *missing* end worse —
   * it leaves a permanent surplus rather than a boolean that the next `settle`
   * can clear — and the overlap it would protect against (a drag inside an
   * edit) is resolved by `settle` consulting the editor anyway.
   */
  end(): void {
    set(false);
  },

  /**
   * The pointer came up. Release the veil unless something is being typed into.
   *
   * @param editingId the node holding a caret, from `textEditing`. Passed in
   *   rather than imported so this module stays a plain state machine that can
   *   be asserted without a store.
   * @returns whether this call changed anything, so the caller can avoid a
   *   pointless reposition on every click.
   */
  settle(editingId: string | null): boolean {
    if (!held || editingId !== null) return false;
    return set(false);
  },

  /**
   * For anything that renders from this rather than polling it.
   *
   * The top bar also stands back during a gesture, and its own docstring says
   * it listens to the same events so that "you are manipulating something" has
   * one definition in the app rather than two that can disagree. It had a
   * second boolean fed by the same pair of events — so it inherited the same
   * stuck-veil bug and would have kept it after this one was fixed, which is
   * the disagreement that comment was written to prevent.
   */
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  getSnapshot(): boolean {
    return held;
  },
};
