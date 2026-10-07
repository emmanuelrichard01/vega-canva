import type * as Y from 'yjs';
import { groupsMap, objectsMap, DERIVED_ORIGIN } from './doc';
import { applyGroupPlan, applyNodePatches } from './mutations';
import { observeGroups, observeNodes } from './observe';
import { isElectedWriter } from './election';
import { canEditObjects } from '../model/permissions';
import { emptyGroups, type GroupedNode, type Groups } from '../model/groupTree';
import { boxIsInside, centreIsInside, frameForNode, nodesInMembershipCycles } from '../model/frames';

/**
 * Document upkeep: the writes the board makes on its own behalf.
 *
 * These read the live Y maps, never the zustand store. During Time Travel the
 * store holds a historical snapshot, and upkeep that compared that snapshot
 * with live data once deleted every group the snapshot predated, for everyone.
 *
 * Two rules decide who writes:
 *  - A client tidies up after its **own** edits immediately, in an ordinary
 *    transaction, so the tidy-up joins the edit's undo step (the UndoManager
 *    merges transactions within its capture window).
 *  - Changes that arrived from **other people** are tidied by the elected
 *    writer only (`election.ts`), under `DERIVED_ORIGIN`, so the room writes
 *    each repair once and nobody's undo stack fills with it.
 */

/** Remote changes are debounced so a burst of updates is checked once. */
const REMOTE_SETTLE_MS = 300;

type Box = { id: string; type?: string; x: number; y: number; width: number; height: number; zIndex: number; frameId?: string };

function boxOf(id: string, ymap: Y.Map<unknown>): Box | null {
  const x = ymap.get('x');
  const y = ymap.get('y');
  const width = ymap.get('width');
  const height = ymap.get('height');
  if (![x, y, width, height].every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  const frameId = ymap.get('frameId');
  const zIndex = ymap.get('zIndex');
  return {
    id,
    type: ymap.get('type') as string | undefined,
    x: x as number,
    y: y as number,
    width: width as number,
    height: height as number,
    zIndex: typeof zIndex === 'number' ? zIndex : 0,
    frameId: typeof frameId === 'string' && frameId ? frameId : undefined,
  };
}

/**
 * Groups that no longer hold anything.
 *
 * Delete the last members of a group and its record is still there: an empty
 * row in the Layers panel that cannot be selected. Swept here rather than
 * prevented at every deletion path.
 */
export function sweepEmptyGroups(origin: unknown): void {
  if (groupsMap.size === 0) return;
  const objects: Record<string, GroupedNode> = {};
  objectsMap.forEach((ymap, id) => {
    const parentId = ymap.get('parentId');
    objects[id] = typeof parentId === 'string' ? { id, parentId } : { id };
  });
  const dead = emptyGroups(Object.keys(objects), objects, Object.fromEntries(groupsMap.entries()) as Groups);
  if (dead.length > 0) applyGroupPlan({ nodes: [], groups: [], remove: dead }, { origin });
}

/**
 * Correct stored frame memberships that no longer match the geometry.
 *
 * Membership is derived from geometry and written when a local object stops
 * moving. Two people editing at once can still merge into a stale answer: a
 * note dropped into a frame at its old position while someone else moved the
 * frame ends up outside it but still clipped to it — invisible on every
 * screen. Concurrent resizes can even produce a cycle.
 *
 * Only memberships that are *wrong* are rewritten (target missing, not a
 * frame, a cycle, or the node no longer inside it). A node with no frame is
 * left alone: adopting it is the job of the gesture that moves it.
 *
 * @param candidates ids to check, or null for every node.
 */
export function repairFrameMembership(candidates: ReadonlySet<string> | null, origin: unknown): number {
  const boxes = new Map<string, Box>();
  const frames: Box[] = [];
  objectsMap.forEach((ymap, id) => {
    const box = boxOf(id, ymap);
    if (!box) return;
    boxes.set(id, box);
    if (box.type === 'frame') frames.push(box);
  });

  const parentOf = new Map<string, string>();
  boxes.forEach((b) => {
    if (b.frameId) parentOf.set(b.id, b.frameId);
  });
  const inCycle = nodesInMembershipCycles(parentOf);

  // A frame that changed puts its members in question too.
  let check: Iterable<string> = boxes.keys();
  if (candidates) {
    const expanded = new Set(candidates);
    boxes.forEach((b) => {
      if (b.frameId && candidates.has(b.frameId)) expanded.add(b.id);
    });
    check = expanded;
  }

  const patches: Array<{ id: string; changes: Record<string, unknown> }> = [];
  for (const id of check) {
    const node = boxes.get(id);
    if (!node?.frameId) continue;
    const frame = boxes.get(node.frameId);
    const valid =
      node.type !== 'connector' &&
      !inCycle.has(node.id) &&
      !!frame &&
      frame.type === 'frame' &&
      frame.id !== node.id &&
      (node.type === 'frame'
        ? boxIsInside(node, frame) && frame.width * frame.height > node.width * node.height
        : centreIsInside(node, frame));
    if (valid) continue;

    const next = node.type === 'connector' ? null : frameForNode(node, frames);
    if ((next ?? undefined) === node.frameId) continue;
    patches.push({ id, changes: { frameId: next ?? undefined } });
  }

  if (patches.length > 0) applyNodePatches(patches, { origin });
  return patches.length;
}

/**
 * Start the upkeep subscribers. Returns a disposer.
 */
export function startDocumentUpkeep(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let remoteDirty: Set<string> | null = null;
  let remoteGroupsDirty = false;
  let localSweepQueued = false;

  const flushRemote = () => {
    timer = null;
    const dirty = remoteDirty;
    const groupsDirty = remoteGroupsDirty;
    remoteDirty = null;
    remoteGroupsDirty = false;
    if (!isElectedWriter()) return;
    if (dirty && dirty.size > 0) repairFrameMembership(dirty, DERIVED_ORIGIN);
    if (groupsDirty) sweepEmptyGroups(DERIVED_ORIGIN);
  };

  const scheduleRemote = () => {
    if (timer === null) timer = setTimeout(flushRemote, REMOTE_SETTLE_MS);
  };

  // After the current transaction, not inside it, and within the
  // UndoManager's capture window so the sweep undoes with the edit.
  const queueLocalSweep = () => {
    if (localSweepQueued || !canEditObjects()) return;
    localSweepQueued = true;
    queueMicrotask(() => {
      localSweepQueued = false;
      sweepEmptyGroups(null);
    });
  };

  const offNodes = observeNodes(({ changed, removed, local }) => {
    if (local) {
      if (removed.size > 0 || changed.size > 0) queueLocalSweep();
      return;
    }
    remoteDirty ??= new Set();
    changed.forEach((id) => remoteDirty!.add(id));
    // Members of a removed frame point at nothing now.
    removed.forEach((id) => remoteDirty!.add(id));
    remoteGroupsDirty = true;
    scheduleRemote();
  });

  const offGroups = observeGroups(() => {
    remoteGroupsDirty = true;
    scheduleRemote();
  });

  return () => {
    offNodes();
    offGroups();
    if (timer !== null) clearTimeout(timer);
  };
}
