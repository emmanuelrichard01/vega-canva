import { applyNodePatches, readNode } from '../document';
import { textEditing } from '../interaction/textEditing';
import { canEditObjects } from '../model/permissions';
import { useStore } from '../../hooks/useStore';
import { isPlaceholder, PLACEHOLDER_OPACITY } from './placeholderText';

/**
 * What makes a placeholder behave like one.
 *
 * A placeholder is ordinary text that reads "Click to add title" (see
 * `layouts.PROMPTS`), set at `PLACEHOLDER_OPACITY`. Two things turn it into
 * the real thing:
 *
 * - **Opening it selects all of it**, so the first key typed replaces the
 *   prompt instead of being appended to it.
 * - **Closing it with other words in it** brings it to full strength. Closed
 *   unchanged, it stays a placeholder.
 *
 * Presenting, the slide pictures and the PDF all leave unfilled placeholders
 * out, so a deck never shows an audience "Click to add title".
 */
export function installPlaceholders(): () => void {
  let editing: string | null = null;
  let wasPlaceholder = false;
  let raf = 0;

  const onChange = () => {
    const next = textEditing.getSnapshot();
    if (next === editing) return;
    const ended = editing;
    const endedPlaceholder = wasPlaceholder;
    editing = next;
    const node = next ? useStore.getState().objects[next] : undefined;
    wasPlaceholder = isPlaceholder(node as never);

    if (ended && endedPlaceholder && canEditObjects()) {
      // Read from the document after the editor's own commit has landed.
      queueMicrotask(() => {
        const after = readNode(ended) as { type: string; text?: unknown; opacity?: number } | null;
        if (after && !isPlaceholder(after) && after.opacity === PLACEHOLDER_OPACITY) {
          applyNodePatches([{ id: ended, changes: { opacity: 1 } }]);
        }
      });
    }

    if (next && wasPlaceholder) {
      cancelAnimationFrame(raf);
      // Two frames: the editor mounts, then focuses and places its caret.
      raf = requestAnimationFrame(() => {
        raf = requestAnimationFrame(() => {
          const el = document.activeElement;
          if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) el.select();
        });
      });
    }
  };

  const unsubscribe = textEditing.subscribe(onChange);
  return () => {
    unsubscribe();
    cancelAnimationFrame(raf);
  };
}
