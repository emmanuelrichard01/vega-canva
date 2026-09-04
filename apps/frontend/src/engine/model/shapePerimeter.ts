/**
 * Where a shape's *outline* is, as opposed to where its box is.
 *
 * ## The problem
 *
 * Everything a connector does has been measured against the bounding box. For
 * a rectangle, a sticky, a frame, an image or a text block that is exactly
 * right — the box *is* the shape. For a triangle it is a lie: the box's
 * left-middle is empty air, several tens of units from anything drawn, and an
 * arrow that ends there ends nowhere. A hexagon, a star, a freehand blob and
 * an ellipse approached diagonally all have the same problem to different
 * degrees, and the result is the tell that separates a diagram tool that feels
 * made from one that feels assembled: arrows that stop short of what they
 * point at.
 *
 * ## What this does *not* change
 *
 * The box stays the storage. `width`/`height` on the base node remain the only
 * record of bounds, which is a load-bearing rule the whole model rests on, and
 * resizing stays a box operation because that is what every professional tool
 * does and what people expect eight handles to mean.
 *
 * This is the same division `lineEnds.ts` already makes and says out loud:
 * **the box is the storage, and something else is the interface**. There it is
 * two endpoints; here it is the outline. Neither one asks the document to
 * change.
 *
 * ## How a point on the outline is found
 *
 * A ray is cast from the shape's centre through the point the box logic chose,
 * and the *farthest* crossing of the outline wins. Farthest rather than
 * nearest because a star's spike means a ray leaves and re-enters the shape;
 * the outermost crossing is the silhouette, which is what an arrow should
 * touch. Anything that fails — a shape with no outline, a ray that misses —
 * falls back to the box point, so this can only ever improve on the previous
 * answer and never break it.
 */

import { flattenPath } from './pathGeometry';
import { shapeToPath } from './shapeToPath';
import type { Point } from './connector';
import type { AnyNode } from './schema';

/**
 * Node types whose outline is their box, so there is nothing to project onto.
 *
 * `grid` belongs here for the same reason a frame does: it is a rectangular
 * region, and its modules are drawn *inside* that rectangle rather than being
 * its silhouette. It was missing, which left a rotated grid presenting its
 * axis-aligned box to the connector system — a side attached at the wrong
 * place on any grid somebody had turned.
 */
const BOX_IS_THE_SHAPE: ReadonlySet<string> = new Set([
  'sticky',
  'image',
  'frame',
  'text',
  'comment',
  'audio',
  'grid',
]);

/** A point turned about another, in degrees. Zero returns the point untouched. */
export function rotatePoint(p: Point, about: Point, degrees: number): Point {
  if (!degrees) return p;
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = p.x - about.x;
  const dy = p.y - about.y;
  return { x: about.x + dx * cos - dy * sin, y: about.y + dx * sin + dy * cos };
}

/** The centre a node rotates about. */
export function centreOf(node: {
  x: number; y: number; width: number; height: number; scaleX?: number; scaleY?: number;
}): Point {
  return {
    x: node.x + (node.width * Math.abs(node.scaleX || 1)) / 2,
    y: node.y + (node.height * Math.abs(node.scaleY || 1)) / 2,
  };
}

/** The four corners of a node's box, turned by its rotation. */
function rotatedCorners(node: {
  x: number; y: number; width: number; height: number;
  scaleX?: number; scaleY?: number; rotation?: number;
}): Point[] {
  const w = node.width * Math.abs(node.scaleX || 1);
  const h = node.height * Math.abs(node.scaleY || 1);
  const c = centreOf(node);
  const r = node.rotation ?? 0;
  return [
    { x: node.x, y: node.y },
    { x: node.x + w, y: node.y },
    { x: node.x + w, y: node.y + h },
    { x: node.x, y: node.y + h },
  ].map((p) => rotatePoint(p, c, r));
}

/**
 * A node's outline in world space, or `null` when its box already tells the truth.
 *
 * Returning `null` rather than the box's own four corners is deliberate: it
 * lets every caller skip the ray cast entirely for the common case, which is
 * most of the objects on most boards.
 */
export function outlineOfNode(node: AnyNode): Point[] | null {
  const rotation = node.rotation ?? 0;
  const centre = centreOf(node);
  const place = (local: readonly Point[]): Point[] =>
    local.map((p) => rotatePoint({ x: node.x + p.x, y: node.y + p.y }, centre, rotation));

  const boxIsTheShape =
    BOX_IS_THE_SHAPE.has(node.type) ||
    (node.type === 'shape' && (!node.geometry?.kind || node.geometry.kind === 'rect'));

  if (boxIsTheShape) {
    /**
     * A rectangle *turned* is no longer its axis-aligned box.
     *
     * This is where rotation entered the connector system, and the whole of
     * it: an outline is a silhouette in world space, so once it carries the
     * rotation every consumer downstream — port rings, anchors, hit testing,
     * the route itself — is rotation-correct without knowing rotation exists.
     * Unrotated, the box still tells the truth, so `null` keeps the fast path
     * for the overwhelming majority of objects.
     */
    return rotation ? rotatedCorners(node) : null;
  }

  if (node.type === 'shape') {
    try {
      const local = flattenPath(shapeToPath(node));
      if (local.length < 3) return null;
      return place(local);
    } catch {
      // A malformed geometry must not take down the render. The box is a
      // worse answer, not a broken one.
      return null;
    }
  }

  if (node.type === 'path') {
    try {
      const local = flattenPath(node.geometry as never);
      if (local.length < 3) return null;
      return place(local);
    } catch {
      return null;
    }
  }

  return null;
}

/** Whether a point is inside a polygon. Even-odd, the usual ray cast. */
export function pointInPolygon(outline: readonly Point[], p: Point): boolean {
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i, i += 1) {
    const a = outline[i];
    const b = outline[j];
    const straddles = a.y > p.y !== b.y > p.y;
    if (!straddles) continue;
    const x = a.x + ((p.y - a.y) / (b.y - a.y)) * (b.x - a.x);
    if (p.x < x) inside = !inside;
  }
  return inside;
}

/** The closest point on a polygon's edges to `p`, and how far away it is. */
export function nearestOnOutline(
  outline: readonly Point[],
  p: Point
): { point: Point; distance: number } | null {
  let best: Point | null = null;
  let bestDist = Infinity;
  for (let i = 0; i < outline.length; i += 1) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    // A zero-length edge is a point; clamping t to 0 makes it fall out
    // correctly rather than needing a branch of its own.
    const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
    const q = { x: a.x + dx * t, y: a.y + dy * t };
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < bestDist) {
      bestDist = d;
      best = q;
    }
  }
  return best ? { point: best, distance: bestDist } : null;
}

/** Where two segments cross, or null. Standard parametric form. */
function segmentCross(a1: Point, a2: Point, b1: Point, b2: Point): Point | null {
  const dax = a2.x - a1.x;
  const day = a2.y - a1.y;
  const dbx = b2.x - b1.x;
  const dby = b2.y - b1.y;
  const denom = dax * dby - day * dbx;
  // Parallel, or a degenerate segment. Not an error — a polygon edge can be
  // zero-length after flattening — so it is skipped rather than guarded
  // against by the caller.
  if (denom === 0) return null;
  const t = ((b1.x - a1.x) * dby - (b1.y - a1.y) * dbx) / denom;
  const u = ((b1.x - a1.x) * day - (b1.y - a1.y) * dax) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: a1.x + dax * t, y: a1.y + day * t };
}

/**
 * The point on `outline` where a ray from `centre` through `through` leaves it.
 *
 * The ray is extended past `through` rather than stopping at it, so a box
 * point that sits *outside* a concave outline still finds the crossing behind
 * it — which is the whole triangle case.
 */
export function projectToOutline(
  outline: readonly Point[],
  centre: Point,
  through: Point
): Point | null {
  const dx = through.x - centre.x;
  const dy = through.y - centre.y;
  const len = Math.hypot(dx, dy);
  // No direction to cast along. A connector ending at the exact centre of a
  // shape has nothing to aim at, and the caller's fallback is correct.
  if (len === 0) return null;

  // Far enough to clear any outline the box could contain, whatever the box.
  const reach = len * 4 + 1;
  const far = { x: centre.x + (dx / len) * reach, y: centre.y + (dy / len) * reach };

  let best: Point | null = null;
  let bestDist = -1;
  for (let i = 0; i < outline.length; i += 1) {
    const p = outline[i];
    const q = outline[(i + 1) % outline.length];
    const hit = segmentCross(centre, far, p, q);
    if (!hit) continue;
    const d = Math.hypot(hit.x - centre.x, hit.y - centre.y);
    // Farthest wins: a star's spike means the ray leaves and re-enters, and
    // the outermost crossing is the silhouette an arrow should touch.
    if (d > bestDist) {
      bestDist = d;
      best = hit;
    }
  }
  return best;
}

/**
 * Where a point in a node's own, unrotated frame really lands on it.
 *
 * ## Why this is one function
 *
 * It was two. `connectorTargets.attachPoint` did this for a node, and
 * `connectorBinding.portAt` did it for a bind candidate — and when rotation was
 * added, only the first one got it. So on a turned shape the ring was *drawn*
 * at the rotated attachment and the snap was *measured* at the unrotated one,
 * tens of units apart: the exact defect this whole area has produced over and
 * over, one question with two implementations that drift.
 *
 * The two callers have different inputs — one holds a node, the other a
 * candidate — so they cannot share a signature. They can share this, which is
 * the part that was actually duplicated: turn the point out by the rotation,
 * then take the outermost crossing of the silhouette along the ray from the
 * centre.
 */
export function attachOnOutline(
  box: { x: number; y: number; width: number; height: number },
  outline: readonly Point[] | null | undefined,
  rotation: number,
  boxPoint: Point
): Point {
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const turned = rotatePoint(boxPoint, centre, rotation);
  if (!outline || outline.length < 3) return turned;
  return projectToOutline(outline, centre, turned) ?? turned;
}
