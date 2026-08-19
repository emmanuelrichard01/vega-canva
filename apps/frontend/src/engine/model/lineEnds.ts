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

import type { Point, ShapeGeometry, ShapeNode } from './schema';
import { defaultEndAlign, linePoints } from './linePath';
import { capExtentPoints, terminateRun } from './connectorEnds';

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
/** A line box that may also carry stored endpoints. */
type LineNode = LineBox & { geometry?: { a?: Point; b?: Point } };

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
export function lineEndpoints(node: LineNode): { a: Point; b: Point } {
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  const centre = { x: cx, y: cy };

  /**
   * The stored endpoints, when the node has them.
   *
   * They are node-local — offsets from `x`/`y` — the same convention path
   * geometry uses, so moving a line is still a change to `x`/`y` alone and
   * nothing has to walk the endpoints to translate it.
   */
  const stored = localEndpoints(node);
  if (stored) {
    return {
      a: rotate({ x: node.x + stored.a.x, y: node.y + stored.a.y }, centre, node.rotation),
      b: rotate({ x: node.x + stored.b.x, y: node.y + stored.b.y }, centre, node.rotation),
    };
  }

  /**
   * The legacy form: corner to corner of the box, with the flip choosing the
   * diagonal.
   *
   * Kept, not migrated away from in a hurry. Every line drawn before endpoints
   * existed is stored this way, and this branch is what lets one open
   * unchanged — including in a Time Travel snapshot, where nothing can be
   * rewritten because the past is not editable.
   */
  const sx = node.scaleX < 0 ? -1 : 1;
  const sy = node.scaleY < 0 ? -1 : 1;
  const a = { x: cx - (node.width / 2) * sx, y: cy - (node.height / 2) * sy };
  const b = { x: cx + (node.width / 2) * sx, y: cy + (node.height / 2) * sy };
  return {
    a: rotate(a, centre, node.rotation),
    b: rotate(b, centre, node.rotation),
  };
}

/**
 * A line's endpoints in its own local space, or `null` for the legacy form.
 *
 * Separate from `lineEndpoints` because the renderer and the outline work in
 * local coordinates — they draw inside a group already translated to the
 * node's origin — while the editor and the snapping work in world space. One
 * of them converting and the other not is how a handle ends up somewhere the
 * line is not.
 */
export function localEndpoints(node: {
  width: number;
  height: number;
  scaleX?: number;
  scaleY?: number;
  geometry?: { a?: Point; b?: Point };
}): { a: Point; b: Point } | null {
  const a = node.geometry?.a;
  const b = node.geometry?.b;
  if (!a || !b) return null;
  return { a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } };
}

/**
 * The local endpoints a line draws between, legacy form included.
 *
 * The one function the renderer, the outline and the exporter should ask, so a
 * profiled line is computed between the same two points everywhere.
 */
export function localRunEnds(node: {
  width: number;
  height: number;
  scaleX?: number;
  scaleY?: number;
  geometry?: { a?: Point; b?: Point };
}): { a: Point; b: Point } {
  return localEndpoints(node) ?? { a: { x: 0, y: 0 }, b: { x: node.width, y: node.height } };
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

/**
 * Everything a line node needs to store, given where its two ends are.
 *
 * ## Why the box is no longer the two endpoints
 *
 * It was, and that is exact for a *straight* line and wrong the moment the run
 * has a profile. A wave deviates across the diagonal, so the box stayed a flat
 * sliver while the drawing occupied real height — measured on a live board, a
 * wavy arrow stored 380x0 and drew 380x49.
 *
 * That box is not decorative. Marquee selection, culling, the radar and export
 * framing all read `width`/`height`, so a profiled line could be missed by a
 * marquee drawn right around it, and culled while its crests were still on
 * screen. The handles sat on a flat diagonal that looked unrelated to the
 * shape, which is what "the bounding box appears separate from the line" is.
 *
 * So `width`/`height` become what they are for every other node — the extent
 * of what is drawn, markers included — and the endpoints move into `geometry`,
 * where the profile and the caps already live. Nothing is stored twice: what
 * changed is which of the two is derived.
 *
 * ## Rotation stays zero
 *
 * A line *is* its two endpoints, so any angle it has is already expressed by
 * where they are. Keeping a stored rotation as well would give the same line
 * two descriptions that could disagree, and dragging an end would then move it
 * somewhere the arithmetic did not predict.
 */
export function lineNodeFromEndpoints(
  a: Point,
  b: Point,
  geometry: ShapeGeometry,
  strokeWidth = 2
): {
  x: number;
  y: number;
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  geometry: ShapeGeometry;
} {
  // The run as drawn, in world space, and the markers that terminate it.
  const run = linePoints(a, b, geometry.lineProfile, geometry.lineWaves);
  const flat = run.flatMap((p) => [p.x, p.y]);
  const { run: drawn, start, end } = terminateRun(flat, {
    start: geometry.endStart ?? 'none',
    end: geometry.endEnd ?? 'none',
    strokeWidth,
    scale: geometry.endScale,
    align: geometry.endAlign ?? defaultEndAlign(geometry.lineProfile),
  });

  const xs: number[] = [];
  const ys: number[] = [];
  const take = (pts: number[]) => {
    for (let i = 0; i + 1 < pts.length; i += 2) {
      xs.push(pts[i]);
      ys.push(pts[i + 1]);
    }
  };
  take(drawn);
  take(capExtentPoints(start));
  take(capExtentPoints(end));
  // A degenerate run — both ends in the same place — still has to have a box,
  // or the node has no presence in the spatial index at all.
  if (xs.length === 0) {
    xs.push(a.x, b.x);
    ys.push(a.y, b.y);
  }

  /**
   * Half the stroke, on every side.
   *
   * A stroke is centred on its path, so a three-pixel line drawn along the
   * exact edge of its own box has half its weight outside it. On a horizontal
   * straight line that *is* the whole height, and without this the box is zero
   * tall for the one case the old model at least got the length of.
   */
  const pad = Math.max(0.5, strokeWidth / 2);
  const x = Math.min(...xs) - pad;
  const y = Math.min(...ys) - pad;
  const width = Math.max(1, Math.max(...xs) - Math.min(...xs) + pad * 2);
  const height = Math.max(1, Math.max(...ys) - Math.min(...ys) + pad * 2);

  return {
    x,
    y,
    width,
    height,
    // Flips are meaningless now that the endpoints are stored outright: the
    // sign used to record which diagonal the run took, and there is no
    // diagonal left to record.
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    geometry: { ...geometry, a: { x: a.x - x, y: a.y - y }, b: { x: b.x - x, y: b.y - y } },
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
