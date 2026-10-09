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
 *   Escape is spent on the menu: it does not also hand the board to Select.
 * - **Arming a tool another way** (a key, another seat, the palette) closes
 *   a flyout that does not own the new tool, so a stale Shapes menu never
 *   hangs over the pencil.
 * - **A right-click** on a seat opens its menu, as a long press does.
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
  | { type: 'dismiss' }
  /** The armed tool changed. `owner`: the menu whose seat holds the new tool, if any. */
  | { type: 'tool'; owner: M | null };

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
    case 'tool':
      return { open: open !== null && open === event.owner ? open : null, arm: false };
  }
}

/**
 * How a flyout arrives: rising from its seat when nothing was open, swapped
 * in place when it replaces another seat's (the old one goes at once and the
 * new one fades in briefly, so two panels never stand on the same spot), and
 * nothing when it was already up.
 */
export type FlyoutMotion = 'rise' | 'swap' | 'settled';

export function flyoutMotion<M extends string>(before: M | null, after: M | null): FlyoutMotion {
  if (after === null || after === before) return 'settled';
  return before === null ? 'rise' : 'swap';
}

/** The entrance and exit, in seconds and px. Reduced motion is an instant swap. */
export function flyoutTransition(motion: FlyoutMotion, reduced: boolean) {
  if (reduced) return { rise: 0, enter: 0, exit: 0 };
  return motion === 'swap' ? { rise: 0, enter: 0.08, exit: 0 } : { rise: 6, enter: 0.14, exit: 0.09 };
}

/**
 * Where a key moves focus along a run of `count` items, from `at`.
 *
 * `axis` names the arrows that walk the run: a list walks with Up and Down,
 * a row of tiles with Left and Right. Home and End go to either end, and the
 * arrows wrap. Null when the key is not one of these, so the caller lets it
 * through.
 */
export function rovingIndex(key: string, at: number, count: number, axis: 'vertical' | 'horizontal'): number | null {
  if (count <= 0) return null;
  const [back, forward] = axis === 'vertical' ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight'];
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (key === forward) return at < 0 ? 0 : (at + 1) % count;
  if (key === back) return at < 0 ? count - 1 : (at - 1 + count) % count;
  return null;
}

/**
 * Typeahead: the next item after `at` whose label starts with `char`.
 *
 * Searches forward and wraps, so pressing the same letter again cycles
 * through every item that starts with it, as in a native menu. Null when
 * nothing matches or the key is not a single printable character.
 */
export function typeaheadIndex(labels: readonly string[], at: number, char: string): number | null {
  if (char.length !== 1 || char === ' ' || labels.length === 0) return null;
  const want = char.toLocaleLowerCase();
  for (let step = 1; step <= labels.length; step++) {
    const i = (((at + step) % labels.length) + labels.length) % labels.length;
    if (labels[i]?.trim().toLocaleLowerCase().startsWith(want)) return i;
  }
  return null;
}

/**
 * The second line of a seat's tooltip: what the seat holds, then how to keep
 * it. The double-click lock is otherwise a gesture nobody can find; this is
 * where it says it exists and, once kept, how to let go.
 */
export function seatTipDescription(
  description: string | undefined,
  lock: 'none' | 'open' | 'kept'
): string | undefined {
  const lead = description ? description.charAt(0).toUpperCase() + description.slice(1) : undefined;
  const tail =
    lock === 'open' ? 'Double-click to keep armed'
    : lock === 'kept' ? 'Kept armed. Double-click to let go'
    : undefined;
  if (lead && tail) return `${lead}. ${tail}`;
  return lead ?? tail;
}
