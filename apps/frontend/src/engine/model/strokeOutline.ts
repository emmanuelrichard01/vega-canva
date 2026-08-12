/**
 * Turning a stroke into a shape.
 *
 * "Outline stroke": the 4px line around a path stops being a line and becomes
 * a 4px-wide filled region you can fill with a gradient, boolean against
 * something else, or pull anchors out of. It is the operation that makes a
 * stroke editable, and there is no way to fake it — a stroke is a rendering
 * instruction, and everything downstream of it wants a region.
 *
 * ## How the region is built
 *
 * Not by offsetting the path. Offsetting is the obvious approach and the wrong
 * one: an offset curve is not a curve of the same family, so it has to be
 * refitted, and on any concave stretch tighter than the stroke is wide the
 * offset crosses itself and has to be un-crossed. Both are delicate, and both
 * fail quietly — as a shape that looks nearly right.
 *
 * Instead the stroke is assembled from primitives that are individually
 * trivial — a quad per segment, a join per corner, a cap per end — and the
 * whole lot is handed to the same clipper the booleans use. Overlaps are what
 * a union is *for*, so every self-intersection resolves itself, and the parts
 * are simple enough to be obviously right.
 *
 * The cost is the same one `pathBoolean` pays and documents: the result is
 * polygonal. A quarter-pixel flattening tolerance means it looks identical and
 * reads as straight segments when opened in the editor.
 */

import * as clipping from 'polygon-clipping';
import type { CompoundGeometry, LineCap, LineJoin, Point, Stroke } from './schema';
import { DEFAULT_MITER_LIMIT } from './schema';
import { flattenPath, subpathsOf, type ContourGeometry } from './pathGeometry';

type Ring = [number, number][];

/** Below this a segment has no direction, so it contributes nothing but a joint. */
const EPS = 1e-9;

/** Ring of a disc, used for round joins and round caps. */
function disc(c: Point, r: number): Ring {
  // Enough sides that the facets stay under the flattening tolerance the rest
  // of the vector engine uses, and never more than a wide stroke needs.
  const sides = Math.min(48, Math.max(8, Math.ceil(r * 2)));
  const ring: Ring = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    ring.push([c.x + r * Math.cos(a), c.y + r * Math.sin(a)]);
  }
  ring.push(ring[0]);
  return ring;
}

function closeRing(points: readonly Point[]): Ring {
  const ring: Ring = points.map((p) => [p.x, p.y]);
  ring.push([points[0].x, points[0].y]);
  return ring;
}

/**
 * The join filling the notch between two segments.
 *
 * Both segments already contribute a quad; on the outer side of a corner those
 * two quads leave a wedge uncovered, and this is what covers it. On the inner
 * side they overlap instead, which the union absorbs — so a join only ever has
 * to think about one side.
 */
function joinRing(
  corner: Point,
  fromDir: Point,
  toDir: Point,
  half: number,
  join: LineJoin,
  miterLimit: number
): Ring | null {
  if (join === 'round') return disc(corner, half);

  // Which side is outside is the side the turn is away from.
  const cross = fromDir.x * toDir.y - fromDir.y * toDir.x;
  if (Math.abs(cross) < EPS) return null; // Straight through: no notch to fill.
  const sign = cross > 0 ? -1 : 1;

  const a = { x: corner.x + sign * -fromDir.y * half, y: corner.y + sign * fromDir.x * half };
  const b = { x: corner.x + sign * -toDir.y * half, y: corner.y + sign * toDir.x * half };

  if (join === 'bevel') return closeRing([corner, a, b]);

  // Miter: extend both offset edges until they meet. The bisector's length is
  // `half / sin(theta/2)`, which is where the miter ratio comes from and why a
  // shallow angle produces an arbitrarily long spike.
  const bx = a.x + b.x - 2 * corner.x;
  const by = a.y + b.y - 2 * corner.y;
  const blen = Math.hypot(bx, by);
  if (blen < EPS) return closeRing([corner, a, b]);
  // The dot of the two unit directions gives cos(pi - theta); the half-angle
  // identity turns that into sin(theta/2) without an inverse trig call.
  const cosTurn = fromDir.x * toDir.x + fromDir.y * toDir.y;
  const sinHalf = Math.sqrt(Math.max(0, (1 - cosTurn) / 2));
  if (sinHalf < EPS) return closeRing([corner, a, b]);
  const miterLength = half / Math.max(EPS, Math.sqrt(Math.max(0, (1 + cosTurn) / 2)));
  // Past the limit the join falls back to a bevel — the same rule every
  // renderer applies, so an outlined stroke matches the stroke it replaced.
  if (miterLength / half > miterLimit) return closeRing([corner, a, b]);
  const tip = { x: corner.x + (bx / blen) * miterLength, y: corner.y + (by / blen) * miterLength };
  return closeRing([corner, a, tip, b]);
}

/** The cap closing one end of an open run. */
function capRing(end: Point, dir: Point, half: number, cap: LineCap): Ring | null {
  if (cap === 'round') return disc(end, half);
  if (cap !== 'square') return null;
  // A square cap is the stroke run on by half its width.
  const nx = -dir.y * half;
  const ny = dir.x * half;
  const tip = { x: end.x + dir.x * half, y: end.y + dir.y * half };
  return closeRing([
    { x: end.x + nx, y: end.y + ny },
    { x: tip.x + nx, y: tip.y + ny },
    { x: tip.x - nx, y: tip.y - ny },
    { x: end.x - nx, y: end.y - ny },
  ]);
}

/**
 * The filled region a stroke covers.
 *
 * Returns `null` for a stroke with no width, or a path with nothing to stroke.
 * The geometry is expected in whatever coordinates the caller wants the answer
 * in — this does no translation of its own.
 */
export function outlineStroke(
  geo: ContourGeometry,
  stroke: Pick<Stroke, 'width' | 'cap' | 'join' | 'miterLimit'>
): CompoundGeometry | null {
  const half = stroke.width / 2;
  if (!(half > 0)) return null;

  const join: LineJoin = stroke.join ?? 'miter';
  const cap: LineCap = stroke.cap ?? 'butt';
  const miterLimit = stroke.miterLimit ?? DEFAULT_MITER_LIMIT;

  const pieces: Ring[][] = [];
  const add = (ring: Ring | null) => {
    if (ring && ring.length > 3) pieces.push([ring]);
  };

  for (const sub of subpathsOf(geo)) {
    const points = flattenPath(sub);
    if (points.length < 2) {
      // A single anchor with a round cap is a dot, which is a legitimate mark;
      // with any other cap it is nothing at all, exactly as a canvas draws it.
      if (points.length === 1 && cap === 'round') add(disc(points[0], half));
      continue;
    }

    const count = sub.closed ? points.length : points.length - 1;
    const dirs: (Point | null)[] = [];
    for (let i = 0; i < count; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < EPS) {
        dirs.push(null);
        continue;
      }
      const dir = { x: dx / len, y: dy / len };
      dirs.push(dir);
      const nx = -dir.y * half;
      const ny = dir.x * half;
      add(
        closeRing([
          { x: a.x + nx, y: a.y + ny },
          { x: b.x + nx, y: b.y + ny },
          { x: b.x - nx, y: b.y - ny },
          { x: a.x - nx, y: a.y - ny },
        ])
      );
    }

    // Joins at every interior corner, plus the closing one when the path
    // closes — which is the corner that would otherwise be the only unjoined
    // one on an outlined rectangle.
    const joints = sub.closed ? count : count - 1;
    for (let i = 0; i < joints; i++) {
      const from = dirs[i];
      const to = dirs[(i + 1) % dirs.length];
      if (!from || !to) continue;
      add(joinRing(points[(i + 1) % points.length], from, to, half, join, miterLimit));
    }

    if (!sub.closed) {
      const first = dirs.find((d) => d);
      const last = [...dirs].reverse().find((d) => d);
      if (first) add(capRing(points[0], { x: -first.x, y: -first.y }, half, cap));
      if (last) add(capRing(points[points.length - 1], last, half, cap));
    }
  }

  if (pieces.length === 0) return null;

  let united: clipping.MultiPolygon;
  try {
    united = clipping.union(pieces[0], ...pieces.slice(1));
  } catch {
    return null;
  }

  const subpaths = united
    .flat()
    .map((ring) => ring.slice(0, -1).map(([x, y]) => ({ x, y })))
    .filter((p) => p.length >= 3)
    .map((p) => ({
      kind: 'bezier' as const,
      segments: p.map((q) => ({ x: q.x, y: q.y })),
      closed: true,
    }));

  return subpaths.length > 0 ? { kind: 'compound', subpaths } : null;
}
