/**
 * Which image is being cropped, and what to put back if you change your mind.
 *
 * A mode rather than a tool: it belongs to one object, it is entered from that
 * object, and leaving it is the normal end of the gesture. So it does not live
 * in the tool dock and does not appear in `ToolManager` — picking the pen
 * while cropping should simply end the crop, which falls out of the tool
 * change clearing this.
 *
 * Not in the CRDT. Which object *you* are cropping is not a property of the
 * board, and putting it there would let a collaborator's half-finished crop
 * flicker on everyone's screen and enter the undo history.
 *
 * The snapshot is the whole reason this holds state at all. Crop writes to the
 * document continuously while you drag — that is what makes it feel direct —
 * so "cancel" cannot mean "stop writing", it has to mean "put back exactly
 * what was there when I started". Undo cannot do that job: a drag is many
 * writes, and the user thinks of it as one action.
 */

import type { Rect } from '../model/imageCrop';

export interface CropSnapshot {
  nodeId: string;
  /** The node's box when the crop began, in world units. */
  node: Rect;
  /** The stored crop when it began, or `undefined` for an uncropped image. */
  crop: Rect | undefined;
}

type Listener = () => void;

const listeners = new Set<Listener>();
let active: CropSnapshot | null = null;

function emit() {
  listeners.forEach((fn) => fn());
}

export const cropMode = {
  getSnapshot: (): CropSnapshot | null => active,

  subscribe: (listener: Listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  isCropping: (nodeId: string) => active?.nodeId === nodeId,

  /**
   * Begin cropping, recording what to restore on cancel.
   *
   * Re-entering on the same node keeps the original snapshot, so a stray
   * second entry cannot quietly redefine "cancel" to mean the half-cropped
   * state rather than the one the user started from.
   */
  enter(snapshot: CropSnapshot) {
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
   * Returns what to write rather than writing it, so this module keeps
   * importing nothing from the document layer — the same rule the physics
   * simulation and `reactions.ts` follow, and what lets it be reasoned about
   * without a Y.Doc.
   */
  cancel(): CropSnapshot | null {
    const restoring = active;
    active = null;
    if (restoring) emit();
    return restoring;
  },
};
