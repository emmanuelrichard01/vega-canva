import type { AnyNode } from '../model/schema';
import { compareStacking } from '../model/stacking';
import { marqueeHits } from './marquee';

/**
 * Picking objects at a point, for the gestures that look *through* the top one.
 *
 * Konva hit-tests for the ordinary click, which is right: the topmost thing
 * under the pointer wins. Select-behind and deep select need the whole stack
 * under the pointer instead, so they ask this.
 */

/** Ids under a world point, topmost first. Locked and hidden objects are skipped. */
export function stackAt(nodes: Iterable<AnyNode>, x: number, y: number, tolerance = 0): string[] {
  const list = Array.from(nodes);
  const hits = new Set(
    marqueeHits(list, { minX: x - tolerance, minY: y - tolerance, maxX: x + tolerance, maxY: y + tolerance })
  );
  return list
    .filter((n) => hits.has(n.id))
    .sort(compareStacking)
    .reverse()
    .map((n) => n.id);
}

/**
 * The next object down the stack from the current selection.
 *
 * With nothing in the stack selected, the answer is the object *behind* the
 * top one: the top one is what a plain click already reaches. From the bottom
 * it wraps to the top, so repeated Alt+clicks walk the whole pile.
 */
export function nextBehind(stack: readonly string[], selected: readonly string[]): string | null {
  if (stack.length === 0) return null;
  if (stack.length === 1) return stack[0];
  const chosen = new Set(selected);
  let deepest = -1;
  stack.forEach((id, i) => {
    if (chosen.has(id)) deepest = i;
  });
  if (deepest === -1) return stack[1];
  return stack[(deepest + 1) % stack.length];
}
