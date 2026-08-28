/**
 * A walk round the screen, once, and again whenever anybody wants it.
 *
 * ## What this is for, and what `lessons.ts` is for
 *
 * They answer different questions and that is the whole reason there are two.
 *
 * A lesson is about a **verb**: what a click does that a drag does not, how a
 * picture gets into a grid module, why an arrow survives the box it points at
 * being moved. It arrives when you pick up the tool it belongs to, because that
 * is the moment you are about to need it, and it retires when you use the tool.
 *
 * A tour is about **nouns and where they live**: this is the dock, that rail is
 * the layer list, the radar is in that corner. Nobody needs that at a
 * particular moment; they need it once, near the beginning, and then never
 * again unless they ask. Teaching it just-in-time is the wrong shape, and
 * teaching verbs in a tour is the thing that makes tours unbearable.
 *
 * The panels used to be taught by a coach mark on a "moment" -- the first
 * selection, the fifth object. That was two mistakes. It said "click the rail
 * on the right" from a card floating above the dock, pointing at nothing, which
 * is the worst version of a spatial instruction. And it fired at a moment
 * somebody had chosen to do something else. Both are fixed by pointing at the
 * actual rail and by asking first.
 *
 * ## Why the anchors are strings, and how they are kept honest
 *
 * A step names a `data-tour` attribute rather than holding a ref, because the
 * elements are spread across six components at three levels and threading refs
 * through all of them to satisfy a tour would let the tour dictate the shape of
 * the application.
 *
 * A string that silently matches nothing is the obvious rot in that, so
 * `tour.test.ts` reads the source and fails if any anchor here is not written
 * on a real element. And at runtime a step whose element is genuinely absent
 * -- focus mode, a narrow window, a panel someone already opened -- is skipped
 * rather than pointed at, because a spotlight on nothing is worse than one step
 * fewer.
 */

export type TourSide = 'top' | 'bottom' | 'left' | 'right';

export interface TourStep {
  id: string;
  /** The `data-tour` value written on the element this points at. */
  anchor: string;
  title: string;
  /**
   * One sentence.
   *
   * The limit is the point. A tour that explains is a tour people skip; a tour
   * that *locates* is one they finish, and everything a sentence cannot hold is
   * already in the reference or arrives as a lesson when the tool is picked up.
   */
  body: string;
  /** Where the card should sit if there is room. */
  side: TourSide;
}

export const TOUR: readonly TourStep[] = [
  {
    id: 'dock',
    anchor: 'dock',
    title: 'Everything you can make',
    body: 'Every tool lives here, each on one key. Press the key or click the icon, then draw on the board.',
    side: 'top',
  },
  {
    id: 'layers',
    anchor: 'layers',
    title: 'What is on the board',
    body: 'Open this for the whole board as a list, in stacking order, with anything hidden or locked said plainly.',
    side: 'right',
  },
  {
    id: 'radar',
    anchor: 'radar',
    title: 'Where everything is',
    body: 'A map of the whole board with your view as a box on it. Click anywhere on it to send the camera there.',
    side: 'right',
  },
  {
    id: 'properties',
    anchor: 'properties',
    title: 'Everything about what you picked',
    body: 'Select something and open this for its fill, stroke, type and effects. It stays closed until you want it.',
    side: 'left',
  },
  {
    id: 'share',
    anchor: 'share',
    title: 'Bring people in',
    body: 'One link and they are here. No account, nothing to accept, and you watch their cursor move as they think.',
    side: 'bottom',
  },
  {
    id: 'help',
    anchor: 'help',
    title: 'The rest of it',
    body: 'Every shortcut and every gesture worth knowing. It is also on the question-mark key from anywhere.',
    side: 'bottom',
  },
];

/* ------------------------------------------------------------- placement -- */

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Placement {
  x: number;
  y: number;
  /** Where it ended up, which is not always where it asked to be. */
  side: TourSide;
}

/**
 * How far the card sits from the thing it points at.
 *
 * Wide, because a pen stroke runs between them. Fourteen was the right number
 * when the card had a little beak, and it is the wrong one now: at that
 * distance the pointer is twenty pixels long, half of it behind the card, and
 * an arrow you cannot see is worse than no arrow because it was drawn anyway.
 *
 * Fifty-six gives the arc room to be a gesture rather than a leader line, and
 * the space reads as deliberate on its own -- annotation sits *near* a thing,
 * not against it.
 */
export const TOUR_GAP = 56;

/** How close to the viewport edge the card may come. */
const MARGIN = 12;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** The two sides at right angles to each one, in the order worth trying. */
const PERPENDICULAR: Record<TourSide, TourSide[]> = {
  top: ['right', 'left'],
  bottom: ['right', 'left'],
  left: ['bottom', 'top'],
  right: ['bottom', 'top'],
};

/**
 * Where a card of this size can sit beside this anchor.
 *
 * ## Why the preferred side is only a preference
 *
 * The step says where it would like to be, from what it knows about the layout:
 * the dock is at the foot of the screen so its card belongs above it. But the
 * layout is not fixed. A rail's card wants to be beside it and there is no room
 * on a narrow window; the header's card wants to be below and is fine; the
 * radar sits in the bottom-left corner where "right" and "top" both work and
 * "left" does not exist.
 *
 * So this tries the asked-for side, then the opposite, then the two
 * perpendicular ones, and takes the first whose own axis fits, sliding along
 * the other. If none of them fits -- a window smaller than the card -- it keeps
 * the preference and clamps, because a card half off the screen in the right
 * general direction still reads as pointing at something, and one placed by a
 * rule nobody can predict does not.
 *
 * Pure and tested because it is the sort of arithmetic that looks right in
 * source and is wrong in the corner of the screen you did not try.
 */
export function placeCard(
  anchor: Box,
  card: Size,
  viewport: Size,
  prefer: TourSide
): Placement {
  const at = (side: TourSide) => {
    switch (side) {
      case 'top':
        return { x: anchor.x + anchor.width / 2 - card.width / 2, y: anchor.y - card.height - TOUR_GAP };
      case 'bottom':
        return { x: anchor.x + anchor.width / 2 - card.width / 2, y: anchor.y + anchor.height + TOUR_GAP };
      case 'left':
        return { x: anchor.x - card.width - TOUR_GAP, y: anchor.y + anchor.height / 2 - card.height / 2 };
      default:
        return { x: anchor.x + anchor.width + TOUR_GAP, y: anchor.y + anchor.height / 2 - card.height / 2 };
    }
  };

  const opposite: Record<TourSide, TourSide> = {
    top: 'bottom',
    bottom: 'top',
    left: 'right',
    right: 'left',
  };
  const order: TourSide[] = [prefer, opposite[prefer], ...PERPENDICULAR[prefer]];

  const inX = (x: number) => clamp(x, MARGIN, Math.max(MARGIN, viewport.width - card.width - MARGIN));
  const inY = (y: number) => clamp(y, MARGIN, Math.max(MARGIN, viewport.height - card.height - MARGIN));

  for (const side of order) {
    const p = at(side);
    const vertical = side === 'top' || side === 'bottom';

    /**
     * Only the axis the side actually decides has to fit.
     *
     * A side positions the card on one axis and centres it on the other, and
     * the centred one is free to slide. Testing both was the first version and
     * it rejected sides that were perfectly good: the radar sits in the
     * bottom-left corner, and "above it" fails only because centring a 300px
     * card on a 150px pill puts its left edge off the screen. Sliding it right
     * by sixty pixels is what any popover does, and refusing the side instead
     * sent the card somewhere much worse.
     */
    const constrained = vertical
      ? p.y >= MARGIN && p.y + card.height <= viewport.height - MARGIN
      : p.x >= MARGIN && p.x + card.width <= viewport.width - MARGIN;
    if (!constrained) continue;

    return { x: inX(p.x), y: inY(p.y), side };
  }

  // No side fits on its own axis, which means a window smaller than the card.
  // Keep the asked-for side so the card is at least in the direction the step
  // meant, and pull it inside the viewport.
  const p = at(prefer);
  return { x: inX(p.x), y: inY(p.y), side: prefer };
}
