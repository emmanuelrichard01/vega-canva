/**
 * Groups that contain groups.
 *
 * ## What was wrong with the flat model
 *
 * A group was nothing but a synthetic id its members shared in `parentId`.
 * That is a genuinely elegant thing — no group node has to exist, selection
 * and dragging fall out for free — and it has one consequence that cannot be
 * worked around: **a group cannot contain a group**, because the only thing
 * that can hold a `parentId` is a node, and a group is not one.
 *
 * The cost shows up the moment anyone builds anything. Group the axis labels
 * of a chart, group the bars, then select both and group *those* — every tool
 * anyone has used does this, and here the second group silently dissolved the
 * first: both sets of members were rewritten to one new id and the inner
 * structure was gone with no way to get it back. The layers panel drew a tree
 * exactly one level deep and called it a hierarchy.
 *
 * ## The model
 *
 * Groups become records of their own, each with an optional `parentId` naming
 * the group that holds *it*. Membership of a node is unchanged — still one
 * `parentId` on the node — so everything that already reads that keeps working;
 * what is new is that the id it points at may now itself point somewhere.
 *
 * A group record holds no geometry. Its bounds are its contents' bounds and
 * always were, and storing them would be a second source of truth that every
 * drag would have to remember to update.
 *
 * Kept pure and out of the document layer, because the interesting parts —
 * which unit a selection really names, where a new group belongs, what
 * ungrouping puts back — are graph questions with edge cases that are tedious
 * to reach by clicking and trivial to state as tests.
 */

export interface GroupRecord {
  id: string;
  /** The group holding this one. Absent means top level. */
  parentId?: string;
  /** What the user renamed it to, if anything. */
  name?: string;
}

export type Groups = Readonly<Record<string, GroupRecord>>;

/** The part of a node this module needs. */
export interface GroupedNode {
  id: string;
  parentId?: string;
}

export type NodeTable = Readonly<Record<string, GroupedNode>>;

/**
 * A group's ancestors, nearest first.
 *
 * Bounded by the number of groups, because a corrupt document — a
 * concurrently merged one, most plausibly — could hold a cycle, and a cycle
 * here would hang the tab rather than mis-draw a row.
 */
export function ancestorsOf(groups: Groups, groupId: string | undefined): string[] {
  const chain: string[] = [];
  const seen = new Set<string>();
  let at = groups[groupId ?? '']?.parentId;
  while (at && groups[at] && !seen.has(at)) {
    seen.add(at);
    chain.push(at);
    at = groups[at].parentId;
  }
  return chain;
}

/** The outermost group this one belongs to, or itself when it is already top level. */
export function rootGroupOf(groups: Groups, groupId: string): string {
  const chain = ancestorsOf(groups, groupId);
  return chain.length > 0 ? chain[chain.length - 1] : groupId;
}

/** Whether `groupId` is inside `ancestor` at any depth. */
export function isDescendantGroup(groups: Groups, groupId: string, ancestor: string): boolean {
  return ancestorsOf(groups, groupId).includes(ancestor);
}

/**
 * Whether reparenting `groupId` under `newParent` would close a loop.
 *
 * A group dropped inside itself, or inside one of its own descendants, is not
 * an error a user makes on purpose — it is what a drag onto the wrong row
 * looks like, and it must be refused rather than written, because once the
 * cycle is in the document every walk over it has to defend against it forever.
 */
export function wouldCycle(groups: Groups, groupId: string, newParent: string | undefined): boolean {
  if (!newParent) return false;
  if (newParent === groupId) return true;
  return isDescendantGroup(groups, newParent, groupId);
}

/** Direct child groups of a group, or of the root when `groupId` is undefined. */
export function childGroups(groups: Groups, groupId: string | undefined): string[] {
  return Object.values(groups)
    .filter((g) => (g.parentId ?? undefined) === (groupId ?? undefined))
    .map((g) => g.id);
}

/** Direct member nodes of a group, in the order given. */
export function directMembers(order: readonly string[], objects: NodeTable, groupId: string): string[] {
  return order.filter((id) => objects[id]?.parentId === groupId);
}

/**
 * Every node inside a group, at any depth.
 *
 * This is what "select the group" means, what "hide the group" acts on, and
 * what a bounding box is computed from. The flat model needed none of it,
 * which is the clearest measure of how much the flat model was not a tree.
 */
export function nodesInGroup(
  order: readonly string[],
  objects: NodeTable,
  groups: Groups,
  groupId: string
): string[] {
  const inside = new Set<string>([groupId]);
  // Breadth-first over child groups, so a deep tree costs one pass rather than
  // a lookup per node per level.
  const queue = [groupId];
  while (queue.length > 0) {
    const at = queue.shift()!;
    for (const child of childGroups(groups, at)) {
      if (inside.has(child)) continue;
      inside.add(child);
      queue.push(child);
    }
  }
  return order.filter((id) => {
    const parent = objects[id]?.parentId;
    return parent !== undefined && inside.has(parent);
  });
}

/**
 * The deepest group that contains all of these, or `undefined` for the root.
 *
 * Where a new group goes. Grouping three things that all live in the same
 * folder should put the new folder in that folder; grouping across two folders
 * has to come out to whatever holds both, because a group cannot be in two
 * places.
 */
export function commonAncestor(groups: Groups, parents: readonly (string | undefined)[]): string | undefined {
  if (parents.length === 0) return undefined;
  // Each parent's chain from the root down, so a shared prefix is the answer.
  const chains = parents.map((p) => {
    if (!p || !groups[p]) return [] as string[];
    return [...ancestorsOf(groups, p).reverse(), p];
  });

  let shared: string | undefined;
  for (let depth = 0; ; depth += 1) {
    const at = chains[0][depth];
    if (at === undefined) break;
    if (!chains.every((c) => c[depth] === at)) break;
    shared = at;
  }
  return shared;
}

export interface GroupPlan {
  /** Nodes whose `parentId` changes. */
  nodes: { id: string; parentId: string | undefined }[];
  /** Groups whose `parentId` changes. */
  groups: { id: string; parentId: string | undefined }[];
  /** A group to create, when the plan makes one. */
  create?: GroupRecord;
  /** Groups left holding nothing, which should be deleted. */
  remove: string[];
}

/**
 * The largest whole thing each selected node belongs to.
 *
 * This is the idea the whole feature turns on. Selecting every member of a
 * group and pressing Group again should nest *the group*, not scatter its
 * members into a new one — the members were already arranged, and taking them
 * out to put them back is not what anybody meant. But selecting only *some* of
 * a group's members means exactly what it says: take these out.
 *
 * So each selected node walks up as far as it can while every node under that
 * ancestor is also selected, and the highest such ancestor is the unit. A node
 * whose group is only partly selected is its own unit.
 */
export function selectionUnits(
  order: readonly string[],
  objects: NodeTable,
  groups: Groups,
  selected: readonly string[]
): { nodes: string[]; groups: string[] } {
  const chosen = new Set(selected);
  const unitNodes = new Set<string>();
  const unitGroups = new Set<string>();

  const whollySelected = (groupId: string) => {
    const inside = nodesInGroup(order, objects, groups, groupId);
    return inside.length > 0 && inside.every((id) => chosen.has(id));
  };

  for (const id of selected) {
    const node = objects[id];
    if (!node) continue;

    let unit: string | null = null;
    let at = node.parentId;
    const seen = new Set<string>();
    while (at && groups[at] && !seen.has(at) && whollySelected(at)) {
      seen.add(at);
      unit = at;
      at = groups[at].parentId;
    }

    if (unit) unitGroups.add(unit);
    else unitNodes.add(id);
  }

  // A group whose ancestor is also a unit is already carried by it.
  const redundant = [...unitGroups].filter((g) =>
    ancestorsOf(groups, g).some((a) => unitGroups.has(a))
  );
  for (const g of redundant) unitGroups.delete(g);

  return { nodes: [...unitNodes], groups: [...unitGroups] };
}

/**
 * Group a selection, nesting rather than flattening.
 *
 * Returns nothing when there is only one unit to group: wrapping a single
 * thing in a folder of its own adds a level and changes nothing, which is a
 * command that appears to have failed.
 */
export function planGroup(
  order: readonly string[],
  objects: NodeTable,
  groups: Groups,
  selected: readonly string[],
  newGroupId: string
): GroupPlan | null {
  const units = selectionUnits(order, objects, groups, selected);
  const total = units.nodes.length + units.groups.length;
  if (total < 2) return null;

  const parents = [
    ...units.nodes.map((id) => objects[id]?.parentId),
    ...units.groups.map((id) => groups[id]?.parentId),
  ];
  const parentId = commonAncestor(groups, parents);

  return {
    create: { id: newGroupId, parentId },
    nodes: units.nodes.map((id) => ({ id, parentId: newGroupId })),
    groups: units.groups.map((id) => ({ id, parentId: newGroupId })),
    remove: [],
  };
}

/**
 * Take one group apart, one level.
 *
 * Its contents move up to where it was — nodes *and* child groups, which is
 * the half a flat model never had to think about. Ungrouping is not recursive:
 * pressing it once should undo one Group, not dismantle everything inside.
 */
export function planUngroup(
  order: readonly string[],
  objects: NodeTable,
  groups: Groups,
  groupId: string
): GroupPlan | null {
  const group = groups[groupId];
  if (!group) return null;
  const up = group.parentId;

  return {
    nodes: directMembers(order, objects, groupId).map((id) => ({ id, parentId: up })),
    groups: childGroups(groups, groupId).map((id) => ({ id, parentId: up })),
    remove: [groupId],
  };
}

/**
 * Groups that no longer hold anything.
 *
 * They arise from ordinary editing — delete the last two members of a folder
 * and the folder is still there, an empty row that cannot be selected and
 * whose only remaining behaviour is to take up space. Swept rather than
 * prevented, because the alternative is every deletion path having to know
 * about groups.
 *
 * A group holding only empty groups is empty too, so this iterates until it
 * settles rather than making one pass and leaving the parents behind.
 */
export function emptyGroups(order: readonly string[], objects: NodeTable, groups: Groups): string[] {
  const dead = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of Object.keys(groups)) {
      if (dead.has(id)) continue;
      const hasNode = order.some((n) => objects[n]?.parentId === id);
      const hasGroup = childGroups(groups, id).some((g) => !dead.has(g));
      if (!hasNode && !hasGroup) {
        dead.add(id);
        changed = true;
      }
    }
  }
  return [...dead];
}

/**
 * What clicking one member on the canvas selects.
 *
 * The outermost group it belongs to, which is what makes a group behave as one
 * object: click any part of a nested assembly and you get the whole assembly,
 * and you go inward by entering the group rather than by clicking more
 * precisely. `depth` lets a caller that has *entered* a group stop there
 * instead — 0 is the outermost, and each step in resolves one level finer.
 */
export function selectionForNode(
  order: readonly string[],
  objects: NodeTable,
  groups: Groups,
  nodeId: string,
  depth = 0
): string[] {
  const node = objects[nodeId];
  if (!node?.parentId || !groups[node.parentId]) return [nodeId];

  // Root-down, so `depth` counts inward the way a person would describe it.
  const chain = [...ancestorsOf(groups, node.parentId).reverse(), node.parentId];
  const target = chain[Math.min(depth, chain.length - 1)];
  const inside = nodesInGroup(order, objects, groups, target);
  return inside.length > 0 ? inside : [nodeId];
}

/**
 * What clicking one member selects, given how far in you have already gone.
 *
 * ## Entering a group
 *
 * Clicking any member of a group selects the whole group, which is what makes a
 * group behave as one object. That rule alone leaves no way to reach a single
 * object inside one without ungrouping the lot — the previous version of this
 * said so outright, calling enter-group "a deliberate scope cut", and with a
 * flat model it was a defensible one because a group was only ever one level
 * deep. Nested, it is not: an assembly three levels down would have to be
 * dismantled to touch anything in it.
 *
 * So `entered` names the group you are currently inside, and each click resolves
 * *one level finer than that*:
 *
 *  - nothing entered — the outermost assembly, as before
 *  - entered a group — whichever of its children holds what you clicked
 *  - entered the innermost group — the object itself
 *
 * Clicking something outside what you entered starts over at the outermost,
 * which is the behaviour that keeps the mode from being sticky: you leave a
 * group by clicking something that is not in it.
 */
export function selectionWithin(
  order: readonly string[],
  objects: NodeTable,
  groups: Groups,
  nodeId: string,
  entered: string | null
): string[] {
  const node = objects[nodeId];
  if (!node) return [];
  const parent = node.parentId;
  if (!parent || !groups[parent]) return [nodeId];

  // Root-down, so walking in is walking forward.
  const chain = [...ancestorsOf(groups, parent).reverse(), parent];
  const at = entered ? chain.indexOf(entered) : -1;
  if (at === -1) return nodesInGroup(order, objects, groups, chain[0]);

  const next = chain[at + 1];
  return next ? nodesInGroup(order, objects, groups, next) : [nodeId];
}

/**
 * The group a click would step into, or `null` when there is nowhere further.
 *
 * Paired with `selectionWithin` so the caller does not have to rebuild the same
 * chain to find out whether the double-click it just handled actually went
 * anywhere — a gesture that reports success and does nothing is worse than one
 * that declines.
 */
export function groupToEnter(
  objects: NodeTable,
  groups: Groups,
  nodeId: string,
  entered: string | null
): string | null {
  const parent = objects[nodeId]?.parentId;
  if (!parent || !groups[parent]) return null;
  const chain = [...ancestorsOf(groups, parent).reverse(), parent];
  if (!entered) return chain[0];
  const at = chain.indexOf(entered);
  if (at === -1) return chain[0];
  return chain[at + 1] ?? null;
}

/**
 * Remap a copied fragment's group ids, and keep the nesting.
 *
 * Paste already regenerated node ids and remapped `parentId`, which was
 * correct while a group was one flat id. With nesting, a group record's own
 * `parentId` has to be remapped by the same table or the copy's inner folders
 * point at the *original's* outer ones — the two would then share structure,
 * and dragging one would move rows in the other.
 *
 * A group whose parent is outside the copied fragment comes out at the top
 * level, because the alternative is a paste that silently joins something the
 * user did not copy.
 */
export function remapGroups(
  groups: Groups,
  used: readonly string[],
  freshId: (old: string) => string
): { records: GroupRecord[]; mapping: Map<string, string> } {
  const wanted = new Set<string>();
  for (const id of used) {
    if (!groups[id]) continue;
    wanted.add(id);
    for (const a of ancestorsOf(groups, id)) wanted.add(a);
  }

  const mapping = new Map<string, string>();
  for (const id of wanted) mapping.set(id, freshId(id));

  const records = [...wanted].map((id) => {
    const parent = groups[id].parentId;
    return {
      ...groups[id],
      id: mapping.get(id)!,
      parentId: parent && mapping.has(parent) ? mapping.get(parent) : undefined,
    };
  });

  return { records, mapping };
}
