type Listener = () => void;

let editingId: string | null = null;
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((listener) => listener());
}

/**
 * Which node, if any, currently has a text caret in it.
 *
 * ## Why this needs to be visible outside the node
 *
 * `ObjectRenderer` tracked editing in local state, so nothing else on the
 * canvas could know it was happening. That mattered most for the transform
 * handles: `SelectionTransformer` rendered unconditionally, and a text node is
 * *selected* while it is being typed into — so the eight handles attached
 * themselves to the node's box and sat on top of the words.
 *
 * On a fresh text node that box is the seed size, which is deliberately small
 * because the real width is not known until something has been typed. Eight
 * handles crammed into a 40px square is the "crumpled up" cluster in the
 * corner: not a rendering fault, a control drawn correctly around a box that
 * is meant to be provisional.
 *
 * Every editor hides transform handles while text is being edited, for the
 * plain reason that you cannot resize and type at the same time and the
 * handles are in the way of the thing you are doing.
 *
 * Follows the same external-store shape as `cropMode` and `pathEdit`: a module
 * singleton read through `useSyncExternalStore`, so any component can subscribe
 * without the state being threaded through props it has no other use for.
 */
export const textEditing = {
  getSnapshot: (): string | null => editingId,

  subscribe: (listener: Listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /** Called by the editor as it mounts. */
  begin(id: string) {
    if (editingId === id) return;
    editingId = id;
    emit();
  },

  /**
   * Called by the editor as it unmounts.
   *
   * Guarded on the id so a late unmount cannot clear a *different* node's
   * editing state — which happens whenever one editor closes because another
   * opened, exactly what Tab-chaining between notes does.
   */
  end(id: string) {
    if (editingId !== id) return;
    editingId = null;
    emit();
  },
};
