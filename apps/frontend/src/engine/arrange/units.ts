import type { AnyNode } from '../model/schema';
import type { GroupRecord } from '../model/groupTree';
import { nodeBounds, type Box, type NodePatch } from '../model/selection';

/**
 * What an arrangement moves: one box per thing the person sees as one thing.
 *
 * A selection holds nodes, but a group is one object to the person who made
 * it. Aligning the members of two selected groups to the left edge would pile
 * every member onto that edge and destroy both layouts; Figma, Illustrator and
 * Lucidchart all align the group as a unit. So a group whose every member is
 * selected becomes one unit, at the highest such group, and a node whose group
 * is only partly selected is its own unit (the same reading as
 * `groupTree.selectionUnits`, computed here in one pass over the board).
 *
 * Connectors and comments are never units: a connector follows the objects at
 * its ends, and a comment pin belongs to what it is pinned on. Locked objects
 * are kept out of the moving set and counted, so the control can say so.
 */

export interface ArrangeUnit {
  /** The group id for a group, the node id otherwise. Stable for a selection. */
  key: string;
  /** Whether this is a whole group rather than a single object. */
  group: boolean;
  /** The nodes that move with it, connectors excluded. */
  members: AnyNode[];
  /** The rendered box of all its members together. */
  box: Box;
  /** The frame every member sits in, when they share one. */
  frameId?: string;
}

export interface UnitSet {
  units: ArrangeUnit[];
  /** Locked units, which an arrangement leaves where they are. */
  locked: number;
}

type Groups = Readonly<Record<string, GroupRecord>>;

const NOT_ARRANGED = new Set(['connector', 'comment']);

/** The groups a node sits in, nearest first, bounded so a corrupt cycle cannot hang. */
function chainOf(node: AnyNode, groups: Groups): string[] {
  const chain: string[] = [];
  let at = node.parentId;
  while (at && groups[at] && !chain.includes(at) && chain.length < 64) {
    chain.push(at);
    at = groups[at].parentId;
  }
  return chain;
}

function union(boxes: readonly Box[]): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  return { x: minX, y: minY, width: Math.max(0, maxX - minX), height: Math.max(0, maxY - minY) };
}

/**
 * The units of a selection, in a stable order (by key).
 *
 * `objects` is the whole board, because "every member is selected" is a
 * question about members that are not in the selection. One pass over it.
 */
export function arrangeUnits(
  nodes: readonly AnyNode[],
  objects: Readonly<Record<string, AnyNode>>,
  groups: Groups = {}
): UnitSet {
  const selected = new Set(nodes.map((n) => n.id));
  const total = new Map<string, number>();
  const chosen = new Map<string, number>();
  const hasGroups = nodes.some((n) => n.parentId && groups[n.parentId]);
  if (hasGroups) {
    for (const node of Object.values(objects)) {
      if (!node.parentId) continue;
      for (const g of chainOf(node, groups)) {
        total.set(g, (total.get(g) ?? 0) + 1);
        if (selected.has(node.id)) chosen.set(g, (chosen.get(g) ?? 0) + 1);
      }
    }
  }

  const byKey = new Map<string, { group: boolean; members: AnyNode[] }>();
  for (const node of nodes) {
    let key = node.id;
    let group = false;
    if (hasGroups) {
      // The highest ancestor that is wholly selected carries this node.
      for (const g of chainOf(node, groups)) {
        if ((total.get(g) ?? 0) > 0 && total.get(g) === chosen.get(g)) {
          key = g;
          group = true;
        } else break;
      }
    }
    const entry = byKey.get(key) ?? { group, members: [] };
    entry.members.push(node);
    byKey.set(key, entry);
  }

  const units: ArrangeUnit[] = [];
  let locked = 0;
  for (const [key, { group, members }] of byKey) {
    const moving = members.filter((n) => !NOT_ARRANGED.has(n.type));
    if (moving.length === 0) continue;
    if (moving.some((n) => n.locked)) {
      locked += 1;
      continue;
    }
    const frames = new Set(moving.map((n) => n.frameId ?? ''));
    const frameId = frames.size === 1 ? [...frames][0] || undefined : undefined;
    units.push({ key, group, members: moving, box: union(moving.map(nodeBounds)), frameId });
  }
  units.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return { units, locked };
}

/**
 * A unit as a node-shaped box, so the arrangement maths in `model/align` and
 * `rail/tidy` can treat a group exactly as it treats a rectangle: unrotated,
 * unscaled, at its rendered extent.
 */
export function unitProxy(unit: ArrangeUnit): AnyNode {
  return {
    id: unit.key,
    type: 'shape',
    x: unit.box.x,
    y: unit.box.y,
    width: unit.box.width,
    height: unit.box.height,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    zIndex: 0,
    locked: false,
    geometry: { kind: 'rect' },
  } as unknown as AnyNode;
}

/** How far each unit moves, read from patches written against its proxy. */
export function unitDeltas(
  units: readonly ArrangeUnit[],
  patches: readonly NodePatch[]
): Map<string, { dx: number; dy: number }> {
  const byKey = new Map(units.map((u) => [u.key, u]));
  const out = new Map<string, { dx: number; dy: number }>();
  for (const { id, changes } of patches) {
    const unit = byKey.get(id);
    if (!unit) continue;
    const dx = typeof changes.x === 'number' ? changes.x - unit.box.x : 0;
    const dy = typeof changes.y === 'number' ? changes.y - unit.box.y : 0;
    if (dx !== 0 || dy !== 0) out.set(id, { dx, dy });
  }
  return out;
}

/** Every member moved by its unit's delta: the patches the document takes. */
export function memberPatches(
  units: readonly ArrangeUnit[],
  deltas: ReadonlyMap<string, { dx: number; dy: number }>
): NodePatch[] {
  const patches: NodePatch[] = [];
  for (const unit of units) {
    const d = deltas.get(unit.key);
    if (!d) continue;
    for (const node of unit.members) {
      const changes: Record<string, unknown> = {};
      if (Math.abs(d.dx) > 1e-9) changes.x = node.x + d.dx;
      if (Math.abs(d.dy) > 1e-9) changes.y = node.y + d.dy;
      if (Object.keys(changes).length > 0) patches.push({ id: node.id, changes });
    }
  }
  return patches;
}

/** Proxy patches straight to member patches. */
export function expandPatches(units: readonly ArrangeUnit[], proxyPatches: readonly NodePatch[]): NodePatch[] {
  return memberPatches(units, unitDeltas(units, proxyPatches));
}

/** Where each unit that moves would land, for drawing a preview of a plan. */
export function landedBoxes(units: readonly ArrangeUnit[], proxyPatches: readonly NodePatch[]): Box[] {
  const deltas = unitDeltas(units, proxyPatches);
  return units.flatMap((u) => {
    const d = deltas.get(u.key);
    return d ? [{ ...u.box, x: u.box.x + d.dx, y: u.box.y + d.dy }] : [];
  });
}
