import { useSyncExternalStore } from 'react';
import { undoManager } from '../engine/document';

/**
 * Whether there is anything to undo or redo, live.
 *
 * The header's Undo and Redo were always enabled, so on a fresh board both
 * looked pressable and neither did anything — and after undoing everything,
 * Undo still invited a press. Every editor greys them out; this is what lets
 * the header do the same, from the Yjs undo manager's own stack events.
 */
function subscribe(onChange: () => void) {
  const events = ['stack-item-added', 'stack-item-popped', 'stack-cleared'] as const;
  events.forEach((e) => undoManager.on(e, onChange));
  return () => events.forEach((e) => undoManager.off(e, onChange));
}

const snapshot = () => `${undoManager.undoStack.length > 0 ? 1 : 0}${undoManager.redoStack.length > 0 ? 1 : 0}`;

export function useUndoAvailability(): { canUndo: boolean; canRedo: boolean } {
  const state = useSyncExternalStore(subscribe, snapshot, snapshot);
  return { canUndo: state[0] === '1', canRedo: state[1] === '1' };
}
