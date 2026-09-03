/**
 * Who owns the pointer right now, when it is not the active tool.
 *
 * ## The bug this exists to fix, stated precisely
 *
 * Six components took the pointer by writing `stage.container().style.cursor`
 * directly — the transformer's resize and rotate handles, the line and
 * connector end editors, the corner-radius handle, the path editor, the crop
 * and reframe overlays. `LocalCursor` stood down when it saw an inline cursor,
 * which it looked for on `.canvas-container`.
 *
 * **Those are two different elements.** react-konva creates its own `<div>` and
 * hands *that* to `new Konva.Stage({ container })`, so `stage.container()` is a
 * child of `.canvas-container`, not `.canvas-container` itself. The inline
 * cursor was therefore written somewhere the watcher never looked:
 *
 * - `checkInline()` read `.canvas-container`'s own `style.cursor`, which
 *   nothing ever writes, so it returned false on every pointer event.
 * - the `MutationObserver` watched `.canvas-container`'s attributes, not its
 *   subtree, so it never fired.
 * - `data-custom-cursor` therefore stayed `on`, the `cursor: none` it carried
 *   stayed in force on the container, and the inner div's inline cursor
 *   overrode it for its own subtree.
 *
 * The result was both pointers at once over every handle: the OS resize arrow
 * from the inline style, and the drawn arrow from a component that had no idea
 * it should have stood down. It was not a race — it was permanent, and no
 * amount of tuning the observer would have found it, because the observer was
 * aimed at the wrong node.
 *
 * The drawn pointer has since gone entirely (see `cursorCss`), which removes
 * that particular collision by removing the second pointer. This module is
 * still the right shape and is still needed: a handle taking the pointer is a
 * real thing that needs saying, and saying it by writing a string to whichever
 * DOM node you happen to have is how it went wrong the first time.
 *
 * ## Why a store rather than fixing the selector
 *
 * Watching the right element is a smaller change and it keeps the fault shape:
 * the pointer would still be decided by whoever last wrote a string to a DOM
 * node, discovered by a watcher, one derivation checking up on another. That
 * is invariant 7, and it is how these two fell out of step in the first place.
 *
 * A claim is explicit, and there is exactly one writer of `style.cursor` on
 * the canvas container — an inline style, which outranks the rules that read
 * `--cursor-tool`, so a claim simply wins for as long as it is held. One fact,
 * one writer, one reader, and nothing to keep in step.
 *
 * ## Falsifiability — invariant 12
 *
 * A claim only its owner can release will eventually get stuck: Konva does not
 * fire `mouseleave` for a node destroyed under the pointer, and every one of
 * these handles is conditionally rendered, so a selection change during a
 * hover ends it with no event. The rail spent a page of the handoff on exactly
 * this.
 *
 * So the store is not only released by its claimants. `releaseAll` is bound to
 * facts about the world that cannot be forgotten by a component that no longer
 * exists: the pointer leaving the canvas, and a press ending. A handle still
 * under the pointer re-claims on the very next move, so a wrongly-cleared
 * claim costs one frame and a stuck one costs a page reload.
 */

/** A CSS cursor value, or null for "I no longer want it". */
export type CursorClaim = string;

type Listener = () => void;

const listeners = new Set<Listener>();

/**
 * Claims by id, in insertion order.
 *
 * A `Map` rather than a single value because two things can want the pointer
 * at once — a resize handle inside a crop overlay — and the one that arrived
 * last is the one under the pointer. Deleting and re-inserting on every claim
 * keeps that ordering true rather than approximately true.
 */
const claims = new Map<string, CursorClaim>();

/** The winning claim: the most recent one still held. */
let current: CursorClaim | null = null;

function recompute() {
  let last: CursorClaim | null = null;
  for (const value of claims.values()) last = value;
  if (last === current) return;
  current = last;
  listeners.forEach((fn) => fn());
}

export const cursorOverride = {
  /** The cursor something has claimed, or null when the tool has the pointer. */
  get: (): CursorClaim | null => current,

  // Returns `void`, not the `Set.delete` boolean, so it can be handed straight
  // back from a `useEffect` — React treats any non-function return as a
  // mistake and a returned boolean is exactly that mistake typed.
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  /**
   * Take the pointer.
   *
   * `id` identifies the claimant, not the cursor — one handle re-claiming with
   * a different shape as it rotates must replace its own claim rather than
   * stacking a second one.
   */
  claim(id: string, cursor: CursorClaim) {
    if (claims.get(id) === cursor) {
      // Already the same claim. Re-inserting would reorder it above a
      // legitimately newer one for no reason.
      if (claims.size === 1 || current === cursor) return;
    }
    claims.delete(id);
    claims.set(id, cursor);
    recompute();
  },

  /** Give it back. Safe to call for an id that holds nothing. */
  release(id: string) {
    if (!claims.delete(id)) return;
    recompute();
  },

  /**
   * Give it all back, because something happened that no claim can survive.
   *
   * The falsifier. Bound to the pointer leaving the canvas and to a press
   * ending — both facts about the world rather than promises from a sender, so
   * neither can be forgotten by a component that unmounted mid-hover.
   */
  releaseAll() {
    if (claims.size === 0) return;
    claims.clear();
    recompute();
  },
};

/**
 * Claim on behalf of a Konva node, in the one line the call sites used to take.
 *
 * The six components this replaces each wrote `stage.container().style.cursor`
 * in a `mouseenter` and `''` in a `mouseleave`. Keeping the call shape means
 * the migration is mechanical and nothing has to learn about a store — and it
 * puts the id, which is the only new argument, next to the cursor it names.
 *
 * Passing `null` releases, so the leave handler stays one line too.
 */
export function claimCursor(id: string, cursor: CursorClaim | null) {
  if (cursor === null) cursorOverride.release(id);
  else cursorOverride.claim(id, cursor);
}
