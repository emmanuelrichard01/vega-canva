/**
 * The shape a combine would produce, shown before it is committed.
 *
 * ## Why this exists
 *
 * Union, subtract, intersect and exclude are four buttons that all look plausible
 * and are impossible to tell apart until one of them has already destroyed the
 * operands. Which of them you want depends on which shape is in front, whether
 * they overlap at all, and what the overlap actually is — none of which is
 * legible from four icons of two overlapping squares.
 *
 * So hovering a combine draws the answer on the canvas, in world coordinates,
 * over the objects it would replace. It is the same geometry the button will
 * commit — `previewBoolean` computes it once and both the preview and the
 * commit read it — so what is outlined is what you get.
 *
 * ## Not in the document
 *
 * Which button *you* are pointing at is not a property of the board, and
 * writing it there would flicker on everybody's screen and land in the undo
 * history. Same rule, and the same shape, as `cropMode` and `pathEdit`.
 */

import type { CompoundGeometry } from '../model/schema';

type Listener = () => void;

const listeners = new Set<Listener>();
let shown: CompoundGeometry | null = null;

export const booleanPreview = {
  /**
   * Show a result, or clear it with `null`.
   *
   * Identity is the signal: `useSyncExternalStore` skips work when the snapshot
   * has not changed, and clearing an already-clear preview must not wake every
   * subscriber on each pointer move across a rail of four buttons.
   */
  set(geometry: CompoundGeometry | null): void {
    if (shown === geometry) return;
    shown = geometry;
    listeners.forEach((fn) => fn());
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot(): CompoundGeometry | null {
    return shown;
  },
};
