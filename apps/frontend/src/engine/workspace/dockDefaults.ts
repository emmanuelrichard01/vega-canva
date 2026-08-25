import {
  DEFAULT_LAYOUT,
  normalizeLayout,
  type DockLayout,
} from './dockLayout';

/**
 * Where the person's own dock arrangement lives.
 *
 * ## Why `localStorage` and not the document
 *
 * How *your* toolbar is arranged is a fact about you, not about the board. In
 * the CRDT it would sync, so a collaborator putting the eraser away would take
 * it off your dock mid-session — and every rearrangement would land in the
 * undo stack between two edits to the artwork. Same call `gridDefaults` and the
 * colour picker's recents make, for the same reason.
 *
 * ## Why it *does* persist, unlike `gridDefaults`
 *
 * The grid tool deliberately forgets between sessions: a default nobody
 * remembers choosing is worse than a clean start. A toolbar is the opposite —
 * rearranging one is a deliberate act you perform once and then rely on, and a
 * dock that reset itself overnight would be broken rather than tidy.
 *
 * ## The store shape
 *
 * A `useSyncExternalStore` source rather than Zustand state, because the dock
 * is the only reader and this keeps a per-person preference out of the store
 * that mirrors the document. `getSnapshot` returns a stable reference until
 * something changes, which is the contract that lets React skip the work.
 */

const KEY = 'vega_dock_layout';

type Listener = () => void;

const listeners = new Set<Listener>();

function read(): DockLayout {
  try {
    const raw = localStorage.getItem(KEY);
    // Normalised on the way *in*, not on the way out: every reader then gets a
    // layout that is already safe, and the repair happens once per load rather
    // than once per render.
    return normalizeLayout(raw ? JSON.parse(raw) : null);
  } catch {
    // A corrupt or unavailable store must not take the toolbar down with it —
    // and the toolbar is the one piece of chrome you cannot work without.
    return normalizeLayout(null);
  }
}

let layout: DockLayout = read();

/**
 * The arrangement a reset threw away, kept so it can be put back.
 *
 * ## Why reset gets an undo and nothing else does
 *
 * Every other edit here is small and self-evident: a seat moved one place is
 * undone by moving it back, and a divider removed is one click to re-add.
 * Reset is the only action that discards *everything at once*, and the only one
 * whose damage is proportional to how much care went into what it destroys —
 * somebody who spent ten minutes arranging their dock loses exactly that to one
 * misclick on a menu row sitting directly under "Edit toolbar".
 *
 * The alternative was a confirmation, and it is the worse trade: it taxes every
 * deliberate reset to protect against the rare accidental one, and people learn
 * to click through confirmations without reading them. Undo prevents the
 * *consequence* rather than adding friction to the action.
 *
 * Deliberately narrow. It holds one arrangement, only from a reset, and any
 * later edit clears it -- once you have started rearranging again, "undo the
 * reset" has no single meaning, and offering it would restore a layout you had
 * already moved on from. In memory rather than stored, because it answers "the
 * thing I just did", which does not survive a reload and should not pretend to.
 */
let undoStash: DockLayout | null = null;

function emit() {
  listeners.forEach((fn) => fn());
}

export const dockDefaults = {
  subscribe: (listener: Listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /** Stable between changes, so `useSyncExternalStore` can skip renders. */
  getSnapshot: (): DockLayout => layout,

  /** Whether a reset can still be taken back. */
  canUndo: (): boolean => undoStash !== null,

  set(next: DockLayout) {
    // Any edit of your own ends the offer -- see `undoStash`.
    undoStash = null;
    layout = normalizeLayout(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(layout));
    } catch {
      /* persistence is a nicety here; the session still works without it */
    }
    emit();
  },

  reset() {
    const replaced = layout;
    this.set(DEFAULT_LAYOUT);
    // Stashed *after* `set`, which clears it: the ordering is what makes a
    // reset the one action that leaves something to undo.
    undoStash = replaced;
    emit();
  },

  /** Put back what the last reset replaced. */
  undoReset() {
    if (!undoStash) return;
    const restored = undoStash;
    this.set(restored);
  },
};
