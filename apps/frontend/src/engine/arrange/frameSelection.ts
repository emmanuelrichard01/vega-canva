import { createNode, undoManager, updateNode } from '../document';
import { captureExistingIntoFrame } from '../interaction/frameMembership';
import { canEditObjects } from '../model/permissions';
import { hugBox, nextFrameName } from '../model/frames';
import { nodeBounds } from '../model/selection';
import type { AnyNode } from '../model/schema';

/**
 * Frame selection: a frame drawn around what is selected, owning it.
 *
 * The box is the frame's own "resize to fit" box (`hugBox`, the same padding),
 * so a frame made this way and a frame fitted later agree. Ownership is decided
 * by `captureExistingIntoFrame`, the rule the frame tool uses, so nothing here
 * has its own idea of what a frame contains. That rule reads the store, which
 * only sees the frame once its own transaction has ended, so the two writes are
 * two transactions held inside one capture window: one undo step.
 *
 * Returns the new frame's id, or null when there is nothing to frame or this
 * person cannot edit.
 */
export function frameSelection(
  nodes: readonly AnyNode[],
  objects: Readonly<Record<string, AnyNode>>
): string | null {
  if (!canEditObjects()) return null;
  const framed = nodes.filter((n) => n.type !== 'connector' && n.type !== 'comment');
  const box = hugBox(framed.map(nodeBounds));
  if (!box) return null;
  const title = nextFrameName(
    Object.values(objects)
      .filter((n) => n.type === 'frame')
      .map((n) => (n as { title?: string }).title)
  );
  undoManager.stopCapturing();
  const id = createNode({
    type: 'frame',
    ...box,
    title,
    appearance: { fill: [{ type: 'solid', color: '#FFFFFF', opacity: 1 }] },
  });
  if (!id) return null;
  // Under what it holds: objects draw in z order, and a frame's fill drawn
  // over its own contents would hide them.
  const lowest = Math.min(...framed.map((n) => n.zIndex ?? 0));
  updateNode(id, { zIndex: lowest - 1 });
  captureExistingIntoFrame(id);
  undoManager.stopCapturing();
  return id;
}

/** Whether Frame selection has anything to frame. */
export function canFrameSelection(nodes: readonly AnyNode[]): boolean {
  return nodes.some((n) => n.type !== 'connector' && n.type !== 'comment');
}
