/**
 * What a pointer at a given place means, as a connector end.
 *
 * ## Why this is not a method on the tool
 *
 * It was. `ConnectorTool.endAt` decided what you were aiming at while
 * *drawing*, and nothing decided it while *editing* — because an existing
 * connector had no endpoint handles at all, so the question never came up. The
 * moment endpoints became draggable, the same decision needed making in a
 * second place, and two implementations of "what does this pointer mean" is
 * how a tool comes to disagree with itself: draw an arrow onto a box's left
 * edge and get one binding, drag an existing arrow to the same pixel and get
 * another.
 *
 * So the rule lives here, once, pure. Candidates in — the caller decides where
 * boxes come from — and one `ConnectorEnd` out.
 *
 * ## The three answers, in order of specificity
 *
 * 1. **A named port.** The pointer is within snapping distance of one of the
 *    four edge midpoints. The most explicit thing a user can say, and what the
 *    rings the tool draws are for.
 * 2. **An anchor.** The pointer is on or near the object's perimeter but not
 *    at a midpoint. This is "here specifically", and it is what makes two
 *    arrows into the same long box arrive at different places instead of
 *    stacking on one point.
 * 3. **`auto`.** The pointer is well inside the object. This says *this
 *    object*, not a spot on it, and it is the answer that keeps looking right
 *    when things move — the route picks whichever side faces the other end.
 *
 * Anything else is a loose end at that coordinate, which a diagram in progress
 * needs constantly: an arrow pointing at a box that does not exist yet.
 *
 * ## Why the tolerances are in screen pixels
 *
 * Snapping is a question about the pointer, and the pointer lives on screen. A
 * world-unit tolerance would be unreachable at 20% zoom and would swallow a
 * whole node at 400%. The caller divides by the zoom; these constants are what
 * the hand can actually do.
 */

import { portPoint, type Box, type ConnectorEnd, type Point, type Port } from './connector';
import { anchorFromPoint, isCentreAnchor, normalizeAnchor } from './connectorAnchor';

/** How close the pointer must be to an edge midpoint before it snaps, in screen px. */
export const PORT_SNAP_SCREEN = 22;

/**
 * How far inside the perimeter still counts as pointing at the edge, in screen px.
 *
 * Wider than the port snap, because the edge is a much easier target than a
 * point and because overshooting into the shape is the common way to miss it.
 */
export const EDGE_BAND_SCREEN = 26;

const SIDES: Array<Exclude<Port, 'auto'>> = ['top', 'right', 'bottom', 'left'];

/** One thing a connector could attach to. */
export interface BindCandidate {
  id: string;
  box: Box;
}

export interface BindOptions {
  /** World units per screen pixel — `1 / zoom`. */
  scale: number;
  /**
   * An object an end may not bind to: its own connector's other end, or the
   * node being dragged. A connector from a box to itself describes no
   * relationship and draws as a degenerate stub.
   */
  excludeId?: string | null;
}

const contains = (box: Box, p: Point): boolean =>
  p.x >= box.x && p.x <= box.x + box.width && p.y >= box.y && p.y <= box.y + box.height;

/** Shortest distance from a point to the box's outline (0 when on it). */
function distanceToPerimeter(box: Box, p: Point): number {
  const dx = Math.min(Math.abs(p.x - box.x), Math.abs(p.x - (box.x + box.width)));
  const dy = Math.min(Math.abs(p.y - box.y), Math.abs(p.y - (box.y + box.height)));
  return contains(box, p) ? Math.min(dx, dy) : Math.hypot(Math.max(0, dx), Math.max(0, dy));
}

/**
 * The end a pointer at `world` describes.
 *
 * Candidates are tried in full for ports first and only then for bodies, so a
 * midpoint on a small node behind a large one still wins over the large one's
 * interior — the specific answer beats the vague one regardless of z-order.
 */
export function bindingAt(
  world: Point,
  candidates: readonly BindCandidate[],
  { scale, excludeId = null }: BindOptions
): ConnectorEnd {
  const portTolerance = PORT_SNAP_SCREEN * scale;
  const edgeBand = EDGE_BAND_SCREEN * scale;

  let nearestPort: { end: ConnectorEnd; distance: number } | null = null;
  for (const c of candidates) {
    if (c.id === excludeId) continue;
    for (const side of SIDES) {
      const p = portPoint(c.box, side);
      const d = Math.hypot(world.x - p.x, world.y - p.y);
      if (d <= portTolerance && (!nearestPort || d < nearestPort.distance)) {
        nearestPort = { end: { nodeId: c.id, port: side }, distance: d };
      }
    }
  }
  if (nearestPort) return nearestPort.end;

  // Only objects the pointer is actually within can claim it from here. The
  // edge band reaches *inwards*: an arrow aimed at the outside of a box has
  // not arrived yet, and treating near-misses as hits makes it impossible to
  // draw a loose end anywhere near existing content.
  let nearestBody: { c: BindCandidate; depth: number } | null = null;
  for (const c of candidates) {
    if (c.id === excludeId || !contains(c.box, world)) continue;
    const depth = distanceToPerimeter(c.box, world);
    // The innermost containing box wins — on nested content (a note on a
    // frame) that is the smaller, more specific one.
    if (!nearestBody || depth < nearestBody.depth) nearestBody = { c, depth };
  }
  if (!nearestBody) return { x: world.x, y: world.y };

  const { c, depth } = nearestBody;
  const anchor = normalizeAnchor(anchorFromPoint(c.box, world));

  // Deep inside, or near enough to the middle that a spot would be arbitrary:
  // bind to the object and let the route choose. Both tests, not either —
  // a tall narrow node has a centre that is never far from an edge, and a
  // huge frame has vast regions that are neither central nor near one.
  if (depth > edgeBand || isCentreAnchor(anchor)) return { nodeId: c.id, port: 'auto' };

  return { nodeId: c.id, anchor };
}
