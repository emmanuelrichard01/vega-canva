/**
 * The cursor for a handle, given how far the selection has been rotated.
 *
 * ## Why this is computed rather than fixed per corner
 *
 * A resize cursor points along the direction the edge will travel. Rotate the
 * object 90° and the top-left corner now pulls *north-east*, so a fixed
 * `nwse-resize` on that handle points across the drag instead of along it —
 * the arrow and the motion disagree, which is exactly the kind of small wrong
 * that makes a canvas feel imprecise.
 *
 * The eight compass cursors are 45° apart, so the angle only has to be
 * snapped to the nearest eighth of a turn to pick the right one.
 */
const CURSORS = [
  'ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize',
  'ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize',
];

/** Each anchor's outward direction, in degrees clockwise from north. */
const ANCHOR_ANGLE: Record<string, number> = {
  'top-center': 0,
  'top-right': 45,
  'middle-right': 90,
  'bottom-right': 135,
  'bottom-center': 180,
  'bottom-left': 225,
  'middle-left': 270,
  'top-left': 315,
};

export function cursorForAnchor(name: string, rotationDeg: number): string {
  if (name === 'rotater') return 'grab';
  const base = ANCHOR_ANGLE[name];
  if (base === undefined) return 'default';
  // Normalised into 0..360 before snapping, so a negative rotation — which is
  // what dragging anticlockwise produces — does not index off the front.
  const angle = (((base + rotationDeg) % 360) + 360) % 360;
  return CURSORS[Math.round(angle / 45) % 8];
}

/**
 * The handle's outward direction, unsnapped.
 *
 * `cursorForAnchor` above rounds to the nearest of the eight OS cursors,
 * because that is all the OS has. A *drawn* arrow has no such limit, and the
 * rounding is worth losing: on an object turned 20° every handle's arrow is up
 * to 22.5° away from the drag it describes. Same table, same normalisation,
 * one fewer approximation.
 *
 * Returns undefined for a name that is not a handle, so a caller cannot draw an
 * arrow for something that does not resize.
 */
export function anchorAngle(name: string, rotationDeg: number): number | undefined {
  const base = ANCHOR_ANGLE[name];
  if (base === undefined) return undefined;
  return (((base + rotationDeg) % 360) + 360) % 360;
}
