/**
 * The adapter between a drag and `smartGuides`.
 *
 * `smartGuides` is arithmetic with no idea what a document or a camera is.
 * This is the part that knows both: which objects are worth comparing against,
 * how big the tolerance should be at the current zoom, and where to publish
 * the guides so the overlay can draw them.
 */

import { cameraSystem } from '../CameraSystem';
import { readGuides } from '../document/guides';
import { useStore } from '../../hooks/useStore';
import { gridSnap } from './gridSnap';
import { guideState } from './guideState';
import { snapToObjects, type Box } from './smartGuides';
import { columnEdges } from '../model/layoutGuide';

/**
 * Snap distance, in **screen** pixels.
 *
 * Screen rather than world, converted through the zoom at the moment of the
 * drag, so the pull feels identical whether you are zoomed to 10% or 800%. A
 * world-unit tolerance would be unusable at both ends: an unreachable
 * hair's-breadth when zoomed out, and a magnet spanning half the viewport when
 * zoomed in.
 */
const SNAP_PX = 6;

/**
 * The most objects worth comparing against in one drag.
 *
 * Candidates are already limited to the viewport, so this only matters on a
 * board where hundreds of objects are visible at once — at which point the
 * nearest few are the only ones anybody can see a guide against anyway, and
 * comparing all of them is a per-frame cost with no per-frame benefit.
 */
const MAX_CANDIDATES = 200;

/**
 * How close counts as "this is the position we just returned".
 *
 * A world-unit fraction, well below anything a pointer can express and well
 * above the floating-point residue a snap leaves behind.
 */
const SETTLED = 0.01;

/** The last position this returned, for the re-entrancy guard above. */
let lastSnap: { x: number; y: number } | null = null;

function boxOf(node: { x: number; y: number; width: number; height: number; scaleX?: number; scaleY?: number }): Box {
  // Scale is folded in, because a flipped or scaled object's *visible* box is
  // what the user is lining things up against.
  const sx = Math.abs(node.scaleX ?? 1);
  const sy = Math.abs(node.scaleY ?? 1);
  return { x: node.x, y: node.y, width: node.width * sx, height: node.height * sy };
}

/**
 * Everything the moving object could sensibly line up with.
 *
 * Restricted to the viewport, which is a correctness decision before it is a
 * performance one: snapping to an object you cannot see produces a jump with
 * an explanation drawn somewhere off-screen, which is worse than not snapping.
 *
 * Hidden and filtered-out objects are excluded for the same reason, and so are
 * the other members of a multi-object drag — an object cannot align to
 * something that is moving with it.
 */
function candidatesFor(excluded: Set<string>): Box[] {
  const objects = useStore.getState().objects;
  // No overscan margin: the culling buffer exists so objects do not pop in at
  // the edge, but an object one pixel off-screen is one you cannot see a guide
  // against, which is the whole reason for restricting the set.
  const view = cameraSystem.getViewportBounds(0);

  const boxes: Box[] = [];
  for (const node of Object.values(objects)) {
    if (excluded.has(node.id)) continue;
    if (node.hidden) continue;
    // A comment pin is a 32px marker anchored to a point, not a shape anyone
    // aligns to; snapping to one is noise.
    if (node.type === 'comment') continue;

    const box = boxOf(node);
    const outside =
      box.x > view.maxX || box.x + box.width < view.minX || box.y > view.maxY || box.y + box.height < view.minY;
    if (outside) continue;

    boxes.push(box);
    if (boxes.length >= MAX_CANDIDATES) break;
  }
  return boxes;
}

/**
 * Every column edge on screen, from the frames that carry a measure.
 *
 * Frames being dragged are skipped: an object cannot align to a measure that
 * is moving with it, which is the same rule the object candidates follow.
 */
function visibleColumnEdges(excluded: Set<string>): number[] {
  const objects = useStore.getState().objects;
  const view = cameraSystem.getViewportBounds(0);
  const edges: number[] = [];

  for (const node of Object.values(objects)) {
    if (node.type !== 'frame' || !node.layoutGuide || node.hidden) continue;
    if (excluded.has(node.id)) continue;
    if (node.x > view.maxX || node.x + node.width < view.minX) continue;
    if (node.y > view.maxY || node.y + node.height < view.minY) continue;
    edges.push(...columnEdges(node, node.layoutGuide));
  }
  return edges;
}

/**
 * Snap a dragged object's world-space top-left, publishing the guides.
 *
 * Returns the corrected position. Suppressed while the grid-snap modifier is
 * held, which is the established way in this app — and in every other — to say
 * "let me put it exactly where I am pointing".
 */
export function snapDraggedBox(
  nodeId: string,
  box: Box,
  alsoMoving?: readonly string[]
): { x: number; y: number } {
  if (gridSnap.isModifierHeld) {
    guideState.clear();
    lastSnap = null;
    return { x: box.x, y: box.y };
  }

  // Konva may call `dragBoundFunc` again with the position this function just
  // returned. Snapping is *usually* idempotent — once aligned, the correction
  // is zero — but not always: landing on one candidate can bring a different
  // one into range, and the two can then trade the object back and forth
  // forever inside a single frame. Recognising our own output and returning it
  // unchanged breaks that without weakening the snap itself.
  if (lastSnap && Math.abs(box.x - lastSnap.x) < SETTLED && Math.abs(box.y - lastSnap.y) < SETTLED) {
    return { x: lastSnap.x, y: lastSnap.y };
  }

  const excluded = new Set<string>([nodeId, ...(alsoMoving ?? [])]);
  const candidates = candidatesFor(excluded);
  // A guide is the most deliberate alignment target on the board — somebody
  // put it there on purpose — so it snaps like any other edge. Expressed as a
  // zero-width box on its own axis, which is exactly what a guide is, rather
  // than as a special case threaded through the arithmetic.
  for (const guide of readGuides()) {
    candidates.push(
      guide.axis === 'x'
        ? { x: guide.position, y: box.y, width: 0, height: box.height }
        : { x: box.x, y: guide.position, width: box.width, height: 0 }
    );
  }
  /**
   * A frame's column measure, as more of the same.
   *
   * A layout guide exists to be lined up against — that is the entire
   * difference between it and the safe area, which is drawn and deliberately
   * snaps to nothing. So its column edges join the candidate list as
   * zero-width boxes, exactly as a ruler guide does, and the arithmetic
   * downstream never learns that layout guides exist.
   *
   * Restricted to frames in view for the reason the object candidates are:
   * snapping to something you cannot see produces a jump with its explanation
   * drawn off-screen.
   *
   * The moving object's own frame is included, which is the case that matters
   * most — placing a block on the measure of the frame it already sits in is
   * what a column guide is *for*.
   */
  for (const edge of visibleColumnEdges(excluded)) {
    candidates.push({ x: edge, y: box.y, width: 0, height: box.height });
  }
  const result = snapToObjects(box, candidates, SNAP_PX / (cameraSystem.zoom || 1));

  guideState.set(result.guides);
  lastSnap = { x: box.x + result.dx, y: box.y + result.dy };
  return lastSnap;
}

/** End of drag: the guides explained a gesture that is over. */
export function clearSnapGuides(): void {
  guideState.clear();
  lastSnap = null;
}
