import type { Point } from './connector';

/**
 * What sits at the end of a connector.
 *
 * ## Why more than an arrow
 *
 * A connector had one expressive knob per end: arrowhead on, or off. That is
 * enough to say "this leads to that" and nothing else — and the moment a
 * diagram has more than one *kind* of relationship in it, every line looks the
 * same. The shapes below are the vocabulary every diagramming notation
 * actually uses:
 *
 *  - **Arrow** — direction. The default, and the only one that was here.
 *  - **Triangle** — a filled, heavier direction marker; UML generalisation.
 *  - **Circle** — an endpoint or a state, and the usual "this attaches here"
 *    marker on a flowchart.
 *  - **Diamond** — containment or aggregation, straight out of UML.
 *  - **Bar** — a terminator: the line stops here, it does not point anywhere.
 *
 * ## Why the geometry is here and not in the renderer
 *
 * The markers are needed in more than one place — the canvas draws them, and
 * anything that measures a connector has to know they extend past the line's
 * last point. Computing them from the tip and a direction keeps every caller
 * agreeing about where a marker actually is, rather than the renderer knowing
 * and everything else guessing.
 */
export type EndCapKind = 'none' | 'arrow' | 'triangle' | 'circle' | 'diamond' | 'bar';

export const END_CAP_KINDS: EndCapKind[] = ['none', 'arrow', 'triangle', 'circle', 'diamond', 'bar'];

export const END_CAP_LABELS: Record<EndCapKind, string> = {
  none: 'None',
  arrow: 'Arrow',
  triangle: 'Triangle',
  circle: 'Circle',
  diamond: 'Diamond',
  bar: 'Bar',
};

/** How a marker is painted: an outline, or a solid. */
export interface EndCapShape {
  /** Closed polygon in world space, or null when the marker is a circle. */
  points: number[] | null;
  /** Present instead of `points` for the round marker. */
  circle: { x: number; y: number; radius: number } | null;
  /** Whether the shape is filled with the line colour or left open. */
  filled: boolean;
  /**
   * How far back along the line the marker occupies.
   *
   * The run has to stop short by this much, or a solid marker is drawn on top
   * of the line it terminates and the two blur into one blob at small sizes.
   */
  inset: number;
}

/** The size of a marker for a given stroke weight. */
/** The range the end-size control offers, as a multiple of the derived size. */
export const MIN_END_SCALE = 0.5;
export const MAX_END_SCALE = 4;

/**
 * How big a marker is, from the stroke it terminates and the user's own scale.
 *
 * Proportional by default, with a floor: a marker that scales all the way down
 * with a hairline stroke stops being identifiable as a shape at all.
 *
 * `scale` is the part a person controls. Deriving the size from stroke weight
 * alone is right most of the time and wrong in the two cases people care about
 * — a diagram whose arrows need to read at a glance across a wall, and a thick
 * decorative line whose head swamps it. A multiplier keeps the proportional
 * default and lets those two be fixed without touching the stroke.
 */
export function endCapSize(strokeWidth: number, scale = 1): number {
  return Math.max(8, strokeWidth * 3.2) * scale;
}

/**
 * Build the marker at `tip`, pointing along `angle` (radians, outward).
 *
 * `angle` is the direction the line is *travelling* as it arrives, so every
 * shape below is described in that frame and rotated once at the end. Writing
 * each one out in absolute coordinates instead is how a diamond ends up
 * correct on a horizontal connector and sideways on a vertical one.
 */
export function endCapShape(kind: EndCapKind, tip: Point, angle: number, size: number): EndCapShape | null {
  if (kind === 'none') return null;

  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  /** Local (along, across) → world, with `along` pointing back down the line. */
  const at = (along: number, across: number): [number, number] => [
    tip.x - along * cos - across * sin,
    tip.y - along * sin + across * cos,
  ];

  switch (kind) {
    case 'arrow': {
      // An open V, drawn as a polygon with a notch so it reads as a barb
      // rather than a solid triangle at any weight.
      const [x1, y1] = at(size, size * 0.45);
      const [x2, y2] = at(size * 0.7, 0);
      const [x3, y3] = at(size, -size * 0.45);
      return {
        points: [tip.x, tip.y, x1, y1, x2, y2, x3, y3],
        circle: null,
        filled: true,
        inset: size * 0.7,
      };
    }
    case 'triangle': {
      const [x1, y1] = at(size, size * 0.5);
      const [x2, y2] = at(size, -size * 0.5);
      return {
        points: [tip.x, tip.y, x1, y1, x2, y2],
        circle: null,
        filled: true,
        inset: size,
      };
    }
    case 'diamond': {
      const half = size * 0.42;
      const [x1, y1] = at(size * 0.5, half);
      const [x2, y2] = at(size, 0);
      const [x3, y3] = at(size * 0.5, -half);
      return {
        points: [tip.x, tip.y, x1, y1, x2, y2, x3, y3],
        circle: null,
        filled: true,
        inset: size,
      };
    }
    case 'circle': {
      const radius = size * 0.36;
      // Centred one radius back, so the circle *touches* the endpoint rather
      // than straddling it — which is what makes it read as sitting on the
      // edge of the box rather than overlapping into it.
      const [cx, cy] = at(radius, 0);
      return {
        points: null,
        circle: { x: cx, y: cy, radius },
        filled: true,
        inset: radius * 2,
      };
    }
    case 'bar': {
      const half = size * 0.5;
      const [x1, y1] = at(0, half);
      const [x2, y2] = at(0, -half);
      // Open, not filled: a bar is a stroke across the line, and filling a
      // two-point polygon paints nothing.
      return { points: [x1, y1, x2, y2], circle: null, filled: false, inset: 0 };
    }
    default:
      return null;
  }
}

/** The direction the line is travelling at an end, in radians. */
export function endAngle(points: number[], atStart: boolean): number {
  if (points.length < 4) return 0;
  if (atStart) {
    // From the second point back toward the first — the outward direction.
    return Math.atan2(points[1] - points[3], points[0] - points[2]);
  }
  const n = points.length;
  return Math.atan2(points[n - 1] - points[n - 3], points[n - 2] - points[n - 4]);
}

/**
 * The length of a polyline, in world units.
 *
 * Every question below is really a question about how much *line* there is,
 * and the last segment is not that — a curved route is sampled into two dozen
 * steps, so its final segment is a couple of units long however far the
 * connector actually travels.
 */
export function polylineLength(points: number[]): number {
  let total = 0;
  for (let i = 2; i < points.length; i += 2) {
    total += Math.hypot(points[i] - points[i - 2], points[i + 1] - points[i - 1]);
  }
  return total;
}

/**
 * How much of the run one marker is allowed to take.
 *
 * Both ends can be at the maximum at once, so this leaves a fifth of the line
 * showing in the worst case. Without a cap, End size at 400% on two adjacent
 * boxes produces a marker longer than the connector: the trim gives up, the
 * head is drawn over the whole line and into both shapes, and what is left to
 * click is a stub. A control whose top setting destroys the object is not a
 * range, it is a trap.
 */
const MAX_CAP_SHARE = 0.4;

/**
 * Pull a polyline back from one end by `inset`, walking across segments.
 *
 * ## Why this is not one interpolation
 *
 * It used to be. The renderer moved the final point toward its neighbour and
 * gave up when the *last segment* was shorter than the marker — which is not
 * an edge case, it is the normal case for two of the three routings:
 *
 *  - **Curved** routes are sampled into 24 steps, so the last segment is a
 *    couple of units. It was therefore *never* trimmed, at any size, and every
 *    curved connector has always drawn its line through its own arrowhead.
 *  - **Orthogonal** routes end with a leg half the gap between the boxes, so
 *    a marker larger than that leg silently stopped being trimmed — which is
 *    exactly what raising End size does.
 *
 * Walking back across segments removes the special case: the marker's depth is
 * consumed from however many segments it spans, intermediate points inside it
 * are dropped, and the boundary point is interpolated.
 */
export function trimPolyline(points: number[], inset: number, atStart: boolean): number[] {
  if (inset <= 0 || points.length < 4) return points.slice();

  // Walk from the end being trimmed toward the other one. Reversing rather
  // than writing the loop twice, because two nearly-identical index dances is
  // how one of them ends up subtly wrong.
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < points.length; i += 2) pairs.push([points[i], points[i + 1]]);
  const walk = atStart ? pairs : pairs.slice().reverse();

  let remaining = inset;
  let cut = 0;
  let boundary: [number, number] | null = null;

  for (let i = 1; i < walk.length; i += 1) {
    const [ax, ay] = walk[i - 1];
    const [bx, by] = walk[i];
    const len = Math.hypot(bx - ax, by - ay);
    if (len === 0) {
      cut = i;
      continue;
    }
    if (len >= remaining) {
      const t = remaining / len;
      boundary = [ax + (bx - ax) * t, ay + (by - ay) * t];
      cut = i;
      break;
    }
    remaining -= len;
    cut = i;
  }

  // The inset swallowed the whole run. Refusing to trim is the honest answer —
  // a zero-length line is not a shorter line, it is nothing to click — and it
  // cannot happen once the size is capped, which is why this is a guard rather
  // than a behaviour.
  if (!boundary) return points.slice();

  // The boundary becomes the new end, and everything from the cut inward is
  // kept as it was. Overwriting `walk[cut]` instead would delete a real corner
  // — the point the trim stopped *before* is still part of the route.
  const kept: Array<[number, number]> = [boundary, ...walk.slice(cut)];
  const ordered = atStart ? kept : kept.slice().reverse();
  return ordered.flat();
}

/**
 * Both markers for a connector, sized against the run they terminate.
 *
 * One function so the renderer and the bounds it stores cannot disagree about
 * how big a marker is — and they did: the box was computed from the route
 * alone, while an arrowhead extends *sideways* out of it. On a horizontal
 * connector the stored box is one unit tall and a 400% head is thirty-two, so
 * the arrow was culled while its head was still on screen, and a marquee drawn
 * over that head selected nothing.
 */
export function connectorCaps(
  points: number[],
  spec: { start: EndCapKind; end: EndCapKind; strokeWidth: number; scale?: number }
): { start: EndCapShape | null; end: EndCapShape | null; size: number } {
  const run = polylineLength(points);
  const size = Math.min(endCapSize(spec.strokeWidth, spec.scale ?? 1), Math.max(1, run * MAX_CAP_SHARE));
  if (points.length < 4) return { start: null, end: null, size };
  return {
    start: endCapShape(spec.start, { x: points[0], y: points[1] }, endAngle(points, true), size),
    end: endCapShape(
      spec.end,
      { x: points[points.length - 2], y: points[points.length - 1] },
      endAngle(points, false),
      size
    ),
    size,
  };
}

/**
 * Every point a marker occupies, flat, for feeding to `connectorBounds`.
 *
 * A circle contributes its bounding square rather than its outline: four
 * points describe the extent exactly, and sampling a circle to get a box is
 * work in exchange for nothing.
 */
export function capExtentPoints(cap: EndCapShape | null): number[] {
  if (!cap) return [];
  if (cap.circle) {
    const { x, y, radius } = cap.circle;
    return [x - radius, y - radius, x + radius, y + radius];
  }
  return cap.points ?? [];
}

/**
 * How a marker meets the end of the run it terminates.
 *
 * Illustrator's two arrowhead alignments, and the reason it has two is that
 * neither is right for every case:
 *
 *  - **`inside`** puts the marker's *tip* on the path's last point, so the
 *    head sits entirely within the line's original length. Right for a
 *    straight line, where "the arrow ends here" is the whole statement and
 *    nothing is lost by giving the last few pixels to the head.
 *
 *  - **`extend`** keeps the path at full length and projects the marker
 *    *outward* along the terminal tangent, so the run finishes flush against
 *    the back of the head. Right for anything with a shape to preserve: a
 *    wave, a zigzag or a coil trimmed by a head loses a crest or a corner at
 *    exactly the end you are looking at, and a shortened zigzag stops
 *    mid-stroke.
 */
export type EndAlign = 'inside' | 'extend';

/**
 * Where a marker goes for a given alignment, and what is left of the run.
 *
 * One function because three surfaces need the same answer — the canvas, the
 * SVG exporter and the toolbar specimen — and a head placed by three separate
 * pieces of arithmetic is three chances to disagree about where the tip is.
 * That has already happened once here: the exporter oriented its heads along
 * the box diagonal while the canvas used the true tangent.
 *
 * The terminal tangent is taken from the run's last segment, which is what
 * SVG's `orient="auto"` means and what has to be computed by hand when the
 * marker is a polygon rather than a `<marker>` element.
 */
export function terminateRun(
  points: number[],
  spec: {
    start: EndCapKind;
    end: EndCapKind;
    strokeWidth: number;
    scale?: number;
    align?: EndAlign;
    /**
     * Point the caps along the run's **axis** rather than its last segment.
     *
     * For a straight or gently curved run the two are the same thing, and the
     * last segment is the better answer — it follows the curve. For a *profile*
     * they are not: a sine crosses its own axis at the steepest part of the
     * wave, so a wavy line arrives at its endpoint travelling **55° off** the
     * direction it is actually going, and a zigzag 44°. An arrowhead cocked
     * fifty-five degrees away from the line it terminates is the "the arrow
     * looks broken" complaint, and it is not a matter of taste: the head states
     * where the line *goes*, which is A to B, and the wave is a texture on the
     * way.
     *
     * The coil has always done this by accident — it enters and leaves on flat
     * leads, so its heads sit at 0°. So the profiles disagreed with each other,
     * which is the argument that settles it.
     *
     * Off by default, so connectors and paths keep following their own last
     * segment, which is right for them.
     */
    axis?: boolean;
  }
): { run: number[]; start: EndCapShape | null; end: EndCapShape | null; size: number } {
  const { size } = connectorCaps(points, spec);
  if (points.length < 4) return { run: points.slice(), start: null, end: null, size };

  const align: EndAlign = spec.align ?? 'inside';

  const a = { x: points[0], y: points[1] };
  const b = { x: points[points.length - 2], y: points[points.length - 1] };
  const outAt = spec.axis ? b : { x: points[2], y: points[3] };
  const inAt = spec.axis ? a : { x: points[points.length - 4], y: points[points.length - 3] };
  const startAngle = Math.atan2(a.y - outAt.y, a.x - outAt.x);
  const endAngle = Math.atan2(b.y - inAt.y, b.x - inAt.x);

  if (align === 'extend') {
    /**
     * The tip is projected out along the tangent by the marker's own depth, so
     * its *base* lands on the path's last point and the run needs no trimming
     * at all. That is the whole of "extend": the line keeps every crest and
     * corner it had, and the head grows out of the end rather than eating it.
     */
    const startCap = endCapShape(spec.start, a, startAngle, size);
    const endCap = endCapShape(spec.end, b, endAngle, size);
    const push = (p: Point, angle: number, by: number): Point => ({
      x: p.x + Math.cos(angle) * by,
      y: p.y + Math.sin(angle) * by,
    });
    return {
      run: points.slice(),
      start: startCap
        ? endCapShape(spec.start, push(a, startAngle, startCap.inset), startAngle, size)
        : null,
      end: endCap ? endCapShape(spec.end, push(b, endAngle, endCap.inset), endAngle, size) : null,
      size,
    };
  }

  // `inside`: the tip stays on the path's last point and the run is pulled
  // back under the marker, or the stroke draws through the head and out past
  // its tip.
  const startCap = endCapShape(spec.start, a, startAngle, size);
  const endCap = endCapShape(spec.end, b, endAngle, size);
  const run = trimPolyline(
    trimPolyline(points, startCap?.inset ?? 0, true),
    endCap?.inset ?? 0,
    false
  );
  return { run, start: startCap, end: endCap, size };
}
