/**
 * Where a coach mark sits so that it points at the control that raised it.
 *
 * The mark is centred on the seat of the tool you armed, as far as the window
 * allows, and a small tail on its lower edge reaches the rest of the way. That
 * is the whole point of anchoring: the eye is already on the dock seat, so the
 * answer to "what does this do" appears over the thing it is about rather than
 * at a fixed place the eye has to find.
 *
 * Pure, because the clamping is the part that goes wrong: a seat at the far
 * edge of the dock on a narrow window must not push the card off the screen,
 * and the tail must still land on the seat when the card could not be centred.
 */

/** The tail keeps this far from the card's corners so it never sits on a rounded edge. */
const TAIL_INSET = 24;

export interface CoachPlacement {
  /** The card's horizontal centre, in window pixels. */
  centre: number;
  /** Where the tail sits along the card, from its left edge. Null when there is no anchor. */
  tail: number | null;
}

export function coachPlacement(
  anchor: { left: number; width: number } | null,
  card: { width: number },
  viewport: { width: number },
  gutter = 16
): CoachPlacement {
  const half = card.width / 2;
  const lo = gutter + half;
  const hi = viewport.width - gutter - half;
  if (!anchor || hi < lo) return { centre: viewport.width / 2, tail: null };

  const target = anchor.left + anchor.width / 2;
  const centre = Math.min(hi, Math.max(lo, target));
  const tail = Math.min(card.width - TAIL_INSET, Math.max(TAIL_INSET, target - (centre - half)));
  return { centre, tail };
}

/** A screen rectangle by its edges, in window pixels. */
export interface Edges {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface CoachPlacement2D {
  /** The card's top-left corner, in window pixels. */
  left: number;
  top: number;
  /** Where the tail sits along the card, or null when the card is not beside its seat. */
  tail: number | null;
  /** Which side of the seat the card ended up on. */
  side: 'above' | 'below' | null;
  /** The most height the card may take, when the free strip is shorter than the card. */
  maxHeight: number;
  /** The most width the card may take inside the free strip. */
  maxWidth: number;
}

/** Below this, a free strip is too narrow to hold a card, and the card may overlap a panel instead. */
const MIN_CARD_WIDTH = 280;

/**
 * Where a coach card goes so that it is always wholly on screen.
 *
 * The rule, in order:
 *
 * 1. Inside the **free strip**: below the header, above the dock, between the
 *    side panels. A card under a panel or behind the dock is a card nobody can
 *    read, which is what a tool armed from a flyout used to produce.
 * 2. **Above its seat**, tail down, centred on it as far as the strip allows.
 * 3. **Below it**, tail up, when there is no room above (a seat near the top).
 * 4. Otherwise clamped into the strip without a tail, rather than off it.
 *
 * With no seat on screen (a tool armed from a menu or a shortcut) the card
 * sits at the bottom of the strip, centred, where the coach band always was.
 */
export function coachPlacement2D(
  anchor: { left: number; top: number; width: number; height: number } | null,
  card: { width: number; height: number },
  free: Edges,
  viewport: { width: number; height: number },
  gap = 12,
  gutter = 16
): CoachPlacement2D {
  // Horizontal room: the strip, or the window when the strip is too narrow.
  let lo = free.left;
  let hi = free.right;
  if (hi - lo < Math.min(card.width, MIN_CARD_WIDTH)) {
    lo = gutter;
    hi = viewport.width - gutter;
  }
  const maxWidth = Math.max(0, hi - lo);
  const width = Math.min(card.width, maxWidth);
  const maxHeight = Math.max(0, free.bottom - free.top);
  const height = Math.min(card.height, maxHeight);

  const clampX = (x: number) => Math.min(Math.max(x, lo), Math.max(lo, hi - width));
  const clampY = (y: number) => Math.min(Math.max(y, free.top), Math.max(free.top, free.bottom - height));

  const onScreen =
    anchor &&
    anchor.width > 0 &&
    anchor.height > 0 &&
    anchor.left + anchor.width > 0 &&
    anchor.left < viewport.width &&
    anchor.top + anchor.height > 0 &&
    anchor.top < viewport.height;

  if (!anchor || !onScreen) {
    return {
      left: clampX((lo + hi) / 2 - width / 2),
      top: clampY(free.bottom - height),
      tail: null,
      side: null,
      maxHeight,
      maxWidth,
    };
  }

  const target = anchor.left + anchor.width / 2;
  const left = clampX(target - width / 2);
  const tailAt = target - left;
  const tail = tailAt >= TAIL_INSET && tailAt <= width - TAIL_INSET ? tailAt : null;

  const above = anchor.top - gap - height;
  if (above >= free.top - 0.5 || anchor.top >= free.bottom) {
    // The seat is in or below the strip's bottom edge (the dock): the card
    // sits on top of it, clamped into the strip.
    const top = clampY(above);
    // Lifted clear of the dock by a few pixels still reads as pointing at the
    // seat; lifted further, or pushed down, it does not and loses its tail.
    const adjacent = above - top <= 28 && top - above <= 1;
    return { left, top, tail: adjacent ? tail : null, side: adjacent ? 'above' : null, maxHeight, maxWidth };
  }
  const below = anchor.top + anchor.height + gap;
  if (below + height <= free.bottom + 0.5) {
    return { left, top: below, tail, side: 'below', maxHeight, maxWidth };
  }
  return { left, top: clampY(above), tail: null, side: null, maxHeight, maxWidth };
}
