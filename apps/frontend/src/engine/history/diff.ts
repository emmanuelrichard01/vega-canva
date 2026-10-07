import { BOOKKEEPING_FIELD_NAMES } from './sessionTimeline';
import { jsonEqual, type Frame, type ObjectJson } from './frames';

/**
 * What changed between two frames, for "Show changes".
 *
 * Bookkeeping the write path stamps on every edit (`updatedAt`, `updatedBy`…)
 * is ignored, so an object counts as modified only when something a person
 * would see or choose differs.
 */
export interface FrameDiff {
  added: string[];
  removed: string[];
  modified: string[];
}

const IGNORED = new Set<string>(BOOKKEEPING_FIELD_NAMES);

export function objectChanged(a: ObjectJson, b: ObjectJson): boolean {
  if (a === b) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (IGNORED.has(key)) continue;
    if (!jsonEqual(a[key], b[key])) return true;
  }
  return false;
}

/**
 * @param only When given, restrict the diff to these ids (per-object history).
 */
export function diffFrames(base: Frame, target: Frame, only?: ReadonlySet<string> | null): FrameDiff {
  const added: string[] = [];
  const removed: string[] = [];
  const modified: string[] = [];
  for (const id in target) {
    if (only && !only.has(id)) continue;
    const before = base[id];
    if (!before) added.push(id);
    else if (objectChanged(before, target[id])) modified.push(id);
  }
  for (const id in base) {
    if (only && !only.has(id)) continue;
    if (!(id in target)) removed.push(id);
  }
  return { added, removed, modified };
}

export const diffSize = (diff: FrameDiff): number =>
  diff.added.length + diff.removed.length + diff.modified.length;
