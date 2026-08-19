/**
 * A line as its two endpoints, and back again.
 *
 * ## The problem this solves
 *
 * A line and an arrow are stored as a *box* — they run corner to corner of
 * `width`/`height`, with the sign of `scaleX`/`scaleY` choosing which diagonal.
 * That keeps `width`/`height` the only record of bounds, which is the rule the
 * whole model rests on, and it is genuinely the right storage.
 *
 * It is the wrong thing to *edit*. Handed a bounding box, a line offers eight
 * resize handles, none of which is "move this end" — dragging a corner moves
 * both ends at once, because that is what resizing a box does. And the
 * transformer floors a box at ten units on each axis, so the two lines people
 * draw most, the horizontal one and the vertical one, were the two the tool
 * could not make: the best it managed was a ten-pixel diagonal.
 *
 * So the box stays the storage and the endpoints become the interface. This
 * module is the conversion, and it is pure and tested because getting it wrong
 * is a line that jumps somewhere else the moment you touch its end.
 */

import type { Point, ShapeNode } from './schema';

/**
 * A line's box is allowed to be flat.
 *
 * Zero on one axis is not a degenerate box for a line, it is a *horizontal*
 * line — and flooring it at one unit, as the transformer does for shapes, is
 * precisely what left the flattest achievable line one pixel off true. Konva
 * draws a two-point run at any extent, and clicking is served by
 * `hitStrokeWidth` rather than by area, so nothing downstream needs the floor.
 *
 * Both axes at zero is a different thing — a point, with no direction — and
 * that one does get a unit, so the node still has somewhere to put a handle.
 */
const MIN_EXTENT = 0;

type LineBox = Pick<ShapeNode, 'x' | 'y' | 'width' | 'height' | 'scaleX' | 'scaleY' | 'rotation'>;

function rotate(p: Point, about: Point, degrees: number): Point {
  if (!degrees) return p;
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = p.x - about.x;
  const dy = p.y - about.y;
  return { x: about.x + dx * cos - dy * sin, y: about.y + dx * sin + dy * cos };
}

/**
 * Where a line's two ends actually are, in world space.
 *
 * Honours the flip *and* the rotation, because both are part of where the ends
 * are drawn — a handle that ignored either would sit off the line it belongs
 * to, which is worse than no handle at all.
 */
export function lineEndpoints(node: LineBox): { a: Point; b: Point } {
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  const sx = node.scaleX < 0 ? -1 : 1;
  const sy = node.scaleY < 0 ? -1 : 1;

  // Local (0,0) and (w,h), scaled about the centre.
  const a = { x: cx - (node.width / 2) * sx, y: cy - (node.height / 2) * sy };
  const b = { x: cx + (node.width / 2) * sx, y: cy + (node.height / 2) * sy };
  const centre = { x: cx, y: cy };
  return {
    a: rotate(a, centre, node.rotation),
    b: rotate(b, centre, node.rotation),
  };
}

/**
 * The box that draws a line between two points.
 *
 * Rotation is reset to zero, and that is not a loss: a line *is* its two
 * endpoints, so any angle it has is already expressed by where they are.
 * Keeping a stored rotation as well would give the same line two descriptions
 * that could disagree — and dragging an end would then move it somewhere the
 * arithmetic did not predict.
 */
export function boxFromEndpoints(a: Point, b: Point): LineBox {
  let width = Math.max(MIN_EXTENT, Math.abs(b.x - a.x));
  let height = Math.max(MIN_EXTENT, Math.abs(b.y - a.y));
  if (width === 0 && height === 0) {
    width = 1;
    height = 1;
  }
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width,
    height,
    // The sign records which diagonal the run takes. A degenerate axis — a
    // perfectly horizontal line has zero height — keeps a positive sign, since
    // there is no direction left for it to record.
    scaleX: b.x < a.x ? -1 : 1,
    scaleY: b.y < a.y ? -1 : 1,
    rotation: 0,
  };
}

/** Angle snapping increment, in degrees. Fifteen is what Figma and Illustrator use. */
export const ANGLE_STEP = 15;

/**
 * Snap a dragged end onto the nearest fixed angle from the other one.
 *
 * Length is preserved, only the direction moves — which is what makes a
 * constrained drag feel like rotating the line rather than like fighting a
 * grid. Held with Shift, the same key every editor uses for this.
 */
export function constrainToAngle(anchor: Point, moving: Point, step = ANGLE_STEP): Point {
  const dx = moving.x - anchor.x;
  const dy = moving.y - anchor.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return moving;
  const snapped = (Math.round(Math.atan2(dy, dx) / ((step * Math.PI) / 180)) * (step * Math.PI)) / 180;
  return { x: anchor.x + Math.cos(snapped) * length, y: anchor.y + Math.sin(snapped) * length };
}

/**
 * Whether a node is one of the two open shapes this applies to.
 *
 * Checked by geometry kind rather than by a capability flag: `isOpenShape`
 * already answers "has no interior" for the renderer and the panel, and a
 * second predicate meaning almost the same thing is how the two come to
 * disagree about a line.
 */
export function isLineLike(node: { type: string; geometry?: { kind?: string } }): boolean {
  return node.type === 'shape' && (node.geometry?.kind === 'line' || node.geometry?.kind === 'arrow');
}
