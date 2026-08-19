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
