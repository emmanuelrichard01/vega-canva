/**
 * Rounding the elbows of a routed connector.
 *
 * ## Why a path rather than a line property
 *
 * The run is drawn as a Konva `Line`, which has no per-corner radius — Konva
 * rounds a *shape's* corners, not a polyline's joins. So a rounded elbow has to
 * be built as a path: each corner becomes a quadratic whose control point is
 * the corner itself, which is the same construction a rounded rectangle uses
 * and is exact for the right angles an orthogonal route is made of.
 *
 * ## Why the radius is per corner rather than global
 *
 * A route's segments are whatever the layout gave it, and two of them are
 * frequently short — an elbow a few units from a box's edge is ordinary. A
 * fixed radius on a segment shorter than twice that radius would consume the
 * whole segment and the next corner would start before the previous one
 * finished, which draws as a knot.
 *
 * So each corner takes the radius it can afford: half the shorter of its two
 * segments, capped at the requested amount. A tight elbow rounds a little, a
 * generous one rounds fully, and no corner ever borrows from its neighbour.
 */

/** Flat `[x, y, x, y, …]`, the form Konva's `Line` and this codebase both use. */
export type FlatPoints = readonly number[];

/**
 * A polyline as an SVG path, with its corners rounded.
 *
 * Returns `''` when there is nothing to draw, and a plain `M…L…` run when the
 * radius is zero — so a caller can use the result unconditionally rather than
 * branching on whether rounding was asked for.
 *
 * Collinear corners are passed through as line joins rather than rounded: a
 * "corner" of 180° has no arc, and constructing one puts a zero-length
 * quadratic in the path that some renderers draw as a dot.
 */
export function roundedPolyline(points: FlatPoints, radius: number): string {
  const n = Math.floor(points.length / 2);
  if (n < 2) return '';

  const at = (i: number) => ({ x: points[i * 2], y: points[i * 2 + 1] });

  if (!(radius > 0) || n === 2) {
    const parts = [`M${at(0).x} ${at(0).y}`];
    for (let i = 1; i < n; i += 1) parts.push(`L${at(i).x} ${at(i).y}`);
    return parts.join(' ');
  }

  const parts = [`M${at(0).x} ${at(0).y}`];

  for (let i = 1; i < n - 1; i += 1) {
    const prev = at(i - 1);
    const corner = at(i);
    const next = at(i + 1);

    const inLength = Math.hypot(corner.x - prev.x, corner.y - prev.y);
    const outLength = Math.hypot(next.x - corner.x, next.y - corner.y);
    if (inLength === 0 || outLength === 0) continue;

    // Unit vectors away from the corner, along each segment.
    const inX = (prev.x - corner.x) / inLength;
    const inY = (prev.y - corner.y) / inLength;
    const outX = (next.x - corner.x) / outLength;
    const outY = (next.y - corner.y) / outLength;

    /**
     * A straight-through corner is not a corner.
     *
     * The two unit vectors point in opposite directions, so their dot product
     * is -1. Rounding one would put a zero-length quadratic in the path, which
     * some renderers draw as a dot on an otherwise clean line.
     */
    if (inX * outX + inY * outY < -0.9999) continue;

    // Half the shorter segment is the most this corner can take without
    // reaching past the next one; the request caps it from the other side.
    const r = Math.min(radius, inLength / 2, outLength / 2);
    if (!(r > 0)) continue;

    const enterX = corner.x + inX * r;
    const enterY = corner.y + inY * r;
    const leaveX = corner.x + outX * r;
    const leaveY = corner.y + outY * r;

    parts.push(`L${round(enterX)} ${round(enterY)}`);
    // The corner itself is the control point: for a right angle this is the
    // exact quarter-circle a rounded rectangle draws.
    parts.push(`Q${round(corner.x)} ${round(corner.y)} ${round(leaveX)} ${round(leaveY)}`);
  }

  const last = at(n - 1);
  parts.push(`L${round(last.x)} ${round(last.y)}`);
  return parts.join(' ');
}

/** Trimmed to a tenth of a unit — no renderer resolves finer, and it halves the string. */
function round(n: number): number {
  return Math.round(n * 10) / 10;
}
