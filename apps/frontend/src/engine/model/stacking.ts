/**
 * The one draw order for canvas nodes.
 *
 * `zIndex` alone is not a total order: two people creating at the same moment
 * both read the same `nextZIndex()`, and a ±1 layer move can land on a
 * neighbour's value. Sorting on `zIndex` with a stable sort then falls back to
 * map insertion order, which depends on the order each client happened to
 * integrate the updates — so the same board stacked differently on different
 * screens. Breaking ties by id makes the order a pure function of the document.
 *
 * Every place that orders nodes for drawing, hit-testing, export or restacking
 * must use this comparator, or the screens disagree again.
 */
export interface Stackable {
  id: string;
  zIndex?: number;
}

export function compareStacking(a: Stackable, b: Stackable): number {
  const dz = (a.zIndex || 0) - (b.zIndex || 0);
  if (dz !== 0) return dz;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Bottom first, as the canvas draws. Returns a new array. */
export function sortByStacking<T extends Stackable>(nodes: Iterable<T>): T[] {
  return Array.from(nodes).sort(compareStacking);
}
