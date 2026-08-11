/**
 * Conic and diamond gradients, painted into an offscreen canvas.
 *
 * Canvas2D has `createConicGradient` and nothing at all for a diamond, and
 * Konva exposes neither — its fill priorities are colour, pattern, linear and
 * radial. So these two are drawn once into an image and handed back as a
 * pattern, which is a first-class Konva fill and needs no custom `sceneFunc`
 * on every shape that wants one.
 *
 * Kept apart from `paint.ts` because everything here touches the DOM. That
 * file is the arithmetic and is tested; this one is a canvas and is looked at.
 */

import { hexToRgb, sortedStops, withAlpha, type ConicPaint, type DiamondPaint, type GradientStop } from './paint';

/**
 * Cap on the pattern bitmap's edge, in device pixels.
 *
 * A pattern is redrawn whenever the shape resizes, and a full-resolution
 * bitmap for a 4000px shape is 64MB of canvas allocated on a drag. These
 * gradients are smooth by definition, so a bitmap smaller than the shape and
 * scaled up is indistinguishable from one drawn at size — and the difference
 * between a laggy resize and a smooth one.
 */
const MAX_PATTERN_EDGE = 512;

/** Below this a pattern is a single pixel and the gradient is invisible anyway. */
const MIN_PATTERN_EDGE = 2;

export interface PatternResult {
  image: HTMLCanvasElement;
  /**
   * What to scale the bitmap by to cover the shape.
   *
   * Returned rather than baked in, because the bitmap is deliberately not the
   * shape's size and a caller that assumed it was would paint the gradient
   * into the top-left corner and tile the rest.
   */
  scaleX: number;
  scaleY: number;
}

/**
 * Draw a conic or diamond gradient sized to a box.
 *
 * Returns null when there is nothing to draw — a zero-sized shape, or a
 * document rendering somewhere without a canvas — so a caller falls back to a
 * flat fill rather than to an exception in the middle of a frame.
 */
export function paintPattern(
  paint: ConicPaint | DiamondPaint,
  width: number,
  height: number
): PatternResult | null {
  if (!(width > 0) || !(height > 0)) return null;
  if (typeof document === 'undefined') return null;

  const scale = Math.min(1, MAX_PATTERN_EDGE / Math.max(width, height));
  const w = Math.max(MIN_PATTERN_EDGE, Math.round(width * scale));
  const h = Math.max(MIN_PATTERN_EDGE, Math.round(height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const stops = sortedStops(paint);
  const cx = paint.center.x * w;
  const cy = paint.center.y * h;

  if (paint.type === 'conic') {
    drawConic(ctx, stops, cx, cy, paint.angle, w, h);
  } else {
    drawDiamond(ctx, stops, cx, cy, paint.radius, w, h);
  }

  // The shape is covered by scaling the bitmap back up by whatever was taken
  // off it, which is why the scale is returned rather than assumed to be 1.
  return { image: canvas, scaleX: width / w, scaleY: height / h };
}

function drawConic(
  ctx: CanvasRenderingContext2D,
  stops: GradientStop[],
  cx: number,
  cy: number,
  angleDeg: number,
  w: number,
  h: number
): void {
  // `createConicGradient` measures from three o'clock; a sweep control that
  // starts anywhere but the top is one nobody predicts, so the stored angle is
  // clockwise from twelve and the quarter turn is added here.
  const from = ((angleDeg - 90) * Math.PI) / 180;

  const gradient = supportsConic(ctx)
    ? ctx.createConicGradient(from, cx, cy)
    : null;

  if (gradient) {
    for (const stop of stops) gradient.addColorStop(stop.offset, withAlpha(stop.color, stop.opacity));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
    return;
  }

  // Fallback for a canvas without conic gradients: the same sweep drawn as a
  // fan of wedges. One degree each is below the point at which the banding is
  // visible at the sizes a pattern is ever drawn at, and it is a great deal
  // better than the flat colour the alternative would be.
  const radius = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy));
  for (let deg = 0; deg < 360; deg++) {
    const t = deg / 360;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    // Wedges overlap by a degree so no seam of background shows between them.
    ctx.arc(cx, cy, radius, from + (deg * Math.PI) / 180, from + ((deg + 1.5) * Math.PI) / 180);
    ctx.closePath();
    ctx.fillStyle = sampleStops(stops, t);
    ctx.fill();
  }
}

function supportsConic(
  ctx: CanvasRenderingContext2D
): ctx is CanvasRenderingContext2D & { createConicGradient: (a: number, x: number, y: number) => CanvasGradient } {
  return typeof (ctx as { createConicGradient?: unknown }).createConicGradient === 'function';
}

/**
 * A diamond gradient: concentric rhombi rather than concentric circles.
 *
 * Drawn as nested outlines from the outside in, each one filled with the
 * colour at its own offset. Stroking would leave gaps at the corners where the
 * rhombus is longest; filling from largest to smallest lets each one paint
 * over the middle of the last, which is what makes the result continuous.
 */
function drawDiamond(
  ctx: CanvasRenderingContext2D,
  stops: GradientStop[],
  cx: number,
  cy: number,
  radius: number,
  w: number,
  h: number
): void {
  // Outside the last ring is the final stop's colour, so the corners of the
  // box are filled rather than left transparent.
  ctx.fillStyle = sampleStops(stops, 1);
  ctx.fillRect(0, 0, w, h);

  const rx = Math.max(1, radius * w);
  const ry = Math.max(1, radius * h);
  // One ring per device pixel of the longer axis: any coarser and the bands
  // are visible, any finer and they are redrawing the same pixels.
  const rings = Math.max(2, Math.ceil(Math.max(rx, ry)));

  for (let i = rings; i >= 0; i--) {
    const t = i / rings;
    ctx.beginPath();
    ctx.moveTo(cx, cy - ry * t);
    ctx.lineTo(cx + rx * t, cy);
    ctx.lineTo(cx, cy + ry * t);
    ctx.lineTo(cx - rx * t, cy);
    ctx.closePath();
    ctx.fillStyle = sampleStops(stops, t);
    ctx.fill();
  }
}

/**
 * The colour at a point along the gradient, interpolated in sRGB.
 *
 * Used by the two paths that draw a gradient by hand rather than handing stops
 * to the canvas. sRGB rather than a perceptual space because that is what
 * `addColorStop` does, and a diamond that blended differently from the linear
 * gradient beside it would be a bug with no visible cause.
 */
function sampleStops(stops: GradientStop[], t: number): string {
  if (stops.length === 0) return 'transparent';
  if (t <= stops[0].offset) return withAlpha(stops[0].color, stops[0].opacity);

  const last = stops[stops.length - 1];
  if (t >= last.offset) return withAlpha(last.color, last.opacity);

  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1];
    const b = stops[i];
    if (t > b.offset) continue;
    const span = b.offset - a.offset;
    const local = span <= 0 ? 0 : (t - a.offset) / span;
    return mix(a, b, local);
  }
  return withAlpha(last.color, last.opacity);
}

function mix(a: GradientStop, b: GradientStop, t: number): string {
  const ca = hexToRgb(a.color);
  const cb = hexToRgb(b.color);
  if (!ca || !cb) return withAlpha(a.color, a.opacity);
  const aa = a.opacity ?? 1;
  const ab = b.opacity ?? 1;
  const lerp = (x: number, y: number) => Math.round(x + (y - x) * t);
  return `rgba(${lerp(ca.r, cb.r)}, ${lerp(ca.g, cb.g)}, ${lerp(ca.b, cb.b)}, ${aa + (ab - aa) * t})`;
}
