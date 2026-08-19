/**
 * The bridge between the document and the pure connector maths.
 *
 * `connector.ts`, `connectorAnchor.ts` and `connectorBinding.ts` all take
 * boxes and give back points, and none of them knows what a node is. Something
 * has to turn the objects map into boxes, and that something was duplicated:
 * `ConnectorTool` had a private `boxOfNode` and its own idea of what is
 * connectable, and the renderer had another. Two answers to "what can an arrow
 * attach to" is how a port appears under the pointer for something the tool
 * will then refuse to bind to.
 *
 * This is the only place that decides.
 */

import type { AnyNode } from './schema';
import { portPoint, type Box, type ConnectorEnd, type Point, type Port } from './connector';
import type { BindCandidate } from './connectorBinding';
import { centreOf, outlineOfNode, projectToOutline, rotatePoint } from './shapePerimeter';
import { anchorPoint, type Anchor } from './connectorAnchor';

/**
 * Types a connector can attach to.
 *
 * Another connector is deliberately not one of them. An arrow bound to an
 * arrow has no box to take a side of, and the chain of derivations it creates
 * has no natural end — move one and every connector downstream of it has to
 * re-resolve, in an order nothing establishes.
 */
export const CONNECTABLE: ReadonlySet<string> = new Set([
  'shape',
  'sticky',
  'image',
  'text',
  'frame',
  'path',
]);

type BoxNode = {
  x: number;
  y: number;
  width: number;
  height: number;
  scaleX?: number;
  scaleY?: number;
};

/**
 * A node's world box.
 *
 * The flip is folded in as an absolute value: a mirrored object occupies the
 * same rectangle, and a negative width would put every port on the wrong side
 * and give `anchorFromPoint` a negative ratio.
 *
 * Rotation is **not** handled, here or anywhere in the connector system, and
 * that is a known gap rather than an oversight — a rotated node's ports still
 * sit on its unrotated bounding box. Fixing it means every consumer working in
 * the node's local frame and rotating the resolved point back out; it is worth
 * doing and it is not a small change.
 */
export function boxOfNode(n: BoxNode): Box {
  return {
    x: n.x,
    y: n.y,
    width: n.width * Math.abs(n.scaleX || 1),
    height: n.height * Math.abs(n.scaleY || 1),
  };
}

/** Whether an arrow may attach to this node at all. */
export function isConnectable(node: { type: string; hidden?: boolean; locked?: boolean }): boolean {
  return CONNECTABLE.has(node.type) && !node.hidden && !node.locked;
}

/** Everything on the board an end could bind to, as boxes. */
export function bindCandidates(objects: Record<string, AnyNode>): BindCandidate[] {
  const out: BindCandidate[] = [];
  for (const node of Object.values(objects)) {
    if (!isConnectable(node)) continue;
    // The silhouette goes with the box, so the rule that decides what the
    // pointer means measures the same thing the eye is looking at. Cached, so
    // building this per pointer-move costs a map lookup per object.
    out.push({
      id: node.id,
      box: boxOfNode(node),
      outline: outlineFor(node),
      rotation: node.rotation ?? 0,
    });
  }
  return out;
}

/** The box for a node id, or null — the shape `connectorPoints` asks for. */
export function boxLookup(objects: Record<string, AnyNode>): (id: string) => Box | null {
  return (id) => {
    const n = objects[id];
    return n ? boxOfNode(n) : null;
  };
}

/**
 * Where one end currently sits, without routing the whole connector.
 *
 * Used for the cheap questions — did this drag travel far enough to be a
 * gesture, where should a handle be drawn — where resolving both ends and
 * routing between them would be doing the work twice. It answers for the end
 * *in isolation*, so an `auto` end reports the object's centre rather than the
 * side the finished route will leave from; that is the honest answer when
 * there is no other end to face.
 */
export function endPoint(end: ConnectorEnd, objects: Record<string, AnyNode>): Point {
  const node = end.nodeId ? objects[end.nodeId] : undefined;
  if (node) {
    const box = boxOfNode(node);
    if (end.anchor) return anchorPoint(box, end.anchor);
    if (end.port && end.port !== 'auto') return portPoint(box, end.port);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }
  return { x: end.x ?? 0, y: end.y ?? 0 };
}

/**
 * A node's outline, flattened once and remembered.
 *
 * Flattening an ellipse produces around sixty points, and `connectorPoints`
 * runs on every render of every connector — on a flowchart that is the same
 * curve being subdivided hundreds of times a second to answer a question whose
 * answer did not change. The cache key is everything the outline depends on,
 * so it invalidates itself when the shape does and no caller has to remember
 * to clear it.
 *
 * Bounded, because a board can hold more shapes than are worth keeping
 * outlines for and this must not become a leak that grows with session length.
 * Oldest-out rather than least-recently-used: an LRU needs bookkeeping on every
 * *read*, and reads are the hot path here.
 */
const outlineCache = new Map<string, Point[] | null>();
const OUTLINE_CACHE_LIMIT = 400;

function outlineKey(node: AnyNode): string {
  const geo = 'geometry' in node ? node.geometry : undefined;
  return [
    node.id,
    node.type,
    Math.round(node.x),
    Math.round(node.y),
    Math.round(node.width),
    Math.round(node.height),
    node.scaleX ?? 1,
    node.scaleY ?? 1,
    geo ? JSON.stringify(geo) : '',
  ].join('|');
}

/** The cached outline for a node, computing it the first time. */
export function outlineFor(node: AnyNode): Point[] | null {
  const key = outlineKey(node);
  const hit = outlineCache.get(key);
  if (hit !== undefined) return hit;
  const value = outlineOfNode(node);
  if (outlineCache.size >= OUTLINE_CACHE_LIMIT) {
    const oldest = outlineCache.keys().next().value;
    if (oldest !== undefined) outlineCache.delete(oldest);
  }
  outlineCache.set(key, value);
  return value;
}

/**
 * The attachment lookup `connectorPoints` takes.
 *
 * A callback that turns a box-derived point into the real one, rather than
 * handing the routing code an outline to reason about. Rotation and the
 * silhouette are both inside it, so `connector.ts` stays a module about routes
 * that has never heard of either.
 */
export function attachLookup(
  objects: Record<string, AnyNode>
): (id: string, boxPoint: Point) => Point | null {
  return (id, boxPoint) => {
    const n = objects[id];
    return n ? attachPoint(n, boxPoint) : null;
  };
}

/**
 * A point the connector logic derived from the box, moved onto the shape.
 *
 * The affordances have to agree with the result. The four rings a user aims at
 * were drawn at `portPoint(box, side)` while the arrow they produced now lands
 * on the outline — so on a triangle the ring floated in empty air a good
 * distance from where the arrow would actually attach. A target that is not
 * where the thing lands is worse than no target: it teaches the wrong place.
 */
export function attachPoint(node: AnyNode, boxPoint: Point): Point {
  const centre = centreOf(node);
  // The box point is in the node's own, unrotated frame — that is what
  // `portPoint` and `anchorPoint` produce, and what the anchor stores. Turning
  // it out first is what makes a named port mean the *shape's* top rather than
  // the screen's, and it is the whole of rotation support for the ports.
  const turned = rotatePoint(boxPoint, centre, node.rotation ?? 0);
  const outline = outlineFor(node);
  if (!outline || outline.length < 3) return turned;
  return projectToOutline(outline, centre, turned) ?? turned;
}

/** The four named ports of a node, on its outline. */
export function portPointsFor(node: AnyNode): Array<{ side: Exclude<Port, 'auto'>; point: Point }> {
  const box = boxOfNode(node);
  return (['top', 'right', 'bottom', 'left'] as const).map((side) => ({
    side,
    point: attachPoint(node, portPoint(box, side)),
  }));
}

/** Where an anchor sits on a node, on its outline. */
export function anchorPointOn(node: AnyNode, anchor: Anchor): Point {
  return attachPoint(node, anchorPoint(boxOfNode(node), anchor));
}
