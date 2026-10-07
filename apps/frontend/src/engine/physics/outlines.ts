/**
 * Collision outlines for shapes that are not a plain box or a circle.
 *
 * Only outlines that are convex **and** point-symmetric about the box centre
 * are offered. Matter places a polygon body by its centre of mass, and the
 * simulation reads the box centre back out of that position; for a symmetric
 * outline the two coincide, so no per-body offset has to be carried around.
 * A triangle or a heart would need that offset, and a wrong offset draws the
 * object off its own collision shape, which is worse than a box.
 *
 * Vertices are relative to the box centre, in the object's unrotated frame.
 */

export interface OutlinePoint {
  x: number;
  y: number;
}

const ELLIPSE_SEGMENTS = 20;

/** Even-sided regular polygons are symmetric; odd ones are not. */
const isEvenPolygon = (sides: number) => Number.isInteger(sides) && sides >= 4 && sides % 2 === 0;

export function convexOutline(
  kind: string | undefined,
  points: number | undefined,
  w: number,
  h: number
): OutlinePoint[] | null {
  if (!(w > 0) || !(h > 0)) return null;
  const rx = w / 2;
  const ry = h / 2;

  if (kind === 'diamond') {
    return [
      { x: 0, y: -ry },
      { x: rx, y: 0 },
      { x: 0, y: ry },
      { x: -rx, y: 0 },
    ];
  }

  if (kind === 'polygon') {
    const sides = points ?? 6;
    if (!isEvenPolygon(sides)) return null;
    return Array.from({ length: sides }, (_, i) => {
      const a = (i * 2 * Math.PI) / sides - Math.PI / 2;
      return { x: rx * Math.cos(a), y: ry * Math.sin(a) };
    });
  }

  if (kind === 'ellipse') {
    return Array.from({ length: ELLIPSE_SEGMENTS }, (_, i) => {
      const a = (i * 2 * Math.PI) / ELLIPSE_SEGMENTS;
      return { x: rx * Math.cos(a), y: ry * Math.sin(a) };
    });
  }

  return null;
}
