/**
 * Where a line's label rides, and how a line's stroke ends are drawn.
 *
 * Both are questions the canvas, the exporter and the label editor each have
 * to answer, and each answering it alone is how an exported label lands
 * somewhere the board did not put it.
 */

import type { Appearance, Point, ShapeGeometry } from './schema';
import { runPoints } from './lineEnds';
import { isDottedPattern } from './strokeStyle';
import { labelFontSize, labelTextWidth } from './connectorLabelLayout';

/** A label never sits on top of a head: this much of the run is kept clear at each end. */
export const LABEL_END_MARGIN = 0.06;

/**
 * Where along the run a label sits, as a fraction of its length.
 *
 * Absent is the middle. Clamped short of both ends, so a label dragged all the
 * way along still leaves the head it would otherwise cover.
 */
export function labelFraction(geometry: { kind?: string; labelT?: number } | undefined): number {
  const t = geometry?.labelT;
  if (typeof t !== 'number' || !Number.isFinite(t)) return 0.5;
  return Math.min(1 - LABEL_END_MARGIN, Math.max(LABEL_END_MARGIN, t));
}

/** Total length of a run of points. */
export function runLength(points: readonly Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return total;
}

/**
 * The point a fraction of the way along a run, by distance.
 *
 * By distance, not by index: a run of corners with one long leg and three
 * short ones has its middle somewhere on the long leg, and halfway through the
 * point list is nowhere near it. The same holds for a curve sampled finely at
 * its bends and coarsely on its straights.
 */
export function pointAlongRun(points: readonly Point[], t: number): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return { ...points[0] };
  const total = runLength(points);
  if (total < 1e-9) return { ...points[0] };
  let remaining = Math.min(1, Math.max(0, t)) * total;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len >= remaining && len > 0) {
      const k = remaining / len;
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
    }
    remaining -= len;
  }
  return { ...points[points.length - 1] };
}

/**
 * The fraction along a run nearest to `p` — the inverse of `pointAlongRun`.
 *
 * What dragging a label reads: the pointer goes wherever the hand goes, and
 * the label follows the run to the closest place on it.
 */
export function fractionNearest(points: readonly Point[], p: Point): number {
  const total = runLength(points);
  if (points.length < 2 || total < 1e-9) return 0.5;
  let best = { distance: Infinity, along: 0 };
  let walked = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const len = Math.sqrt(len2);
    const k = len2 > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
    const distance = Math.hypot(a.x + dx * k - p.x, a.y + dy * k - p.y);
    if (distance < best.distance) best = { distance, along: walked + len * k };
    walked += len;
  }
  return best.along / total;
}

type LineLike = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
  geometry: ShapeGeometry & { labelT?: number };
};

/** The label's anchor in the line's own space. */
export function lineLabelLocal(node: Omit<LineLike, 'x' | 'y' | 'rotation'>): Point {
  return pointAlongRun(runPoints(node), labelFraction(node.geometry));
}

/** The label's anchor in world space, rotation included. */
export function lineLabelWorld(node: LineLike): Point {
  const local = lineLabelLocal(node);
  const p = { x: node.x + local.x, y: node.y + local.y };
  const degrees = node.rotation ?? 0;
  if (!degrees) return p;
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  const rad = (degrees * Math.PI) / 180;
  const dx = p.x - cx;
  const dy = p.y - cy;
  return { x: cx + dx * Math.cos(rad) - dy * Math.sin(rad), y: cy + dx * Math.sin(rad) + dy * Math.cos(rad) };
}

/**
 * How a line's stroke ends and turns, as the canvas draws it.
 *
 * - A **dotted** pattern is drawn by its round caps, whatever the stored cap.
 * - A **sampled** profile (curved, elbow, wavy, coil) is a run of short
 *   segments, and a mitred join between two of them spikes wherever the
 *   direction changes quickly; it draws round. A zigzag keeps its corners —
 *   they are the shape.
 * - Otherwise the stored cap and join, and absent means the SVG and Canvas2D
 *   defaults (`butt`, `miter`).
 */
export function lineStrokeEnds(
  appearance: Pick<Appearance, 'stroke'> | undefined,
  profile: ShapeGeometry['lineProfile']
): { cap: 'butt' | 'round' | 'square'; join: 'miter' | 'round' | 'bevel' } {
  const stroke = appearance?.stroke;
  const sampled = (profile ?? 'straight') !== 'straight' && profile !== 'zigzag';
  if (sampled) return { cap: 'round', join: 'round' };
  return {
    cap: isDottedPattern(stroke?.dash) ? 'round' : (stroke?.cap ?? 'butt'),
    join: stroke?.join ?? 'miter',
  };
}

/** Padding inside a label's plate, in world units — the connector label's. */
export const LABEL_PAD = 3;

/**
 * A line label's type size and plate, centred on its anchor.
 *
 * The connector label's exact vocabulary — size stepped by the stroke, Inter
 * 500, a plate in the board's colour — because a line drawn between two
 * objects *becomes* a connector, and its label should not change typeface on
 * the way. The canvas and the exporter both size the plate from this.
 */
export function lineLabelBox(text: string, strokeWidth: number): { fontSize: number; width: number; height: number } {
  const fontSize = labelFontSize(strokeWidth);
  return {
    fontSize,
    width: labelTextWidth(text, fontSize) + LABEL_PAD * 2,
    height: fontSize + LABEL_PAD * 2,
  };
}
