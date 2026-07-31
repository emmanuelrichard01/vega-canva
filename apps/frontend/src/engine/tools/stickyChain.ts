import { nanoid } from 'nanoid';
import { createNode, localAuthor } from '../document';
import type { StickyNode } from '../model/schema';
import { requestEditOnMount } from '../interaction/pendingEdit';

/**
 * Tab out of a sticky note into a new one beside it.
 *
 * Brainstorming is not one note, it is nine, and the cost that decides whether
 * anyone gets to nine is the gap between them: reach for the mouse, find the
 * tool, aim, click, type. Tab collapses that to a keystroke, and it is the
 * reason FigJam and Miro feel fast to think in.
 *
 * The new note inherits colour and size, because a row of notes from one train
 * of thought should look like a row of notes from one train of thought.
 */

/** Gap between chained notes, in world pixels. */
const GAP = 24;

/** Where a chained note goes before it starts wrapping to a new row. */
const ROW_LIMIT = 5;

let chainCount = 0;

/** Reset the wrap counter — a chain that started somewhere else is a new row. */
export function beginStickyChain(): void {
  chainCount = 0;
}

/**
 * Create the next note in a chain and open it for typing.
 *
 * Returns the new node's id, or null if `from` is not a sticky.
 */
export function chainSticky(from: StickyNode): string | null {
  if (from.type !== 'sticky') return null;

  chainCount = (chainCount + 1) % ROW_LIMIT;
  // Wrapping rather than marching off toward the horizon: five notes across is
  // about what stays on screen, and a chain that leaves the viewport is a
  // chain you stop being able to see yourself building.
  const wrapping = chainCount === 0;

  const id = nanoid();
  requestEditOnMount(id);

  createNode({
    id,
    type: 'sticky',
    x: wrapping ? from.x - (ROW_LIMIT - 1) * (from.width + GAP) : from.x + from.width + GAP,
    y: wrapping ? from.y + from.height + GAP : from.y,
    width: from.width,
    height: from.height,
    text: '',
    theme: from.theme,
    fontSize: from.fontSize,
    author: localAuthor(),
    reactions: {},
    tags: [],
    pinned: false,
  });

  return id;
}
