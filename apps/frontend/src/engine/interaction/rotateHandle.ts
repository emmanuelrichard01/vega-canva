/**
 * Rotating a selection from just outside its corners.
 *
 * ## Why the protruding handle went
 *
 * Konva's `Transformer` draws a ninth control on a stalk above the top edge.
 * It is a library default rather than a design: it is not part of the object's
 * geometry, it collides with whatever sits above the selection, and on a small
 * object it is bigger than the thing it belongs to.
 *
 * Figma and Illustrator both do the same thing instead — corner handles only,
 * with rotation living in the ring *just outside* each corner — and the reason
 * it works there is worth stating, because it is also the risk: an invisible
 * hot zone advertises nothing. What makes it discoverable is that the pointer
 * changes the moment you enter it. **The cursor is the affordance**, so this
 * only ships alongside a rotate cursor, and removing the visible handle
 * without one would be a regression dressed as polish.
 *
 * ## Everything here is in world coordinates
 *
 * Invariant 10, taken seriously rather than nodded at. The document stores
 * world coordinates, `cameraSystem.screenToWorld` converts a pointer into
 * them, and the angle between two world points is the same angle at any zoom
 * or pan. So the gesture never touches stage or window space and cannot
 * acquire the ruler-inset error that made the contextual rail wrong for the
 * life of that component.
 *
 * The one screen-space quantity is the *size* of the hit zone, which is a
 * statement about a hand on a screen and is therefore divided by the zoom —
 * invariant 9, the same rule `altDuplicate.travelledEnough` follows.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * How far outside a corner the rotate zone reaches, in screen pixels.
 *
 * ## Why it is this big
 *
 * The zone hangs off the corner outward, and the resize anchor is *also* there:
 * the transformer pads by 4 and draws a 9px anchor centred on that, so the
 * anchor covers roughly the first 8–9px of the zone. The zones are rendered
 * **beneath** the transformer so the anchor wins where they overlap — which is
 * the arbitration Figma and Illustrator have and needs no geometry to
 * maintain — but it means the usable rotate band is `ROTATE_REACH` minus that.
 *
 * At 18 the band was about nine pixels and had to be aimed for. At 26 it is
 * about seventeen, which is a band you fall into rather than hunt for, and it
 * still stops well short of anything a neighbouring object would want.
 */
export const ROTATE_REACH = 26;

/** The reach in world units, for the zoom the board is currently at. */
export function reachAt(zoom: number): number {
  return ROTATE_REACH / Math.max(zoom, 0.0001);
}

/**
 * The four corners of an unrotated box, in the order the zones are built.
 *
 * Clockwise from the top-left, so the index is also the corner's position and
 * the diagonal a zone sits on can be derived rather than tabulated.
 */
export function corners(box: Box): Point[] {
  return [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x + box.width, y: box.y + box.height },
    { x: box.x, y: box.y + box.height },
  ];
}

/**
 * Where each rotate zone sits, in the box's own unrotated frame.
 *
 * A square hung off the corner, outward along both axes, so it occupies the
 * quadrant *outside* the shape and never the inside — a zone that reached
 * inwards would take presses meant for the object.
 */
export function rotateZones(box: Box, reach: number): Box[] {
  return corners(box).map((c) => ({
    x: c.x + (c.x === box.x ? -reach : 0),
    y: c.y + (c.y === box.y ? -reach : 0),
    width: reach,
    height: reach,
  }));
}

/** The angle from `centre` to `point`, in degrees, clockwise from east. */
export function angleOf(centre: Point, point: Point): number {
  return (Math.atan2(point.y - centre.y, point.x - centre.x) * 180) / Math.PI;
}

/** The centre of a box. */
export function centreOf(box: Box): Point {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * The shortest signed way from one angle to another, in (−180, 180].
 *
 * ## The jump this exists to remove
 *
 * `angleOf` is `atan2`, so it returns (−180, 180] and **wraps**. Dragging a
 * rotation across the far side of the object takes the pointer from 179° to
 * −179°, a real step of two degrees that subtracts as *three hundred and
 * fifty-eight* — so the object flipped most of a turn in one frame, every time
 * the gesture crossed the left of the box.
 *
 * That is the "weird jumps" in the report, and it is the classic failure of
 * every angle-driven gesture. It cannot be smoothed away downstream: the value
 * really did change by 358, and any filter fast enough to hide it would be too
 * slow to follow the hand.
 *
 * The fix is to measure each *step* the short way round and accumulate. Which
 * also buys the thing a stateless `current − start` cannot do at all: turning
 * past a full circle. Reading the difference from the start angle caps a
 * gesture at ±180° and then quietly folds it back.
 */
export function angleDelta(from: number, to: number): number {
  let d = (to - from) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/**
 * The rotation a gesture has produced, from the total it has travelled.
 *
 * `snap` is applied to the **result** rather than to the delta. Rounding the
 * delta makes the snap relative to wherever the object already was, so a box
 * sitting at 7° snaps to 7°, 22°, 37° — a grid of its own that lines up with
 * nothing. Rounding the result is what makes Shift mean "square to the world",
 * which is the only reading that is any use.
 */
export function rotationFor(startRotation: number, travelled: number, snap = 0): number {
  const raw = startRotation + travelled;
  if (snap <= 0) return raw;
  return Math.round(raw / snap) * snap;
}

/**
 * Which way the rotate cursor should point, for the corner being held.
 *
 * The glyph is a curved arrow, and a curved arrow has a direction — one drawn
 * at a fixed angle is right at one corner and visibly wrong at the other
 * three. Turning it to the corner's own diagonal, plus the object's rotation,
 * keeps it tangential to the arc the corner will actually travel.
 *
 * Normalised into 0..360 before it is used so a negative object rotation —
 * which is what dragging anticlockwise produces — does not come back negative.
 */
export function rotateCursorAngle(cornerIndex: number, rotationDeg: number): number {
  // Clockwise from the top-left, so each corner is 90° further round.
  const base = [225, 315, 45, 135][cornerIndex] ?? 0;
  return (((base + rotationDeg) % 360) + 360) % 360;
}

/* --------------------------------------------------------------- shearing */

/** Which edge a shear handle sits on, clockwise from the top. */
export type ShearEdge = 'top' | 'right' | 'bottom' | 'left';

export const SHEAR_EDGES: readonly ShearEdge[] = ['top', 'right', 'bottom', 'left'];

/**
 * The bar outside each edge midpoint that shears the selection.
 *
 * ## Why shear needed a gesture at all
 *
 * `skewX`/`skewY` have been on `BaseNode` since before this session, are
 * normalised, are rendered by `ObjectRenderer` through the `tan()` that turns
 * degrees into Konva's coefficient, and have a pair of steppers in the
 * Transform panel. What they did not have was a way to *drag*, which is how
 * anybody actually shears something — the panel is where you go to type an
 * exact number, not to find the slant you want.
 *
 * That is the same shape as the third handle mode: declared, honoured, and
 * reachable only through the least direct route available.
 *
 * ## Why bars on the edges, and not a modifier on the resize handles
 *
 * Illustrator shears by holding a modifier while dragging an edge handle, and
 * that is a better *expert* gesture — but Konva's `Transformer` owns its
 * anchors' drags internally, so intercepting one means fighting the library
 * for the gesture rather than adding to it. That is how the rotation zones
 * ended up being ours, and it is the one part of that which went well.
 *
 * So shear gets its own zones, on the edges, exactly as rotation got its own
 * on the corners. The two are then the same idea at the same distance: the
 * corners turn, the edges slant, and the ring outside the box is where
 * transforms that are not resizes live.
 */
export function shearZones(box: Box, reach: number): Record<ShearEdge, Box> {
  // A bar along the middle half of each edge: long enough to fall into,
  // short enough to leave both corner zones clear at any box size.
  const w = Math.max(box.width / 2, 1);
  const h = Math.max(box.height / 2, 1);
  return {
    top: { x: box.x + box.width / 4, y: box.y - reach, width: w, height: reach },
    bottom: { x: box.x + box.width / 4, y: box.y + box.height, width: w, height: reach },
    left: { x: box.x - reach, y: box.y + box.height / 4, width: reach, height: h },
    right: { x: box.x + box.width, y: box.y + box.height / 4, width: reach, height: h },
  };
}

/** Which skew axis an edge drives, and which way round. */
export function shearAxis(edge: ShearEdge): { key: 'skewX' | 'skewY'; sign: number } {
  // Dragging the *top* edge to the right leans verticals right, which is a
  // positive `skewX`. The bottom edge is the same lean from the other end, so
  // it takes the opposite sign or the object would shear away from the hand.
  return edge === 'top'
    ? { key: 'skewX', sign: 1 }
    : edge === 'bottom'
      ? { key: 'skewX', sign: -1 }
      : edge === 'left'
        ? { key: 'skewY', sign: -1 }
        : { key: 'skewY', sign: 1 };
}

/**
 * The skew a drag has produced, in degrees.
 *
 * `atan` rather than a linear ratio, because skew *is* an angle: the field
 * stores degrees, the renderer takes their tangent, and treating the drag as
 * proportional would make the same hand movement mean different slants at
 * different box sizes — and would run away past 45° where the tangent does.
 *
 * `across` is the box's extent perpendicular to the edge, which is what the
 * lean is measured against: leaning the top of a tall box by ten pixels is a
 * much smaller slant than leaning a short one by the same amount.
 *
 * Clamped to ±89°, matching the panel's steppers. At 90 the tangent is
 * infinite and the object collapses to a line it cannot come back from.
 */
export function shearFor(
  startSkew: number,
  travel: number,
  across: number,
  sign: number,
  snap = 0
): number {
  const safe = Math.max(Math.abs(across), 1);
  const delta = (Math.atan2(travel * sign, safe) * 180) / Math.PI;
  const raw = startSkew + delta;
  const snapped = snap > 0 ? Math.round(raw / snap) * snap : raw;
  return Math.max(-89, Math.min(89, snapped));
}

/** The cursor angle for a shear bar: along the edge it slides. */
export function shearCursorAngle(edge: ShearEdge, rotationDeg: number): number {
  const base = edge === 'top' || edge === 'bottom' ? 0 : 90;
  return (((base + rotationDeg) % 360) + 360) % 360;
}
