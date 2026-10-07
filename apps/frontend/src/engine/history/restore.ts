import {
  applyGroupPlan,
  applyNodePatches,
  createNode,
  deleteNode,
  doc,
  groupsMap,
  readAllNodes,
  undoManager,
} from '../document';
import { updateTableNode } from '../document/mutations';
import { canEditObjects } from '../model/permissions';
import type { GroupRecord } from '../model/groupTree';
import { normalizeTableSpec } from '../table/tableTypes';
import type { FrameState } from './frames';
import { planRestore, planSize, type RestorePlan } from './restorePlan';

/**
 * Write a version back onto the live board, as one forward edit.
 *
 * Every write goes through the mutation layer, so the role gate applies to
 * each one; the check here only spares a viewer the attempt. Nested inside one
 * outer transaction, the writes reach peers as a single update and land on the
 * undo stack as a single step, bracketed by `stopCapturing` so they cannot
 * merge with an edit made just before or after.
 *
 * Must run with replay off: derived writers stand down while `isReplaying` is
 * set, and a restore is exactly the kind of edit they need to see.
 */
export function restoreVersion(target: FrameState, only?: ReadonlySet<string> | null): RestorePlan | null {
  if (!canEditObjects()) return null;
  const live = readAllNodes();
  const plan = planRestore(live, target, groupsMap.toJSON() as Record<string, unknown>, only);
  if (planSize(plan) === 0 && plan.groups.length === 0) return plan;

  undoManager.stopCapturing();
  doc.transact(() => {
    for (const group of plan.groups) {
      applyGroupPlan({ nodes: [], groups: [], remove: [], create: group as unknown as GroupRecord });
    }
    for (const id of plan.remove) deleteNode(id);
    for (const raw of plan.create) {
      const id = createNode(raw as Parameters<typeof createNode>[0], { preserveAuthorship: true });
      if (!id) continue;
      // `createNode` stamps a fresh stacking slot, creation time and frame;
      // the version's own values are what "restore" means.
      applyNodePatches([
        { id, changes: { zIndex: raw.zIndex, createdAt: raw.createdAt, frameId: raw.frameId } },
      ]);
    }
    applyNodePatches(plan.patch);
    for (const t of plan.tables) {
      updateTableNode(
        t.id,
        normalizeTableSpec(t.table, { refsMarked: t.refsMarked }),
        normalizeTableSpec(t.current, { refsMarked: t.currentRefsMarked })
      );
    }
  });
  undoManager.stopCapturing();
  return plan;
}
