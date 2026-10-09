/**
 * What a line drawn onto objects becomes.
 *
 * ## Line and connector: one rule between them
 *
 * A **line** is a mark: it stays where it was drawn. A **connector** is a
 * relationship: both of its ends belong to objects, and it follows them. The
 * two tools were drawing the same arrow between the same two boxes and getting
 * different objects, which is how two tools come to feel like duplicates.
 *
 * So the line tool hands off. When **both ends of a two-point line land on
 * objects**, it is created as a connector — same ends, same path, same weight
 * — and from then on it follows those objects, with the connector's own
 * routing, labels and endpoint editing. The preview says so before release:
 * both objects light up and the run takes the route it will have.
 *
 * Anything else stays a line:
 *  - **One end on an object.** Its end snaps flush to the edge, but a single
 *    bound end would be a connector whose free end can never be put back on
 *    empty board, which the connector editor rightly refuses.
 *  - **A run of corners.** The corners were placed by hand; a connector would
 *    route over them.
 *  - **A decorative profile** — wavy, zigzag, coil. A connector routes
 *    straight, elbow or curved and has no way to draw the rest.
 *  - **Ctrl or ⌘ held**, which is how to draw a plain line across objects on
 *    purpose. Excalidraw uses the same key to suppress binding.
 *
 * The connector tool keeps its own job: it only connects, ports show as you
 * approach, and both ends must land. The line tool draws anything and connects
 * when you happen to draw between two things.
 */

import { isOpenShape, type AnyNode } from './schema';
import { bindCandidates, isConnectable } from './connectorTargets';
import type { BindCandidate } from './connectorBinding';
import type { ConnectorEnd, Point, Routing } from './connector';
import type { EndCapKind } from './connectorEnds';
import { isRouteProfile, type LineProfile, type RouteProfile } from './linePath';

/** The node a promoted line is created as, in the shape `createNode` takes. */
export interface ConnectorInput {
  [field: string]: unknown;
  id: string;
  type: 'connector';
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Whether a line's end may attach to this node.
 *
 * Narrower than the connector tool's rule in two places. **Frames** are left
 * out: a line is drawn *inside* a frame far more often than *to* one, and a
 * frame would claim every end that landed on its empty interior. **Other
 * lines** are left out because a line has no sides to arrive at.
 */
export function isLineBindTarget(node: AnyNode | undefined): boolean {
  if (!node || !isConnectable(node)) return false;
  if (node.type === 'frame') return false;
  if (node.type === 'shape' && isOpenShape(node.geometry.kind)) return false;
  return true;
}

/** Everything a line end could bind to, as boxes. */
export function lineBindCandidates(objects: Record<string, AnyNode>): BindCandidate[] {
  return bindCandidates(objects).filter((c) => isLineBindTarget(objects[c.id]));
}

/** The connector routing that draws the same path as a line profile. */
export const ROUTING_FOR_PROFILE: Record<RouteProfile, Routing> = {
  straight: 'straight',
  elbow: 'orthogonal',
  curved: 'curved',
};

/**
 * The routing a line should be promoted to, or `null` to keep it a line.
 *
 * See the module note for each condition and why it is there.
 */
export function promotion(
  from: ConnectorEnd | null,
  to: ConnectorEnd | null,
  options: { profile: LineProfile | undefined; vertexCount: number; suppressed: boolean }
): Routing | null {
  if (options.suppressed || options.vertexCount !== 2) return null;
  if (!isRouteProfile(options.profile)) return null;
  if (!from?.nodeId || !to?.nodeId || from.nodeId === to.nodeId) return null;
  return ROUTING_FOR_PROFILE[options.profile ?? 'straight'];
}

/**
 * The connector a promoted line is written as.
 *
 * The box is the endpoints' extent, as the connector tool writes it; the
 * renderer draws from the live route and an elected editor keeps the box in
 * step afterwards.
 */
export function connectorFromLine(input: {
  id: string;
  from: ConnectorEnd;
  to: ConnectorEnd;
  /** Where the two ends resolve now, for the initial box. */
  a: Point;
  b: Point;
  routing: Routing;
  endStart: EndCapKind;
  endEnd: EndCapKind;
  stroke: { color: string; width: number; dash?: number[] };
  avoid: boolean;
  /** A label the line already carried, which the connector keeps. */
  label?: string;
}): ConnectorInput {
  return {
    id: input.id,
    type: 'connector',
    x: Math.min(input.a.x, input.b.x),
    y: Math.min(input.a.y, input.b.y),
    width: Math.max(1, Math.abs(input.b.x - input.a.x)),
    height: Math.max(1, Math.abs(input.b.y - input.a.y)),
    from: input.from,
    to: input.to,
    routing: input.routing,
    endStart: input.endStart,
    endEnd: input.endEnd,
    ...(input.avoid && input.routing !== 'straight' ? { avoid: true } : null),
    // Round caps stated in the document, as the connector tool writes them, so
    // the Cap control shows what is drawn.
    ...(input.label?.trim() ? { label: input.label } : null),
    appearance: {
      stroke: {
        color: input.stroke.color,
        width: input.stroke.width,
        cap: 'round',
        ...(input.stroke.dash?.length ? { dash: [...input.stroke.dash] } : null),
      },
    },
  };
}
