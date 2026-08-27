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
import {
  isMultiPoint,
  normalizeBends,
  normalizeVertices,
  polylinePoints,
  type Bends,
} from './polyline';

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
type LineGeometryish = {
  a?: Point;
  b?: Point;
  vertices?: Point[];
  bends?: unknown;
  smooth?: boolean;
};
type LineNode = LineBox & { geometry?: LineGeometryish };

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
 * Every vertex of a line, in world space.
 *
 * The world-space twin of {@link localVertices}, and it exists for the same
 * reason `lineEndpoints` does: the renderer and the outline work inside a group
 * already translated to the node's origin, while the editor and the snapping
 * work in window-facing world coordinates. One of them converting and the other
 * not is how a handle ends up somewhere the line is not.
 *
 * Rotation is honoured even though a line written by this module always stores
 * zero — a legacy line, or one rotated as part of a group, can carry one, and a
 * handle that ignored it would sit off the line it belongs to.
 */
export function worldVertices(node: LineNode): Point[] {
  const centre = { x: node.x + node.width / 2, y: node.y + node.height / 2 };
  return localVertices(node).map((p) =>
    rotate({ x: node.x + p.x, y: node.y + p.y }, centre, node.rotation)
  );
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
  geometry?: LineGeometryish;
}): { a: Point; b: Point } | null {
  // A multi-point line's ends are the ends of its run. Reading `a`/`b` here
  // instead would give the caps and the snapping a stale two-point answer for a
  // line that has since grown corners -- and `a`/`b` are not even written for
  // one, so the answer would be the *legacy box*: a diagonal unrelated to the
  // shape on screen.
  const run = node.geometry?.vertices;
  if (run && run.length >= 2) {
    return { a: { ...run[0] }, b: { ...run[run.length - 1] } };
  }
  const a = node.geometry?.a;
  const b = node.geometry?.b;
  if (!a || !b) return null;
  return { a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } };
}

/**
 * Every vertex a line runs through, in its own local space.
 *
 * **The one reader.** Three storage forms exist and all three are legitimate:
 * `vertices` for a run of corners, `a`/`b` for the two-point line, and the
 * legacy corner-to-corner box for anything drawn before endpoints were stored.
 * Every consumer — the renderer, the outline, the exporter, the thumbnail, the
 * editor — asks this and gets a list, so none of them has to know which form it
 * is looking at and none of them can answer it differently.
 */
export function localVertices(node: {
  width: number;
  height: number;
  scaleX?: number;
  scaleY?: number;
  geometry?: LineGeometryish;
}): Point[] {
  const stored = normalizeVertices(node.geometry?.vertices);
  if (stored) return stored;
  const ends = localRunEnds(node);
  return [ends.a, ends.b];
}

/** The bends for those vertices, always the right length. */
export function localBends(node: { geometry?: LineGeometryish }, vertexCount: number): Bends {
  return normalizeBends(vertexCount, node.geometry?.bends);
}

/**
 * The run a line draws, profile and bends included.
 *
 * The single place the two shapes of "not a straight line" are reconciled, and
 * they are mutually exclusive by construction rather than by convention: a
 * multi-point line takes its shape from its bends, a two-point line from its
 * profile. Letting both apply would need a wave sampled along a curve, which is
 * an arc-length problem nothing here should own — see `polyline.ts`.
 */
export function runPoints(node: {
  width: number;
  height: number;
  scaleX?: number;
  scaleY?: number;
  geometry?: LineGeometryish & {
    lineProfile?: ShapeGeometry['lineProfile'];
    lineWaves?: number;
    lineAmplitude?: number;
  };
}): Point[] {
  const vertices = localVertices(node);
  if (isMultiPoint(vertices) || node.geometry?.bends || node.geometry?.smooth) {
    return polylinePoints(vertices, localBends(node, vertices.length), node.geometry?.smooth);
  }
  return linePoints(
    vertices[0],
    vertices[vertices.length - 1],
    node.geometry?.lineProfile,
    node.geometry?.lineWaves,
    node.geometry?.lineAmplitude
  );
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
  geometry?: LineGeometryish;
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
): LineNodeFields {
  /**
   * Two points is the general case with two vertices in it.
   *
   * Kept as its own named function because every existing caller says "these
   * are the two ends" and should not have to build a list to say it — but the
   * arithmetic below it is the same arithmetic, run once. Two implementations
   * of "what box does this line need" is exactly how the box and the drawing
   * came to disagree the last time.
   */
  return lineNodeFromVertices([a, b], undefined, geometry, strokeWidth);
}

export interface LineNodeFields {
  /**
   * Indexable, because `updateNode` takes a patch rather than a named shape.
   * The alternative at every call site is a cast, which is the same hole with
   * more places to forget it.
   */
  [field: string]: unknown;
  x: number;
  y: number;
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  geometry: ShapeGeometry;
}

/**
 * Everything a line node needs to store, given the run it goes through.
 *
 * The general form of {@link lineNodeFromEndpoints} — see that function's note
 * for why the box is the extent of what is drawn rather than the diagonal
 * between the ends, and why rotation stays zero.
 *
 * A run of two is stored as `a`/`b` with no `vertices`, so drawing an ordinary
 * line produces exactly the node it always did and a document does not grow a
 * field for a feature it is not using. Anything longer, or anything bent,
 * stores the list.
 */
export function lineNodeFromVertices(
  vertices: readonly Point[],
  bends: Bends | undefined,
  geometry: ShapeGeometry,
  strokeWidth = 2
): LineNodeFields {
  const points = vertices.length >= 2 ? [...vertices] : [{ x: 0, y: 0 }, { x: 0, y: 0 }];
  const a = points[0];
  const b = points[points.length - 1];
  const slots = normalizeBends(points.length, bends);
  const bent = slots.some((slot) => slot !== null);
  const multi = isMultiPoint(points);
  const smooth = geometry.smooth === true;

  // The run as drawn, in world space, and the markers that terminate it. A
  // multi-point or bent line takes its shape from its own geometry; only a
  // plain two-point line is handed to the profile. Same rule as `runPoints`,
  // which is what reads the result back.
  const run =
    multi || bent || smooth
      ? polylinePoints(points, slots, smooth)
      : linePoints(a, b, geometry.lineProfile, geometry.lineWaves, geometry.lineAmplitude);
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

  /**
   * `vertices` is written only when it says something `a`/`b` cannot.
   *
   * And when it is not written it is **removed**, not left standing: a
   * five-vertex line reduced back to two would otherwise keep a stale run in
   * `geometry.vertices`, which `localVertices` prefers — so the line would snap
   * back to its old shape the next time anything read it. `undefined` is how
   * this model spells "not set"; `normalize` and the CRDT both drop it.
   */
  const store: ShapeGeometry = {
    ...geometry,
    a: { x: a.x - x, y: a.y - y },
    b: { x: b.x - x, y: b.y - y },
    vertices: multi || bent || smooth ? points.map((p) => ({ x: p.x - x, y: p.y - y })) : undefined,
    bends: bent ? slots.map((slot) => (slot ? { ...slot } : null)) : undefined,
  };
  if (!store.vertices) delete store.vertices;
  if (!store.bends) delete store.bends;

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
    geometry: store,
  };
}

/**
 * A line's geometry, refitted from one box to another.
 *
 * ## The bug this closes
 *
 * A line's points are stored as offsets from its own origin, and its box is
 * derived from them — which is right, and which means a resize that writes the
 * box alone leaves the line the length it was inside a box that is not. The
 * transformer stands down for a *solo* line, so nobody saw it there; a line
 * caught in a multi-object selection, or inside a group being scaled, got a new
 * `width`/`height` and kept its old endpoints. Everything else in the selection
 * grew and the line stayed put, with its own bounding box now several times
 * larger than the mark it drew.
 *
 * `fitPathToBox` has done this for paths since the transform rewrite. This is
 * the same obligation for the other node type whose size lives in its geometry,
 * and it went unnoticed for the same reason it was easy to write for paths: the
 * node that needs it is the one that stores its own shape.
 *
 * ## Why the result is approximate, and why that is fine
 *
 * The box a line reports includes half its stroke on every side and whatever
 * its end caps project. Scaling the points by the box's ratio therefore
 * overstates the run very slightly — by a fraction of the stroke width. The
 * alternative is to invert the cap geometry, which is neither stable nor
 * worth it: the next edit through `lineNodeFromVertices` recomputes an exact
 * box from the points, and the error never accumulates because this measures
 * against the box rather than multiplying a running ratio.
 */
export function fitLineToBox(
  geometry: ShapeGeometry,
  from: { width: number; height: number },
  to: { width: number; height: number }
): ShapeGeometry | null {
  const sx = from.width > 1e-6 ? to.width / from.width : 1;
  const sy = from.height > 1e-6 ? to.height / from.height : 1;
  // Nothing to do, and returning a fresh object anyway would make every
  // unrelated resize write a geometry the CRDT then has to broadcast.
  if (Math.abs(sx - 1) < 1e-9 && Math.abs(sy - 1) < 1e-9) return null;

  const scale = (p: Point): Point => ({ x: p.x * sx, y: p.y * sy });
  const next: ShapeGeometry = { ...geometry };
  if (geometry.vertices?.length) next.vertices = geometry.vertices.map(scale);
  if (geometry.a && geometry.b) {
    next.a = scale(geometry.a);
    next.b = scale(geometry.b);
  }
  /**
   * Bends are left alone, and that is the point of storing them in chord space.
   *
   * A bend is a fraction of its own chord, so a segment that doubles in length
   * keeps a curve of the same *shape*. Stored absolutely they would have to be
   * scaled here too, and non-uniformly — which a quadratic through three points
   * does not survive, since the perpendicular of a stretched chord is not the
   * stretch of its perpendicular.
   */
  return next;
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
