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
import { nearestOnOutline, pointInPolygon, projectToOutline, rotatePoint } from './shapePerimeter';

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
  /**
   * The shape's real silhouette in world space, when its box is not it.
   *
   * Without this the rule measured the pointer against the box while the rings
   * were *drawn* on the outline — so on a triangle you had to hover empty air
   * beside the shape to arm a ring sitting on the shape, and hovering the
   * triangle itself did nothing. Two different answers to "what am I pointing
   * at", one for the eye and one for the hand.
   *
   * It also carries the rotation, because an outline is a silhouette: a turned
   * rectangle's outline is its turned corners. Everything below therefore
   * works on rotated objects without knowing rotation exists.
   */
  outline?: readonly Point[] | null;
  /** Degrees, needed only to express an anchor back in the node's own frame. */
  rotation?: number;
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

const inBox = (box: Box, p: Point): boolean =>
  p.x >= box.x && p.x <= box.x + box.width && p.y >= box.y && p.y <= box.y + box.height;

const centreOfBox = (box: Box): Point => ({
  x: box.x + box.width / 2,
  y: box.y + box.height / 2,
});

/** Whether the pointer is within the candidate — its silhouette, if it has one. */
function contains(c: BindCandidate, p: Point): boolean {
  return c.outline && c.outline.length >= 3 ? pointInPolygon(c.outline, p) : inBox(c.box, p);
}

/** Shortest distance from a point to the candidate's edge (0 when on it). */
function distanceToEdge(c: BindCandidate, p: Point): number {
  if (c.outline && c.outline.length >= 3) {
    return nearestOnOutline(c.outline, p)?.distance ?? Infinity;
  }
  const box = c.box;
  const dx = Math.min(Math.abs(p.x - box.x), Math.abs(p.x - (box.x + box.width)));
  const dy = Math.min(Math.abs(p.y - box.y), Math.abs(p.y - (box.y + box.height)));
  return inBox(box, p) ? Math.min(dx, dy) : Math.hypot(Math.max(0, dx), Math.max(0, dy));
}

/**
 * Where a candidate's named port actually sits.
 *
 * The ring the user aims at is drawn here, so the snap has to be measured here
 * too. A ray from the centre through the box's midpoint, taking the outermost
 * crossing — the same construction `attachPoint` uses, kept in step by both
 * going through the outline rather than by being the same code, since this one
 * has a candidate and that one has a node.
 */
function portAt(c: BindCandidate, side: Exclude<Port, 'auto'>): Point {
  const boxPoint = portPoint(c.box, side);
  if (!c.outline || c.outline.length < 3) return boxPoint;
  const centre = centreOfBox(c.box);
  return projectToOutline(c.outline, centre, boxPoint) ?? boxPoint;
}

/**
 * The pointer expressed as an anchor in the node's own, unrotated proportions.
 *
 * Two conversions, and both matter. The pointer is first snapped to the
 * nearest point *on the silhouette*, so the stored anchor describes where the
 * user actually pointed rather than where the box would have projected them.
 * That point is then turned back into the node's own frame, because an anchor
 * is a ratio of an unrotated box — store a rotated one and turning the object
 * afterwards would drag its connectors around the outside.
 */
function anchorAt(c: BindCandidate, world: Point): { u: number; v: number } {
  const onEdge =
    c.outline && c.outline.length >= 3
      ? (nearestOnOutline(c.outline, world)?.point ?? world)
      : world;
  const local = rotatePoint(onEdge, centreOfBox(c.box), -(c.rotation ?? 0));
  return normalizeAnchor(anchorFromPoint(c.box, local));
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
      const p = portAt(c, side);
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
    if (c.id === excludeId || !contains(c, world)) continue;
    const depth = distanceToEdge(c, world);
    // The innermost containing shape wins — on nested content (a note on a
    // frame) that is the smaller, more specific one.
    if (!nearestBody || depth < nearestBody.depth) nearestBody = { c, depth };
  }
  if (!nearestBody) return { x: world.x, y: world.y };

  const { c, depth } = nearestBody;
  const anchor = anchorAt(c, world);

  // Deep inside, or near enough to the middle that a spot would be arbitrary:
  // bind to the object and let the route choose. Both tests, not either —
  // a tall narrow node has a centre that is never far from an edge, and a
  // huge frame has vast regions that are neither central nor near one.
  if (depth > edgeBand || isCentreAnchor(anchor)) return { nodeId: c.id, port: 'auto' };

  return { nodeId: c.id, anchor };
}
