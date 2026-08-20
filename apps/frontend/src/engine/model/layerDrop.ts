/**
 * Where a dragged row lands, and what that does to the document.
 *
 * ## Why a drop needs three zones and not one
 *
 * The first version of this asked one question — "which row did you drop on?"
 * — and derived membership from that row's own parent: onto a group, join it;
 * onto a member, join that member's group; onto anything loose, leave. That
 * reads well and it is wrong in a way you only find by using it, because it
 * makes *position* and *parent* the same answer. There is then no gesture for
 * "put this at the top level, between those two grouped rows": every row you
 * could aim at belongs to a group, so every drop joins one. Getting an object
 * out of a group required finding an ungrouped row somewhere else to aim at,
 * and if the document had none, it could not be done at all.
 *
 * Photoshop and Illustrator both solve this the same way, and it is the reason
 * their layer panels feel exact: a row is not one target but three.
 *
 *  - the **top edge** — insert above this row, as its sibling
 *  - the **bottom edge** — insert below this row, as its sibling
 *  - the **middle of a container** — go inside it
 *
 * Position and parent are now separate answers to separate questions, which is
 * what makes every arrangement reachable. "Out of the group" is the top edge of
 * the group's own header: above the folder, therefore not in it.
 *
 * ## What is deliberately not a container
 *
 * Frames. A frame owns its children through `frameId`, and `frameId` is
 * maintained *geometrically* — an object belongs to the frame it sits inside on
 * the board. Writing it from here would claim membership of a frame the object
 * is nowhere near, and the next geometry pass would disagree. So a frame row
 * takes `before` and `after` like any other node and offers no `inside`; you
 * put something in a frame by dragging it into the frame.
 */

export interface DropNode {
  id: string;
  zIndex: number;
  parentId?: string;
}

/**
 * One row as the panel displays it.
 *
 * Group headers are rows but not nodes — a group is only ever the `parentId`
 * its members share — so the planner cannot work from the node table alone. It
 * needs to know which rows exist, in which order, and which of them are folded
 * shut, because "below a folder" means something different depending on whether
 * you can see inside it.
 */
export interface DropRow {
  id: string;
  kind: 'object' | 'group';
  /** Folded shut. Only meaningful for `group`. */
  collapsed?: boolean;
}

export type DropWhere = 'before' | 'after' | 'inside';

export interface DropPlan {
  id: string;
  changes: { zIndex?: number; parentId?: string | undefined };
}

export interface DropInput {
  /** Every node id, front to back — descending z-index. */
  order: readonly string[];
  objects: Readonly<Record<string, DropNode>>;
  /** The displayed rows, headers included, in display order. */
  rows: readonly DropRow[];
  /** The rows being dragged. Node ids: a group is dragged as its members. */
  moving: readonly string[];
  /** The row under the pointer, and which of its three zones. */
  target: { id: string; where: DropWhere };
}

/** The members of a group, in stacking order. */
const membersOf = (order: readonly string[], objects: DropInput['objects'], groupId: string) =>
  order.filter((id) => objects[id]?.parentId === groupId);

/**
 * Where the insertion actually goes, once the dragged rows are lifted out.
 *
 * The anchor may itself be one of the rows being moved — dragging two of a
 * group's four members onto the third — in which case it is no longer in the
 * list to insert beside, and the search walks outward to the nearest row that
 * still is. Falling back to "the end" instead would drop the selection at the
 * bottom of the document, which is a long way from where it was released.
 */
function insertionIndex(
  order: readonly string[],
  remaining: readonly string[],
  anchorId: string | undefined,
  side: 'before' | 'after'
): number {
  if (!anchorId) return remaining.length;

  const direct = remaining.indexOf(anchorId);
  if (direct !== -1) return side === 'before' ? direct : direct + 1;

  const from = order.indexOf(anchorId);
  if (from === -1) return remaining.length;

  if (side === 'before') {
    for (let i = from + 1; i < order.length; i++) {
      const at = remaining.indexOf(order[i]);
      if (at !== -1) return at;
    }
    return remaining.length;
  }
  for (let i = from - 1; i >= 0; i--) {
    const at = remaining.indexOf(order[i]);
    if (at !== -1) return at + 1;
  }
  return 0;
}

/**
 * The parent the dropped rows take, and the row they land beside.
 *
 * Six cases, and the two that carry the design are the group header's edges:
 * its **top** is outside the group (above the folder) and its **bottom** is
 * inside it when the folder is open and outside it when the folder is shut.
 * That is exactly what the eye expects, because a shut folder's bottom edge has
 * nothing between it and the next row, while an open one's bottom edge is
 * immediately above its own first child.
 */
function resolveDrop(input: DropInput): { parentId: string | undefined; anchor: string | undefined; side: 'before' | 'after' } {
  const { order, objects, rows, target } = input;
  const row = rows.find((r) => r.id === target.id);

  if (row?.kind === 'group') {
    const members = membersOf(order, objects, row.id);
    const first = members[0];
    const last = members[members.length - 1];

    if (target.where === 'inside') {
      // The top of the group, which is where a folder receives a drop.
      return { parentId: row.id, anchor: first, side: 'before' };
    }
    if (target.where === 'before') {
      // Above the folder is not in the folder. This is how you get out.
      return { parentId: undefined, anchor: first, side: 'before' };
    }
    return row.collapsed
      ? { parentId: undefined, anchor: last, side: 'after' }
      : { parentId: row.id, anchor: first, side: 'before' };
  }

  // A plain node row: take its parent, and sit on the named side of it.
  const node = objects[target.id];
  return {
    parentId: node?.parentId,
    anchor: target.id,
    side: target.where === 'before' ? 'before' : 'after',
  };
}

/**
 * What a drop does to the document.
 *
 * Returns only the rows that actually change. The panel this replaced rewrote
 * `zIndex` on **every node in the document**, one `updateNode` per node,
 * outside any transaction — five hundred CRDT updates and five hundred undo
 * steps to move one row.
 *
 * The z-scale it writes is dense, so the first drop on a board whose stack has
 * gaps in it touches a lot of rows and every drop after that touches few. That
 * is the right trade: sparse stacks are what made the old keyboard restack
 * silently do nothing, and normalising once is cheaper than carrying the
 * ambiguity forever.
 */
export function planLayerDrop(input: DropInput): DropPlan[] {
  const { order, objects, moving, target } = input;

  const movingSet = new Set(moving.filter((id) => objects[id]));
  if (movingSet.size === 0) return [];
  // Dropping a selection onto one of its own rows is a gesture that means
  // nothing — not a cycle to guard against, just nowhere to go.
  if (movingSet.has(target.id)) return [];

  const { parentId, anchor, side } = resolveDrop(input);

  /**
   * A group cannot be dropped into itself.
   *
   * Dragging a folder's header onto that same folder resolves to "inside me",
   * which would be a no-op with a distracting amount of z-index churn behind
   * it. Nothing outside the set can be its own parent, so this is the only
   * shape the check needs.
   */
  if (parentId && moving.every((id) => objects[id]?.parentId === parentId) && target.id === parentId) {
    return [];
  }

  const remaining = order.filter((id) => !movingSet.has(id));
  const at = insertionIndex(order, remaining, anchor, side);

  // The dragged rows keep their own relative order, so moving five rows does
  // not shuffle them against each other on the way.
  const ordered = order.filter((id) => movingSet.has(id));
  const next = [...remaining.slice(0, at), ...ordered, ...remaining.slice(at)];

  const plans: DropPlan[] = [];
  next.forEach((id, index) => {
    const node = objects[id];
    if (!node) return;
    // Front to back, so position 0 carries the highest z.
    const zIndex = next.length - index;
    const changes: DropPlan['changes'] = {};
    if (node.zIndex !== zIndex) changes.zIndex = zIndex;
    if (movingSet.has(id) && node.parentId !== parentId) changes.parentId = parentId;
    if (Object.keys(changes).length > 0) plans.push({ id, changes });
  });

  return plans;
}

/**
 * Which zone of a row the pointer is in.
 *
 * A container gets a generous middle, because "into the folder" is the harder
 * thing to aim at and the one people are usually after when they hover a
 * folder at all. A plain row has no middle: every pixel of it is one edge or
 * the other, so there is no dead band where a drag appears to do nothing.
 */
export function dropZone(offsetY: number, height: number, isContainer: boolean): DropWhere {
  if (height <= 0) return 'before';
  const ratio = offsetY / height;
  if (!isContainer) return ratio < 0.5 ? 'before' : 'after';
  if (ratio < 0.28) return 'before';
  if (ratio > 0.72) return 'after';
  return 'inside';
}
