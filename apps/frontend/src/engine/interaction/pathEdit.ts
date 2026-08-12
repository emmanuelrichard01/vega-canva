/**
 * Which path is open for anchor editing, and which anchor is picked.
 *
 * The same shape as `cropMode`, and for the same reasons: it is a mode
 * belonging to one object, entered from that object, and left by pressing
 * Escape or selecting something else. It is not in the CRDT — which anchor
 * *you* have selected is not a property of the board, and syncing it would put
 * a collaborator's handle selection on everyone's screen.
 *
 * Unlike crop, there is no snapshot to restore. Every anchor edit is a single
 * `updateNode` with the whole geometry in it, so it is one undo step already
 * and "cancel" has no separate meaning — Escape leaves the mode and the path
 * stays as you last dragged it, exactly as leaving any other tool does.
 */

export interface PathSelection {
  nodeId: string;
  /** Index of the picked anchor, or `null` when nothing in particular is picked. */
  anchor: number | null;
}

type Listener = () => void;

const listeners = new Set<Listener>();
let active: PathSelection | null = null;

function emit() {
  listeners.forEach((fn) => fn());
}

export const pathEdit = {
  getSnapshot: (): PathSelection | null => active,

  subscribe: (listener: Listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  isEditing: (nodeId: string) => active?.nodeId === nodeId,

  /** Open a path for editing. Re-entering on the same node keeps the picked anchor. */
  enter(nodeId: string) {
    if (active?.nodeId === nodeId) return;
    active = { nodeId, anchor: null };
    emit();
  },

  select(anchor: number | null) {
    if (!active || active.anchor === anchor) return;
    active = { ...active, anchor };
    emit();
  },

  exit() {
    if (!active) return;
    active = null;
    emit();
  },
};
