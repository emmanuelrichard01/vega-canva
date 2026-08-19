/**
 * Attaching a connector to an exact place on an object, not just to a side.
 *
 * ## What this adds to the four ports
 *
 * `portPoint` gives the midpoint of each edge, which is the right default and
 * covers most diagrams — those four are what the tool shows and what a fast
 * gesture lands on. What they cannot express is *this* spot: the third input
 * on the left of a wide node, the corner of a frame, the point on a long box
 * where two arrows would otherwise arrive on top of each other.
 *
 * An anchor is that spot, stored **normalized to the node's own box** — `u`
 * and `v` each run 0 to 1 across the width and height. Normalized rather than
 * absolute for the same reason a connector stores a node id rather than a
 * coordinate: the binding has to survive the object being moved *and resized*.
 * An absolute offset would slide off a box that got narrower, which is the
 * whole failure a bound connector exists to avoid.
 *
 * ## Why an anchor still resolves to a point on the perimeter
 *
 * An arrow that stops in the middle of a shape has its head buried inside the
 * fill. So the stored anchor is an *aim* and `anchorPoint` projects it out to
 * the edge, keeping the free coordinate and snapping the bound one. Dragging
 * an endpoint along the left edge slides it up and down that edge; dragging it
 * across to the top edge moves it round the corner. That is the behaviour of
 * every tool that has this, and it falls out of one comparison.
 *
 * Everything here is pure: a box and a pair of ratios in, a point and a side
 * out. Routing bugs are close to invisible on screen — a wrong path still
 * looks like *a* path — which is why this is a module and not four lines
 * inside a renderer.
 */

import type { Box, Point, Port } from './connector';

/** A point on an object, in the object's own proportions. Both run 0..1. */
export interface Anchor {
  u: number;
  v: number;
}

/**
 * How far from the centre an anchor has to be before it means a *place*.
 *
 * Inside this, the user is pointing at the object rather than at a spot on
 * it, and the honest reading is `auto` — let the route pick the side, which
 * is both what they want and what keeps looking right when things move. The
 * radius is in normalized units, so it is the same fraction of a small box and
 * a large one; a screen-space dead zone would swallow a whole small node.
 */
export const ANCHOR_CENTRE_ZONE = 0.34;

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/** An anchor with both ratios brought into range. */
export function normalizeAnchor(a: Anchor): Anchor {
  return { u: clamp01(a.u), v: clamp01(a.v) };
}

/**
 * Whether a point in a box is close enough to the middle to mean "auto".
 *
 * Measured in normalized units on both axes independently, so the zone is a
 * rectangle in the box's own proportions rather than a circle that would be
 * generous on the long axis of a wide node and stingy on the short one.
 */
export function isCentreAnchor(a: Anchor): boolean {
  return Math.abs(a.u - 0.5) < ANCHOR_CENTRE_ZONE && Math.abs(a.v - 0.5) < ANCHOR_CENTRE_ZONE;
}

/**
 * Which edge an anchor belongs to.
 *
 * Compared in normalized space, which is the load-bearing detail: on a
 * 400x60 node, a point 20px in from the left and 20px down from the top is
 * far more of the way down than across, and the edge it is really near is the
 * top. Raw offsets would say left. This is the same reasoning `portFacing`
 * uses for a bare point outside the box, and deliberately the same shape.
 */
export function anchorPort(a: Anchor): Exclude<Port, 'auto'> {
  const du = a.u - 0.5;
  const dv = a.v - 0.5;
  if (Math.abs(du) >= Math.abs(dv)) return du >= 0 ? 'right' : 'left';
  return dv >= 0 ? 'bottom' : 'top';
}

/**
 * Where an anchor sits in world space, projected onto the box's perimeter.
 *
 * The coordinate on the anchor's own edge is kept and the other is snapped to
 * that edge, so an anchor at `{u: 0.05, v: 0.8}` lands 80% of the way down the
 * left edge rather than just inside the shape.
 */
export function anchorPoint(box: Box, a: Anchor): Point {
  const { u, v } = normalizeAnchor(a);
  switch (anchorPort({ u, v })) {
    case 'left': return { x: box.x, y: box.y + box.height * v };
    case 'right': return { x: box.x + box.width, y: box.y + box.height * v };
    case 'top': return { x: box.x + box.width * u, y: box.y };
    case 'bottom': return { x: box.x + box.width * u, y: box.y + box.height };
  }
}

/** A world point expressed in a box's own proportions. Not clamped. */
export function anchorFromPoint(box: Box, p: Point): Anchor {
  return {
    u: box.width > 0 ? (p.x - box.x) / box.width : 0.5,
    v: box.height > 0 ? (p.y - box.y) / box.height : 0.5,
  };
}

/**
 * The anchor equivalent to each named port.
 *
 * Kept so the two systems are provably one system — a `port: 'left'` end and
 * an anchor of `{u: 0, v: 0.5}` resolve to the same point, which is asserted
 * in the tests. Named ports remain the storage for the common case because
 * they say what they mean when you read the document, and because they are
 * what the tool's four rings write.
 */
export const PORT_ANCHORS: Record<Exclude<Port, 'auto'>, Anchor> = {
  top: { u: 0.5, v: 0 },
  right: { u: 1, v: 0.5 },
  bottom: { u: 0.5, v: 1 },
  left: { u: 0, v: 0.5 },
};
