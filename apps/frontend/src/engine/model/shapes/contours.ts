/**
 * Every shape this canvas can draw, as one contour each.
 *
 * ## One author per shape
 *
 * The set this replaces had two of nearly everything: a `…Anchors()` that
 * described the shape with curves, and a `…Points()` that threw the curves
 * away and kept the anchor positions. The dispatcher called the second one.
 * So the seal was a jagged sunburst, the ribbon was a box with a bite out of
 * it, the key's round bow was a *diamond*, and the speech bubble had square
 * corners and a wedge for a tail — while the toolbar, which called the first
 * one, showed the smooth version of each. The picture promised a shape the
 * board would not draw.
 *
 * There is now exactly one function per shape and nothing to choose between.
 * Where a shape used to have a straight-sided fallback, the fallback is gone
 * rather than fixed: a second description of a shape is the defect, and
 * correcting both copies only postpones it.
 *
 * ## Every shape fills its box
 *
 * `width`/`height` are the only bounds this model has, so a shape that draws
 * inside part of its box is lying to selection, snapping, culling, export
 * framing and every connector that tries to touch it. Two families were doing
 * exactly that: the regular polygons, which are inscribed in a circle and so
 * leave a band of air along one axis, and the hand-authored symbols, whose
 * unit coordinates were eyeballed. Both are now normalised — the polygons by
 * `fitToBox`, the authored ones by `unit()`, which measures a shape once at
 * module load and scales it into the box on every call.
 *
 * ## Where a number comes from
 *
 * Nothing here carries its own default for a parametric dial. `SHAPE_PARAMS`
 * is the one table that says what a trapezoid's inset or a gear's tooth count
 * is when the document does not, and `param()` reads it. The old set wrote
 * those numbers again in the geometry, again in the swapper and again in the
 * panel, and three of them had already drifted: an untouched donut drew a 55%
 * hole under a control reading 50%, an untouched badge drew a 90% scallop
 * under a control reading 82%, and a swapped chip got six pins where a fresh
 * one got three.
 */

import type { ContourGeometry } from '../pathGeometry';
import { contourBounds, mapPath } from '../pathGeometry';
import type { BezierGeometry, CalloutTail, Point } from '../schema';
import {
  clamp,
  compound,
  ellipseContour,
  fitContour,
  fitToBox,
  pen,
  polygonContour,
  regularPolygonPoints,
  roundedPolygonContour,
  starPoints,
} from './pen';

export { regularPolygonPoints, starPoints, fitToBox };

// ---------------------------------------------------------------------------
// Authoring in unit space
// ---------------------------------------------------------------------------

/**
 * A shape drawn once, in whatever coordinates suited its author, and thereafter
 * scaled into the node's box.
 *
 * The alternative — writing every coordinate as a fraction and hoping the
 * extremes come to 0 and 1 — is how the old set ended up with a heart whose
 * widest point was at 0.96 and a cloud whose base was at 0.92: each shape sat
 * inside its box by a percent or two that nobody could see on its own and that
 * every neighbour in a row of shapes made obvious.
 *
 * Measured with `contourBounds`, which flattens the curves, so the fit accounts
 * for a curve that bulges past its own control points. Done once, at module
 * load, because the answer cannot change.
 */
function unit(build: () => ContourGeometry): (w: number, h: number) => ContourGeometry {
  let normalised: ContourGeometry | null = null;
  return (w, h) => {
    if (!normalised) {
      /**
       * Measured large, then divided down.
       *
       * `contourBounds` flattens the curves to find the extremes, and its
       * tolerance is in the same units as the path. A shape authored in a
       * one-unit box is therefore measured to a tolerance of about a quarter
       * of itself: the flattener takes one segment per curve, misses every
       * bulge, and reports a box too small. Scaled up by a thousand first, the
       * same tolerance is a thousandth of the shape and the measurement is
       * exact to well under a pixel at any size a canvas draws.
       *
       * This is worth the paragraph because the symptom was subtle and
       * plausible: the heart, the cloud and the pin each sat a couple of
       * percent outside their own box, which looks like a shape that was
       * drawn slightly wrong rather than one that was measured slightly wrong.
       */
      const MEASURE_AT = 1000;
      const raw = mapPath(build(), (p) => ({ x: p.x * MEASURE_AT, y: p.y * MEASURE_AT }));
      const b = contourBounds(raw);
      const sx = b.width > 1e-9 ? 1 / b.width : 1;
      const sy = b.height > 1e-9 ? 1 / b.height : 1;
      normalised = mapPath(raw, (p) => ({ x: (p.x - b.x) * sx, y: (p.y - b.y) * sy }));
    }
    return mapPath(normalised, (p) => ({ x: p.x * w, y: p.y * h }));
  };
}

// ---------------------------------------------------------------------------
// Basic forms
// ---------------------------------------------------------------------------

/**
 * A squircle, as the superellipse it is named after rather than as a guess.
 *
 * The shape it replaces was four cubic quarters with their handles stretched to
 * 0.86 of the radius — a circle's 0.55 pushed until the sides looked flatter.
 * That is not a superellipse; it is an over-tensioned ellipse, and it bulges
 * where a squircle is straight, which is exactly the part of the curve the
 * shape exists for.
 *
 * This samples the real curve, `|2x/w|⁴ + |2y/h|⁴ = 1`, and fits cubics through
 * the samples. Sampling rather than solving because the parametric form has an
 * infinite derivative at each of the four axis points; the four points
 * themselves are exact and their tangents are axis-aligned by symmetry, which
 * is what a fitted spline reproduces and what makes the join to the next
 * quadrant invisible.
 */
const SQUIRCLE_EXPONENT = 4;
const squircleUnit = unit(() => {
  const p = 2 / SQUIRCLE_EXPONENT;
  const samples: Point[] = [];
  const perQuadrant = 6;
  for (let i = 0; i < perQuadrant * 4; i++) {
    const t = (i * Math.PI * 2) / (perQuadrant * 4) - Math.PI / 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    samples.push({
      x: Math.sign(c) * Math.abs(c) ** p,
      y: Math.sign(s) * Math.abs(s) ** p,
    });
  }
  return smoothClosed(samples);
});

export const squircleContour = (w: number, h: number) => squircleUnit(w, h);

/**
 * A closed curve through a run of points, with no cusps.
 *
 * Centripetal Catmull-Rom, converted to cubics. Centripetal rather than
 * uniform because the samples of a superellipse bunch hard near its corners,
 * and uniform Catmull-Rom answers uneven spacing with a loop that leaves the
 * shape — the one failure mode that is worse than the flat spot it was brought
 * in to fix.
 */
function smoothClosed(points: readonly Point[]): BezierGeometry {
  const n = points.length;
  const at = (i: number) => points[((i % n) + n) % n];
  const dist = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y) ** 0.5 || 1e-6;

  const p = pen().moveTo(points[0].x, points[0].y);
  for (let i = 0; i < n; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const d1 = dist(p0, p1);
    const d2 = dist(p1, p2);
    const d3 = dist(p2, p3);

    const c1 = {
      x: p1.x + ((p2.x - p0.x) * d2) / (3 * (d1 + d2)),
      y: p1.y + ((p2.y - p0.y) * d2) / (3 * (d1 + d2)),
    };
    const c2 = {
      x: p2.x - ((p3.x - p1.x) * d2) / (3 * (d2 + d3)),
      y: p2.y - ((p3.y - p1.y) * d2) / (3 * (d2 + d3)),
    };
    p.curveTo(c1.x, c1.y, c2.x, c2.y, p2.x, p2.y);
  }
  return p.close();
}

/**
 * A capsule: two semicircular ends and two straight sides.
 *
 * Built from real arcs, so the transition from the straight edge to the cap is
 * tangent by construction. The version this replaces placed six anchors by
 * hand and gave the transition anchors handles that ran along the *flat* edge
 * rather than along the arc, which put a visible flat spot at each of the four
 * places the two meet — the one defect a capsule cannot afford, since the join
 * is most of what the shape is.
 */
export function capsuleContour(w: number, h: number): ContourGeometry {
  if (w >= h) {
    const r = h / 2;
    return pen()
      .moveTo(r, 0)
      .lineTo(w - r, 0)
      .arc(w - r, r, r, r, -Math.PI / 2, Math.PI / 2)
      .lineTo(r, h)
      .arc(r, r, r, r, Math.PI / 2, (3 * Math.PI) / 2)
      .close();
  }
  const r = w / 2;
  return pen()
    .arc(r, r, r, r, Math.PI, Math.PI * 2)
    .lineTo(w, h - r)
    .arc(r, h - r, r, r, 0, Math.PI)
    .close();
}

/** A half disc, flat edge down. The arc is elliptical, so it fills any box. */
export function semicircleContour(w: number, h: number): ContourGeometry {
  return pen().arc(w / 2, h, w / 2, h, Math.PI, Math.PI * 2).close();
}

/** The right angle at the bottom left, hypotenuse from the top left corner. */
export function rightTriangleContour(w: number, h: number): ContourGeometry {
  return polygonContour([
    { x: 0, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ]);
}

export function diamondContour(w: number, h: number): ContourGeometry {
  return polygonContour([
    { x: w / 2, y: 0 },
    { x: w, y: h / 2 },
    { x: w / 2, y: h },
    { x: 0, y: h / 2 },
  ]);
}

export function polygonPoints(w: number, h: number, sides: number): Point[] {
  return fitToBox(regularPolygonPoints(w / 2, h / 2, sides, w / 2, h / 2), w, h);
}

export function starOutlinePoints(
  w: number,
  h: number,
  points: number,
  innerRatio: number
): Point[] {
  return fitToBox(starPoints(w / 2, h / 2, points, innerRatio, w / 2, h / 2), w, h);
}

// ---------------------------------------------------------------------------
// Diagram forms
// ---------------------------------------------------------------------------

export function parallelogramContour(w: number, h: number, skew: number): ContourGeometry {
  const s = clamp(skew, -0.45, 0.45);
  const d = Math.abs(s) * w;
  return polygonContour(
    s >= 0
      ? [
          { x: d, y: 0 },
          { x: w, y: 0 },
          { x: w - d, y: h },
          { x: 0, y: h },
        ]
      : [
          { x: 0, y: 0 },
          { x: w - d, y: 0 },
          { x: w, y: h },
          { x: d, y: h },
        ]
  );
}

/**
 * A trapezoid, drawn from whichever edge is the short one.
 *
 * The sign of `inset` chooses the edge, exactly as the sign of a
 * parallelogram's `skew` chooses which way it leans: positive draws the top in
 * (wide base), negative draws the bottom in (wide top: the ISO 5807
 * manual-operation symbol).
 *
 * The range used to be positive-only, which made the two forms the same
 * picture. Mermaid distinguishes them — `[/A\]` against `[\A/]` — and so does
 * every flowchart notation that has them, so a shape that could not tell them
 * apart could not draw either faithfully.
 */
export function trapezoidContour(w: number, h: number, inset: number): ContourGeometry {
  const t = clamp(inset, -0.45, 0.45);
  const d = Math.abs(t) * w;
  return polygonContour(
    t >= 0
      ? [
          { x: d, y: 0 },
          { x: w - d, y: 0 },
          { x: w, y: h },
          { x: 0, y: h },
        ]
      : [
          { x: 0, y: 0 },
          { x: w, y: 0 },
          { x: w - d, y: h },
          { x: d, y: h },
        ]
  );
}

export function chevronContour(w: number, h: number, indent: number): ContourGeometry {
  const ix = w * clamp(indent, 0.05, 0.5);
  return polygonContour([
    { x: 0, y: 0 },
    { x: w - ix, y: 0 },
    { x: w, y: h / 2 },
    { x: w - ix, y: h },
    { x: 0, y: h },
    { x: ix, y: h / 2 },
  ]);
}

/**
 * A cross whose four arms are the same thickness.
 *
 * The version this replaces took the arm ratio as a share of *each* axis
 * separately, so a 180×90 cross had a 60-unit vertical bar crossing a 30-unit
 * horizontal one. It read as a lower-case t. One thickness, measured against
 * the shorter side, is what makes it a cross at every aspect.
 */
export function crossContour(w: number, h: number, armRatio: number): ContourGeometry {
  const t = (clamp(armRatio, 0.1, 0.8) * Math.min(w, h)) / 2;
  const x1 = w / 2 - t;
  const x2 = w / 2 + t;
  const y1 = h / 2 - t;
  const y2 = h / 2 + t;
  return polygonContour([
    { x: x1, y: 0 },
    { x: x2, y: 0 },
    { x: x2, y: y1 },
    { x: w, y: y1 },
    { x: w, y: y2 },
    { x: x2, y: y2 },
    { x: x2, y: h },
    { x: x1, y: h },
    { x: x1, y: y2 },
    { x: 0, y: y2 },
    { x: 0, y: y1 },
    { x: x1, y: y1 },
  ]);
}

/** A block arrow: a shaft and a head, both proportional to the box. */
export function arrowBlockContour(w: number, h: number, indent: number): ContourGeometry {
  const head = clamp(indent, 0.2, 0.7) * w;
  const shaft = h * 0.46;
  const top = (h - shaft) / 2;
  const neck = w - head;
  return polygonContour([
    { x: 0, y: top },
    { x: neck, y: top },
    { x: neck, y: 0 },
    { x: w, y: h / 2 },
    { x: neck, y: h },
    { x: neck, y: top + shaft },
    { x: 0, y: top + shaft },
  ]);
}

/** The flowchart preparation symbol: flat top and bottom, points left and right. */
export function preparationContour(w: number, h: number, indent: number): ContourGeometry {
  const ix = w * clamp(indent, 0.05, 0.5);
  return polygonContour([
    { x: ix, y: 0 },
    { x: w - ix, y: 0 },
    { x: w, y: h / 2 },
    { x: w - ix, y: h },
    { x: ix, y: h },
    { x: 0, y: h / 2 },
  ]);
}

/**
 * A page with a torn bottom edge.
 *
 * One full period of a sine, drawn as two cubic humps. A cubic whose controls
 * sit at a third and two thirds of the span, four thirds of the amplitude off
 * the baseline, passes through exactly ±amplitude at its midpoint — so the
 * wave's depth is the number the panel says it is rather than something close
 * to it, and the two humps are the same size.
 */
export function documentContour(w: number, h: number, waveHeight: number): ContourGeometry {
  const a = clamp(waveHeight, 0.05, 0.35) * h;
  const base = h - a;
  const lift = (4 / 3) * a;
  return pen()
    .moveTo(0, 0)
    .lineTo(w, 0)
    .lineTo(w, base)
    .curveTo((w * 5) / 6, base + lift, (w * 2) / 3, base + lift, w / 2, base)
    .curveTo(w / 3, base - lift, w / 6, base - lift, 0, base)
    .close();
}

/**
 * A D: a straight back and a semicircular front.
 *
 * Shared by the flowchart *delay* symbol and the logic *AND* gate, which is a
 * fact about the two notations rather than a shortcut here — both are drawn
 * this way, and a tool that differentiated them would be inventing a symbol.
 * The cap is elliptical so it fills a box of any aspect; at 3:2, the proportion
 * a gate is normally drawn at, it is a true semicircle.
 */
export function dContour(w: number, h: number): ContourGeometry {
  const rx = Math.min(w, h / 2 + w / 2) / 2;
  const capX = w - rx;
  return pen()
    .moveTo(0, 0)
    .lineTo(capX, 0)
    .arc(capX, h / 2, rx, h / 2, -Math.PI / 2, Math.PI / 2)
    .lineTo(0, h)
    .close();
}

/**
 * The OR gate: a concave back, and two convex flanks meeting at a point.
 *
 * The one it replaces had its back edge bulging the wrong way and its point
 * pulled off the centre line, which made it read as a fish. The three curves
 * here are the standard distinctive-shape gate, and the back's controls sit at
 * a quarter of the width — deep enough to be unmistakably concave at icon size,
 * which is the whole reason the notation gives the OR gate a curved back.
 */
export function orGateContour(w: number, h: number): ContourGeometry {
  return pen()
    .moveTo(0, 0)
    .curveTo(w * 0.55, h * 0.03, w * 0.82, h * 0.26, w, h / 2)
    .curveTo(w * 0.82, h * 0.74, w * 0.55, h * 0.97, 0, h)
    .curveTo(w * 0.26, h * 0.74, w * 0.26, h * 0.26, 0, 0)
    .close();
}

/** A drum: an elliptical rim on top, straight sides, an elliptical base. */
export function cylinderContour(w: number, h: number, rimRatio: number): ContourGeometry {
  const ry = clamp(rimRatio, 0.05, 0.4) * h;
  const rx = w / 2;
  return pen()
    .arc(rx, ry, rx, ry, Math.PI, Math.PI * 2)
    .lineTo(w, h - ry)
    .arc(rx, h - ry, rx, ry, 0, Math.PI)
    .close();
}

/**
 * Manual input: a rectangle whose top edge slopes.
 *
 * The flowchart symbol for something a person types in, and one of the few in
 * the standard set that this product did not have. The slope runs down from
 * the right, which is the convention every notation draws it with.
 */
export function manualInputContour(w: number, h: number, indent: number): ContourGeometry {
  const rise = clamp(indent, 0.05, 0.5) * h;
  return polygonContour([
    { x: 0, y: rise },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ]);
}

/**
 * A folder, with its tab on the left of the leading edge.
 *
 * The tab is a share of the width with a floor and a ceiling, like every other
 * detail in this set, so a wide folder does not grow a tab half its length.
 */
export function folderContour(w: number, h: number): ContourGeometry {
  const tabW = clamp(w * 0.42, 24, w * 0.6);
  const tabH = clamp(h * 0.16, 6, 26);
  const slant = Math.min(tabH * 0.8, tabW * 0.25);
  const r = Math.min(w, h) * 0.06;
  return roundedPolygonContour(
    [
      { x: 0, y: 0 },
      { x: tabW - slant, y: 0 },
      { x: tabW, y: tabH },
      { x: w, y: tabH },
      { x: w, y: h },
      { x: 0, y: h },
    ],
    [r, r * 0.8, r * 0.8, r, r, r]
  );
}

/**
 * A map pin: a circular head over a point.
 *
 * The two tangent lines from the tip to the head's circle, found rather than
 * eyeballed — which is what keeps the teardrop smooth at the join instead of
 * showing the two kinks a hand-placed curve leaves there.
 */
const pinUnit = unit(() => {
  // Solved on a *circle*, in coordinates chosen so a pin has a pin's
  // proportions, and stretched into the node's box afterwards. Doing it in the
  // box directly made the head a circle of half the width, which in a square
  // box put its centre exactly one radius above the tip — the tangent angle
  // collapses to zero there, the two flanks come out zero-length, and the pin
  // rendered as a bare circle with the point missing.
  const r = 0.5;
  const cx = 0.5;
  const cy = 0.5;
  const tipY = 1.42;
  const d = tipY - cy;
  const a = Math.acos(clamp(r / d, -1, 1));
  // Straight down from the centre is +π/2 here, so the tangent points sit that
  // far either side of it. The arc between them is the *major* one — the whole
  // head except the wedge the flanks cut away.
  const from = Math.PI / 2 + a;
  const to = Math.PI * 2 + Math.PI / 2 - a;
  return pen()
    .moveTo(cx, tipY)
    .lineTo(cx + r * Math.cos(from), cy + r * Math.sin(from))
    .arc(cx, cy, r, r, from, to)
    .lineTo(cx, tipY)
    .close();
});

export const pinContour = (w: number, h: number) => pinUnit(w, h);

/** A paper plane, as the classic four-triangle fold. */
const planeUnit = unit(() =>
  polygonContour([
    { x: 1, y: 0 },
    { x: 0.42, y: 1 },
    { x: 0.33, y: 0.6 },
    { x: 0, y: 0.44 },
  ])
);

export const planeContour = (w: number, h: number) => planeUnit(w, h);

/** A page with one corner turned back. The fold itself is drawn as a feature. */
export function noteContour(w: number, h: number): ContourGeometry {
  const f = Math.min(w, h) * 0.28;
  return polygonContour([
    { x: 0, y: 0 },
    { x: w - f, y: 0 },
    { x: w, y: f },
    { x: w, y: h },
    { x: 0, y: h },
  ]);
}

// ---------------------------------------------------------------------------
// Annotation
// ---------------------------------------------------------------------------

/** Which edge a tail leaves from, and how far along it. One table, seven tails. */
const TAIL_PLACEMENT: Record<CalloutTail, { edge: 'top' | 'right' | 'bottom' | 'left'; at: number }> = {
  'top-left': { edge: 'top', at: 0.28 },
  'top-right': { edge: 'top', at: 0.72 },
  left: { edge: 'left', at: 0.5 },
  right: { edge: 'right', at: 0.5 },
  'bottom-left': { edge: 'bottom', at: 0.28 },
  bottom: { edge: 'bottom', at: 0.5 },
  'bottom-right': { edge: 'bottom', at: 0.72 },
};

/**
 * A speech bubble: a rounded body, and a tail that grows out of one edge.
 *
 * ## Why the whole outline is one rounded polygon
 *
 * The body's corners and the tail's own bends are the same operation applied at
 * different radii, so they are described together and rounded together. The
 * version this replaces built a sharp-cornered polygon and left the app's
 * general corner-rounding pass to soften it — which rounded the *tail's tip*
 * by the same radius as the body's corners and turned the beak into a thumb.
 *
 * The tail is given a base wider than its tip and a tip radius of its own, so
 * it reads as something the balloon is pointing with rather than a triangle
 * stuck to the side of a box.
 */
export function calloutContour(
  w: number,
  h: number,
  tail: CalloutTail,
  tailSize: number
): ContourGeometry {
  const place = TAIL_PLACEMENT[tail] ?? TAIL_PLACEMENT['bottom-left'];
  const ts = clamp(tailSize, 8, Math.min(w, h) * 0.4);
  const vertical = place.edge === 'top' || place.edge === 'bottom';

  // The body, inset from the box on the tail's side only, so the box still
  // describes everything drawn.
  const bx = place.edge === 'left' ? ts : 0;
  const by = place.edge === 'top' ? ts : 0;
  const bw = w - (vertical ? 0 : ts);
  const bh = h - (vertical ? ts : 0);

  const r = clamp(Math.min(bw, bh) * 0.18, 4, 28);
  const base = ts * 0.85;
  const half = base / 2;

  /** A point on the body edge the tail leaves from, offset along that edge. */
  const along = (offset: number): Point => {
    const t = clamp(place.at, 0.18, 0.82);
    if (place.edge === 'top') return { x: bx + clamp(bw * t + offset, r, bw - r), y: by };
    if (place.edge === 'bottom') return { x: bx + clamp(bw * t + offset, r, bw - r), y: by + bh };
    if (place.edge === 'left') return { x: bx, y: by + clamp(bh * t + offset, r, bh - r) };
    return { x: bx + bw, y: by + clamp(bh * t + offset, r, bh - r) };
  };

  // The tip sits on the box edge, leaned away from the body's centre, which is
  // what gives a bubble its direction rather than a symmetric spike.
  const lean = place.at < 0.5 ? -ts * 0.35 : place.at > 0.5 ? ts * 0.35 : 0;
  const tipFrom = along(lean);
  const tip: Point =
    place.edge === 'top'
      ? { x: tipFrom.x, y: 0 }
      : place.edge === 'bottom'
        ? { x: tipFrom.x, y: h }
        : place.edge === 'left'
          ? { x: 0, y: tipFrom.y }
          : { x: w, y: tipFrom.y };

  const corners: Point[] = [
    { x: bx, y: by },
    { x: bx + bw, y: by },
    { x: bx + bw, y: by + bh },
    { x: bx, y: by + bh },
  ];
  // Clockwise from the top-left corner, the edges run top, right, bottom, left;
  // the tail is spliced into its own edge in that same direction.
  const edgeIndex = { top: 0, right: 1, bottom: 2, left: 3 }[place.edge];
  const forwards = place.edge === 'top' || place.edge === 'right';
  const first = along(forwards ? -half : half);
  const second = along(forwards ? half : -half);

  const points: Point[] = [];
  const radii: number[] = [];
  for (let i = 0; i < 4; i++) {
    points.push(corners[i]);
    radii.push(r);
    if (i === edgeIndex) {
      points.push(first, tip, second);
      /**
       * The tip is sharp, and the two bends behind it are not.
       *
       * Rounding a corner pulls it back off the vertex, so a rounded tip does
       * not reach the box's edge — which for a bubble whose tail *is* the
       * bottom of the box means the shape stops short of its own bounds. Every
       * professional speech bubble points, FigJam's included; the softening
       * belongs where the tail leaves the balloon, which is what the two base
       * radii do.
       */
      radii.push(base * 0.45, 0, base * 0.45);
    }
  }
  return roundedPolygonContour(points, radii);
}

/**
 * A cloud: one large disc, a smaller cap, a flat base.
 *
 * The construction every diagramming tool draws a cloud with, and the one the
 * reference set uses — a big lobe carrying most of the silhouette, a half-disc
 * shoulder on the right, and a level bottom the two sit on. It reads as a
 * cloud at 16px, which a ring of eight equal bumps does not: at glyph size
 * those average out into a circle with a wavy edge.
 *
 * Built from real arcs in unit space and scaled into the box afterwards, so
 * the lobes stay tangent to the base and to each other at any aspect. Solving
 * the crossings in the box directly would mean solving them again for every
 * width and height.
 */
const CLOUD_MAIN = { x: 0.40, y: 0.50, r: 0.40 };
const CLOUD_CAP = { x: 0.85, y: 0.66, r: 0.24 };

const cloudUnit = unit(() => {
  const base = CLOUD_MAIN.y + CLOUD_MAIN.r;
  // Where the big lobe has risen to the cap's shoulder, which is where the two
  // are joined by the short straight run across the top.
  const shoulderY = CLOUD_CAP.y - CLOUD_CAP.r;
  const dy = shoulderY - CLOUD_MAIN.y;
  const shoulderX = CLOUD_MAIN.x + Math.sqrt(Math.max(0, CLOUD_MAIN.r ** 2 - dy ** 2));
  const shoulderAngle = Math.atan2(dy, shoulderX - CLOUD_MAIN.x);

  return pen()
    .moveTo(shoulderX, shoulderY)
    .lineTo(CLOUD_CAP.x, shoulderY)
    // Over the cap and down its right side.
    .arc(CLOUD_CAP.x, CLOUD_CAP.y, CLOUD_CAP.r, CLOUD_CAP.r, -Math.PI / 2, Math.PI / 2)
    .lineTo(CLOUD_MAIN.x, base)
    // Round the big lobe the long way: bottom, left, top, back to the shoulder.
    .arc(
      CLOUD_MAIN.x,
      CLOUD_MAIN.y,
      CLOUD_MAIN.r,
      CLOUD_MAIN.r,
      Math.PI / 2,
      Math.PI * 2 + shoulderAngle
    )
    .close();
});

export const cloudContour = (w: number, h: number) => cloudUnit(w, h);


/**
 * A ribbon: a straight band with a swallowtail notched into each end.
 *
 * The old banner tried to draw a band, two end folds *and* two tails that tuck
 * behind, in one contour with no way to shade the folds — so the folds read as
 * bites taken out of the shape rather than as paper turning over. One fill can
 * express a band and its notches honestly; it cannot express a fold, and the
 * creases are drawn as features instead, where a line is what a fold looks like.
 */
export function bannerContour(w: number, h: number, indent: number): ContourGeometry {
  const notch = clamp(indent, 0.05, 0.3) * w;
  return polygonContour([
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w - notch, y: h / 2 },
    { x: w, y: h },
    { x: 0, y: h },
    { x: notch, y: h / 2 },
  ]);
}

/**
 * A seal: a disc with a run of circular bumps around its rim.
 *
 * Each scallop is one quadratic whose apex is placed *on* the outer radius —
 * solved rather than approximated, so the count and the depth the panel offers
 * are the count and depth drawn. The shape it replaces alternated straight
 * vertices between two radii, which is a star with a lot of points; a seal's
 * whole character is that its edge is convex everywhere.
 */
export function badgeContour(
  w: number,
  h: number,
  scallops: number,
  innerRatio: number
): ContourGeometry {
  const count = Math.max(6, Math.round(scallops));
  const ir = clamp(innerRatio, 0.55, 0.95);
  const cx = w / 2;
  const cy = h / 2;
  const rx = w / 2;
  const ry = h / 2;
  const step = (Math.PI * 2) / count;

  const valley = (i: number): Point => {
    const a = (i + 0.5) * step - Math.PI / 2;
    return { x: cx + rx * ir * Math.cos(a), y: cy + ry * ir * Math.sin(a) };
  };

  const p = pen();
  const start = valley(-1);
  p.moveTo(start.x, start.y);
  for (let i = 0; i < count; i++) {
    const from = valley(i - 1);
    const to = valley(i);
    const a = i * step - Math.PI / 2;
    const apex = { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) };
    // A quadratic passes through (P0 + 2C + P2)/4 at its midpoint, so putting
    // the midpoint on the apex is one rearrangement rather than a fitted guess.
    p.quadTo((4 * apex.x - from.x - to.x) / 2, (4 * apex.y - from.y - to.y) / 2, to.x, to.y);
  }
  return p.close();
}

// ---------------------------------------------------------------------------
// Symbols
// ---------------------------------------------------------------------------

/** A ring: a disc with a concentric hole, the hole wound the other way. */
export function donutContour(w: number, h: number, innerRatio: number): ContourGeometry {
  const ir = clamp(innerRatio, 0.1, 0.9);
  const cx = w / 2;
  const cy = h / 2;
  return compound(
    ellipseContour(cx, cy, w / 2, h / 2, 'cw'),
    ellipseContour(cx, cy, (w / 2) * ir, (h / 2) * ir, 'ccw')
  );
}

const heartUnit = unit(() =>
  pen()
    // From the tip, clockwise: up the right flank, over the right lobe, into
    // the cusp, over the left lobe, and back down the left flank.
    .moveTo(0.5, 1)
    .curveTo(0.62, 0.82, 0.9, 0.62, 0.98, 0.42)
    .curveTo(1.06, 0.22, 0.96, 0.02, 0.76, 0.02)
    .curveTo(0.63, 0.02, 0.54, 0.1, 0.5, 0.2)
    .curveTo(0.46, 0.1, 0.37, 0.02, 0.24, 0.02)
    .curveTo(0.04, 0.02, -0.06, 0.22, 0.02, 0.42)
    .curveTo(0.1, 0.62, 0.38, 0.82, 0.5, 1)
    .close()
);

export const heartContour = (w: number, h: number) => heartUnit(w, h);

/**
 * A shield: a rounded-cornered top, straight tapering sides, a soft point.
 *
 * The diagramming shield rather than the heraldic one. The curved-sided
 * version this replaces reads as a crest at 200px and as a thumbprint at 20,
 * because a shield's whole identity at glyph size is the *angle* the sides
 * make — and two Béziers spend that angle on a curve. Straight sides keep it,
 * and the reference set draws it exactly this way.
 */
export function shieldContour(w: number, h: number): ContourGeometry {
  const r = Math.min(w, h) * 0.1;
  const rounded = roundedPolygonContour(
    [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h * 0.58 },
      { x: w / 2, y: h },
      { x: 0, y: h * 0.58 },
    ],
    [r, r, r * 0.5, r * 0.6, r * 0.5]
  );
  // Refitted, because rounding the point lifted it off the bottom edge.
  return fitContour(rounded, w, h);
}

/** A rounded rectangle as a contour. Several shapes here are made of these. */
export function roundedBox(x: number, y: number, w: number, h: number, r: number): BezierGeometry {
  return roundedPolygonContour(
    [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ],
    Math.min(r, w / 2, h / 2)
  );
}

/**
 * A rack: one rounded unit per bay, stacked with air between them.
 *
 * A single box with rules across it — which is what this drew — is a table,
 * not a rack. The units are separate objects in every drawing of one, and
 * separating them is also what makes the bay count legible at glyph size,
 * where three hairlines inside one box merge into a grey band.
 */
export function serverContour(w: number, h: number, bays: number): ContourGeometry {
  const count = clamp(Math.round(bays), 2, 6);
  const gap = clamp(h * 0.06, 2, 14);
  const unitH = (h - gap * (count - 1)) / count;
  const r = Math.min(unitH * 0.3, w * 0.06);
  return compound(
    ...Array.from({ length: count }, (_, i) => roundedBox(0, i * (unitH + gap), w, unitH, r))
  );
}

/**
 * A lidded box: the lid, and the body under it.
 *
 * Two contours rather than one, because that is what it is — the lid overhangs
 * and the body is inset, and a single outline of the union would lose the step
 * between them that makes it read as a box with a lid on.
 */
export function archiveContour(w: number, h: number): ContourGeometry {
  const lidH = clamp(h * 0.26, 6, 44);
  const gap = clamp(h * 0.04, 1, 8);
  const inset = clamp(w * 0.06, 2, 18);
  const r = Math.min(w, h) * 0.05;
  return compound(
    roundedBox(0, 0, w, lidH, r),
    roundedBox(inset, lidH + gap, w - inset * 2, h - lidH - gap, r)
  );
}

/** A hopper: sloped shoulders from a narrow mouth down to a square body. */
export function hopperContour(w: number, h: number): ContourGeometry {
  const shoulder = h * 0.34;
  const mouth = w * 0.24;
  const r = Math.min(w, h) * 0.06;
  return roundedPolygonContour(
    [
      { x: mouth, y: 0 },
      { x: w - mouth, y: 0 },
      { x: w, y: shoulder },
      { x: w, y: h },
      { x: 0, y: h },
      { x: 0, y: shoulder },
    ],
    [r, r, r, r, r, r]
  );
}

/** A globe: a circle, with its meridians and its equator drawn as features. */
export function globeContour(w: number, h: number): ContourGeometry {
  return ellipseContour(w / 2, h / 2, w / 2, h / 2, 'cw');
}

const boltUnit = unit(() =>
  polygonContour([
    { x: 0.60, y: 0 },
    { x: 0.16, y: 0.58 },
    { x: 0.44, y: 0.58 },
    { x: 0.36, y: 1 },
    { x: 0.84, y: 0.4 },
    { x: 0.54, y: 0.4 },
  ])
);

export const boltContour = (w: number, h: number) => boltUnit(w, h);

/**
 * An isometric box.
 *
 * The three faces meet at the bottom vertex of the top rhombus, which is the
 * centre of the box. The creases the old one drew ran to three quarters of the
 * height on both sides — a point on neither edge of either side face — so the
 * cube's own construction lines missed its corners.
 */
export function packageContour(w: number, h: number): ContourGeometry {
  // Softened corners, as the reference draws it: a carton has folded edges,
  // and six needle-sharp points read as a crystal rather than a box.
  const r = Math.min(w, h) * 0.09;
  return fitContour(
    roundedPolygonContour(
      [
        { x: w / 2, y: 0 },
        { x: w, y: h / 4 },
        { x: w, y: (h * 3) / 4 },
        { x: w / 2, y: h },
        { x: 0, y: (h * 3) / 4 },
        { x: 0, y: h / 4 },
      ],
      r
    ),
    w,
    h
  );
}

/**
 * A key: a round bow with a hole in it, a straight blade, stepped teeth along
 * one edge and a squared tip, lying on the diagonal.
 *
 * ## Laid out in the box, not stretched into it
 *
 * The other authored symbols are drawn once and scaled into whatever box they
 * are given, which is right for a heart and wrong for anything with a circle in
 * it: a key in a wide box would get an oval bow. So this one is *solved* for
 * its box. The bow is always a true circle in the box's top-right corner, and
 * the blade swings between flat and upright until the whole key fills the box
 * exactly: near the diagonal in a squarish box, flat in a wide one, upright in
 * a tall one. Past either end of the swing the blade lengthens instead, and
 * the extra length goes between the bow and the teeth, so the cuts keep their
 * spacing and angles at any aspect.
 *
 * ## The measurements
 *
 * Everything below is in key units: one unit is the length from the bow's
 * centre to the tip of an unstretched key. The proportions are those of the
 * glyph the shape was refined from (a bow about four tenths of the length in
 * radius, a blade a sixth as wide, teeth a tenth deep), made regular: one
 * blade width end to end, every tooth the same ramp and face at the same
 * pitch, and a hint of radius at every corner so the joins read as cut metal
 * rather than as pixels.
 */
const KEY_CORE = 0.085;
/** How far a tooth stands proud of the blade. */
const KEY_TOOTH = 0.1;
/**
 * Tooth spacing, at most, and how one pitch divides: a long ramp down toward
 * the bow (about 35° off the blade) and a short steep face back up (about 68°).
 * A short blade packs its teeth closer, and the two cuts shrink together.
 */
const KEY_PITCH = 0.19;
const KEY_RAMP_SHARE = 0.75;
/** The flat between the last tooth and the bow, at least. */
const KEY_SHOULDER = 0.06;
/** The hole's centre, from the bow's centre away from the blade, as a share of the bow. */
const KEY_HOLE_AT = 0.42;
/** Corner softening on the blade, and the larger fillet where the blade meets the bow. */
const KEY_ROUND = 0.014;
const KEY_JOIN = 0.03;

/** The blade's two edges, in key units across it: the plain edge and the tops of the teeth. */
export const KEY_BLADE = { back: -KEY_CORE, front: KEY_CORE + KEY_TOOTH } as const;

export interface KeyLayout {
  /** The bow's centre and radius, in the node's box. */
  cx: number;
  cy: number;
  r: number;
  /** Unit vector along the blade, from the bow towards the tip. */
  ux: number;
  uy: number;
  /** Unit vector across the blade, towards the teeth. */
  vx: number;
  vy: number;
  /** Box units per key unit. */
  scale: number;
  /** Bow radius and blade length (bow centre to tip), in key units. */
  bow: number;
  length: number;
}

/** Where a point given in key units (along the blade, across it) lands in the box. */
export function keyPoint(k: KeyLayout, along: number, across: number): Point {
  return {
    x: k.cx + (along * k.ux + across * k.vx) * k.scale,
    y: k.cy + (along * k.uy + across * k.vy) * k.scale,
  };
}

/** The extent of a key with its blade `theta` radians below flat, about the bow's centre. */
function keyExtent(theta: number, length: number, bow: number) {
  const ux = -Math.cos(theta);
  const uy = Math.sin(theta);
  const vx = -Math.sin(theta);
  const vy = -Math.cos(theta);
  // The tip's two corners are the only parts that reach past the bow: every
  // tooth stands no prouder than the tip's top corner and sits nearer the bow.
  const { back, front } = KEY_BLADE;
  const xs = [-bow, bow, length * ux + front * vx, length * ux + back * vx];
  const ys = [-bow, bow, length * uy + front * vy, length * uy + back * vy];
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

/**
 * The angle, the blade length and the scale that make a key fill `w` × `h`.
 *
 * The aspect falls steadily as the blade swings from flat to upright, so the
 * angle is found by bisection. Past either end the length has a closed form,
 * because the bow then sets one of the two dimensions on its own.
 */
export function keyLayout(w: number, h: number, bow: number): KeyLayout {
  const W = Math.max(w, 1e-6);
  const H = Math.max(h, 1e-6);
  const target = W / H;
  const aspect = (t: number, l: number) => {
    const e = keyExtent(t, l, bow);
    return (e.maxX - e.minX) / (e.maxY - e.minY);
  };

  let theta: number;
  let length = 1;
  if (target >= aspect(0, 1)) {
    theta = 0;
    length = Math.max(1, 2 * bow * target - bow);
  } else if (target <= aspect(Math.PI / 2, 1)) {
    theta = Math.PI / 2;
    length = Math.max(1, (2 * bow) / target - bow);
  } else {
    let lo = 0;
    let hi = Math.PI / 2;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (aspect(mid, 1) > target) lo = mid;
      else hi = mid;
    }
    theta = (lo + hi) / 2;
  }

  const e = keyExtent(theta, length, bow);
  const scale = Math.min(W / (e.maxX - e.minX), H / (e.maxY - e.minY));
  return {
    cx: -e.minX * scale,
    cy: -e.minY * scale,
    r: bow * scale,
    ux: -Math.cos(theta),
    uy: Math.sin(theta),
    vx: -Math.sin(theta),
    vy: -Math.cos(theta),
    scale,
    bow,
    length,
  };
}

/** The hole: on the bow's axis, on the side away from the blade. */
export function keyHole(k: KeyLayout, holeRatio: number): { x: number; y: number; r: number } {
  const at = keyPoint(k, -KEY_HOLE_AT * k.bow, 0);
  return { x: at.x, y: at.y, r: holeRatio * k.r };
}

/** Where the hole's centre sits along the blade's axis, as a share of the bow. */
export const KEY_HOLE_OFFSET = KEY_HOLE_AT;

export function keyContour(w: number, h: number, teeth: number, bowRatio: number, holeRatio: number): ContourGeometry {
  const k = keyLayout(w, h, bowRatio);
  const R = k.bow;
  const { back, front } = KEY_BLADE;
  const L = k.length;
  const n = clamp(Math.round(teeth), 1, 6);

  // Where the blade's two edges leave the bow.
  const uPlain = Math.sqrt(Math.max(0, R * R - back * back));
  const uTeeth = Math.sqrt(Math.max(0, R * R - front * front));
  // The teeth run back from the tip at one pitch, packed closer only when the
  // blade is too short to hold them at full spacing.
  const pitch = Math.max(0.05, Math.min(KEY_PITCH, (L - uTeeth - KEY_SHOULDER) / n));
  const ramp = pitch * KEY_RAMP_SHARE;

  // The blade, from the bow's teeth-side join to its plain-side join: along
  // the tops toward the tip, and for each tooth a steep face down and a long
  // ramp back up to the next peak; the last peak is the tip's own corner.
  // Then across the squared tip and home along the plain edge.
  const run: Array<[number, number]> = [[uTeeth, front]];
  const shoulder = L - n * pitch;
  if (shoulder - uTeeth > 1e-6) run.push([shoulder, front]);
  for (let i = n - 1; i >= 0; i--) {
    const peak = L - i * pitch;
    run.push([peak - ramp, -back]);
    run.push([peak, front]);
  }
  run.push([L, back]);
  run.push([uPlain, back]);
  const pts = run.map(([along, across]) => keyPoint(k, along, across));

  const toward = (p: Point, q: Point, d: number): Point => {
    const len = Math.hypot(q.x - p.x, q.y - p.y);
    return len < 1e-9 ? p : { x: p.x + ((q.x - p.x) / len) * d, y: p.y + ((q.y - p.y) / len) * d };
  };
  const edge = (i: number) => Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);

  // The bow, the long way round: from the plain-side join, away from the
  // blade, to the teeth-side join, stopping a fillet short of each.
  const axis = Math.atan2(k.uy, k.ux);
  const fillet = KEY_JOIN / R;
  const fromPlain = axis - Math.asin(-back / R) - fillet;
  const toTeeth = axis + Math.asin(front / R) - Math.PI * 2 + fillet;
  const p = pen().arc(k.cx, k.cy, k.r, k.r, fromPlain, toTeeth);

  const joinPx = KEY_JOIN * k.scale;
  const roundPx = KEY_ROUND * k.scale;
  const into = toward(pts[0], pts[1], Math.min(joinPx, edge(0) / 2));
  p.quadTo(pts[0].x, pts[0].y, into.x, into.y);
  for (let i = 1; i < pts.length - 1; i++) {
    const r = Math.min(roundPx, edge(i - 1) / 2, edge(i) / 2);
    const a = toward(pts[i], pts[i - 1], r);
    const b = toward(pts[i], pts[i + 1], r);
    p.lineTo(a.x, a.y);
    p.quadTo(pts[i].x, pts[i].y, b.x, b.y);
  }
  const last = pts.length - 1;
  const out = toward(pts[last], pts[last - 1], Math.min(joinPx, edge(last - 1) / 2));
  p.lineTo(out.x, out.y);
  p.quadTo(pts[last].x, pts[last].y, k.cx + k.r * Math.cos(fromPlain), k.cy + k.r * Math.sin(fromPlain));
  const outer = p.close();

  const hole = keyHole(k, holeRatio);
  // Fitted after the fact: softening the tip's corners pulls them off the
  // box's edge by the fillet's sagitta, a fraction of a pixel the box would
  // otherwise carry as air.
  return fitContour(compound(outer, ellipseContour(hole.x, hole.y, hole.r, hole.r, 'ccw')), w, h);
}

/**
 * A gear: teeth with flat flanks, arcs at every tip and root, and a bore.
 *
 * The teeth are placed by angle rather than by a point list, so the tooth
 * count the panel offers is drawn exactly, and the root between two teeth is a
 * real arc of the root circle rather than the chord the old polygon drew.
 */
export function gearContour(w: number, h: number, teeth: number): ContourGeometry {
  const count = clamp(Math.round(teeth), 4, 24);
  const cx = w / 2;
  const cy = h / 2;
  const tipX = w / 2;
  const tipY = h / 2;
  const rootX = tipX * 0.76;
  const rootY = tipY * 0.76;
  const step = (Math.PI * 2) / count;
  const tipHalf = step * 0.17;
  const rootHalf = step * 0.31;

  const at = (rx: number, ry: number, a: number): Point => ({
    x: cx + rx * Math.cos(a),
    y: cy + ry * Math.sin(a),
  });

  const p = pen();
  for (let i = 0; i < count; i++) {
    const a = i * step - Math.PI / 2;
    const flankIn = at(rootX, rootY, a - rootHalf);
    if (i === 0) p.moveTo(flankIn.x, flankIn.y);
    else p.lineTo(flankIn.x, flankIn.y);
    const tipIn = at(tipX, tipY, a - tipHalf);
    p.lineTo(tipIn.x, tipIn.y);
    p.arc(cx, cy, tipX, tipY, a - tipHalf, a + tipHalf);
    const flankOut = at(rootX, rootY, a + rootHalf);
    p.lineTo(flankOut.x, flankOut.y);
    p.arc(cx, cy, rootX, rootY, a + rootHalf, a + step - rootHalf);
  }

  return compound(p.close(), ellipseContour(cx, cy, tipX * 0.34, tipY * 0.34, 'ccw'));
}

/** A person: a head, and shoulders that reach the full width of the box. */
export function userContour(w: number, h: number): ContourGeometry {
  const head = ellipseContour(w / 2, h * 0.24, w * 0.23, h * 0.24, 'cw');
  const body = pen()
    .moveTo(0, h)
    .lineTo(0, h * 0.86)
    .curveTo(0, h * 0.66, w * 0.2, h * 0.58, w / 2, h * 0.58)
    .curveTo(w * 0.8, h * 0.58, w, h * 0.66, w, h * 0.86)
    .lineTo(w, h)
    .close();
  return compound(head, body);
}

// -- Flowchart, completed ------------------------------------------------------
//
// The rest of the ISO 5807 set. Each one fills its box on both axes, so
// selection, snapping and connector ports agree with what is drawn.

/** How far each sheet behind the front one is stepped. */
export function multiDocumentStep(w: number, h: number): number {
  return clamp(Math.min(w, h) * 0.08, 3, 18);
}

/**
 * Several documents: the front sheet with its torn edge, and the two behind it
 * stepped up and to the right.
 *
 * One silhouette rather than three overlapping sheets, so the fill is one
 * colour and a hit anywhere on the stack selects it. The edges of the back
 * sheets that lie over the front one are drawn as features.
 */
export function multiDocumentContour(w: number, h: number, waveHeight: number): ContourGeometry {
  const d = multiDocumentStep(w, h);
  const fw = w - 2 * d;
  const a = clamp(waveHeight, 0.05, 0.35) * (h - 2 * d);
  const base = h - a;
  const lift = (4 / 3) * a;
  return pen()
    .moveTo(2 * d, 0)
    .lineTo(w, 0)
    .lineTo(w, h - 2 * d - a)
    .lineTo(w - d, h - 2 * d - a)
    .lineTo(w - d, h - d - a)
    .lineTo(fw, h - d - a)
    .lineTo(fw, base)
    .curveTo((fw * 5) / 6, base + lift, (fw * 2) / 3, base + lift, fw / 2, base)
    .curveTo(fw / 3, base - lift, fw / 6, base - lift, 0, base)
    .lineTo(0, 2 * d)
    .lineTo(d, 2 * d)
    .lineTo(d, d)
    .lineTo(2 * d, d)
    .close();
}

/** Off-page connector: a box whose bottom edge comes to a point. */
export function offPageContour(w: number, h: number, indent: number): ContourGeometry {
  const shoulder = h * (1 - clamp(indent, 0.1, 0.5));
  return polygonContour([
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: shoulder },
    { x: w / 2, y: h },
    { x: 0, y: shoulder },
  ]);
}

/** Punched card: a rectangle with its top-left corner cut off. */
export function cardContour(w: number, h: number, indent: number): ContourGeometry {
  const c = clamp(indent, 0.05, 0.5) * Math.min(w, h);
  return polygonContour([
    { x: c, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
    { x: 0, y: c },
  ]);
}

/**
 * Loop limit: a rectangle with both top corners chamfered.
 *
 * The symbol for the start of a loop, drawn upright; the matching end is the
 * same shape flipped, which the transformer already does.
 */
export function loopLimitContour(w: number, h: number, indent: number): ContourGeometry {
  const c = clamp(indent, 0.05, 0.5) * Math.min(w, h);
  return polygonContour([
    { x: c, y: 0 },
    { x: w - c, y: 0 },
    { x: w, y: c },
    { x: w, y: h },
    { x: 0, y: h },
    { x: 0, y: c },
  ]);
}

/**
 * Punched tape: a band whose top and bottom edges wave in step.
 *
 * Both edges run the same phase, so the band keeps one thickness along its
 * length the way a strip of tape does; edges in opposite phase pinch it into a
 * chain of beads.
 */
export function punchedTapeContour(w: number, h: number, waveHeight: number): ContourGeometry {
  const a = clamp(waveHeight, 0.05, 0.25) * h;
  const lift = (4 / 3) * a;
  return pen()
    .moveTo(0, a)
    .curveTo(w / 6, a - lift, w / 3, a - lift, w / 2, a)
    .curveTo((w * 2) / 3, a + lift, (w * 5) / 6, a + lift, w, a)
    .lineTo(w, h - a)
    .curveTo((w * 5) / 6, h - a + lift, (w * 2) / 3, h - a + lift, w / 2, h - a)
    .curveTo(w / 3, h - a - lift, w / 6, h - a - lift, 0, h - a)
    .close();
}

/** Collate: two triangles meeting point to point, like an hourglass. */
export function collateContour(w: number, h: number): ContourGeometry {
  return polygonContour([
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w / 2, y: h / 2 },
    { x: w, y: h },
    { x: 0, y: h },
    { x: w / 2, y: h / 2 },
  ]);
}

/** Merge: a triangle on its point. Extract is the same triangle upright. */
export function mergeContour(w: number, h: number): ContourGeometry {
  return polygonContour([
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w / 2, y: h },
  ]);
}

/**
 * Stored data: a convex left end and a concave right end.
 *
 * The symbol for data held on any medium, and the one shape in the set whose
 * outline bends inward. `indent` is how deep both curves are, as a share of
 * the width.
 */
export function storedDataContour(w: number, h: number, indent: number): ContourGeometry {
  const r = clamp(indent, 0.05, 0.3) * w;
  return pen()
    .moveTo(r, 0)
    .lineTo(w, 0)
    .arc(w, h / 2, r, h / 2, -Math.PI / 2, (-Math.PI * 3) / 2)
    .lineTo(r, h)
    .arc(r, h / 2, r, h / 2, Math.PI / 2, (Math.PI * 3) / 2)
    .close();
}

/** The reel's horizontal radius: the circle takes the height, the tape the rest. */
export function sequentialReelRadius(w: number, h: number): number {
  return Math.min(h / 2, w * 0.41);
}

/**
 * Sequential access storage: a reel, with the tape leaving it along the
 * bottom.
 *
 * The tape is a run out to the box's right edge and back, so it strokes as a
 * single line and adds no area to the fill.
 */
export function sequentialAccessContour(w: number, h: number): ContourGeometry {
  const rx = sequentialReelRadius(w, h);
  return pen()
    .moveTo(w, h)
    .lineTo(rx, h)
    .arc(rx, h / 2, rx, h / 2, Math.PI / 2, Math.PI / 2 + Math.PI * 2)
    .close();
}

/**
 * Direct access storage: a drum lying on its side.
 *
 * `rimRatio` is the end's depth as a share of the width, the horizontal twin of
 * the upright cylinder's rim.
 */
export function directAccessContour(w: number, h: number, rimRatio: number): ContourGeometry {
  const rx = clamp(rimRatio, 0.05, 0.3) * w;
  return pen()
    .moveTo(rx, 0)
    .lineTo(w - rx, 0)
    .arc(w - rx, h / 2, rx, h / 2, -Math.PI / 2, Math.PI / 2)
    .lineTo(rx, h)
    .arc(rx, h / 2, rx, h / 2, Math.PI / 2, (Math.PI * 3) / 2)
    .close();
}

/** Display: a pointed left end and a rounded right end. */
export function displayContour(w: number, h: number, indent: number): ContourGeometry {
  const d = clamp(indent, 0.05, 0.35) * w;
  return pen()
    .moveTo(0, h / 2)
    .lineTo(d, 0)
    .lineTo(w - d, 0)
    .arc(w - d, h / 2, d, h / 2, -Math.PI / 2, Math.PI / 2)
    .lineTo(d, h)
    .close();
}

// -- Advanced ---------------------------------------------------------------
//
// System-diagram glyphs drawn on the same terms as the rest of the set: one
// stroke weight (the shape's own), soft corners at a share of the short side,
// and detail held between a floor and a ceiling so the glyph reads at 24px and
// at 400px.

/** Where a chat bubble's body ends and its tail begins. */
export function chatBodyHeight(h: number): number {
  return h * 0.8;
}

/**
 * A chat bubble: a soft rectangle with a short tail at the lower left.
 *
 * Distinct from the callout, whose tail is long and can point anywhere: this is
 * the message-in-a-thread mark, and its tail is a fixed, small hook.
 */
export function chatContour(w: number, h: number): ContourGeometry {
  const bh = chatBodyHeight(h);
  const r = Math.min(bh, w) * 0.22;
  const tailL = Math.max(r, w * 0.14);
  const tailR = Math.min(w - r, tailL + Math.max(w * 0.18, 8));
  const tipX = Math.max(0, tailL - w * 0.06);
  return pen()
    .moveTo(r, 0)
    .lineTo(w - r, 0)
    .arc(w - r, r, r, r, -Math.PI / 2, 0)
    .lineTo(w, bh - r)
    .arc(w - r, bh - r, r, r, 0, Math.PI / 2)
    .lineTo(tailR, bh)
    .lineTo(tipX, h)
    .lineTo(tailL, bh)
    .lineTo(r, bh)
    .arc(r, bh - r, r, r, Math.PI / 2, Math.PI)
    .lineTo(0, r)
    .arc(r, r, r, r, Math.PI, (Math.PI * 3) / 2)
    .close();
}

/** Where a padlock's body starts. The shackle takes the box above it. */
export function lockBodyTop(h: number): number {
  return h * 0.44;
}

/**
 * A padlock: a soft body and a shackle with straight legs.
 *
 * The shackle is a band with its own inner edge, so it fills and strokes as a
 * solid hoop rather than as a single line, and it reads as metal at any size.
 */
export function lockContour(w: number, h: number): ContourGeometry {
  const top = lockBodyTop(h);
  const short = Math.min(w, h);
  const body = roundedBox(0, top, w, h - top, short * 0.12);
  const cx = w / 2;
  const t = clamp(short * 0.11, 2, 30);
  const rxo = w * 0.32;
  const rxi = Math.max(rxo - t, 1);
  const ryo = Math.min(rxo, top * 0.8);
  const ryi = Math.max(ryo - t, 1);
  const shackle = pen()
    .moveTo(cx - rxo, top)
    .lineTo(cx - rxo, ryo)
    .arc(cx, ryo, rxo, ryo, Math.PI, Math.PI * 2)
    .lineTo(cx + rxo, top)
    .lineTo(cx + rxi, top)
    .lineTo(cx + rxi, ryo)
    .arc(cx, ryo, rxi, ryi, 0, -Math.PI)
    .lineTo(cx - rxi, top)
    .close();
  return compound(body, shackle);
}
