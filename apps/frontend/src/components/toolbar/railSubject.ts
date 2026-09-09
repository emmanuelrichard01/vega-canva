import type { Bounds, Rect } from '../../engine/interaction/railPlacement';

/**
 * Where the artwork the rail is attached to is, and what free screen there is.
 *
 * ## Why this is a module and not a context
 *
 * A popover on the rail should not land on the object being edited, and the
 * only thing that knows where that object is on screen is the rail's own
 * placement loop — which already computes both of these, every frame, to place
 * itself.
 *
 * It cannot be a context. The rail writes its position **straight to the DOM
 * inside the frame loop** precisely so that moving it does not re-render a
 * component tree at broadcast rate; putting the same rect in React state would
 * undo that for the one consumer that needs it once, when a popover opens. So
 * it is a plain holder, written where the values are already known and read on
 * open. The same reasoning `liveTransformStore` follows.
 *
 * Both halves are published together because a popover that placed itself
 * against the right subject inside the wrong bounds would be a new way to get
 * the same answer wrong.
 */

export interface RailSubject {
  /** The selection's screen box, handles and all. */
  subject: Rect;
  /** The free strip: inside the panels, under the top bar, above the dock. */
  bounds: Bounds;
}

let current: RailSubject | null = null;

/** Called by the rail's placement loop, with what it just placed against. */
export function setRailSubject(next: RailSubject | null) {
  current = next;
}

/**
 * What the rail is attached to, or `null` where nothing has published it.
 *
 * Null is the ordinary case for a popover used anywhere but the rail, and the
 * caller falls back to its own trigger — so this can only ever improve a
 * placement, never break one.
 */
export function railSubject(): RailSubject | null {
  return current;
}
