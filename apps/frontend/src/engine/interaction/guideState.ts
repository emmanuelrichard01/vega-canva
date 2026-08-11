/**
 * The guides currently on screen.
 *
 * Not in the CRDT, and not in the zustand store either. They exist for the
 * duration of one drag, change on every pointer move, and mean nothing to
 * anybody else — putting them in the document would broadcast a line to every
 * collaborator sixty times a second and write it into the undo history.
 *
 * The same shape as `cropMode` and `tagFilter`: a hand-rolled external store
 * read through `useSyncExternalStore`, so exactly one component subscribes and
 * a drag re-renders the overlay rather than the board.
 */

import type { Guide } from './smartGuides';

type Listener = () => void;

const listeners = new Set<Listener>();
let guides: Guide[] = [];

/**
 * A stable empty array.
 *
 * `useSyncExternalStore` compares snapshots by identity and throws if the
 * getter returns a fresh value every call. Returning `[]` inline would do
 * exactly that, and the failure is an infinite render loop rather than a
 * quiet inefficiency.
 */
const EMPTY: Guide[] = [];

let scheduled = false;

/**
 * Notify on the next frame, never synchronously.
 *
 * The writer is Konva's `dragBoundFunc`, which runs *inside* the drag as part
 * of deciding where the node goes. Notifying from there renders React from
 * within a Konva layout callback, which re-enters the drag machinery — the
 * first version of this froze the renderer outright rather than merely being
 * inefficient.
 *
 * Deferring also coalesces: a drag can call `set` several times before the
 * browser paints, and the overlay only needs the last one.
 */
function emit() {
  if (scheduled) return;
  scheduled = true;
  const run = () => {
    scheduled = false;
    listeners.forEach((fn) => fn());
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
  else setTimeout(run, 0);
}

export const guideState = {
  getSnapshot: (): Guide[] => guides,

  subscribe: (listener: Listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  set(next: Guide[]) {
    // Most pointer moves during a drag produce no guides at all, and the ones
    // that do usually produce the same guides as the frame before. Skipping
    // the notification when nothing changed keeps the overlay from
    // re-rendering on every mouse move of every drag.
    if (next.length === 0 && guides.length === 0) return;
    if (sameGuides(next, guides)) return;
    guides = next.length === 0 ? EMPTY : next;
    emit();
  },

  clear() {
    if (guides.length === 0) return;
    guides = EMPTY;
    emit();
  },
};

function sameGuides(a: Guide[], b: Guide[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.orientation !== y.orientation ||
      x.position !== y.position ||
      x.from !== y.from ||
      x.to !== y.to ||
      x.kind !== y.kind
    ) {
      return false;
    }
  }
  return true;
}
