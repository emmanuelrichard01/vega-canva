/**
 * Drawing a bezier path, as arithmetic.
 *
 * ## Why the pen tool has a module now
 *
 * It kept its own idea of what an anchor was — a point with one forward handle,
 * the backward one always taken as its exact mirror — and its own arithmetic
 * for turning a run of them into stored segments. Three things followed from
 * that, and none of them were going to be fixed inside the tool:
 *
 * 1. **You could not draw a cusp.** Every anchor was smooth by construction,
 *    because the incoming handle was *defined* as the mirror of the outgoing
 *    one. The corner of a leaf, the point of a heart, the join where a curve
 *    meets a straight run — none of them could be drawn, only drawn and then
 *    repaired in the path editor afterwards.
 * 2. **The preview and the committed path were built twice**, by two different
 *    functions, from the same anchors. The codebase has been bitten by exactly
 *    this often enough to have a name for it: what you draw against and what
 *    you get were free to drift.
 * 3. **The box was the control hull, not the path.** Bounds were taken over the
 *    anchors *and their handles*, and a handle sits well outside the curve it
 *    bends. So every curved path was stored with a box larger than its own ink,
 *    which is what marquee selection, the eraser, snapping and every later
 *    resize all work from.
 *
 * The document already has an anchor-centric view of a path — `toAnchors` /
 * `fromAnchors` in `pathGeometry`, which the path *editor* has always used.
 * Drawing in the same vocabulary makes the tool's output identical in kind to
 * what the editor produces, and makes a cusp a property of the anchor rather
 * than something the format cannot express.
 */

import {
  fromAnchors,
  pathBounds,
  translatePath,
  type Anchor,
} from '../model/pathGeometry';
import type { BezierGeometry, Point } from '../model/schema';

/** Below this much drag, a press is a click placing a corner, not a pull shaping a curve. */
export const HANDLE_DRAG_SLOP = 3;

/**
 * Pull a handle out of an anchor.
 *
 * ## Smooth and broken
 *
 * Dragging away from a freshly placed anchor gives it two handles: the one
 * under the pointer, and its mirror on the other side, so the curve runs
 * through the point without a kink. That is the ordinary case and what makes a
 * pen tool draw arcs.
 *
 * Holding Alt breaks the pair — the drag sets only the *outgoing* handle and
 * whatever arrived stays as it was. That is how every vector tool draws a cusp,
 * and it is the gesture this tool has never had: with the incoming handle
 * defined as the mirror of the outgoing, the format itself could not hold the
 * answer.
 *
 * @param broken  true while Alt is held.
 */
export function pullHandle(anchor: Anchor, to: Point, broken: boolean): Anchor {
  const next: Anchor = { ...anchor, outX: to.x, outY: to.y };
  if (!broken) {
    next.inX = 2 * anchor.x - to.x;
    next.inY = 2 * anchor.y - to.y;
  }
  return next;
}

/**
 * Whether a press has moved far enough to be shaping a curve.
 *
 * In **screen** pixels, so it means the same to the hand at every zoom. Judged
 * in world units, a hand tremor at 10% zoom would bend a curve and a deliberate
 * pull at 800% would not register.
 */
export function isHandleDrag(from: Point, to: Point, zoom: number): boolean {
  const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return Math.hypot(to.x - from.x, to.y - from.y) * scale > HANDLE_DRAG_SLOP;
}

/**
 * Retract an anchor's outgoing handle, leaving the incoming one alone.
 *
 * What clicking the path's last anchor does in Illustrator: the curve arrives
 * bent and leaves straight, which is the other half of drawing a shape that is
 * part arc and part edge. Without it a single curved anchor forces every
 * subsequent segment to curve out of it.
 */
export function retractOutgoing(anchor: Anchor): Anchor {
  const { outX: _outX, outY: _outY, ...rest } = anchor;
  return rest;
}

/**
 * The path as it should be drawn while it is being drawn.
 *
 * The rubber band is a real anchor at the pointer rather than a special case in
 * a string builder — so the segment you are aiming with is built by the same
 * function that will build the one you get. It carries no handles, because a
 * click places a corner; if the click turns into a drag, that is the next
 * frame's problem and the next frame will show it.
 *
 * `closing` swallows the rubber band: when the pointer is over the first anchor
 * the next click closes the path, and showing a band running to a point that is
 * already an anchor says the opposite.
 */
export function previewGeometry(
  anchors: readonly Anchor[],
  pointer: Point | null,
  closing: boolean
): BezierGeometry {
  if (closing || !pointer) return fromAnchors(anchors, closing);
  return fromAnchors([...anchors, { x: pointer.x, y: pointer.y }], false);
}

export interface CommittedPath {
  geometry: BezierGeometry;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The finished path: local geometry, and the box it really occupies.
 *
 * Measured with `pathBounds`, which flattens the curves — so the box is the
 * *ink*. Taking the extent of the anchors and their handles instead, as this
 * used to, gives a box that can be half as big again as the shape, because a
 * handle lies outside the curve it bends. Everything downstream reads that box
 * and nothing re-derives it: marquee selection, the eraser, the radar, snapping,
 * and every resize from then on.
 *
 * Null for fewer than two anchors. One point is not a path, and committing it
 * would leave an invisible zero-area object on the board that only the layers
 * panel could find.
 */
export function commitPath(anchors: readonly Anchor[], closed: boolean): CommittedPath | null {
  if (anchors.length < 2) return null;

  const geometry = fromAnchors(anchors, closed);
  const box = pathBounds(geometry);

  return {
    geometry: translatePath(geometry, -box.x, -box.y),
    x: box.x,
    y: box.y,
    // A perfectly straight horizontal run has no height, and an object with no
    // area cannot be clicked. Both are floored at one unit, as `reframePath`
    // does for the same reason.
    width: Math.max(1, box.width),
    height: Math.max(1, box.height),
  };
}

/**
 * The point a Shift-held segment lands on: the nearest 45° from the last anchor.
 *
 * How every pen tool draws a clean horizontal, vertical or diagonal run, and
 * the reason a flowchart outline can be laid out by hand at all.
 */
export function constrainToAngle(from: Point, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  const distance = Math.hypot(dx, dy);
  return { x: from.x + Math.cos(angle) * distance, y: from.y + Math.sin(angle) * distance };
}

/**
 * Whether the pointer is close enough to the first anchor to close the path.
 *
 * A constant *screen* radius, which is what every vector tool does: the target
 * is a thing you are aiming at with a mouse, so it must stay the same size on
 * the screen however far the canvas is zoomed.
 */
export const CLOSE_RADIUS_SCREEN = 9;

/** Whether the pointer is on an anchor, judged in screen pixels. */
export function withinTarget(point: Point, pointer: Point, zoom: number): boolean {
  const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return Math.hypot(pointer.x - point.x, pointer.y - point.y) * scale <= CLOSE_RADIUS_SCREEN;
}

export function isClosable(
  anchors: readonly Anchor[],
  pointer: Point,
  zoom: number
): boolean {
  // One anchor cannot be closed onto itself, and the first click of a path
  // would otherwise close it the instant the pointer had not moved.
  if (anchors.length < 2) return false;
  return withinTarget(anchors[0], pointer, zoom);
}
