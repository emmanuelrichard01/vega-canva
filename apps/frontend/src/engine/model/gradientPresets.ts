import type { GradientPaint, GradientStop } from './paint';

/**
 * Gradients worth starting from.
 *
 * A new gradient is the fill's colour fading to nothing, which is a correct
 * default and a dull place to begin. Most gradients on a whiteboard are one of
 * a few moods — a warm header, a cool panel, a soft wash behind a note — and
 * building those stop by stop is the long way to a result everybody recognises.
 *
 * Presets carry **stops only**. Applying one keeps the kind and the geometry
 * the gradient already has, so a radial stays radial and a tilted linear stays
 * tilted: a preset is a set of colours, not a second way to reset the fill.
 */
export interface GradientPreset {
  id: string;
  name: string;
  stops: GradientStop[];
}

export const GRADIENT_PRESETS: readonly GradientPreset[] = [
  { id: 'sunrise', name: 'Sunrise', stops: [{ offset: 0, color: '#FDE68A' }, { offset: 0.5, color: '#FB923C' }, { offset: 1, color: '#E11D48' }] },
  { id: 'lagoon', name: 'Lagoon', stops: [{ offset: 0, color: '#5EEAD4' }, { offset: 1, color: '#2563EB' }] },
  { id: 'aurora', name: 'Aurora', stops: [{ offset: 0, color: '#34D399' }, { offset: 0.5, color: '#22D3EE' }, { offset: 1, color: '#6366F1' }] },
  { id: 'dusk', name: 'Dusk', stops: [{ offset: 0, color: '#6366F1' }, { offset: 0.5, color: '#A855F7' }, { offset: 1, color: '#EC4899' }] },
  { id: 'peach', name: 'Peach', stops: [{ offset: 0, color: '#FFEDD5' }, { offset: 1, color: '#FDA4AF' }] },
  { id: 'mint', name: 'Mint', stops: [{ offset: 0, color: '#ECFDF5' }, { offset: 1, color: '#6EE7B7' }] },
  { id: 'graphite', name: 'Graphite', stops: [{ offset: 0, color: '#F3F4F6' }, { offset: 1, color: '#374151' }] },
  { id: 'night', name: 'Night', stops: [{ offset: 0, color: '#1E293B' }, { offset: 1, color: '#020617' }] },
];

/** A preset's colours on a gradient's own kind and geometry. */
export function applyPreset<T extends GradientPaint>(paint: T, stops: readonly GradientStop[]): T {
  return { ...paint, stops: stops.map((s) => ({ ...s })) };
}

/**
 * The selected colour, fading out — the one preset that depends on the fill.
 *
 * Offered first because it is the gradient people most often want and the one
 * a fixed list cannot contain: a shadowy fade of *this* blue.
 */
export function fadeStops(color: string): GradientStop[] {
  return [
    { offset: 0, color, opacity: 1 },
    { offset: 1, color, opacity: 0 },
  ];
}

/** Whether a gradient's stops are exactly a preset's, for marking it. */
export function matchesPreset(paint: GradientPaint, stops: readonly GradientStop[]): boolean {
  if (paint.stops.length !== stops.length) return false;
  const a = [...paint.stops].sort((x, y) => x.offset - y.offset);
  return a.every(
    (s, i) =>
      Math.abs(s.offset - stops[i].offset) < 0.001 &&
      s.color.toUpperCase() === stops[i].color.toUpperCase() &&
      (s.opacity ?? 1) === (stops[i].opacity ?? 1)
  );
}

/**
 * Where a stop ends up while it is being dragged, and whether it is leaving.
 *
 * Figma's rule: pull a stop well away from the bar and it comes off. The
 * distance is measured perpendicular to the bar, so a stop dragged sideways
 * with a wobbly hand never disappears, and it is refused when only two stops
 * are left — a gradient needs both.
 */
export function stopDrag(
  pointer: { x: number; y: number },
  bar: { left: number; width: number; top: number; bottom: number },
  stopCount: number,
  detachAt = 36
): { offset: number; detaching: boolean } {
  const offset = bar.width <= 0 ? 0 : Math.min(1, Math.max(0, (pointer.x - bar.left) / bar.width));
  const away = pointer.y < bar.top ? bar.top - pointer.y : pointer.y > bar.bottom ? pointer.y - bar.bottom : 0;
  return { offset, detaching: stopCount > 2 && away > detachAt };
}
