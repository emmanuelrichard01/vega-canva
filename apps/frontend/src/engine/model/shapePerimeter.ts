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

/** Node types whose outline is their box, so there is nothing to project onto. */
const BOX_IS_THE_SHAPE: ReadonlySet<string> = new Set([
  'sticky',
  'image',
  'frame',
  'text',
  'comment',
  'audio',
]);

/**
 * A node's outline in world space, or `null` when its box already tells the truth.
 *
 * Returning `null` rather than the box's own four corners is deliberate: it
 * lets every caller skip the ray cast entirely for the common case, which is
 * most of the objects on most boards.
 */
export function outlineOfNode(node: AnyNode): Point[] | null {
  if (BOX_IS_THE_SHAPE.has(node.type)) return null;

  if (node.type === 'shape') {
    const kind = node.geometry?.kind;
    // A rectangle is its box. A rounded one differs only within the corner
    // radius, which is not worth flattening a path per frame to honour.
    if (!kind || kind === 'rect') return null;
    try {
      const local = flattenPath(shapeToPath(node));
      if (local.length < 3) return null;
      return local.map((p) => ({ x: node.x + p.x, y: node.y + p.y }));
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
      return local.map((p) => ({ x: node.x + p.x, y: node.y + p.y }));
    } catch {
      return null;
    }
  }

  return null;
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
