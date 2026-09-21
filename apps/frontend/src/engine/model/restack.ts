import type { AnyNode } from './schema';
import { nodeBounds, type NodePatch } from './selection';
import { descendantsOfFrame } from './frames';

/**
 * Moving a selection up and down the stack.
 *
 * ## Why this exists
 *
 * Restacking was written three times, and the three disagreed:
 *
 * - The keyboard's Ctrl+Shift+] and the context menu assigned `top + i` in
 *   **selection** order, so bringing a stacked pair to the front could swap
 *   them — the order you clicked in is invisible, the order they overlap in is
 *   the drawing.
 * - The keyboard's Ctrl+] added one to each `zIndex`. Duplicates copy their
 *   original's `zIndex`, so ties are ordinary, and +1 past a tie can move an
 *   object past nothing, or past three things at once. Ctrl+[ clamped at zero
 *   while "Send to back" writes negatives, so a step backward could be a jump
 *   forward.
 * - The rail sorted by stacking order first, which was the right answer, and
 *   was the only one of the three that did.
 *
 * One implementation, pure, so every surface gives the same answer and the
 * answer can be asserted.
 *
 * ## What "forward" means on a board
 *
 * A step past the next object that **overlaps** the selection, not past the
 * next object in the global list. On a whiteboard the next object up the list
 * is usually on the other side of the board, and a Bring forward that visibly
 * does nothing — press it four times before anything moves — reads as broken.
 * Miro and Lucidchart both step past what you can see; this does the same.
 *
 * Selected objects that are already above what they pass stay where they are,
 * and the relative order of the selection is never changed: the command moves
 * the selection through the stack, it does not re-sort it.
 */

export type RestackOp = 'front' | 'forward' | 'backward' | 'back';

/** Where each node sits, bottom first, as the canvas draws it. */
function stackOrder(nodes: readonly AnyNode[]): AnyNode[] {
  // `Array.prototype.sort` is stable, which is what the canvas relies on too:
  // ties are drawn in insertion order, and so they are read in it here.
  return [...nodes].sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
}

function overlaps(a: AnyNode, b: AnyNode): boolean {
  const p = nodeBounds(a);
  const q = nodeBounds(b);
  const pw = Math.max(p.width, 1);
  const ph = Math.max(p.height, 1);
  const qw = Math.max(q.width, 1);
  const qh = Math.max(q.height, 1);
  return p.x < q.x + qw && q.x < p.x + pw && p.y < q.y + qh && q.y < p.y + ph;
}

/**
 * Ensures that all descendants of any frame are positioned above that frame
 * in the drawing order. If a frame moved toward the front, its children are
 * lifted to sit on top of it. If a child moved toward the back, it stops at
 * the frame's boundary and never sinks behind the frame's opaque canvas fill.
 */
function enforceFrameHierarchy(
  order: string[],
  moved: Set<string>,
  all: readonly AnyNode[],
  _selected: ReadonlySet<string>
): { order: string[]; moved: Set<string> } {
  const frames = all.filter((n) => n.type === 'frame');
  if (frames.length === 0) return { order, moved };

  let currentOrder = [...order];
  const currentMoved = new Set(moved);

  for (const frame of frames) {
    const frameId = frame.id;
    const descendants = descendantsOfFrame(frameId, all as unknown as Array<{ id: string; frameId?: string }>);
    if (descendants.length === 0) continue;

    const frameIdx = currentOrder.indexOf(frameId);
    if (frameIdx < 0) continue;

    // Any descendant that currently sits below the frame in the stack
    const violations = descendants.filter((dId) => {
      const dIdx = currentOrder.indexOf(dId);
      return dIdx >= 0 && dIdx < frameIdx;
    });

    if (violations.length === 0) continue;

    const violationSet = new Set(violations);
    const remaining = currentOrder.filter((id) => !violationSet.has(id));
    const newFrameIdx = remaining.indexOf(frameId);
    currentOrder = [
      ...remaining.slice(0, newFrameIdx + 1),
      ...violations,
      ...remaining.slice(newFrameIdx + 1),
    ];
    violations.forEach((v) => currentMoved.add(v));
  }

  return { order: currentOrder, moved: currentMoved };
}

/**
 * The new bottom-to-top order, or `null` when the operation changes nothing.
 *
 * Returned as ids so the second half — turning an order back into `zIndex`
 * values — does not need to know which operation produced it.
 */
export function restackOrder(
  all: readonly AnyNode[],
  selectedIds: readonly string[],
  op: RestackOp
): { order: string[]; moved: Set<string> } | null {
  const selected = new Set(selectedIds);
  const stack = stackOrder(all);
  if (!stack.some((n) => selected.has(n.id))) return null;

  const ids = stack.map((n) => n.id);
  let order: string[];
  let moved: Set<string>;

  if (op === 'front' || op === 'back') {
    const mine = ids.filter((id) => selected.has(id));
    const rest = ids.filter((id) => !selected.has(id));
    order = op === 'front' ? [...rest, ...mine] : [...mine, ...rest];
    moved = new Set(mine);
  } else if (op === 'forward') {
    // The nearest unselected object above some selected object that it covers.
    let target = -1;
    for (let j = 0; j < stack.length && target < 0; j++) {
      if (selected.has(stack[j].id)) continue;
      for (let i = 0; i < j; i++) {
        if (selected.has(stack[i].id) && overlaps(stack[i], stack[j])) {
          target = j;
          break;
        }
      }
    }
    if (target < 0) return null;
    // Everything selected beneath the target rises to sit just above it, in
    // the order it was already in.
    const rising = ids.slice(0, target).filter((id) => selected.has(id));
    const below = ids.slice(0, target).filter((id) => !selected.has(id));
    order = [...below, ids[target], ...rising, ...ids.slice(target + 1)];
    moved = new Set(rising);
  } else {
    let target = -1;
    for (let j = stack.length - 1; j >= 0 && target < 0; j--) {
      if (selected.has(stack[j].id)) continue;
      for (let i = stack.length - 1; i > j; i--) {
        if (selected.has(stack[i].id) && overlaps(stack[i], stack[j])) {
          target = j;
          break;
        }
      }
    }
    if (target < 0) return null;
    const sinking = ids.slice(target + 1).filter((id) => selected.has(id));
    const above = ids.slice(target + 1).filter((id) => !selected.has(id));
    order = [...ids.slice(0, target), ...sinking, ids[target], ...above];
    moved = new Set(sinking);
  }

  const adjusted = enforceFrameHierarchy(order, moved, all, selected);
  order = adjusted.order;
  moved = adjusted.moved;

  if (order.every((id, i) => id === ids[i])) return null;
  return { order, moved };
}

/**
 * The patches that make the board draw in `order`, touching as little as it can.
 *
 * Objects that did not move keep their `zIndex`. Each run of moved objects is
 * slotted between its unmoved neighbours: whole numbers when there is room,
 * evenly spaced fractions when there is not. Only a genuine tie — the moved run
 * landing between two objects that share a value — forces the objects above to
 * be nudged up, and then only as far as the tie reaches.
 *
 * Fewer patches is not tidiness. Every patch is a write every collaborator
 * receives, and renumbering a two-thousand-object board to move one sticky
 * would be two thousand of them.
 */
export function zIndexPatches(
  all: readonly AnyNode[],
  order: readonly string[],
  moved: ReadonlySet<string>
): NodePatch[] {
  const byId = new Map(all.map((n) => [n.id, n]));
  const z = new Map<string, number>(all.map((n) => [n.id, n.zIndex || 0]));
  const patches = new Map<string, number>();
  const set = (id: string, value: number) => {
    z.set(id, value);
    if ((byId.get(id)?.zIndex || 0) !== value) patches.set(id, value);
    else patches.delete(id);
  };

  let i = 0;
  while (i < order.length) {
    if (!moved.has(order[i])) {
      i++;
      continue;
    }
    let end = i;
    while (end < order.length && moved.has(order[end])) end++;
    const run = order.slice(i, end);
    const k = run.length;
    const lo = i > 0 ? z.get(order[i - 1])! : -Infinity;
    const hi = end < order.length ? z.get(order[end])! : Infinity;

    if (lo === -Infinity && hi === Infinity) {
      run.forEach((id, n) => set(id, n));
    } else if (hi === Infinity) {
      run.forEach((id, n) => set(id, lo + 1 + n));
    } else if (lo === -Infinity) {
      run.forEach((id, n) => set(id, hi - k + n));
    } else if (hi - lo > k) {
      run.forEach((id, n) => set(id, lo + 1 + n));
    } else if (hi - lo > 1e-6) {
      run.forEach((id, n) => set(id, lo + ((hi - lo) * (n + 1)) / (k + 1)));
    } else {
      // A tie: there is no value strictly between, so make room above.
      run.forEach((id, n) => set(id, lo + 1 + n));
      let floor = lo + k;
      for (let j = end; j < order.length; j++) {
        const current = z.get(order[j])!;
        if (current > floor) break;
        floor += 1;
        set(order[j], floor);
      }
    }
    i = end;
  }

  return [...patches].map(([id, zIndex]) => ({ id, changes: { zIndex } }));
}

/** Restack a selection. An empty result means the command had nothing to do. */
export function restackSelection(
  all: readonly AnyNode[],
  selectedIds: readonly string[],
  op: RestackOp
): NodePatch[] {
  const result = restackOrder(all, selectedIds, op);
  return result ? zIndexPatches(all, result.order, result.moved) : [];
}
