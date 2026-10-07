import { BOOKKEEPING_FIELD_NAMES } from './sessionTimeline';
import { jsonEqual, type Frame, type FrameState } from './frames';

/**
 * Restoring a version as a **forward** edit.
 *
 * History is never rewritten: the live board is changed, in one transaction,
 * into the version's state. Everyone sees it arrive like any other edit, it
 * lands in the log as a new moment, and it undoes in one step. This module
 * computes the difference; `restore.ts` writes it through the mutation layer.
 *
 * Left alone on purpose:
 *  - bookkeeping (`updatedAt`, `updatedBy`…), which the write stamps afresh;
 *  - provenance (`createdBy*`), which records who made the object, not who
 *    restored it;
 *  - `reactions`, which are people's responses rather than content, and a
 *    nested CRDT that a plain write would break.
 * Tables are diffed separately, because their cells are a nested CRDT that
 * must be written through the table writer, not replaced wholesale.
 */
const SKIP = new Set<string>([
  ...BOOKKEEPING_FIELD_NAMES,
  'createdBy',
  'createdByName',
  'createdByColor',
  'reactions',
  'table',
]);

export interface RestorePlan {
  /** Objects the version has and the board does not, as their raw data. */
  create: Record<string, unknown>[];
  /** Objects the board has and the version does not. */
  remove: string[];
  /** Field changes; `undefined` removes the field. */
  patch: { id: string; changes: Record<string, unknown> }[];
  /** Tables whose contents differ: the version's table and the board's. */
  tables: { id: string; table: unknown; current: unknown; refsMarked: boolean; currentRefsMarked: boolean }[];
  /** Groups the restored objects belong to that the board no longer has. */
  groups: Record<string, unknown>[];
}

export function planRestore(
  live: Frame,
  target: FrameState,
  liveGroups: Readonly<Record<string, unknown>>,
  only?: ReadonlySet<string> | null
): RestorePlan {
  const plan: RestorePlan = { create: [], remove: [], patch: [], tables: [], groups: [] };
  const inScope = (id: string) => !only || only.has(id);
  const parents = new Set<string>();

  for (const id in target.objects) {
    if (!inScope(id)) continue;
    const want = target.objects[id];
    const have = live[id];
    if (typeof want.parentId === 'string') parents.add(want.parentId);
    if (!have) {
      plan.create.push({ ...want, id });
      continue;
    }
    const changes: Record<string, unknown> = {};
    const keys = new Set([...Object.keys(want), ...Object.keys(have)]);
    for (const key of keys) {
      if (SKIP.has(key)) continue;
      if (!jsonEqual(want[key], have[key])) changes[key] = want[key];
    }
    if (Object.keys(changes).length > 0) plan.patch.push({ id, changes });
    if ('table' in want && !jsonEqual(want.table, have.table)) {
      plan.tables.push({
        id,
        table: want.table,
        current: have.table,
        refsMarked: want.tableRefs === 2,
        currentRefsMarked: have.tableRefs === 2,
      });
    }
  }

  for (const id in live) {
    if (inScope(id) && !(id in target.objects)) plan.remove.push(id);
  }

  // Bring back each missing group and the chain of groups above it.
  const queued = new Set<string>();
  const visit = (groupId: string, depth: number) => {
    if (depth > 32 || queued.has(groupId) || groupId in liveGroups) return;
    const record = target.groups[groupId];
    if (!record) return;
    queued.add(groupId);
    if (typeof record.parentId === 'string') visit(record.parentId, depth + 1);
    plan.groups.push({ ...record, id: groupId });
  };
  parents.forEach((p) => visit(p, 0));

  return plan;
}

export const planSize = (plan: RestorePlan): number =>
  plan.create.length + plan.remove.length + plan.patch.length + plan.tables.length;
