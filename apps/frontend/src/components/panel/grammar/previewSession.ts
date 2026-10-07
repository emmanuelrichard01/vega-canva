import { applyNodePatches, readNode, undoManager } from '../../../engine/document';

/**
 * Live previews for a scrub, and one undo step for the result.
 *
 * While a scrub is in progress every panel write goes to the document under
 * `PREVIEW_ORIGIN`, which the undo manager does not track: the board (and
 * everyone on it) sees the value move, and the history does not. The first
 * time a scrub touches a field, its value before the scrub is kept.
 *
 * When the scrub ends those values are put back, still untracked, and the
 * final value is then written once with the ordinary origin. Undo therefore
 * returns to where the scrub began, not to its last intermediate frame.
 */
export const PREVIEW_ORIGIN = 'panel-preview';

type Patch = { id: string; changes: Record<string, unknown> };

let active = false;
const originals = new Map<string, Map<string, unknown>>();

export function isPreviewing(): boolean {
  return active;
}

export function beginPreview(): void {
  if (active) endPreview();
  active = true;
  originals.clear();
}

function capture(patches: readonly Patch[]): void {
  for (const { id, changes } of patches) {
    let kept = originals.get(id);
    if (!kept) {
      kept = new Map();
      originals.set(id, kept);
    }
    const current = Object.keys(changes).some((k) => !kept!.has(k)) ? readNode(id) : null;
    for (const key of Object.keys(changes)) {
      if (!kept.has(key)) kept.set(key, current ? current[key] : undefined);
    }
  }
}

/**
 * End a scrub: restore every field it touched, untracked. The caller writes
 * the final value next, as the one undo step. Separate capture groups on
 * either side keep that step from merging with an unrelated edit.
 */
export function endPreview(): void {
  if (!active) return;
  active = false;
  const restore: Patch[] = [];
  originals.forEach((kept, id) => {
    const changes: Record<string, unknown> = {};
    kept.forEach((value, key) => {
      changes[key] = value;
    });
    restore.push({ id, changes });
  });
  originals.clear();
  if (restore.length > 0) applyNodePatches(restore, { origin: PREVIEW_ORIGIN });
  undoManager.stopCapturing();
  queueMicrotask(() => undoManager.stopCapturing());
}

/** The panel's one write path: a preview during a scrub, an ordinary write otherwise. */
export function writePatches(patches: readonly Patch[]): void {
  if (patches.length === 0) return;
  if (active) {
    capture(patches);
    applyNodePatches(patches, { origin: PREVIEW_ORIGIN });
    return;
  }
  applyNodePatches(patches);
}
