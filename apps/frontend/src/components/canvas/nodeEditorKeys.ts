import type { ChainDirection } from '../../engine/tools/stickyChain';
import { formatCommandFor, type FormatCommand } from '../../engine/text/textShortcuts';

/**
 * What a key press means to the in-place text editor.
 *
 * Pure, so the chords can be tested without a textarea. Keys pressed while an
 * IME composition is open belong to the composition: Tab and Cmd+Enter would
 * otherwise chain a new note mid-word, and Escape would discard the note
 * instead of the candidate.
 */
export type EditorKeyIntent =
  | { kind: 'cancel' }
  | { kind: 'chain'; direction: ChainDirection }
  | { kind: 'finish' }
  | { kind: 'format'; command: FormatCommand };

export interface EditorKeyEvent {
  key: string;
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  isComposing?: boolean;
}

export function editorKeyIntent(
  e: EditorKeyEvent,
  { sticky, formattable }: { sticky: boolean; formattable: boolean }
): EditorKeyIntent | null {
  if (e.isComposing) return null;
  if (e.key === 'Escape') return { kind: 'cancel' };
  // Tab chains a new note to the right, Shift+Tab one below. A literal tab
  // character in a sticky is worth nothing.
  if (e.key === 'Tab' && sticky) return { kind: 'chain', direction: e.shiftKey ? 'down' : 'right' };
  // Cmd/Ctrl+Enter finishes editing; on a sticky it also starts the next.
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    return sticky ? { kind: 'chain', direction: 'right' } : { kind: 'finish' };
  }
  const command = formattable ? formatCommandFor(e) : null;
  return command ? { kind: 'format', command } : null;
}
