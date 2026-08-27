import { useEffect } from 'react';
import { undoManager } from '../engine/document';
import { useStore } from './useStore';
import { LINE_SEAT, TOOL_FOR_KEY, lineSeatFor } from '../engine/tools/shortcuts';
import { editor } from '../engine/api/EditorAPI';
import { cameraSystem } from '../engine/CameraSystem';
import { isForceTool } from '../engine/physics/forces';

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
 * - Command Palette (Cmd+K, Cmd+P)
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

  // Escape leaves Force mode or disarms Audio mode
  useEffect(() => {
    if (!isForceTool(activeTool) && activeTool !== 'audio') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const el = document.activeElement?.tagName;
      if (el === 'INPUT' || el === 'TEXTAREA') return;
      setActiveTool('select');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeTool, setActiveTool]);

  // Main room shortcut router
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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

      if (hasModifier && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setShowCommandPalette(true);
        return;
      }

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
