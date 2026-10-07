import { useEffect, useRef } from 'react';
import { useStore } from '../../hooks/useStore';
import { applyNodePatches, updateNodes } from '../../engine/document';
import { STICKY_THEMES, type AnyNode, type FrameNode } from '../../engine/model/schema';
import { keyBelongsToFocus } from '../../engine/interaction/keyTarget';
import { canEditObjects } from '../../engine/model/permissions';
import { hugBox } from '../../engine/model/frames';
import { nodeBounds } from '../../engine/model/selection';
import { applyOrganiseStickies } from '../../engine/tools/organiseStickies';

/**
 * Board shortcuts for stickies and frames.
 *
 * - **1–8** with stickies selected recolours them, in the palette's order. The
 *   digits otherwise arm a gesture; a selection of notes is the stronger
 *   intent, so this listens in the capture phase and claims the key.
 * - **⌥⌘O** organises the selected stickies by colour, **⌥⌘⇧O** by author.
 * - **⌥⌘⇧R** resizes the selected frames to fit what they hold.
 * - **⌥⌘Enter** presents the board's frames, starting from a selected one.
 *
 * All of these write the document except presenting, so they are editor-only
 * and run nothing for viewers or commenters.
 */

/** Ask the presenter to start, optionally from a given frame. */
export function requestPresentation(startId?: string): void {
  window.dispatchEvent(new CustomEvent('presentFrames', { detail: { startId } }));
}

/** Fit each frame among `nodes` to its direct contents. Returns how many changed. */
export function resizeFramesToFit(frames: readonly FrameNode[], all: Record<string, AnyNode>): number {
  const patches: Array<{ id: string; changes: Record<string, unknown> }> = [];
  const members = Object.values(all);
  for (const frame of frames) {
    const contents = members.filter((n) => n.frameId === frame.id && n.type !== 'connector').map(nodeBounds);
    const box = hugBox(contents);
    if (!box) continue;
    if (box.x === frame.x && box.y === frame.y && box.width === frame.width && box.height === frame.height) continue;
    patches.push({ id: frame.id, changes: box });
  }
  applyNodePatches(patches);
  return patches.length;
}

export function useContentShortcuts({ selectedIds }: { selectedIds: readonly string[] }): void {
  const selectedRef = useRef(selectedIds);
  selectedRef.current = selectedIds;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat) return;
      if (keyBelongsToFocus(e.key)) return;
      const ids = selectedRef.current;
      const all = useStore.getState().objects as Record<string, AnyNode>;
      const selected = ids.map((id) => all[id]).filter(Boolean);
      const mod = e.metaKey || e.ctrlKey;

      const claim = () => {
        e.preventDefault();
        e.stopImmediatePropagation();
      };

      // Presenting reads the board and writes nothing, so anyone may.
      if (mod && e.altKey && !e.shiftKey && e.key === 'Enter') {
        claim();
        const frame = selected.find((n) => n.type === 'frame');
        requestPresentation(frame?.id);
        return;
      }

      if (!canEditObjects()) return;

      const stickies = selected.filter((n) => n.type === 'sticky');

      if (!mod && !e.altKey && !e.shiftKey && stickies.length > 0 && /^Digit[1-8]$/.test(e.code)) {
        const theme = STICKY_THEMES[Number(e.code.slice(5)) - 1];
        if (!theme) return;
        claim();
        updateNodes(
          stickies.map((n) => n.id),
          { theme }
        );
        return;
      }

      if (mod && e.altKey && e.code === 'KeyO' && stickies.length > 1) {
        claim();
        applyOrganiseStickies(stickies, e.shiftKey ? 'author' : 'theme');
        return;
      }

      if (mod && e.altKey && e.shiftKey && e.code === 'KeyR') {
        const frames = selected.filter((n): n is FrameNode => n.type === 'frame');
        if (frames.length === 0) return;
        claim();
        resizeFramesToFit(frames, all);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
}
