import { useEffect, useRef } from 'react';
import type { CanvasContextMenuActions, ContextTarget } from '../components/CanvasContextMenu';
import type { AnyNode } from '../engine/model/schema';
import { selectionBounds } from '../engine/model/selection';
import { cameraSystem } from '../engine/CameraSystem';

/**
 * The keys for the commands the menu shows, bound to the same actions.
 *
 * ## Why these moved out of `Canvas`
 *
 * Duplicate and the four restacks were written a second time inside the
 * canvas's key handler, and the second copies were each wrong in a different
 * way: Ctrl+D cloned connectors still bound to the originals, Ctrl+] added one
 * to a `zIndex` that duplicates share, Ctrl+[ clamped at zero while Send to
 * back writes negatives. And Ctrl+Shift+] compared `e.key` to `']'`, which a
 * held Shift turns into `'}'` on most layouts — so it never fired at all.
 *
 * A shortcut shown on a menu row is a promise that the key does what the row
 * does. Binding both to one action is the only way to keep it. Keys are read by
 * `e.code`, the physical key, for the same reason: Option+C on a Mac types `ç`.
 *
 * ## Opening the menu from the keyboard
 *
 * Shift+F10 and the Menu key are how every desktop platform opens a context
 * menu without a pointer. The menu opens on the selection — or the middle of
 * the board — with the keyboard already on its first row.
 */
export function useSelectionCommandKeys({
  actions,
  selectedIds,
  objects,
  canEdit,
  openMenu,
}: {
  actions: CanvasContextMenuActions;
  selectedIds: string[];
  objects: Record<string, AnyNode>;
  canEdit: boolean;
  openMenu: (target: ContextTarget) => void;
}) {
  const live = useRef({ actions, selectedIds, objects, canEdit, openMenu });
  live.current = { actions, selectedIds, objects, canEdit, openMenu };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      if (
        el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.tagName === 'SELECT' ||
          el.isContentEditable ||
          el.closest?.('[role="dialog"], [role="menu"]'))
      ) {
        return;
      }

      const { actions: a, selectedIds: ids, objects: all, canEdit: editable, openMenu: open } = live.current;
      const mod = e.ctrlKey || e.metaKey;

      if ((e.key === 'F10' && e.shiftKey && !mod) || e.key === 'ContextMenu') {
        e.preventDefault();
        const nodes = ids.map((id) => all[id]).filter(Boolean);
        const stage = document.querySelector('.konvajs-content')?.getBoundingClientRect();
        const box = selectionBounds(nodes);
        const x = box
          ? (stage?.left ?? 0) + (box.x + box.width / 2) * cameraSystem.zoom + cameraSystem.x
          : (stage?.left ?? 0) + (stage?.width ?? window.innerWidth) / 2;
        const y = box
          ? (stage?.top ?? 0) + (box.y + box.height / 2) * cameraSystem.zoom + cameraSystem.y
          : (stage?.top ?? 0) + (stage?.height ?? window.innerHeight) / 2;
        open({ x, y, ids: nodes.map((n) => n.id), viaKeyboard: true });
        return;
      }

      if (ids.length === 0) return;

      // Looking, not changing: allowed for viewers.
      if (e.shiftKey && !mod && !e.altKey && e.code === 'Digit2') {
        e.preventDefault();
        a.zoomToSelection();
        return;
      }

      if (!editable || !mod) return;

      const run = (fn: () => void) => {
        e.preventDefault();
        e.stopImmediatePropagation();
        fn();
      };

      if (e.altKey && !e.shiftKey && e.code === 'KeyC') return run(a.copyStyle);
      if (e.altKey && !e.shiftKey && e.code === 'KeyV') return run(a.pasteStyle);
      if (e.altKey) return;

      if (!e.shiftKey && e.code === 'KeyD') return run(a.duplicate);
      if (e.code === 'BracketRight') return run(() => a.restack(e.shiftKey ? 'front' : 'forward'));
      if (e.code === 'BracketLeft') return run(() => a.restack(e.shiftKey ? 'back' : 'backward'));
      if (e.shiftKey && e.code === 'KeyL') return run(a.toggleLock);
      if (e.shiftKey && e.code === 'KeyH') return run(a.hide);
    };
    // Capture, so the board's own window handler — which still binds a few of
    // the same keys for its modes — never sees a key this has already run.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
}
