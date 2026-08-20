/**
 * Where a dragged row lands, and what that does to the document.
 *
 * ## Why this is not inside the panel
 *
 * It decides two things at once — stacking order and *group membership* — and
 * both are easy to get subtly wrong in ways that only show up as "my object
 * went into the wrong group". Dropping a group onto its own member, dropping
 * the last row, dropping something that is already where it landed: each is a
 * case, and a case checked by dragging things around by hand is a case checked
 * once.
 *
 * The panel that called this could only reorder. It rewrote `zIndex` on **every
 * node in the document**, one write per node, outside any transaction — five
 * hundred CRDT updates and five hundred undo steps to move one row — and it had
 * no concept of reparenting at all, so the panel drew a hierarchy it gave you
 * no way to edit.
 */

export interface DropNode {
  id: string;
  zIndex: number;
  parentId?: string;
}

export interface DropPlan {
  id: string;
  changes: { zIndex?: number; parentId?: string | undefined };
}

export interface DropInput {
  /** Every row, front to back — the order the panel displays. */
  order: readonly string[];
  objects: Readonly<Record<string, DropNode>>;
  /** The rows being dragged. */
  moving: readonly string[];
  /** The row dropped onto: a node id, or a group id when `targetIsGroup`. */
  targetId: string;
  targetIsGroup?: boolean;
}

/**
 * What a drop means.
 *
 * The target row answers "where does this belong", which is the question a
 * layers panel exists to let you change:
 *
 *  - onto a **group** row — join that group
 *  - onto a **member** of a group — join that group, and sit beside it
 *  - onto a **loose** row — leave whatever group it was in
 *
 * The third is what makes leaving a group need no separate gesture: you drop it
 * next to something that is not in one.
 *
 * Returns only the rows that actually change, so a drop near the bottom of a
 * long list does not rewrite the whole document.
 */
export function planLayerDrop({
  order,
  objects,
  moving,
  targetId,
  targetIsGroup = false,
}: DropInput): DropPlan[] {
  const movingSet = new Set(moving);
  if (movingSet.size === 0) return [];
  // Dropping a group onto one of its own members is a no-op, not a cycle.
  if (movingSet.has(targetId)) return [];

  const nextParent = targetIsGroup ? targetId : objects[targetId]?.parentId;

  const remaining = order.filter((id) => !movingSet.has(id));
  /**
   * A group row is not in `order` — only nodes are — so a drop onto one lands
   * above the group's topmost member, which is where its header is drawn.
   */
  const anchor = targetIsGroup
    ? remaining.findIndex((id) => objects[id]?.parentId === targetId)
    : remaining.indexOf(targetId);
  const at = anchor === -1 ? remaining.length : anchor;

  // Kept in their own relative order, so dragging five rows does not shuffle
  // them against each other on the way.
  const next = [...remaining.slice(0, at), ...moving.filter((id) => objects[id]), ...remaining.slice(at)];

  const plans: DropPlan[] = [];
  next.forEach((id, index) => {
    const node = objects[id];
    if (!node) return;
    // The list is front-to-back, so position 0 carries the highest z.
    const zIndex = next.length - index;
    const changes: DropPlan['changes'] = {};
    if (node.zIndex !== zIndex) changes.zIndex = zIndex;
    if (movingSet.has(id) && node.parentId !== nextParent) changes.parentId = nextParent;
    if (Object.keys(changes).length > 0) plans.push({ id, changes });
  });

  return plans;
}
