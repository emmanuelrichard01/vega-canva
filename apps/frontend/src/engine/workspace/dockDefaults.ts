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

  set(next: DockLayout) {
    layout = normalizeLayout(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(layout));
    } catch {
      /* persistence is a nicety here; the session still works without it */
    }
    emit();
  },

  reset() {
    this.set(DEFAULT_LAYOUT);
  },
};
