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
