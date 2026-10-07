import type { RoomRole } from '../model/permissions';

/**
 * A walk round the screen: where things live, pointed at rather than described.
 *
 * ## What this is for, and what `lessons.ts` is for
 *
 * A lesson is about a **verb** and arrives when you pick up its tool. A tour is
 * about **nouns and where they live**: this is the dock, that is Insert, the
 * record button is up there. People need that once, near the beginning, and
 * then only when they ask, so the tour is offered, never started on its own.
 *
 * ## Anchors
 *
 * A step names a `data-tour` value rather than holding a ref, so the tour does
 * not dictate the shape of six components. Some surfaces belong to other
 * owners and do not carry their hook yet; those steps also name a `fallback`
 * selector built from an attribute or class the element already has.
 * `resolveAnchor` prefers the hook, and `tour.test.ts` fails if a step's hook
 * and fallback both match nothing in the source.
 *
 * A step whose element is not on screen (focus mode, a narrow window, a role
 * that does not get that control) is skipped rather than pointed at.
 */

export type TourSide = 'top' | 'bottom' | 'left' | 'right';

export interface TourStep {
  id: string;
  /** The `data-tour` value written on the element this points at. */
  anchor: string;
  /** A selector for the same element, used while it does not carry `anchor`. */
  fallback?: string;
  title: string;
  /** One or two short sentences. The tour locates; lessons explain. */
  body: string;
  /** The same step said for a role that cannot do what `body` describes. */
  bodyFor?: Partial<Record<RoomRole, string>>;
  /** Who sees this step. Absent means everyone. */
  roles?: readonly RoomRole[];
  /** Where the card should sit if there is room. */
  side: TourSide;
}

export const TOUR: readonly TourStep[] = [
  {
    id: 'board',
    anchor: 'layers',
    title: 'Your board',
    body: 'Rename it, see its layers, and open the board menu for export, view settings and help.',
    bodyFor: {
      viewer: 'The board’s name and its layers. The menu by the title has view settings and help.',
      commenter: 'The board’s name and its layers. The menu by the title has view settings and help.',
    },
    side: 'right',
  },
  {
    id: 'dock',
    anchor: 'dock',
    title: 'The dock',
    body: 'Every tool, most on a single key. Draw opens a tray of pens and notes just above it.',
    bodyFor: {
      viewer: 'Select and move around from here. This link can look at the board but not change it.',
      commenter: 'Select, move around and comment from here. Press C to pin a comment anywhere.',
    },
    side: 'top',
  },
  {
    id: 'insert',
    anchor: 'insert',
    fallback: '[data-seat="media"]',
    title: 'Insert',
    body: 'Images, voice notes, links, code, diagrams and icons, in one searchable library.',
    roles: ['editor'],
    side: 'top',
  },
  {
    id: 'all-tools',
    anchor: 'all-tools',
    fallback: '[id^="dock-seat-all-"]',
    title: 'All tools',
    body: 'Every tool with its key. Pin the ones you use to the dock, or rearrange it.',
    roles: ['editor'],
    side: 'top',
  },
  {
    id: 'properties',
    anchor: 'properties',
    title: 'Properties and people',
    body: 'Who is here, the comments, and everything about what you selected: fill, stroke, type and effects.',
    bodyFor: {
      viewer: 'Who is on the board right now, the comments, and the board’s history.',
      commenter: 'Who is on the board right now, the comments, and the board’s history.',
    },
    side: 'left',
  },
  {
    id: 'share',
    anchor: 'share',
    title: 'Bring people in',
    body: 'One link and they are here, with their cursor beside yours. Choose whether they can edit, comment or view.',
    bodyFor: {
      viewer: 'Pass the board on. A link you make carries no more access than your own.',
      commenter: 'Pass the board on. A link you make carries no more access than your own.',
    },
    side: 'bottom',
  },
  {
    id: 'zoom',
    anchor: 'zoom',
    fallback: '.zoom-ctl',
    title: 'Zoom',
    body: 'Step in and out, or type a percentage. Ctrl and scroll zooms too.',
    side: 'top',
  },
  {
    id: 'music',
    anchor: 'music',
    fallback: '.hdr-music',
    title: 'Music while you work',
    body: 'Put on a station or your own Spotify. It plays for you, and sharing it is your choice.',
    side: 'bottom',
  },
];

/** Whether a role is shown a step at all. */
export function stepAllowed(step: TourStep, role: RoomRole): boolean {
  return !step.roles || step.roles.includes(role);
}

/** The step's words for this role. */
export function stepBody(step: TourStep, role: RoomRole): string {
  return step.bodyFor?.[role] ?? step.body;
}

/** The indexes into `TOUR` a role walks through, in order. */
export function stepsFor(role: RoomRole): number[] {
  return TOUR.flatMap((step, i) => (stepAllowed(step, role) ? [i] : []));
}

/** The minimum a resolved element has to offer to be pointed at. */
export interface AnchorProbe {
  /** Its box on screen. A zero-sized box is an element that is not shown. */
  box(): Box;
}

/**
 * The element a step points at: its `data-tour` hook first, then its fallback,
 * and only one that is actually laid out on screen.
 *
 * `query` returns every match for a selector, so a hook that exists twice (the
 * open panel and the collapsed pill, of which one is hidden) resolves to the
 * one that is showing.
 */
export function resolveAnchor<T extends AnchorProbe>(
  step: TourStep,
  query: (selector: string) => readonly T[]
): T | null {
  const selectors = [`[data-tour="${step.anchor}"]`, ...(step.fallback ? [step.fallback] : [])];
  for (const selector of selectors) {
    for (const el of query(selector)) {
      const b = el.box();
      if (b.width > 0 && b.height > 0) return el;
    }
  }
  return null;
}

/**
 * The next step in the direction of travel that can be shown, or `null` if
 * there is none that way.
 *
 * `present` decides; the component passes a probe that checks the role and the
 * document. Returning `null` at either end is what lets the caller end the
 * tour rather than leave it running with nothing on screen and its key handler
 * still swallowing Escape.
 */
export function nextVisibleStep(
  from: number,
  direction: 1 | -1,
  present: (step: TourStep) => boolean
): number | null {
  for (let at = from; at >= 0 && at < TOUR.length; at += direction) {
    if (present(TOUR[at])) return at;
  }
  return null;
}

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
 * How far the card sits from the element it points at.
 *
 * Enough to clear the pen ring drawn round the element (ten pixels out, plus
 * its wobble) and leave a visible gap, close enough that the two read as one.
 */
export const TOUR_GAP = 24;

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

const OPPOSITE: Record<TourSide, TourSide> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
};

/**
 * Where a card of this size can sit beside this anchor.
 *
 * Tries the asked-for side, then the opposite, then the two perpendicular ones,
 * and takes the first whose own axis fits, sliding along the other. Only the
 * deciding axis has to fit: a card centred on a small pill in a corner slides
 * sideways the way any popover does. If nothing fits (a window smaller than the
 * card) it keeps the preference and clamps, so it still points the right way.
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

  const order: TourSide[] = [prefer, OPPOSITE[prefer], ...PERPENDICULAR[prefer]];

  const inX = (x: number) => clamp(x, MARGIN, Math.max(MARGIN, viewport.width - card.width - MARGIN));
  const inY = (y: number) => clamp(y, MARGIN, Math.max(MARGIN, viewport.height - card.height - MARGIN));

  for (const side of order) {
    const p = at(side);
    const vertical = side === 'top' || side === 'bottom';
    const fits = vertical
      ? p.y >= MARGIN && p.y + card.height <= viewport.height - MARGIN
      : p.x >= MARGIN && p.x + card.width <= viewport.width - MARGIN;
    if (fits) return { x: inX(p.x), y: inY(p.y), side };
  }

  const p = at(prefer);
  return { x: inX(p.x), y: inY(p.y), side: prefer };
}
