import type { EndCapShape } from '../../../engine/model/connectorEnds';
import type { ShadowSilhouette, ShadowStroke, LocalBox } from './ShapeEffects';

/**
 * Silhouette builders for `DropShadow`: the same ink a renderer draws, as
 * `Path2D`s the shadow can paint in one pass.
 *
 * Built from the renderer's own numbers — the run it strokes, the markers it
 * places — so the shadow cannot describe a different line from the one on
 * screen.
 */

/** An open polyline through flat `[x0, y0, x1, y1, …]` points. */
export function polylinePath(points: readonly number[]): Path2D {
  const path = new Path2D();
  for (let i = 0; i + 1 < points.length; i += 2) {
    if (i === 0) path.moveTo(points[i], points[i + 1]);
    else path.lineTo(points[i], points[i + 1]);
  }
  return path;
}

/** One end marker's ink, painted the way the renderers paint it. */
export function capSilhouette(cap: EndCapShape | null | undefined, width: number): ShadowSilhouette {
  if (!cap) return {};
  if (cap.circle) {
    const path = new Path2D();
    path.arc(cap.circle.x, cap.circle.y, cap.circle.radius, 0, Math.PI * 2);
    return {
      fills: cap.filled ? [{ path }] : [],
      strokes: [{ path, width }],
    };
  }
  const pts = cap.points ?? [];
  if (pts.length < 4) return {};
  const path = polylinePath(pts);
  if (cap.filled) path.closePath();
  return {
    fills: cap.filled ? [{ path }] : [],
    strokes: [{ path, width, cap: 'round', join: 'round' }],
  };
}

/** Several silhouettes as one. */
export function mergeSilhouettes(...parts: ShadowSilhouette[]): ShadowSilhouette {
  const fills: NonNullable<ShadowSilhouette['fills']>[number][] = [];
  const strokes: ShadowStroke[] = [];
  const rasters: NonNullable<ShadowSilhouette['raster']>[] = [];
  for (const p of parts) {
    if (p.fills) fills.push(...p.fills);
    if (p.strokes) strokes.push(...p.strokes);
    if (p.raster) rasters.push(p.raster);
  }
  return {
    fills,
    strokes,
    raster: rasters.length ? (ctx) => rasters.forEach((r) => r(ctx)) : undefined,
  };
}

/** The box around flat points, grown by `pad` on every side. */
export function pointsBox(points: readonly number[], pad: number): LocalBox {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i + 1 < points.length; i += 2) {
    x0 = Math.min(x0, points[i]);
    x1 = Math.max(x1, points[i]);
    y0 = Math.min(y0, points[i + 1]);
    y1 = Math.max(y1, points[i + 1]);
  }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: x0 - pad, y: y0 - pad, width: x1 - x0 + pad * 2, height: y1 - y0 + pad * 2 };
}

/**
 * How far a stroke's ink can reach past the edge it is drawn on.
 *
 * Half the weight for a centred stroke, all of it for an outside one, none for
 * an inside one — and a mitred corner reaches further, up to half the miter
 * limit times the weight at the sharpest point of a star. The box only sizes
 * the scratch bitmap, so it errs wide: a box too small would clip the tip of
 * the shadow of the tip of a star.
 */
export function strokeReach(width: number, align: 'center' | 'inside' | 'outside' = 'center', join: string = 'miter', miterLimit = 10): number {
  if (!(width > 0) || align === 'inside') return 0;
  const base = align === 'outside' ? width : width / 2;
  return join === 'miter' ? base * Math.max(1, Math.min(miterLimit, 10)) : base;
}
