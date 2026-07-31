/**
 * Which frame owns what, and the operations that keep it true.
 *
 * Membership is derived from geometry, not declared: an object belongs to the
 * frame its **centre** sits over, recomputed whenever it stops moving. Nothing
 * asks the user to "add to frame", because on an infinite canvas the position
 * is the statement — dragging something onto a frame is the gesture that means
 * "this goes here".
 *
 * The writes all live here rather than in the components that trigger them, so
 * the rules cannot diverge between the four places that move an object. The
 * pure half is `engine/model/frames.ts`; this is the adapter that reads the
 * store and writes the document.
 */

import { doc } from '../document/doc';
import { deleteNode, updateNode } from '../document/mutations';
import { useStore } from '../../hooks/useStore';
import type { AnyNode } from '../model/schema';
import { descendantsOfFrame, frameForNode } from '../model/frames';

/** Every frame on the board, in the shape `frameForNode` wants. */
function framesInDocument(objects: Record<string, AnyNode>) {
  return Object.values(objects)
    .filter((n) => n.type === 'frame')
    .map((f) => ({ id: f.id, x: f.x, y: f.y, width: f.width, height: f.height, zIndex: f.zIndex }));
}

/**
 * Recompute which frame an object belongs to, after it has been moved.
 *
 * Writes only when the answer changed, because this runs at the end of every
 * drag of every object and an unconditional write would put a no-op edit into
 * the update log — and therefore an empty step into Time Travel — each time
 * anyone nudged anything.
 */
export function reassignFrame(nodeId: string): void {
  const objects = useStore.getState().objects;
  const node = objects[nodeId];
  if (!node) return;

  const frames = framesInDocument(objects);
  if (frames.length === 0 && !node.frameId) return;

  const next = frameForNode(node, frames);
  if ((next ?? undefined) === node.frameId) return;

  updateNode(nodeId, { frameId: next ?? undefined });
}

/**
 * Move a frame and everything it owns, as one action.
 *
 * A frame that leaves its contents behind is not a frame, it is a rectangle
 * drawn underneath some objects. Committed in a single `doc.transact` so it
 * reaches collaborators as one change and undoes as one step — a frame with
 * forty children would otherwise be forty entries in the history and forty
 * separate broadcasts.
 *
 * Children are moved by the same delta rather than being re-derived from the
 * frame's new position, so their arrangement inside it is preserved exactly.
 */
export function moveFrameWithChildren(frameId: string, dx: number, dy: number): void {
  if (dx === 0 && dy === 0) return;
  const objects = useStore.getState().objects;
  const children = descendantsOfFrame(frameId, Object.values(objects));
  if (children.length === 0) return;

  doc.transact(() => {
    for (const childId of children) {
      const child = objects[childId];
      if (!child) continue;
      updateNode(childId, { x: child.x + dx, y: child.y + dy });
    }
  });
}

/**
 * Delete a selection, taking the contents of any frame in it.
 *
 * The single entry point every delete path uses, because there were five of
 * them — the canvas shortcut, the object toolbar, the bulk toolbar, and two in
 * the Layers panel — and a rule that has to be remembered in five places is a
 * rule that will hold in four. One transaction, so a frame and forty children
 * are one undo step and one broadcast rather than forty-one of each.
 */
export function deleteNodesWithFrames(ids: string[]): void {
  if (ids.length === 0) return;
  const objects = useStore.getState().objects;

  // Collected before anything is removed, and de-duplicated: deleting a frame
  // and one of its own children in the same selection must not delete twice.
  const doomed = new Set<string>();
  for (const id of ids) {
    doomed.add(id);
    if (objects[id]?.type === 'frame') {
      for (const childId of descendantsOfFrame(id, Object.values(objects))) doomed.add(childId);
    }
  }

  doc.transact(() => {
    for (const id of doomed) deleteNode(id);
  });
}

/**
 * Claim whatever a newly drawn frame was drawn around.
 *
 * Drawing a frame over existing objects means "these belong together" — that
 * is why you drew it there. Without this the frame appears behind them and
 * owns nothing, and the only way to fill it is to drag every object out and
 * back in again.
 *
 * Only objects that are not already inside a *smaller* frame are taken, which
 * `frameForNode` decides for us by preferring the smallest containing frame.
 */
export function captureExistingIntoFrame(frameId: string): void {
  const objects = useStore.getState().objects;
  const frame = objects[frameId];
  if (!frame || frame.type !== 'frame') return;

  const frames = framesInDocument(objects);

  doc.transact(() => {
    for (const node of Object.values(objects)) {
      if (node.id === frameId) continue;
      // Never re-parent something that is already a descendant of this frame,
      // and never let a frame swallow one of its own ancestors.
      const owner = frameForNode(node, frames);
      if (owner !== frameId) continue;
      if (node.frameId === frameId) continue;
      updateNode(node.id, { frameId });
    }
  });
}
