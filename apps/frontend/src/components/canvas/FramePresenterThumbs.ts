import { applyNodePatches, readNode } from '../../engine/document';
import { canEditObjects } from '../../engine/model/permissions';
import { buildPreview, MAX_ITEMS_RICH, type BoardPreview } from '../../engine/model/boardPreview';
import { previewColorOf, previewPointsOf } from '../../engine/model/previewPaint';
import { descendantsOfFrame, moveSlide, presentableFrames, presentationOrder, slideOrderPatches } from '../../engine/model/frames';
import type { AnyNode, FrameNode } from '../../engine/model/schema';

/**
 * Frames as slides, for any list that shows them: the presenter's slide
 * strip, the Layers frames outline, an export picker.
 *
 * A thumbnail is drawn from the document, not captured from the stage. The
 * stage only mounts what is in view, so a capture of a frame off screen is an
 * empty rectangle; the document always has all of it. It is the same summary
 * the dashboard's board covers are drawn from (`buildPreview`), so a slide's
 * thumbnail and a board's cover are one kind of picture, drawn by
 * `WorkspaceCover`.
 */

/** The slides, in presentation order. */
export function orderedSlides(objects: Record<string, AnyNode>): FrameNode[] {
  return presentationOrder(presentableFrames(Object.values(objects)) as FrameNode[]);
}

/** A frame's picture: the frame and everything it owns. Null when it has nothing to draw. */
export function framePreview(frameId: string, objects: Record<string, AnyNode>): BoardPreview | null {
  const all = Object.values(objects);
  const ids = new Set([frameId, ...descendantsOfFrame(frameId, all)]);
  const nodes = all.filter((n) => ids.has(n.id));
  return buildPreview(nodes, previewColorOf, (node) => previewPointsOf(node, objects), MAX_ITEMS_RICH);
}

/**
 * Move the slide at `from` to `to`, as one undoable edit.
 *
 * Every slide is numbered, not just the moved one, so the order is fully
 * stated: a frame added later has no number and joins the end, and two people
 * reordering at once each leave a complete sequence rather than a half-merged
 * one. Editors only; a viewer presenting cannot rearrange the deck.
 */
export function reorderSlides(objects: Record<string, AnyNode>, from: number, to: number): boolean {
  if (!canEditObjects() || from === to) return false;
  const order = orderedSlides(objects).map((f) => f.id);
  const next = moveSlide(order, from, to);
  const current = new Map(order.map((id) => [id, (readNode(id)?.slideOrder as number | undefined) ?? undefined]));
  const patches = slideOrderPatches(next, current);
  if (patches.length === 0) return false;
  applyNodePatches(patches);
  return true;
}
