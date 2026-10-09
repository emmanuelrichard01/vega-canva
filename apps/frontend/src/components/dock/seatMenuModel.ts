/**
 * When a seat's mini flyout opens and closes: one model for every seat that
 * has variants to choose between (Shape, Frame, Data, Chart, Table, Grid).
 *
 * - **A click** arms the seat's tool and opens its flyout at once, anchored to
 *   the seat. A second click on the armed seat closes the flyout and leaves
 *   the tool armed. A click on another seat swaps one flyout for the other.
 * - **The caret, a long press, Up or a second press of the tool's key** opens
 *   it without the click's arming (the caret toggles).
 * - **Picking an option** arms that variant and leaves the flyout open.
 * - **Escape, a press anywhere else, or placing on the board** closes it.
 * - **A tool the person may not use** never opens a flyout: a viewer pressing
 *   Shape gets the refusal notice, not a menu of shapes they cannot draw.
 *
 * Draw, Text and Connector show their options on the shelf, which follows the
 * armed tool, so a click "opens" them the same way without passing through
 * here. Select and Hand open nothing on a click: Select is the tool everybody
 * returns to between every other one, and a menu each time would sit over the
 * work.
 *
 * Pure, so the rules are tested apart from the dock that applies them.
 */

export type SeatMenuEvent<M extends string> =
  /** A click on the seat. `armed`: its tool is the one in hand. */
  | { type: 'click'; menu: M; armed: boolean; allowed: boolean }
  /** The corner caret. */
  | { type: 'caret'; menu: M; allowed: boolean }
  /** Up on the seat, a long press, or the tool's key pressed while it is armed. */
  | { type: 'open'; menu: M; allowed: boolean }
  /** An option chosen inside the flyout. */
  | { type: 'pick' }
  /** Escape, a press outside the dock, or a placement on the board. */
  | { type: 'dismiss' };

export interface SeatMenuStep<M extends string> {
  /** The flyout open after the event. */
  open: M | null;
  /** Whether the seat's tool should be armed by this event. */
  arm: boolean;
}

export function seatMenuStep<M extends string>(open: M | null, event: SeatMenuEvent<M>): SeatMenuStep<M> {
  switch (event.type) {
    case 'click':
      // The second click on an armed seat with its flyout up: close, keep the tool.
      if (open === event.menu && event.armed) return { open: null, arm: false };
      return { open: event.allowed ? event.menu : open === event.menu ? null : open, arm: true };
    case 'caret':
      if (open === event.menu) return { open: null, arm: false };
      return { open: event.allowed ? event.menu : open, arm: false };
    case 'open':
      return { open: event.allowed ? event.menu : open, arm: false };
    case 'pick':
      return { open, arm: false };
    case 'dismiss':
      return { open: null, arm: false };
  }
}

/**
 * How a flyout arrives: rising from its seat when nothing was open, a quick
 * cross-fade when it replaces another seat's (so moving along the dock does
 * not flicker shut and open again), and nothing when it was already up.
 */
export type FlyoutMotion = 'rise' | 'swap' | 'settled';

export function flyoutMotion<M extends string>(before: M | null, after: M | null): FlyoutMotion {
  if (after === null || after === before) return 'settled';
  return before === null ? 'rise' : 'swap';
}

/** The entrance and exit, in seconds and px. Reduced motion is an instant swap. */
export function flyoutTransition(motion: FlyoutMotion, reduced: boolean) {
  if (reduced) return { rise: 0, enter: 0, exit: 0 };
  return motion === 'swap' ? { rise: 0, enter: 0.1, exit: 0.08 } : { rise: 6, enter: 0.14, exit: 0.09 };
}
