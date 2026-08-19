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
 * 1. **A named port.** The pointer is within a short snap of one of the four
 *    edge midpoints. The most explicit thing a user can say, and what the
 *    rings the tool draws are for. Kept deliberately tight — see
 *    `PORT_SNAP_SCREEN` for what a generous one does to the feel.
 * 2. **An anchor.** The pointer is within a ribbon straddling the outline,
 *    inside or outside. This is "here specifically", it is what makes two
 *    arrows into the same long box arrive at different places instead of
 *    stacking, and it is the *continuous* answer — the one that has to track
 *    the cursor exactly, because it is what a person sees while moving.
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
import { anchorFromPoint, normalizeAnchor } from './connectorAnchor';
import { attachOnOutline, nearestOnOutline, pointInPolygon, rotatePoint } from './shapePerimeter';

/**
 * How close the pointer must be to an edge midpoint before it snaps, in screen px.
 *
 * Deliberately small. At 22 the four snap zones were 44px across and covered
 * most of the perimeter of an ordinary sticky note, so running the cursor
 * round a shape spent more time captured than free — and each entry and exit
 * teleported the endpoint, because a snap is a jump by definition. Four hard
 * jumps per lap is the difference between a tool that assists and one that
 * fights.
 *
 * At 11 the midpoints are an *assist*: close enough to catch a deliberate aim
 * at "the middle of this edge", small enough that the continuous anchor is
 * what you get the rest of the time.
 */
export const PORT_SNAP_SCREEN = 11;

/**
 * How far from the outline still counts as pointing at the edge, in screen px.
 *
 * Reaches **both ways** — outside the shape as well as inside. It used to
 * reach inwards only, so tracing the outer perimeter, which is the natural way
 * to aim at an edge, produced nothing at all until the cursor crossed the
 * stroke; one pixel further and it became an anchor. That boundary flicker was
 * on the outside of every object on the board.
 *
 * Reaching outward was previously unsafe because it would have swallowed the
 * space where a loose end could be placed. Loose ends can no longer be
 * authored, so that cost is gone and the band can do what it should.
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
 * The ring the user aims at is drawn from `attachPoint`, so the snap has to be
 * measured at the same place — through `attachOnOutline`, which is the shared
 * construction rather than a second copy of it. It *was* a second copy, and
 * when rotation arrived only the drawing side got it: on a turned square the
 * ring sat on one edge and the snap listened on another.
 */
function portAt(c: BindCandidate, side: Exclude<Port, 'auto'>): Point {
  return attachOnOutline(c.box, c.outline, c.rotation ?? 0, portPoint(c.box, side));
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
  return anchorFor(c, snapToEdge(c, world));
}

/** The point on the candidate's silhouette nearest `world`. */
function snapToEdge(c: BindCandidate, world: Point): Point {
  if (!c.outline || c.outline.length < 3) return world;
  return nearestOnOutline(c.outline, world)?.point ?? world;
}

/** A world point already on the edge, expressed in the node's own frame. */
function anchorFor(c: BindCandidate, onEdge: Point): { u: number; v: number } {
  const local = rotatePoint(onEdge, centreOfBox(c.box), -(c.rotation ?? 0));
  return normalizeAnchor(anchorFromPoint(c.box, local));
}

const lerp = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

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

  /**
   * The nearest edge midpoint, and how the pull toward it is applied.
   *
   * ## Why a snap is not a jump here
   *
   * A snap moves the result to somewhere the cursor is not, so crossing into
   * its zone teleports the endpoint. Four zones on a shape means four leaps per
   * lap of its outline, in both directions — which is most of what "jarring
   * jumps and glitches" is describing, and it is the part a person feels even
   * when every individual answer is correct.
   *
   * So the zone has two halves. Inside the inner half the answer is the named
   * port outright. Across the outer half the anchor is *drawn toward* the
   * midpoint, from no pull at all at the rim to fully arrived at the halfway
   * mark — which is exactly where the binding flips to the port. The position
   * is therefore continuous the whole way through, and the change of *kind*
   * happens at the one radius where both kinds agree about where the point is.
   *
   * It still feels magnetic. It simply stops teleporting to get there.
   */
  let pull: { c: BindCandidate; side: Exclude<Port, 'auto'>; point: Point; distance: number } | null = null;
  for (const c of candidates) {
    if (c.id === excludeId) continue;
    for (const side of SIDES) {
      const p = portAt(c, side);
      const d = Math.hypot(world.x - p.x, world.y - p.y);
      if (d <= portTolerance && (!pull || d < pull.distance)) {
        pull = { c, side, point: p, distance: d };
      }
    }
  }
  if (pull) {
    const grip = portTolerance / 2;
    if (pull.distance <= grip) return { nodeId: pull.c.id, port: pull.side };
    // 0 at the rim of the zone, 1 at the halfway mark.
    const t = 1 - (pull.distance - grip) / grip;
    const eased = lerp(snapToEdge(pull.c, world), pull.point, t);
    return { nodeId: pull.c.id, anchor: anchorFor(pull.c, eased) };
  }

  /**
   * The edge, from either side.
   *
   * Measured as an absolute distance to the outline rather than as depth
   * *within* the shape, so the band is a ribbon straddling the stroke. That is
   * what makes running the cursor round the outside of an object work at all,
   * and it is the reason this loop is separate from the containment one below
   * rather than nested inside it.
   */
  let nearestEdge: { c: BindCandidate; distance: number } | null = null;
  for (const c of candidates) {
    if (c.id === excludeId) continue;
    const d = distanceToEdge(c, world);
    if (d <= edgeBand && (!nearestEdge || d < nearestEdge.distance)) {
      nearestEdge = { c, distance: d };
    }
  }
  if (nearestEdge) return { nodeId: nearestEdge.c.id, anchor: anchorAt(nearestEdge.c, world) };

  // Well inside something: that object as a whole, side left to the route.
  let nearestBody: { c: BindCandidate; depth: number } | null = null;
  for (const c of candidates) {
    if (c.id === excludeId || !contains(c, world)) continue;
    const depth = distanceToEdge(c, world);
    // The innermost containing shape wins — on nested content (a note on a
    // frame) that is the smaller, more specific one.
    if (!nearestBody || depth < nearestBody.depth) nearestBody = { c, depth };
  }
  if (!nearestBody) return { x: world.x, y: world.y };

  return { nodeId: nearestBody.c.id, port: 'auto' };
}
