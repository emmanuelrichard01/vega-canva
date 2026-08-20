import type { AnchorRef } from '../model/pathEditing';

/**
 * Which path is open for direct selection, and which of its anchors are picked.
 *
 * The same shape as `cropMode`, and for the same reasons: it is a mode
 * belonging to one object, entered from that object, and left by pressing
 * Escape or selecting something else. It is not in the CRDT — which anchor
 * *you* have selected is not a property of the board, and syncing it would put
 * a collaborator's handle selection on everyone's screen.
 *
 * ## Why the selection is a list
 *
 * It used to be `anchor: number | null`: one index, on the assumption of one
 * contour. Both halves were too small.
 *
 * One anchor at a time is not a slower way to reshape an edge, it is a
 * different result — moving the two corners of a box's top edge separately
 * passes through a shape you did not want, and any constraint or snap applies
 * to the wrong thing on the way. And a bare index cannot name an anchor on a
 * compound path at all: a boolean result or a glyph with a hole has several
 * contours, and `3` does not say which.
 *
 * ## No snapshot to restore
 *
 * Every edit writes the whole geometry, so the UndoManager's capture window
 * already folds a drag into one step, and "cancel" has no separate meaning —
 * Escape leaves the mode and the path stays as you last dragged it, exactly as
 * leaving any other tool does.
 */

export interface PathSelection {
  nodeId: string;
  /** The picked anchors. Empty means the path is open but nothing is chosen. */
  anchors: AnchorRef[];
}

type Listener = () => void;

const listeners = new Set<Listener>();
let active: PathSelection | null = null;

function emit() {
  listeners.forEach((fn) => fn());
}

const sameSelection = (a: readonly AnchorRef[], b: readonly AnchorRef[]) =>
  a.length === b.length && a.every((r, i) => r.sub === b[i].sub && r.index === b[i].index);

export const pathEdit = {
  getSnapshot: (): PathSelection | null => active,

  subscribe: (listener: Listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  isEditing: (nodeId: string) => active?.nodeId === nodeId,

  /** Open a path for editing. Re-entering on the same node keeps the selection. */
  enter(nodeId: string) {
    if (active?.nodeId === nodeId) return;
    active = { nodeId, anchors: [] };
    emit();
  },

  /**
   * Replace the picked anchors.
   *
   * Compared before emitting, because a drag reports a selection on every
   * pointer move and an unconditional emit would re-render the overlay sixty
   * times a second to draw the same handles in the same places.
   */
  select(anchors: AnchorRef[]) {
    if (!active) return;
    if (sameSelection(active.anchors, anchors)) return;
    active = { ...active, anchors };
    emit();
  },

  exit() {
    if (!active) return;
    active = null;
    emit();
  },
};
