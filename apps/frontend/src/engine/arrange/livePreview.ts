import { applyNodePatches, undoManager } from '../document';
import { liveTransformStore } from '../model/liveTransformStore';
import { canEditObjects } from '../model/permissions';
import type { NodePatch } from '../model/selection';

/**
 * A scrub's intermediate frames, drawn and never written.
 *
 * Positions and sizes go to `liveTransformStore`, which the renderers, the
 * connectors and the selection box all follow, so a value being dragged
 * reads on the board at once while the document and the history see only the
 * value the scrub ends on.
 */
const shown = new Set<string>();

export function showPatches(patches: readonly NodePatch[]): void {
  const batch: Array<[string, Record<string, number>]> = [];
  for (const { id, changes } of patches) {
    const live: Record<string, number> = {};
    for (const key of ['x', 'y', 'width', 'height'] as const) {
      if (typeof changes[key] === 'number') live[key] = changes[key] as number;
    }
    batch.push([id, live]);
    shown.add(id);
  }
  // Objects a previous frame moved and this one leaves alone go back.
  const now = new Set(patches.map((p) => p.id));
  const released = [...shown].filter((id) => !now.has(id));
  released.forEach((id) => shown.delete(id));
  if (released.length > 0) liveTransformStore.deleteBatch(released);
  if (batch.length > 0) liveTransformStore.setBatch(batch);
}

/** Drop every previewed frame. */
export function clearShown(): void {
  if (shown.size === 0) return;
  const ids = [...shown];
  shown.clear();
  liveTransformStore.deleteBatch(ids);
}

/**
 * Write patches as their own undo step, then drop any preview of them, in
 * that order so nothing flashes back to where it started.
 */
export function commitPatches(patches: readonly NodePatch[]): void {
  if (patches.length > 0 && canEditObjects()) {
    undoManager.stopCapturing();
    applyNodePatches(patches);
    undoManager.stopCapturing();
  }
  clearShown();
}
