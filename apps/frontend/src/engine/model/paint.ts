/**
 * What fills a shape.
 *
 * `Paint` was a one-member union — `{ type: 'solid' }` — for the project's
 * whole life, which is why every fill on the board is a flat colour and why
 * the type had a `type` discriminant with nothing to discriminate. This is the
 * rest of the union.
 *
 * ## Gradient geometry is stored in unit space
 *
 * Every point and radius here is a fraction of the node's own box: `{x: 0, y:
 * 0}` is its top-left, `{x: 1, y: 1}` its bottom-right. Nothing is stored in
 * world units.
 *
 * That is the difference between a gradient that survives a resize and one
 * that does not. Absolute coordinates would leave a shape dragged wider with
 * its gradient stranded down the left-hand edge, and a shape scaled up with a
 * hard band where the last stop used to be — which is exactly the bug that
 * makes a gradient feel bolted on rather than part of the object.
 *
 * It also means this module needs no knowledge of where anything is. It is
 * handed a box and returns props; the renderers own the boxes.
 *
 * ## Two families, for one reason
 *
 * Linear and radial are what a 2D canvas draws natively, so they are described
 * in the terms Konva already accepts and cost nothing. Conic and diamond have
 * no native equivalent and are painted into an offscreen canvas by
 * `paintPattern.ts`. The split is visible in the type only through
 * `needsPattern`, so a renderer asks one question rather than switching on
 * five cases.
 */

import type { Point } from './schema';

export type GradientKind = 'linear' | 'radial' | 'conic' | 'diamond';
export type PaintType = 'solid' | GradientKind;

/**
 * One colour along a gradient.
 *
 * `offset` runs 0..1 along the gradient's own axis, not across the shape:
 * for a linear gradient 0 is `from` and 1 is `to`, wherever those are.
 */
export interface GradientStop {
  offset: number;
  color: string;
  /** 0..1. Absent is fully opaque — the stop's own alpha, not the layer's. */
  opacity?: number;
}

export interface SolidPaint {
  type: 'solid';
  color: string;
  opacity?: number;
}

interface GradientBase {
  stops: GradientStop[];
  opacity?: number;
}

export interface LinearPaint extends GradientBase {
  type: 'linear';
  /** Unit-space endpoints of the gradient axis. */
  from: Point;
  to: Point;
}

export interface RadialPaint extends GradientBase {
  type: 'radial';
  center: Point;
  /**
   * Fraction of the box's larger half-dimension.
   *
   * A single radius, so the gradient is a circle even in a wide box. Konva's
   * radial gradient takes radii, not an ellipse, and faking one by scaling the
   * shape would scale its stroke and its text with it.
   */
  radius: number;
}

export interface ConicPaint extends GradientBase {
  type: 'conic';
  center: Point;
  /** Where the sweep begins, in degrees clockwise from twelve o'clock. */
  angle: number;
}

export interface DiamondPaint extends GradientBase {
  type: 'diamond';
  center: Point;
  /** Fraction of the box's half-dimensions; the diamond is inscribed in it. */
  radius: number;
}

export type GradientPaint = LinearPaint | RadialPaint | ConicPaint | DiamondPaint;
export type Paint = SolidPaint | GradientPaint;

export const isGradient = (paint: Paint): paint is GradientPaint => paint.type !== 'solid';

/** Conic and diamond have no native canvas gradient and are painted as images. */
export const needsPattern = (paint: Paint): paint is ConicPaint | DiamondPaint =>
  paint.type === 'conic' || paint.type === 'diamond';

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

/**
 * Fold a stop's own alpha into its colour.
 *
 * Canvas gradients have no per-stop opacity — the alpha has to be in the
 * colour string — so a stop that fades to nothing is `rgba(r,g,b,0)` and not
 * `transparent`, which would fade through black on the way.
 *
 * A colour this cannot parse (a CSS name, an `hsl()`) is returned unchanged
 * rather than guessed at. That loses the stop's opacity, which is the lesser
 * of the two failures: the alternative is a wrong colour, and every colour
 * this application writes is a hex.
 */
export function withAlpha(color: string, opacity: number | undefined): string {
  const alpha = opacity === undefined ? 1 : Math.min(1, Math.max(0, opacity));
  if (alpha >= 1) return color;

  const rgb = hexToRgb(color);
  if (!rgb) return color;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${round(alpha)})`;
}

/** `#rgb`, `#rgba`, `#rrggbb` and `#rrggbbaa`; null for anything else. */
export function hexToRgb(color: string): { r: number; g: number; b: number } | null {
  const hex = color.trim();
  if (hex[0] !== '#') return null;

  const body = hex.slice(1);
  const expand = (s: string) => parseInt(s.length === 1 ? s + s : s, 16);

  if (body.length === 3 || body.length === 4) {
    return { r: expand(body[0]), g: expand(body[1]), b: expand(body[2]) };
  }
  if (body.length === 6 || body.length === 8) {
    return { r: expand(body.slice(0, 2)), g: expand(body.slice(2, 4)), b: expand(body.slice(4, 6)) };
  }
  return null;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * One colour that stands for this paint.
 *
 * For the places that can only show one — the radar's dots, a Layers swatch,
 * the SVG exporter's fallback. The first stop rather than an average, because
 * a gradient is read from its start and an averaged mud colour matches nothing
 * anyone can see on the canvas.
 */
export function paintColor(paint: Paint | undefined, fallback: string): string {
  if (!paint) return fallback;
  if (paint.type === 'solid') return paint.color || fallback;
  return sortedStops(paint)[0]?.color ?? fallback;
}

// ---------------------------------------------------------------------------
// Stops
// ---------------------------------------------------------------------------

/**
 * The stops in drawing order, clamped, with at least two of them.
 *
 * Canvas throws on an offset outside 0..1 and draws nothing at all from a
 * single-stop gradient, and both are reachable from the panel: dragging a stop
 * past the end of the bar, or deleting one until only one is left. Neither
 * should be the renderer's problem, so it is handled once, here.
 *
 * Sorting is not cosmetic — `addColorStop` requires ascending offsets, and a
 * user dragging the first stop past the second is the ordinary way to reverse
 * a gradient.
 */
export function sortedStops(paint: GradientPaint): GradientStop[] {
  const stops = (paint.stops ?? [])
    .filter((s) => s && typeof s.offset === 'number' && Number.isFinite(s.offset))
    .map((s) => ({ ...s, offset: Math.min(1, Math.max(0, s.offset)) }))
    .sort((a, b) => a.offset - b.offset);

  if (stops.length === 0) return [...DEFAULT_STOPS];
  // A gradient of one colour is that colour; duplicating the stop at both ends
  // says so, rather than leaving the canvas with nothing to interpolate.
  if (stops.length === 1) return [{ ...stops[0], offset: 0 }, { ...stops[0], offset: 1 }];
  return stops;
}

/** Flat `[offset, cssColor, ...]`, the form both Konva and Canvas2D want. */
export function colorStopArray(paint: GradientPaint): Array<number | string> {
  const flat: Array<number | string> = [];
  for (const stop of sortedStops(paint)) {
    flat.push(stop.offset, withAlpha(stop.color, stop.opacity));
  }
  return flat;
}

const DEFAULT_STOPS: GradientStop[] = [
  { offset: 0, color: '#6366F1' },
  { offset: 1, color: '#EC4899' },
];

// ---------------------------------------------------------------------------
// Converting between paint types
// ---------------------------------------------------------------------------

/**
 * Change a paint's type, keeping as much of it as still applies.
 *
 * Switching solid to a gradient starts from the colour that was already there
 * and fades it to transparent, so the first thing you see is recognisably the
 * shape you had. Starting from an unrelated two-colour default would look like
 * the fill had been discarded, and the undo you would then reach for is the
 * wrong tool for "put my colour back".
 *
 * Switching between gradients keeps the stops. They are the part that took
 * work; the geometry is one drag to redo.
 */
export function convertPaint(paint: Paint | undefined, to: PaintType): Paint {
  const current = paint ?? { type: 'solid' as const, color: '#4F46E5' };

  if (to === 'solid') {
    return { type: 'solid', color: paintColor(current, '#4F46E5'), opacity: current.opacity };
  }

  const solidColor = current.type === 'solid' ? current.color : undefined;
  const effectiveColor = !solidColor || solidColor === 'transparent' ? '#4F46E5' : solidColor;

  const stops: GradientStop[] = isGradient(current)
    ? sortedStops(current)
    : [
        { offset: 0, color: effectiveColor, opacity: current.opacity ?? 1 },
        { offset: 1, color: effectiveColor, opacity: 0 },
      ];

  const base = { stops, opacity: current.opacity };
  const center = isGradient(current) && 'center' in current ? current.center : { x: 0.5, y: 0.5 };

  switch (to) {
    case 'linear':
      // Top to bottom: the direction a gradient is drawn by default in every
      // tool that has one, and the one a reader assumes when the stops are
      // listed first-to-last down a panel.
      return { ...base, type: 'linear', from: { x: 0.5, y: 0 }, to: { x: 0.5, y: 1 } };
    case 'radial':
      return { ...base, type: 'radial', center, radius: 0.5 };
    case 'conic':
      return { ...base, type: 'conic', center, angle: 0 };
    case 'diamond':
      return { ...base, type: 'diamond', center, radius: 0.5 };
  }
}

// ---------------------------------------------------------------------------
// Linear geometry as an angle
// ---------------------------------------------------------------------------

/**
 * A linear gradient's direction, in degrees clockwise from straight down.
 *
 * Two endpoints is the right *storage* — it is what a canvas draws and what a
 * pair of on-canvas handles would edit directly — but it is the wrong control.
 * Nobody types a pair of unit coordinates to tilt a gradient by fifteen
 * degrees. Zero is downward because that is what a gradient does when you add
 * one and touch nothing.
 */
export function linearAngle(paint: LinearPaint): number {
  const dx = paint.to.x - paint.from.x;
  const dy = paint.to.y - paint.from.y;
  if (dx === 0 && dy === 0) return 0;
  const deg = (Math.atan2(dx, dy) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/**
 * The same gradient pointed a different way, through the centre of the box.
 *
 * The axis is half a unit long in each direction, so the endpoints stay inside
 * the box at every angle. A full-diagonal axis would put the first and last
 * stops outside the shape at 45 degrees, where they are invisible — so turning
 * a gradient would silently compress its visible range.
 */
export function withLinearAngle(paint: LinearPaint, degrees: number): LinearPaint {
  const rad = (degrees * Math.PI) / 180;
  const dx = Math.sin(rad) / 2;
  const dy = Math.cos(rad) / 2;
  return {
    ...paint,
    from: { x: 0.5 - dx, y: 0.5 - dy },
    to: { x: 0.5 + dx, y: 0.5 + dy },
  };
}

// ---------------------------------------------------------------------------
// Konva props
// ---------------------------------------------------------------------------

/** The box a paint is measured against, in the shape's own local coordinates. */
export interface PaintBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Konva fill props for a paint, or null when the paint needs a pattern.
 *
 * Null rather than a thrown error or a silent solid fallback: the caller has
 * to reach for `paintPattern` for conic and diamond, and a fallback would hide
 * a missing call site behind a fill that looks almost right.
 *
 * `fillPriority` is set explicitly on every branch. Konva picks a fill by
 * priority and *leaves the other fill props in place*, so a shape that was a
 * gradient and became solid keeps painting the gradient until the stale props
 * are outranked. React does not unset props it no longer passes.
 */
export function konvaFillProps(
  paint: Paint | undefined,
  box: PaintBox,
  fallback: string
): Record<string, unknown> | null {
  if (!paint || paint.type === 'solid') {
    return {
      fill: withAlpha(paint?.color || fallback, paint?.opacity),
      fillPriority: 'color',
    };
  }

  const at = (p: Point) => ({ x: box.x + p.x * box.width, y: box.y + p.y * box.height });

  if (paint.type === 'linear') {
    return {
      fillPriority: 'linear-gradient',
      fillLinearGradientStartPoint: at(paint.from),
      fillLinearGradientEndPoint: at(paint.to),
      fillLinearGradientColorStops: colorStopArray(paint),
    };
  }

  if (paint.type === 'radial') {
    const centre = at(paint.center);
    return {
      fillPriority: 'radial-gradient',
      fillRadialGradientStartPoint: centre,
      fillRadialGradientEndPoint: centre,
      fillRadialGradientStartRadius: 0,
      fillRadialGradientEndRadius: Math.max(1, paint.radius * Math.max(box.width, box.height)),
      fillRadialGradientColorStops: colorStopArray(paint),
    };
  }

  return null;
}

/**
 * A CSS gradient string for the same paint, for the swatches and previews.
 *
 * The panel shows a paint outside a canvas, and reimplementing the stops in
 * two places is how a preview drifts from the thing it previews. Unit space
 * maps onto CSS percentages directly, which is most of why unit space was the
 * right call for storage.
 */
export function paintToCss(paint: Paint | undefined, fallback = '#4F46E5'): string {
  if (!paint) return fallback;
  if (paint.type === 'solid') return withAlpha(paint.color || fallback, paint.opacity);

  const stops = sortedStops(paint)
    .map((s) => `${withAlpha(s.color, s.opacity)} ${round(s.offset * 100)}%`)
    .join(', ');

  switch (paint.type) {
    case 'linear': {
      // CSS measures its angle clockwise from "to top"; the stored gradient is
      // a vector in a y-down space. atan2 of (dx, -dy) is that conversion.
      const dx = paint.to.x - paint.from.x;
      const dy = paint.to.y - paint.from.y;
      const deg = round((Math.atan2(dx, -dy) * 180) / Math.PI);
      return `linear-gradient(${deg}deg, ${stops})`;
    }
    case 'radial':
      return `radial-gradient(circle at ${round(paint.center.x * 100)}% ${round(paint.center.y * 100)}%, ${stops})`;
    case 'conic':
      return `conic-gradient(from ${round(paint.angle)}deg at ${round(paint.center.x * 100)}% ${round(paint.center.y * 100)}%, ${stops})`;
    case 'diamond':
      // CSS has no diamond gradient. A rotated square radial is the closest
      // honest preview, and the swatch is 24px — the difference is invisible
      // at that size, whereas showing a circle for a diamond is not.
      return `radial-gradient(ellipse ${round(paint.radius * 100)}% ${round(paint.radius * 100)}% at ${round(paint.center.x * 100)}% ${round(paint.center.y * 100)}%, ${stops})`;
  }
}

/**
 * Flip a gradient end for end.
 *
 * ## Why this is a button and not something you do by hand
 *
 * Reversing a two-stop gradient by hand is two colour picks and two drags, and
 * it is the single most common thing anyone does to a gradient after making
 * one — you build it, look at it on the shape, and want it the other way round.
 * At five stops with per-stop opacities it is a dozen operations with no way
 * back if you lose your place.
 *
 * The offsets are mirrored rather than the colours reassigned. Those are the
 * same result for evenly spaced stops and very different results for uneven
 * ones: a stop bunched at 10% should end up bunched at 90%, carrying its own
 * colour and opacity with it, not handing them to whichever stop happens to
 * sit opposite.
 */
export function reverseStops<T extends GradientPaint>(paint: T): T {
  // Generic rather than returning `GradientPaint`: reversing a linear gradient
  // gives a linear gradient, and widening the return would make every caller
  // narrow it again to reach `from`/`to` -- for an operation that provably does
  // not change the kind.
  return {
    ...paint,
    stops: paint.stops
      .map((stop) => ({ ...stop, offset: 1 - stop.offset }))
      .sort((a, b) => a.offset - b.offset),
  };
}

/**
 * Space a gradient's stops evenly from end to end.
 *
 * The tidy-up for a gradient built by adding stops wherever the pointer
 * happened to be. Endpoints are pinned to 0 and 1 rather than merely spaced,
 * because a gradient that stops short of its own extent has a flat band at each
 * end that reads as a rendering fault.
 *
 * Order is taken from where the stops currently sit, not from the array, so the
 * gradient people can see is the one that gets evened out.
 */
export function distributeStops<T extends GradientPaint>(paint: T): T {
  const ordered = [...paint.stops].sort((a, b) => a.offset - b.offset);
  const last = ordered.length - 1;
  return {
    ...paint,
    // One stop has nowhere to be spaced to, and dividing by zero would put it
    // at `NaN` -- which CSS drops, so the gradient would silently lose it.
    stops: ordered.map((stop, i) => ({ ...stop, offset: last <= 0 ? 0 : i / last })),
  };
}
