/**
 * Connectors: lines that know what they are attached to.
 *
 * The distinction that makes this a system rather than a shape is that a
 * connector stores **which objects it joins**, not where its ends happen to
 * be. Move a box and the arrow follows, because the arrow never knew a
 * coordinate to begin with — it knows a node id and a side, and its geometry
 * is derived on every read.
 *
 * Everything here is pure: boxes in, points out. It has no idea what a Y.Map
 * is, which is what lets the routing be reasoned about and tested at all —
 * routing bugs are close to invisible on screen, because a wrong path still
 * looks like *a* path.
 */

import { anchorPoint, anchorPort, type Anchor } from './connectorAnchor';

/** The four sides an end can attach to, plus "work it out". */
export type Port = 'top' | 'right' | 'bottom' | 'left' | 'auto';

export interface ConnectorEnd {
  /**
   * The object this end is bound to.
   *
   * Absent means the end is loose and `x`/`y` hold it. Both are stored so an
   * end can be *detached* — when the object it pointed at is deleted, the
   * connector freezes where it was rather than vanishing or dangling at the
   * origin.
   */
  nodeId?: string;
  port?: Port;
  /**
   * An exact spot on the object, in its own proportions — see
   * `connectorAnchor.ts`. Takes precedence over `port`, which is the four
   * edge midpoints and `auto`.
   *
   * Three fields for one question looks like two too many, and each earns its
   * place: `auto` is the only one that keeps choosing a sensible side as
   * things move, a named port says something a reader of the document can
   * understand at a glance, and an anchor is the only one that can express
   * *here*. Precedence is checked in one function, `resolveEnd`, so no reader
   * has to know the order.
   */
  anchor?: Anchor;
  x?: number;
  y?: number;
}

export type Routing = 'straight' | 'orthogonal' | 'curved';

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** The attachment point for one side of a box. */
export function portPoint(box: Box, port: Exclude<Port, 'auto'>): Point {
  const midX = box.x + box.width / 2;
  const midY = box.y + box.height / 2;
  switch (port) {
    case 'top': return { x: midX, y: box.y };
    case 'bottom': return { x: midX, y: box.y + box.height };
    case 'left': return { x: box.x, y: midY };
    case 'right': return { x: box.x + box.width, y: midY };
  }
}

/** The direction a line leaves a port, as a unit vector. */
export function portNormal(port: Exclude<Port, 'auto'>): Point {
  switch (port) {
    case 'top': return { x: 0, y: -1 };
    case 'bottom': return { x: 0, y: 1 };
    case 'left': return { x: -1, y: 0 };
    case 'right': return { x: 1, y: 0 };
  }
}

/**
 * Which sides two boxes should use when nobody has chosen.
 *
 * Picked from the **dominant axis of the gap between them**, not from the
 * distance between centres. Two boxes side by side but vertically offset
 * should still join right-to-left; choosing by centre distance flips them to
 * top/bottom as soon as the offset exceeds the horizontal gap, which makes a
 * diagram visibly reorganise itself while you drag something a few pixels.
 */
export function autoPorts(from: Box, to: Box): { from: Exclude<Port, 'auto'>; to: Exclude<Port, 'auto'> } {
  // Signed gaps: positive means the boxes are clear of each other on that axis.
  const gapLeft = from.x - (to.x + to.width);
  const gapRight = to.x - (from.x + from.width);
  const gapAbove = from.y - (to.y + to.height);
  const gapBelow = to.y - (from.y + from.height);

  const horizontal = Math.max(gapLeft, gapRight);
  const vertical = Math.max(gapAbove, gapBelow);

  if (horizontal >= vertical) {
    return gapRight >= gapLeft
      ? { from: 'right', to: 'left' }
      : { from: 'left', to: 'right' };
  }
  return gapBelow >= gapAbove
    ? { from: 'bottom', to: 'top' }
    : { from: 'top', to: 'bottom' };
}

/**
 * How far back from a corner an elbow starts to turn.
 *
 * Small on purpose. This is a softened corner, not a curve -- past about 12px
 * an orthogonal connector stops reading as orthogonal, and the right angles
 * are what make a flowchart scan as a flowchart.
 */
export const ELBOW_RADIUS = 8;

/** How many points each turn is sampled into. Four is smooth at any zoom a
 *  connector is read at, and keeps the point list short enough that bounds
 *  and hit-testing stay cheap. */
const ELBOW_STEPS = 4;

/**
 * Round the corners of a polyline, by inserting points rather than by
 * switching to arcs.
 *
 * ## Why sampled points and not a `Path`
 *
 * The same reason `routeCurved` samples: the point list *is* the geometry
 * here. `connectorBounds`, hit-testing, the radar and the board thumbnail all
 * read it, and none of them would know about a `Q` command hidden in an SVG
 * path string. A rounded corner drawn only in the renderer would be a shape
 * the rest of the system could not see -- clicks would miss it and its box
 * would be wrong.
 *
 * ## The clamp
 *
 * The radius is cut to just under half of the shorter adjacent segment. Two
 * corners on one short segment would otherwise each eat more than half of it,
 * cross over, and turn the elbow inside out -- which is the failure mode of
 * every naive corner-rounder.
 */
export function roundCorners(points: Point[], radius = ELBOW_RADIUS): Point[] {
  if (points.length < 3 || radius <= 0) return points;

  const out: Point[] = [points[0]];

  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const corner = points[i];
    const next = points[i + 1];

    const inLen = Math.hypot(corner.x - prev.x, corner.y - prev.y);
    const outLen = Math.hypot(next.x - corner.x, next.y - corner.y);
    // 0.49 rather than 0.5: two corners sharing a segment must not meet
    // exactly at its midpoint, where the arcs would touch and flatten.
    const r = Math.min(radius, inLen * 0.49, outLen * 0.49);
    if (!(r > 0.5)) {
      out.push(corner);
      continue;
    }

    const start = {
      x: corner.x + ((prev.x - corner.x) / inLen) * r,
      y: corner.y + ((prev.y - corner.y) / inLen) * r,
    };
    const end = {
      x: corner.x + ((next.x - corner.x) / outLen) * r,
      y: corner.y + ((next.y - corner.y) / outLen) * r,
    };

    // A quadratic through the corner: the corner is the control point, which
    // is what makes the turn tangent to both segments without any angle maths.
    out.push(start);
    for (let step = 1; step < ELBOW_STEPS; step++) {
      const t = step / ELBOW_STEPS;
      const u = 1 - t;
      out.push({
        x: u * u * start.x + 2 * u * t * corner.x + t * t * end.x,
        y: u * u * start.y + 2 * u * t * corner.y + t * t * end.y,
      });
    }
    out.push(end);
  }

  out.push(points[points.length - 1]);
  return out;
}

/**
 * An orthogonal route between two ports.
 *
 * Deliberately simple and predictable rather than a full obstacle-avoiding
 * router. A diagram tool's connectors are read constantly and adjusted
 * constantly, and a clever router that finds a *different* clever answer each
 * time something nudges is worse than a plain one whose behaviour you can
 * predict and work with. Three segments cover the cases people actually draw;
 * the elbow sits at the midpoint of the gap so two parallel connectors between
 * the same pair of boxes do not overlap along their whole length.
 */
export function routeOrthogonal(
  a: Point,
  b: Point,
  fromPort: Exclude<Port, 'auto'>,
  toPort: Exclude<Port, 'auto'>
): Point[] {
  const fromHorizontal = fromPort === 'left' || fromPort === 'right';
  const toHorizontal = toPort === 'left' || toPort === 'right';

  if (fromHorizontal && toHorizontal) {
    const midX = (a.x + b.x) / 2;
    return [a, { x: midX, y: a.y }, { x: midX, y: b.y }, b];
  }
  if (!fromHorizontal && !toHorizontal) {
    const midY = (a.y + b.y) / 2;
    return [a, { x: a.x, y: midY }, { x: b.x, y: midY }, b];
  }
  // One of each: a single elbow, turned at the corner that keeps both ends
  // leaving their own port along its own normal.
  return fromHorizontal ? [a, { x: b.x, y: a.y }, b] : [a, { x: a.x, y: b.y }, b];
}

/**
 * Which side of a box faces a bare point.
 *
 * The companion to `autoPorts` for the case where the other end is not a box
 * at all — a loose end, or one that was detached when its object was deleted.
 * `autoPorts` needs two boxes to measure a gap between; this needs only a
 * direction.
 *
 * The offsets are divided by the box's half-extents before being compared, so
 * the choice is made in the box's own proportions. A wide, short box has a
 * point slightly above it *and* far to the side; comparing raw offsets would
 * pick the side, when the honest answer — the edge that point is actually
 * closest to crossing — is the top.
 */
export function portFacing(box: Box, target: Point): Exclude<Port, 'auto'> {
  const halfW = Math.max(1, box.width / 2);
  const halfH = Math.max(1, box.height / 2);
  const dx = target.x - (box.x + halfW);
  const dy = target.y - (box.y + halfH);

  if (Math.abs(dx) / halfW >= Math.abs(dy) / halfH) {
    return dx >= 0 ? 'right' : 'left';
  }
  return dy >= 0 ? 'bottom' : 'top';
}

/**
 * Resolve an end to a point, given whatever it is attached to.
 *
 * `boxOf` is injected rather than reading a store, so this stays pure and the
 * caller decides where boxes come from — the live document, a Time Travel
 * snapshot, or a test.
 */
export function resolveEnd(
  end: ConnectorEnd,
  other: Box | null,
  boxOf: (id: string) => Box | null,
  /**
   * Where the other end is when it is *not* a box — a loose end, or one
   * detached by deleting the object it held. Without this the port choice had
   * no information to work from and fell back to a fixed `'right'`, so an
   * arrow coming from the left entered a box's left edge, carried on through
   * the interior and put its head on the far side.
   */
  otherPoint: Point | null = null,
  /**
   * Where a box-derived point really lands on the object.
   *
   * Optional and last, so every existing caller and every test keeps the
   * answer it had. A triangle's box has a left-middle in empty air and a star
   * has four of them; landing an arrow there is the difference between a
   * diagram that looks drawn and one that looks approximated. Rotation lives
   * in here too — this module works in the node's own frame and lets the
   * callback put the point where the object actually is. Absent, or returning
   * null, means the box point stands. See `connectorTargets.attachLookup`.
   */
  attachOf: ((id: string, boxPoint: Point) => Point | null) | null = null
): { point: Point; port: Exclude<Port, 'auto'>; box: Box | null } {
  const box = end.nodeId ? boxOf(end.nodeId) : null;
  const explicit = end.port && end.port !== 'auto' ? end.port : null;

  // An anchor is the most specific thing an end can say, so it is checked
  // before either of the others. It is meaningless without a box — a loose end
  // has no proportions to be a ratio of — so it falls through when the object
  // is gone, and the stored coordinate takes over exactly as it does for a
  // detached port.
  if (box && end.anchor) {
    return {
      point: onOutline(anchorPoint(box, end.anchor), box, end.nodeId, attachOf),
      port: anchorPort(end.anchor),
      box,
    };
  }
  // Wherever the far end is, however it is expressed.
  const away =
    other ? { x: other.x + other.width / 2, y: other.y + other.height / 2 } : otherPoint;

  // Loose, or bound to something that no longer exists: fall back to the
  // stored coordinate, which is what detaching writes.
  if (!box) {
    const point = { x: end.x ?? 0, y: end.y ?? 0 };
    return {
      point,
      // A loose end has no sides, but the route still needs to know which way
      // it leaves. Facing whatever it joins keeps the first segment pointing
      // at the destination rather than always setting off to the right.
      port: explicit ?? (away ? portFacing({ ...point, width: 0, height: 0 }, away) : 'right'),
      box: null,
    };
  }

  const port =
    explicit ?? (other ? autoPorts(box, other).from : away ? portFacing(box, away) : 'right');

  return { point: onOutline(portPoint(box, port), box, end.nodeId, attachOf), port, box };
}

/**
 * Move a box-derived point onto the shape actually drawn inside that box.
 *
 * Everything about this is a fallback: no lookup, no outline, or a ray that
 * finds nothing all return the point unchanged. It can improve the answer and
 * it cannot break it, which is what makes it safe to apply on every resolve.
 */
function onOutline(
  point: Point,
  _box: Box,
  nodeId: string | undefined,
  attachOf: ((id: string, boxPoint: Point) => Point | null) | null
): Point {
  if (!attachOf || !nodeId) return point;
  return attachOf(nodeId, point) ?? point;
}

/** The full route for a connector, as a flat Konva points array. */
export function connectorPoints(
  from: ConnectorEnd,
  to: ConnectorEnd,
  routing: Routing,
  boxOf: (id: string) => Box | null,
  /** See `resolveEnd`. Optional; absent means the box is the answer. */
  attachOf: ((id: string, boxPoint: Point) => Point | null) | null = null
): number[] {
  const fromBox = from.nodeId ? boxOf(from.nodeId) : null;
  const toBox = to.nodeId ? boxOf(to.nodeId) : null;

  // An end with no box is a bare coordinate, and that coordinate is known
  // without resolving anything — so each end can be told where the other one
  // is even when the other one is not an object.
  const fromLoose = fromBox ? null : { x: from.x ?? 0, y: from.y ?? 0 };
  const toLoose = toBox ? null : { x: to.x ?? 0, y: to.y ?? 0 };

  const a = resolveEnd(from, toBox, boxOf, toLoose, attachOf);
  const b = resolveEnd(to, fromBox, boxOf, fromLoose, attachOf);

  const path =
    routing === 'orthogonal'
      ? // Softened at the turns. The rounding inserts points rather than
        // drawing arcs, so bounds, hit-testing, the radar and export all keep
        // seeing the same geometry the renderer draws.
        roundCorners(routeOrthogonal(a.point, b.point, a.port, b.port))
      : routing === 'curved'
        ? routeCurved(a.point, b.point, a.port, b.port)
        : [a.point, b.point];

  return path.flatMap((p) => [p.x, p.y]);
}

/**
 * Points along a curve that leaves each end along its own port normal.
 *
 * ## Why this exists at all
 *
 * "Curved" drew a **straight line**. `connectorPoints` returned just the two
 * endpoints for it, and the renderer then asked Konva for `tension` — but
 * tension is smoothing *between* points, and there is nothing to smooth
 * between two of them. So the third routing mode was, in every case, identical
 * to the first.
 *
 * ## Why the curve is sampled here rather than left to Konva
 *
 * Konva's tension would bend the line, but it bends it around wherever the
 * points happen to be, with no idea which side of a box the line is leaving.
 * A curve that exits a box's right edge heading *left* looks like a mistake,
 * and that is what a generic smoothing gives you half the time.
 *
 * A cubic Bézier whose control points sit along each port's own normal always
 * leaves and arrives perpendicular to the edge it touches — the way a curved
 * connector is drawn in every diagramming tool. Sampling it into points keeps
 * the whole system honest: `connectorBounds`, hit-testing, the radar and the
 * board thumbnail all read the same point list, and none of them would know
 * how to account for a curve that only existed as a rendering flag.
 */
export function routeCurved(
  a: Point,
  b: Point,
  fromPort: Exclude<Port, 'auto'>,
  toPort: Exclude<Port, 'auto'>
): Point[] {
  const na = portNormal(fromPort);
  const nb = portNormal(toPort);
  const reachA = curveTension(a, b, na, nb);
  const reachB = curveTension(b, a, nb, na);

  const c1 = { x: a.x + na.x * reachA, y: a.y + na.y * reachA };
  const c2 = { x: b.x + nb.x * reachB, y: b.y + nb.y * reachB };

  /**
   * Enough segments that the curve reads as smooth at a sensible zoom, few
   * enough that a board of connectors is not thousands of points. The line is
   * re-sampled at a fixed count rather than adaptively: a point count that
   * changed with length would make `connectorBounds` — and therefore culling —
   * jitter while an endpoint is dragged.
   */
  const STEPS = 24;
  const points: Point[] = [];
  for (let i = 0; i <= STEPS; i += 1) {
    const t = i / STEPS;
    const u = 1 - t;
    // Cubic Bézier, written out rather than looped: three multiplies beats a
    // de Casteljau loop at this size and says plainly what it is.
    points.push({
      x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x,
      y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y,
    });
  }
  return points;
}

/**
 * How far a curved connector's control points reach from each end.
 *
 * Proportional to the span so a short link stays tight and a long one bows,
 * and capped so a connector across the whole board does not loop out of it.
 */
export function curveTension(a: Point, b: Point, na?: Point, _nb?: Point): number {
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  if (!na) {
    return Math.min(160, Math.max(30, dist * 0.4));
  }
  const dx = (b.x - a.x) / (dist || 1);
  const dy = (b.y - a.y) / (dist || 1);
  const alignA = na.x * dx + na.y * dy;
  const factor = alignA > 0 ? 0.38 : 0.28;
  return Math.min(160, Math.max(24, dist * factor));
}

/**
 * The bounding box a connector occupies.
 *
 * A connector's `width`/`height` on the base node are derived, never authored
 * — but they still have to be *correct*, because culling, the radar and
 * marquee selection all read them. A stale box is an arrow that disappears
 * when it scrolls past the edge of the viewport.
 */
export function connectorBounds(points: number[]): Box {
  if (points.length < 2) return { x: 0, y: 0, width: 1, height: 1 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < points.length; i += 2) {
    minX = Math.min(minX, points[i]);
    maxX = Math.max(maxX, points[i]);
    minY = Math.min(minY, points[i + 1]);
    maxY = Math.max(maxY, points[i + 1]);
  }
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}
