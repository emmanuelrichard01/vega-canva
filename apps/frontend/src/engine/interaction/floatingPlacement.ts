/**
 * Where a floating panel opened from a small trigger should go.
 *
 * ## Why the colour picker needed more than "below, else above"
 *
 * The picker is opened from two very different places. In the Properties
 * panel its trigger is a 24px swatch in a 260px column pinned to the right edge
 * of the window, and "below, centred on the swatch" put a 280px panel mostly
 * over the panel it was opened from — covering the very rows (stroke, opacity)
 * that are adjusted next, while the empty board to its left went unused. Figma
 * opens the picker *beside* the properties panel for exactly this reason.
 *
 * On the contextual rail the trigger floats over the artwork, and "below"
 * routinely landed the picker on the object whose colour was being chosen:
 * the one thing the choice needs to be seen against.
 *
 * So the caller says which sides it prefers, in order, and optionally names a
 * rectangle to keep clear of. A side qualifies when the whole panel fits on
 * screen there without crossing that rectangle. When none does, the side with
 * the most room wins and the panel scrolls, rather than running off the window.
 */

export type FloatSide = 'bottom' | 'top' | 'left' | 'right';

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface FloatPlacement {
  x: number;
  y: number;
  side: FloatSide;
  /** Set when the panel must scroll to fit. */
  maxHeight?: number;
}

const intersects = (a: Box, b: Box) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

export function placeFloating(
  trigger: Box,
  size: { width: number; height: number },
  view: { width: number; height: number; margin?: number },
  options: { prefer: readonly FloatSide[]; gap?: number; avoid?: Box | null }
): FloatPlacement {
  const margin = view.margin ?? 8;
  const gap = options.gap ?? 8;
  const { width, height } = size;
  const clampX = (x: number) => Math.max(margin, Math.min(x, view.width - margin - width));
  const clampY = (y: number) => Math.max(margin, Math.min(y, view.height - margin - height));

  const candidate = (side: FloatSide): { x: number; y: number; room: number } => {
    switch (side) {
      case 'bottom':
        return {
          x: clampX((trigger.left + trigger.right) / 2 - width / 2),
          y: trigger.bottom + gap,
          room: view.height - margin - (trigger.bottom + gap),
        };
      case 'top':
        return {
          x: clampX((trigger.left + trigger.right) / 2 - width / 2),
          y: trigger.top - gap - height,
          room: trigger.top - gap - margin,
        };
      case 'left':
        return {
          x: trigger.left - gap - width,
          // Aligned to the trigger's top, a little above it, so the panel's
          // first control sits level with the swatch that opened it.
          y: clampY(trigger.top - 12),
          room: trigger.left - gap - margin,
        };
      case 'right':
        return {
          x: trigger.right + gap,
          y: clampY(trigger.top - 12),
          room: view.width - margin - (trigger.right + gap),
        };
    }
  };

  const along = (side: FloatSide) => (side === 'top' || side === 'bottom' ? height : width);

  for (const side of options.prefer) {
    const c = candidate(side);
    if (c.room < along(side)) continue;
    // A side panel taller than the window is not a fit either.
    if ((side === 'left' || side === 'right') && height > view.height - margin * 2) continue;
    const box = { left: c.x, top: c.y, right: c.x + width, bottom: c.y + height };
    if (options.avoid && intersects(box, options.avoid)) continue;
    return { x: c.x, y: c.y, side };
  }

  // Nothing fits whole: the vertical side with more room, scrolling.
  const below = candidate('bottom');
  const above = candidate('top');
  const pick: 'top' | 'bottom' = below.room >= above.room ? 'bottom' : 'top';
  const chosen = pick === 'bottom' ? below : above;
  const room = Math.max(120, chosen.room);
  const drawn = Math.min(height, room);
  return {
    x: chosen.x,
    y: pick === 'bottom' ? chosen.y : Math.max(margin, trigger.top - gap - drawn),
    side: pick,
    maxHeight: height > room ? room : undefined,
  };
}
