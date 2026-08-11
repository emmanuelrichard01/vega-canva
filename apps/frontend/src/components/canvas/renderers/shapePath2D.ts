import { shapeOutline } from '../../../engine/model/shapeOutline';
import type { ShapeNode } from '../../../engine/model/schema';

/**
 * A shape's outline as a `Path2D`, in the node's own local coordinates.
 *
 * `Path2D` because the two effects that need a path both need it as an
 * *object*: `ctx.clip(path)` and `ctx.fill(path, 'evenodd')` take one, and
 * building the path twice — once to clip with and once to fill — is how the
 * clip and the fill end up describing marginally different shapes.
 *
 * Browser-only, which is why it lives here rather than in `model/`: the
 * geometry is in `shapeOutline` and is tested; this is the part that needs a
 * DOM constructor and can only be looked at.
 */
export function shapePath2D(node: ShapeNode): Path2D {
  const outline = shapeOutline(node);
  const path = new Path2D();

  if (outline.kind === 'rect') {
    if (outline.radius > 0 && typeof path.roundRect === 'function') {
      path.roundRect(outline.x, outline.y, outline.width, outline.height, outline.radius);
    } else {
      path.rect(outline.x, outline.y, outline.width, outline.height);
    }
    return path;
  }

  if (outline.kind === 'ellipse') {
    path.ellipse(outline.cx, outline.cy, outline.rx, outline.ry, 0, 0, Math.PI * 2);
    return path;
  }

  outline.points.forEach((p, i) => (i === 0 ? path.moveTo(p.x, p.y) : path.lineTo(p.x, p.y)));
  // An open run is not closed: closing a line would draw it back on itself,
  // and the effects that use this path clip to an *interior* a line has not
  // got. They are gated off for open shapes for exactly that reason.
  if (outline.kind !== 'open') path.closePath();
  return path;
}

/**
 * A rectangle far larger than any shape, for the "everything outside" region.
 *
 * An inner shadow is the shadow cast by the *inverse* of the shape, and an
 * outside stroke is clipped to the inverse of the shape. Both need a finite
 * outer boundary, and both are already clipped to something smaller — so this
 * only has to be big enough that its own edges never come into view. It is in
 * the node's local space, which a node can be scaled and rotated within, so
 * the margin is generous rather than exact.
 */
export function inversePath(inner: Path2D, width: number, height: number): Path2D {
  const path = new Path2D();
  const margin = Math.max(width, height) * 4 + 2000;
  path.rect(-margin, -margin, width + margin * 2, height + margin * 2);
  path.addPath(inner);
  return path;
}
