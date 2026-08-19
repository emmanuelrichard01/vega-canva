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
import { portPoint, type Box, type ConnectorEnd, type Point } from './connector';
import { anchorPoint } from './connectorAnchor';
import type { BindCandidate } from './connectorBinding';

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
    out.push({ id: node.id, box: boxOfNode(node) });
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
