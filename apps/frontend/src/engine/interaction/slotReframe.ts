import type { SlotFit } from '../grid/gridSlot';

/**
 * Which picture is being reframed inside its module, and what to put back.
 *
 * ## Why this is not `cropMode`
 *
 * They answer the same question and they cannot share an implementation,
 * because they move opposite things. Cropping a loose image drags the *frame*:
 * the handles resize the node's box and the picture holds still behind it. A
 * picture in a module has no frame of its own to drag. The module owns the box,
 * `planGridReflow` writes it back on every pass, and a handle that resized it
 * would be a control the document undoes a frame later, which is precisely the
 * dead capability invariant 6 exists to prevent.
 *
 * So the two modes are the same gesture over different subjects. Cropping moves
 * the window; reframing moves the picture under a window that cannot move. One
 * store each, because a single store would have to carry both snapshots and
 * every reader would have to ask which kind it was holding.
 *
 * ## Why a mode and not a tool
 *
 * The same reasoning `cropMode` gives: it belongs to one object, it is entered
 * from that object, and leaving it is the normal end of the gesture. Picking
 * the pen should end it, which falls out of the tool change clearing this
 * rather than out of anything in `ToolManager`.
 *
 * ## Why not in the CRDT
 *
 * Which picture *you* are reframing is not a property of the board. Putting it
 * there would flicker a collaborator's half-finished framing onto everyone's
 * screen and put it in the undo history.
 *
 * The snapshot is the whole reason this holds state. Reframing writes to the
 * document on every drag frame, which is what makes it feel direct, so cancel
 * cannot mean "stop writing" -- it has to mean "put back exactly what was there
 * when I started". Undo cannot do that job: one drag is many writes and a
 * person thinks of it as one action.
 */
export interface SlotReframeSnapshot {
  nodeId: string;
  /**
   * The framing when the gesture began, or `undefined` for a picture sitting
   * at a plain centred cover.
   *
   * The fit alone, not the crop it produced: the crop is derived from this and
   * the module's size on every pass, so restoring the fit restores the picture
   * even if the grid was re-laid underneath the gesture.
   */
  fit: SlotFit | undefined;
}

type Listener = () => void;

const listeners = new Set<Listener>();
let active: SlotReframeSnapshot | null = null;

function emit() {
  listeners.forEach((fn) => fn());
}

export const slotReframe = {
  getSnapshot: (): SlotReframeSnapshot | null => active,

  subscribe: (listener: Listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  isReframing: (nodeId: string) => active?.nodeId === nodeId,

  /**
   * Begin, recording what to restore on cancel.
   *
   * Re-entering on the same picture keeps the original snapshot, so a stray
   * second entry cannot quietly redefine "cancel" to mean the half-reframed
   * state rather than the one the person started from.
   */
  enter(snapshot: SlotReframeSnapshot) {
    if (active?.nodeId === snapshot.nodeId) return;
    active = snapshot;
    emit();
  },

  /** Leave, keeping whatever is currently in the document. */
  commit() {
    if (!active) return;
    active = null;
    emit();
  },

  /**
   * Leave, restoring the snapshot.
   *
   * Returns what to restore rather than writing it, so this module keeps
   * importing nothing from the document layer. `cropMode` follows the same
   * rule, and it is what lets both be reasoned about without a Y.Doc.
   */
  cancel(): SlotReframeSnapshot | null {
    const restoring = active;
    active = null;
    if (restoring) emit();
    return restoring;
  },
};
