import { useEffect } from 'react';
import { undoManager } from '../engine/document';
import { useStore } from './useStore';
import { LINE_SEAT, TOOL_FOR_KEY, lineSeatFor } from '../engine/tools/shortcuts';
import { editor } from '../engine/api/EditorAPI';
import { cameraSystem } from '../engine/CameraSystem';

export interface RoomShortcutsOptions {
  selectTool: (toolId: string) => void;
  selectedIds?: string[];
  setSelectedIds: (ids: string[]) => void;
  setShowCommandPalette: (setter: boolean | ((prev: boolean) => boolean)) => void;
  setShowHelp: (show: boolean) => void;
  setIsUiVisible: (setter: (prev: boolean) => boolean) => void;
  isCompact: boolean;
  panelsOpen: boolean;
  setPanelsOpen: (open: boolean) => void;
  activeTool: string;
  setActiveTool: (tool: string) => void;
  /**
   * Open the export dialog pointed at the selection.
   *
   * Optional so the hook stays usable from a test that is not exercising it,
   * and so the shortcut is simply absent rather than throwing where no dialog
   * exists to open.
   */
  openExport?: (fromSelection: boolean) => void;
}

/**
 * Handles room-level keyboard shortcuts:
 * - Undo / Redo (Cmd+Z, Cmd+Shift+Z, Ctrl+Y)
 * - Select All (Cmd+A)
 * - Command Palette (Cmd+K)
 * - Zoom in / out / fit / reset (Cmd/Ctrl + +/-, bare +/-, 0, !)
 * - Tool hotkeys (from TOOL_FOR_KEY map)
 * - Export the selection (Cmd/Ctrl + Shift + E)
 * - Help (?), Toggle UI (\)
 * - Panel dismissals on Escape
 */
export function useRoomShortcuts({
  selectTool,
  selectedIds = [],
  setSelectedIds,
  setShowCommandPalette,
  setShowHelp,
  setIsUiVisible,
  isCompact,
  panelsOpen,
  setPanelsOpen,
  activeTool,
  setActiveTool,
  openExport,
}: RoomShortcutsOptions) {
  // Escape closes overlay panels in compact mode
  useEffect(() => {
    if (!isCompact || !panelsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPanelsOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isCompact, panelsOpen, setPanelsOpen]);

  /**
   * Escape puts the arrow back in your hand.
   *
   * This used to cover the force tools and the audio tool only, which are the
   * two that trap you most obviously — but the rule people arrive with is the
   * one Figma, Illustrator and Photoshop all share: **Escape returns to the
   * selection tool, from anywhere.** Picking up the pen and then wanting to
   * move what you just drew is the single most common thing anyone does on
   * this board, and the alternative was pressing `V` or hunting the dock.
   *
   * ## Why a plain bubble-phase listener is the right layering
   *
   * Escape already means something to several modes: it leaves a crop, exits
   * the path editor, cancels a reframe, closes a thread. Every one of those
   * listens in the **capture** phase and calls `stopPropagation`, which stops
   * the event before it bubbles back to this one.
   *
   * That gives the layering for free, and it is the layering those apps have:
   * the first Escape cancels whatever is in progress, and the *next* one — with
   * nothing left to cancel — hands you the arrow. Registering this in capture
   * too, or reaching for a "is anything in progress" flag, would break that and
   * would be a second derivation of something the event model already answers.
   */
  useEffect(() => {
    if (activeTool === 'select') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      /**
       * Typing into something is the one case where Escape is unambiguously
       * about the text and not about the tool.
       *
       * Read as properties rather than through `instanceof`, which compares
       * against *this realm's* constructors — so a field inside an embedded
       * document would fail the test and have the tool yanked out from under
       * it. It is also what lets this be covered without a DOM.
       */
      const el = document.activeElement as {
        tagName?: unknown;
        isContentEditable?: unknown;
      } | null;
      const tag = el && typeof el.tagName === 'string' ? el.tagName.toUpperCase() : '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (el?.isContentEditable === true) return;
      setActiveTool('select');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeTool, setActiveTool]);

  // Main room shortcut router
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      const hasModifier = e.ctrlKey || e.metaKey;

      if (hasModifier && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) undoManager.redo();
        else undoManager.undo();
        return;
      }

      if (hasModifier && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        undoManager.redo();
        return;
      }

      if (e.key === 'Escape') {
        window.dispatchEvent(new CustomEvent('exitGroupIsolation'));
      }

      if (hasModifier && e.key.toLowerCase() === 'a') {
        if (e.defaultPrevented) return;
        e.preventDefault();
        setSelectedIds(Object.keys(useStore.getState().objects));
        return;
      }

      /**
       * Export the selection.
       *
       * Cmd/Ctrl + Shift + E because that is the shortcut Figma, Illustrator
       * and Sketch all use for it — a person arriving from any of the three
       * already has this in their hands, and a canvas app that assigns it to
       * something else is a canvas app that surprises them once per session.
       *
       * With nothing selected it opens on the board, which is what the same
       * key does in all three.
       */
      if (hasModifier && e.shiftKey && e.key.toLowerCase() === 'e' && openExport) {
        e.preventDefault();
        openExport(selectedIds.length > 0);
        return;
      }

      if (hasModifier && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setShowCommandPalette((prev) => !prev);
        return;
      }

      /*
       * Cmd+P is Print, and it is not ours to take.
       *
       * It used to be a second opener for the palette, with a
       * `preventDefault()` on it, so pressing the shortcut every operating
       * system and browser agrees means "print this" produced a command list
       * instead. A shortcut that is wrong everywhere else is not a convenience
       * however well it reads in a changelog, and there is nothing here Cmd+K
       * does not already do.
       */

      // Zoom In (Cmd + + / =)
      if (hasModifier && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        const cx = typeof window !== 'undefined' ? window.innerWidth / 2 : 400;
        const cy = typeof window !== 'undefined' ? window.innerHeight / 2 : 300;
        cameraSystem.zoomAt(1, cx, cy);
        return;
      }

      // Zoom Out (Cmd + - / _)
      if (hasModifier && (e.key === '-' || e.key === '_')) {
        e.preventDefault();
        const cx = typeof window !== 'undefined' ? window.innerWidth / 2 : 400;
        const cy = typeof window !== 'undefined' ? window.innerHeight / 2 : 300;
        cameraSystem.zoomAt(-1, cx, cy);
        return;
      }

      // Zoom Reset (Cmd + 0)
      if (hasModifier && e.key === '0') {
        e.preventDefault();
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('navigateViewport', { detail: { x: 0, y: 0, zoom: 1 } })
          );
        }
        return;
      }

      // Zoom to Fit (Cmd + 1 or Cmd + Shift + 1)
      if (hasModifier && (e.key === '1' || e.key === '!')) {
        e.preventDefault();
        editor.zoomToFit();
        return;
      }

      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const key = e.key.toLowerCase();

      const tool = TOOL_FOR_KEY[key];
      if (tool) {
        // The line key arms a *seat*, and pressing it again switches within
        // it — line and arrow differ only by which end carries a head, share
        // one dock button, and there is no second mnemonic letter free. See
        // `lineSeatFor`.
        selectTool(LINE_SEAT.includes(tool) ? lineSeatFor(activeTool) : tool);
        return;
      }

      switch (key) {
        case '?':
          setShowHelp(true);
          break;
        case '\\':
          setIsUiVisible((prev) => !prev);
          break;
        case '0':
          if (typeof window !== 'undefined') {
            window.dispatchEvent(
              new CustomEvent('navigateViewport', { detail: { x: 0, y: 0, zoom: 1 } })
            );
          }
          break;
        case '!':
          editor.zoomToFit();
          break;
        case '+':
        case '=': {
          const cx = typeof window !== 'undefined' ? window.innerWidth / 2 : 400;
          const cy = typeof window !== 'undefined' ? window.innerHeight / 2 : 300;
          cameraSystem.zoomAt(1, cx, cy);
          break;
        }
        case '-':
        case '_': {
          const cx = typeof window !== 'undefined' ? window.innerWidth / 2 : 400;
          const cy = typeof window !== 'undefined' ? window.innerHeight / 2 : 300;
          cameraSystem.zoomAt(-1, cx, cy);
          break;
        }
        case 'arrowleft':
        case 'arrowright':
        case 'arrowup':
        case 'arrowdown': {
          if (selectedIds.length === 0) {
            const focus = document.activeElement;
            const isEditingField = focus && (
              focus.tagName === 'INPUT' ||
              focus.tagName === 'TEXTAREA' ||
              focus.tagName === 'SELECT' ||
              (focus as HTMLElement).isContentEditable ||
              focus.getAttribute?.('role') === 'listbox' ||
              focus.getAttribute?.('role') === 'dialog' ||
              focus.closest?.('[role="dialog"]') ||
              focus.closest?.('.layers-panel')
            );
            if (!isEditingField) {
              e.preventDefault();
              const step = (e.shiftKey ? 80 : 30) / cameraSystem.zoom;
              let dx = 0;
              let dy = 0;
              if (key === 'arrowleft') dx = -step;
              if (key === 'arrowright') dx = step;
              if (key === 'arrowup') dy = -step;
              if (key === 'arrowdown') dy = step;
              cameraSystem.panBy(-dx * cameraSystem.zoom, -dy * cameraSystem.zoom);
            }
          }
          break;
        }
      }
    };

    const handleToolChange = (e: Event) => {
      const custom = e as CustomEvent<string>;
      if (custom.detail) selectTool(custom.detail);
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', handleKeyDown);
      window.addEventListener('legacy_tool_change', handleToolChange);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('keydown', handleKeyDown);
        window.removeEventListener('legacy_tool_change', handleToolChange);
      }
    };
  }, [selectTool, setSelectedIds, setShowCommandPalette, setShowHelp, setIsUiVisible, selectedIds, openExport, activeTool]);
}
