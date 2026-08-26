/**
 * Which line is open in the line editor, and which of its vertices is picked.
 *
 * ## Why a mode at all
 *
 * A selected line has always shown its two end handles, which is right: moving
 * an end is the commonest thing anyone does to a line, and making it a mode
 * would put a step in front of the common case.
 *
 * A *run of corners* cannot work that way. Five vertices, four curve handles
 * and four segments that accept an Alt-click is nine live targets sitting on
 * top of the object — enough that dragging the line itself becomes difficult,
 * and enough that a selection rectangle drawn over a diagram would light up
 * like a control panel. Every editor that has this feature gates it the same
 * way, and Excalidraw's phrasing is the clearest: selecting is for *placing*
 * the line, and there is a second, deliberate gesture for *shaping* it.
 *
 * So: selecting a line still shows its ends. `Ctrl`/`Cmd`+`Enter`, or a
 * double-click, opens the editor and shows everything. `Escape`, or selecting
 * something else, leaves.
 *
 * ## The same shape as `pathEdit`
 *
 * Deliberately, and it is worth saying why they are not merged. `pathEdit`
 * addresses anchors on a possibly-compound bezier path — an anchor there needs
 * a contour index as well as its own. A line has one run and no contours, so an
 * index is the whole address. Sharing the type would mean every line-editing
 * call site carrying a `sub: 0` that means nothing, which is how a field comes
 * to be set wrongly somewhere and read as if it meant something.
 *
 * ## Not in the document, and not in awareness
 *
 * Which vertex *you* have picked is not a property of the board. Writing it
 * there would put a collaborator's handle selection on everyone's screen and
 * land it in their undo history. Same tier as `cropMode`, `pathEdit`,
 * `booleanPreview` and `railVeil` — see the architecture note on the three
 * tiers of state.
 */

export interface LineSelection {
  nodeId: string;
  /**
   * The picked vertex, by index, or `null` when the line is open but nothing
   * is chosen.
   *
   * One rather than a list, unlike `pathEdit`. Moving several anchors of a
   * closed shape together is a real operation — the two corners of a box's top
   * edge — but a line has no interior for a multi-vertex drag to preserve, and
   * `Delete` on a multi-selection would have to decide what happens when the
   * selection is the whole line. If a use for it appears, this is the field
   * that changes; inventing the list first would be inventing the use.
   */
  vertex: number | null;
}

type Listener = () => void;

const listeners = new Set<Listener>();
let active: LineSelection | null = null;

function emit() {
  listeners.forEach((fn) => fn());
}

export const lineEdit = {
  getSnapshot: (): LineSelection | null => active,

  subscribe: (listener: Listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  isEditing: (nodeId: string): boolean => active?.nodeId === nodeId,

  /** Open a line for editing. Re-entering the same line keeps the picked vertex. */
  begin(nodeId: string): void {
    if (active?.nodeId === nodeId) return;
    active = { nodeId, vertex: null };
    emit();
  },

  /**
   * Pick a vertex, or clear the pick with `null`.
   *
   * Ignored when no line is open, rather than opening one: a stray pick from a
   * handle that has not unmounted yet would otherwise put the editor into a
   * mode nobody asked for, on a node that may not even be selected.
   */
  pick(vertex: number | null): void {
    if (!active || active.vertex === vertex) return;
    active = { ...active, vertex };
    emit();
  },

  /**
   * Leave the editor.
   *
   * Guarded on the id when one is given, so a late unmount cannot close the
   * editor that a *different* line has since opened — the same guard, for the
   * same reason, as `textEditing.end`.
   */
  end(nodeId?: string): void {
    if (!active) return;
    if (nodeId && active.nodeId !== nodeId) return;
    active = null;
    emit();
  },
};
