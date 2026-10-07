import { nanoid } from 'nanoid';
import { createNode, localAuthor } from '../document';
import type { StickyNode } from '../model/schema';
import { requestEditOnMount } from '../interaction/pendingEdit';
import { spatialIndex } from '../SpatialIndex';

/**
 * Tab out of a sticky note into a new one beside it.
 *
 * Tab goes right, Shift+Tab goes down. The new note inherits colour and size,
 * so a row of notes from one train of thought reads as one row, and it lands
 * in the nearest free slot in that direction rather than on top of whatever
 * is already there.
 */

/** Gap between chained notes, in world pixels. */
export const CHAIN_GAP = 24;

/** Notes in a rightward run before it wraps to the next row. */
export const ROW_LIMIT = 5;

/** How far past an occupied slot a chain looks for room before giving up. */
const MAX_PROBES = 12;

export type ChainDirection = 'right' | 'down';

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

let chainCount = 0;
let chainOriginX: number | null = null;

/** Reset the wrap counter: a chain that started somewhere else is a new row. */
export function beginStickyChain(): void {
  chainCount = 0;
  chainOriginX = null;
}

/**
 * Where the next note in a chain goes.
 *
 * Pure: `occupied` answers whether a box overlaps something already on the
 * board. The first candidate is one step from `from`; each blocked candidate
 * steps once more in the same direction. If nothing is free within the probe
 * budget the first candidate is used, because a note on top of another is
 * still better than a keystroke that does nothing.
 */
export function nextChainSlot(
  from: Box,
  direction: ChainDirection,
  occupied: (box: Box) => boolean,
  wrap?: { originX: number }
): { x: number; y: number } {
  const stepX = from.width + CHAIN_GAP;
  const stepY = from.height + CHAIN_GAP;

  const first =
    wrap
      ? { x: wrap.originX, y: from.y + stepY }
      : direction === 'right'
        ? { x: from.x + stepX, y: from.y }
        : { x: from.x, y: from.y + stepY };

  let candidate = first;
  for (let i = 0; i < MAX_PROBES; i++) {
    if (!occupied({ ...candidate, width: from.width, height: from.height })) return candidate;
    candidate =
      direction === 'right' && !wrap
        ? { x: candidate.x + stepX, y: candidate.y }
        : { x: candidate.x, y: candidate.y + stepY };
  }
  return first;
}

/** True when `box`, inset by a pixel, overlaps any indexed node other than `ignore`. */
function boardHasSomethingIn(box: Box, ignore: string): boolean {
  const hits = spatialIndex.query({
    minX: box.x + 1,
    minY: box.y + 1,
    maxX: box.x + box.width - 1,
    maxY: box.y + box.height - 1,
  });
  // A frame is a place notes go, not an obstacle to them.
  return hits.some((n) => n.id !== ignore && n.type !== 'frame' && n.type !== 'connector');
}

/**
 * Create the next note in a chain and open it for typing.
 *
 * Returns the new node's id, or null if `from` is not a sticky.
 */
export function chainSticky(from: StickyNode, direction: ChainDirection = 'right'): string | null {
  if (from.type !== 'sticky') return null;

  let wrap: { originX: number } | undefined;
  if (direction === 'right') {
    if (chainOriginX === null) chainOriginX = from.x;
    chainCount = (chainCount + 1) % ROW_LIMIT;
    // Five across is about what stays on screen; past that the run wraps
    // back under its first note instead of marching off the viewport.
    if (chainCount === 0) wrap = { originX: chainOriginX };
  } else {
    beginStickyChain();
  }

  const slot = nextChainSlot(from, direction, (box) => boardHasSomethingIn(box, from.id), wrap);

  const id = nanoid();
  requestEditOnMount(id);

  createNode({
    id,
    type: 'sticky',
    x: slot.x,
    y: slot.y,
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
