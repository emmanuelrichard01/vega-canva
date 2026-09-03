import type { AnyNode } from '../model/schema';

/**
 * What the eraser is allowed to touch.
 *
 * ## The rule, and why it was not being followed
 *
 * **An eraser erases ink, not area.** Everything else follows from that, and
 * the tool was doing the opposite: for every object it did not know how to cut
 * — which is everything except a pen path and a freehand stroke — it tested
 * the axis-aligned bounding box and deleted the whole object if the disc came
 * near it.
 *
 * Three consequences, in rising order of alarm:
 *
 * 1. **A rotated object has a bounding box much larger than itself.** A square
 *    turned 45° has a box 41% wider in each direction, and the four corners of
 *    that box are empty. Brushing one deleted the square.
 * 2. **An unfilled shape is a hole with an outline round it.** A rectangle
 *    with no fill is a frame of four thin lines, and erasing through the empty
 *    middle — where there is visibly nothing — deleted it.
 * 3. **A frame is a container whose interior belongs to its children.** Its
 *    box is the whole region you would ever want to erase *inside*, so
 *    erasing anything within a frame deleted the frame and everything in it.
 *    That is the one that turns a small mistake into losing a board's work.
 *
 * ## Why this is a module with tests rather than a method on the tool
 *
 * "Which objects did that gesture delete" is invisible to the type system and
 * to every other test in the codebase, and it is destructive. `capApplies` was
 * pulled out of the stroke panel for the same reason and found to be wrong in
 * a shipped build with nothing failing.
 */

/** The rotation-aware local point, so every test below can be axis-aligned. */
function toLocal(node: AnyNode, cx: number, cy: number): { x: number; y: number } {
  const rotation = node.rotation || 0;
  const centreX = node.x + node.width / 2;
  const centreY = node.y + node.height / 2;
  if (!rotation) return { x: cx, y: cy };

  /**
   * The pointer turned *back* by the node's rotation, about the node's centre.
   *
   * Rotating the test point into the object's own frame is the whole fix for
   * a turned object, and it is one rotation rather than four transformed
   * corners plus a polygon test. Konva rotates about the node's origin with an
   * offset to the centre — see `fitProxy` — so the centre is the pivot here
   * too, and this is the same convention the transformer uses.
   */
  const radians = (-rotation * Math.PI) / 180;
  const dx = cx - centreX;
  const dy = cy - centreY;
  return {
    x: centreX + dx * Math.cos(radians) - dy * Math.sin(radians),
    y: centreY + dx * Math.sin(radians) + dy * Math.cos(radians),
  };
}

/** Distance from a point to an axis-aligned rectangle. Zero inside it. */
function distanceToRect(
  px: number,
  py: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
): number {
  const dx = Math.max(left - px, 0, px - right);
  const dy = Math.max(top - py, 0, py - bottom);
  return Math.hypot(dx, dy);
}

/** Distance from a point to a rectangle's *outline*, rather than to its area. */
function distanceToRectEdge(
  px: number,
  py: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
): number {
  const outside = distanceToRect(px, py, left, top, right, bottom);
  if (outside > 0) return outside;
  // Inside: the nearest edge is whichever side is closest.
  return Math.min(px - left, right - px, py - top, bottom - py);
}

/**
 * Whether an object is painted through its middle.
 *
 * An unfilled shape is an outline, and erasing through the empty middle of one
 * should do nothing — which is what Illustrator does and what anybody who has
 * drawn an empty rectangle expects. A gradient counts as a fill; so does a
 * sketch shading, since pen strokes across the interior *are* ink there.
 */
export function hasInterior(node: AnyNode): boolean {
  if (node.type !== 'shape' && node.type !== 'path') return true;
  const appearance = (node as { appearance?: { fill?: unknown[]; fillStyle?: string; sketch?: string } })
    .appearance;
  if (!appearance) return false;
  if (appearance.sketch && appearance.fillStyle && appearance.fillStyle !== 'solid') return true;
  const fill = appearance.fill;
  return Array.isArray(fill) && fill.length > 0;
}

/**
 * Does the eraser disc touch this object's ink?
 *
 * `radius` is in world units, as the sweep computes it. Paths are not asked
 * about here: the tool cuts those rather than deleting them, and only falls
 * through to this for legacy path data it cannot cut.
 */
export function erasesObject(node: AnyNode, cx: number, cy: number, radius: number): boolean {
  const { x: px, y: py } = toLocal(node, cx, cy);
  const left = node.x;
  const top = node.y;
  const right = node.x + node.width;
  const bottom = node.y + node.height;

  /**
   * A frame is erased by its edge, never by its interior.
   *
   * The interior of a frame is where its children live, so it is exactly the
   * region somebody reaches into with an eraser — and testing the box meant
   * every one of those strokes deleted the frame *and*, since the children go
   * with it, everything inside. A frame is drawn as a border and a label; that
   * is its ink, and that is what can be rubbed out.
   */
  if (node.type === 'frame') {
    return distanceToRectEdge(px, py, left, top, right, bottom) <= radius;
  }

  if (node.type === 'shape' && node.geometry?.kind === 'ellipse') {
    const rx = node.width / 2;
    const ry = node.height / 2;
    const centreX = left + rx;
    const centreY = top + ry;
    if (hasInterior(node)) {
      // Normalised-radius test: close enough to an ellipse for a disc, and it
      // grows the ellipse by the eraser rather than testing a true offset
      // curve, which no eraser needs.
      const nx = (px - centreX) / (rx + radius || 1);
      const ny = (py - centreY) / (ry + radius || 1);
      return nx * nx + ny * ny <= 1;
    }
    // An outline: the disc has to reach the curve itself, so the point must be
    // inside the grown ellipse and outside the shrunken one.
    const outer =
      ((px - centreX) / (rx + radius || 1)) ** 2 + ((py - centreY) / (ry + radius || 1)) ** 2 <= 1;
    const innerRx = Math.max(0, rx - radius);
    const innerRy = Math.max(0, ry - radius);
    const inner =
      innerRx > 0 &&
      innerRy > 0 &&
      ((px - centreX) / innerRx) ** 2 + ((py - centreY) / innerRy) ** 2 < 1;
    return outer && !inner;
  }

  /**
   * A line or an arrow is its line, not the box that contains it.
   *
   * A diagonal line's bounding box is mostly empty on both sides of it, and
   * the two large empty triangles were live targets — brushing well clear of a
   * long diagonal deleted it.
   */
  if (node.type === 'shape' && (node.geometry?.kind === 'line' || node.geometry?.kind === 'arrow')) {
    const a = node.geometry.a;
    const b = node.geometry.b;
    if (a && b) {
      return (
        distanceToSegment(px, py, node.x + a.x, node.y + a.y, node.x + b.x, node.y + b.y) <= radius
      );
    }
    // No stored endpoints — an older document, or a run with vertices. The
    // box is the honest answer rather than a guess at where the line went.
    return distanceToRect(px, py, left, top, right, bottom) <= radius;
  }

  // An unfilled shape is an outline. Erasing through its empty middle should
  // do nothing, which is what you see and what Illustrator does.
  if (node.type === 'shape' && !hasInterior(node)) {
    return distanceToRectEdge(px, py, left, top, right, bottom) <= radius;
  }

  // Everything else is a solid card: a sticky, an image, a text block, an
  // audio clip. Its box is its ink.
  return distanceToRect(px, py, left, top, right, bottom) <= radius;
}

/** Point-to-segment distance. Shared with the path cutter. */
export function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  let t = lengthSquared > 0 ? ((px - ax) * dx + (py - ay) * dy) / lengthSquared : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
