import { useCallback } from 'react';
import type { CanvasContextMenuActions, ContextTarget } from '../components/CanvasContextMenu';
import type { AnyNode, ShapeGeometry, ShapeKind } from '../engine/model/schema';
import type { AlignEdge, DistributeAxis } from '../engine/model/align';
import {
  writeClipboard,
  parseClipboard,
  offsetOrigin,
  type ClipboardPayload,
} from '../engine/clipboard/clipboard';
import { looksLikeSvg } from '../engine/clipboard/svgImport';
import { deleteNodesWithFrames } from '../engine/interaction/frameMembership';
import { nextZIndex, lowestZIndex, applyNodePatches } from '../engine/document';
import { exportScope, scopeOptions, ExportService } from '../engine/export';
import { canEmitDiagram, diagramToMermaid, diagramIdOf } from '../engine/diagram/build';
import { editor } from '../engine/api/EditorAPI';
import { isLineLike } from '../engine/model/lineEnds';
import { lineEdit } from '../engine/interaction/lineEdit';
import { pathEdit } from '../engine/interaction/pathEdit';
import { textToPath, flattenToPath } from '../engine/document/vectorOps';
import { breakApartGrid } from '../engine/grid/gridApply';
import { fillGridWithImages, releaseSlots } from '../engine/grid/gridSlotApply';
import type { CopyResult } from './useRoomClipboard';
import { alignSelection, distributeSelection } from '../engine/model/align';
import { swapShapeKind } from '../engine/model/shapeSwap';
import { cameraSystem } from '../engine/CameraSystem';

export interface UseRoomContextMenuActionsOptions {
  selectedIds: string[];
  setSelectedIds: (ids: string[]) => void;
  diagramObjects: Record<string, AnyNode>;
  contextTarget: ContextTarget | null;
  localTitle: string;
  clipboardRef: React.MutableRefObject<ClipboardPayload | null>;
  copySelection: (event?: ClipboardEvent) => CopyResult;
  pasteObjects: (payload: ClipboardPayload, at?: { x: number; y: number }) => void;
  pasteSvg: (text: string) => void;
  pasteText: (rawText: string, at?: { x: number; y: number }) => void;
  showToast: (msg: string) => void;
  setExportFromSelection: (val: boolean) => void;
  setShowExportMenu: (val: boolean) => void;
  setDiagramSource: (src: string | undefined) => void;
  setDiagramReplacing: (id: string | null) => void;
  setDiagramReplaceIds: (ids: string[]) => void;
  setDiagramOpen: (open: boolean) => void;
}

export function useRoomContextMenuActions({
  selectedIds,
  setSelectedIds,
  diagramObjects,
  contextTarget,
  localTitle,
  clipboardRef,
  copySelection,
  pasteObjects,
  pasteSvg,
  pasteText,
  showToast,
  setExportFromSelection,
  setShowExportMenu,
  setDiagramSource,
  setDiagramReplacing,
  setDiagramReplaceIds,
  setDiagramOpen,
}: UseRoomContextMenuActionsOptions): CanvasContextMenuActions {
  const handleCopy = useCallback(() => {
    void copySelection();
  }, [copySelection]);

  /**
   * Paste, from the menu rather than from a keystroke.
   *
   * ## Why the system clipboard is asked first
   *
   * This used to prefer `clipboardRef` — the last copy made *in this tab* — and
   * only fall back to the real clipboard when there had been none. So copying
   * in one tab and right-click-pasting in another gave you that tab's older
   * copy instead of what you had just taken, while Ctrl+V in the same spot gave
   * the right thing. Two paths, two answers, and the wrong one silently winning
   * whenever both had something to say.
   *
   * The system clipboard is the shared truth; the ref is a cache for when it
   * cannot be read, which is a real case — Firefox gates `readText` behind a
   * permission prompt and Safari refuses it outside a user gesture in some
   * contexts. Asking it first and falling back keeps the menu working there
   * without letting it disagree with the keyboard anywhere else.
   */
  const handlePaste = useCallback(async () => {
    const at = contextTarget
      ? cameraSystem.screenToWorld(contextTarget.x, contextTarget.y)
      : cameraSystem.screenToWorld(window.innerWidth / 2, window.innerHeight / 2);

    try {
      const text = await navigator.clipboard?.readText?.();
      if (text) {
        const external = parseClipboard(text);
        if (external) {
          pasteObjects(external, at);
          return;
        }
        if (looksLikeSvg(text)) {
          pasteSvg(text);
          return;
        }
        if (text.trim()) {
          pasteText(text, at);
          return;
        }
      }
    } catch {
      // Read permission denied, or no clipboard API. The cache below is
      // exactly what that case is for.
    }

    if (clipboardRef.current) pasteObjects(clipboardRef.current, at);
  }, [contextTarget, clipboardRef, pasteObjects, pasteSvg, pasteText]);

  const handleDuplicate = useCallback(() => {
    const nodes = selectedIds.map((id) => diagramObjects[id]).filter(Boolean) as AnyNode[];
    const payload = writeClipboard(nodes);
    if (!payload) return;
    pasteObjects(payload, offsetOrigin(payload));
  }, [selectedIds, diagramObjects, pasteObjects]);

  const handleRemove = useCallback(() => {
    deleteNodesWithFrames(selectedIds);
    setSelectedIds([]);
  }, [selectedIds, setSelectedIds]);

  const handleBringToFront = useCallback(() => {
    const top = nextZIndex();
    applyNodePatches(selectedIds.map((id, i) => ({ id, changes: { zIndex: top + i } })));
  }, [selectedIds]);

  const handleSendToBack = useCallback(() => {
    const bottom = lowestZIndex();
    applyNodePatches(
      selectedIds.map((id, i) => ({ id, changes: { zIndex: bottom - selectedIds.length + i } }))
    );
  }, [selectedIds]);

  const handleSelectAll = useCallback(() => {
    setSelectedIds(Object.keys(diagramObjects));
  }, [diagramObjects, setSelectedIds]);

  const handleSelectAllOfType = useCallback(() => {
    const type = diagramObjects[selectedIds[0]]?.type;
    if (!type) return;
    setSelectedIds(Object.values(diagramObjects).filter((n) => n.type === type).map((n) => n.id));
  }, [diagramObjects, selectedIds, setSelectedIds]);

  const handleCopyPng = useCallback(
    async (ids: string[]) => {
      const scope = exportScope(diagramObjects, ids, localTitle);
      const result = await ExportService.copy('png', {
        ...scopeOptions(scope),
        stage: (window as any)._konva_stage,
      });
      showToast(result.ok ? `Copied ${scope.subject} as PNG` : result.message!);
    },
    [diagramObjects, localTitle, showToast]
  );

  const handleCopySvg = useCallback(
    async (ids: string[]) => {
      const scope = exportScope(diagramObjects, ids, localTitle);
      const result = await ExportService.copy('svg', scopeOptions(scope));
      showToast(result.ok ? `Copied ${scope.subject} as SVG` : result.message!);
    },
    [diagramObjects, localTitle, showToast]
  );

  const handleExportSelection = useCallback(
    (ids: string[]) => {
      setExportFromSelection(ids.length > 0);
      setShowExportMenu(true);
    },
    [setExportFromSelection, setShowExportMenu]
  );

  const handleCopyMermaid = useCallback(() => {
    const selected = selectedIds.map((id) => diagramObjects[id]).filter(Boolean);
    if (!canEmitDiagram(selected)) return;
    void navigator.clipboard.writeText(diagramToMermaid(selected));
  }, [selectedIds, diagramObjects]);

  const handleEditMermaid = useCallback(() => {
    const selected = selectedIds.map((id) => diagramObjects[id]).filter(Boolean);
    if (!canEmitDiagram(selected)) return;
    setDiagramSource(diagramToMermaid(selected));
    setDiagramReplacing(diagramIdOf(selected.find((n) => diagramIdOf(n)) ?? selected[0]) ?? null);
    setDiagramReplaceIds(selected.map((n) => n.id));
    setDiagramOpen(true);
  }, [
    selectedIds,
    diagramObjects,
    setDiagramSource,
    setDiagramReplacing,
    setDiagramReplaceIds,
    setDiagramOpen,
  ]);

  const handleGroup = useCallback(() => {
    if (selectedIds.length > 1) editor.groupNodes(selectedIds);
  }, [selectedIds]);

  const handleUngroup = useCallback(() => {
    if (selectedIds.length > 0) editor.ungroupNodes(selectedIds);
  }, [selectedIds]);

  const handleEditLinePoints = useCallback(() => {
    const only = selectedIds.length === 1 ? diagramObjects[selectedIds[0]] : null;
    if (only && isLineLike(only) && !only.locked) lineEdit.begin(only.id);
  }, [selectedIds, diagramObjects]);

  const handleToPath = useCallback(() => {
    if (selectedIds.length !== 1) return;
    const target = diagramObjects[selectedIds[0]];

    const land = (newId: string) => {
      setSelectedIds([newId]);
      pathEdit.enter(newId);
      window.dispatchEvent(new CustomEvent('legacy_tool_change', { detail: 'direct-select' }));
    };

    if (target?.type === 'text') {
      textToPath(selectedIds[0])
        .then((result) => {
          if (!result) {
            showToast('There are no letters in that box to outline');
            return;
          }
          land(result.id);
          if (result.dropped.length > 0) {
            showToast(`Outlined. ${result.dropped.join(', ')} could not come along.`);
          }
        })
        .catch((error: unknown) => {
          showToast(error instanceof Error ? error.message : 'That text could not be outlined');
        });
      return;
    }

    const newId = flattenToPath(selectedIds[0]);
    if (newId) land(newId);
  }, [selectedIds, diagramObjects, setSelectedIds, showToast]);

  const handleBreakApart = useCallback(() => {
    if (selectedIds.length !== 1) return;
    const ids = breakApartGrid(selectedIds[0]);
    if (ids.length > 0) setSelectedIds(ids);
  }, [selectedIds, setSelectedIds]);

  /**
   * Put the selected pictures into the selected grid.
   *
   * The affordance guarantees exactly one grid and at least one picture, so
   * this does not re-litigate that — it only has to decide the **order**, and
   * it takes the order the pictures are stacked in rather than the order they
   * were clicked. Stacking order is what the Layers panel shows and what the
   * board looks like; selection order is invisible and is whatever a marquee
   * happened to sweep up, so two people making the same selection two ways
   * would otherwise get two different arrangements.
   */
  const handleFillGrid = useCallback(() => {
    const nodes = selectedIds.map((id) => diagramObjects[id]).filter(Boolean) as AnyNode[];
    const grid = nodes.find((n) => n.type === 'grid');
    if (!grid) return;

    const images = nodes
      .filter((n) => n.type === 'image')
      .sort((a, b) => a.zIndex - b.zIndex)
      .map((n) => n.id);

    const { placed, overflow } = fillGridWithImages(grid.id, images);
    if (placed > 0) setSelectedIds(images.filter((id) => !overflow.includes(id)));

    /**
     * Say what happened, including the part that did not.
     *
     * Filling nine of twelve and saying nothing is the quiet partial success
     * this codebase has been bitten by before — the three that did not fit are
     * still selected and still on the board, and the only way to find out
     * would be to count.
     */
    if (placed === 0) showToast('No free modules in that grid');
    else if (overflow.length > 0) {
      showToast(
        `Placed ${placed}, and ${overflow.length} did not fit`
      );
    } else {
      showToast(`Placed ${placed} image${placed === 1 ? '' : 's'}`);
    }
  }, [selectedIds, diagramObjects, setSelectedIds, showToast]);

  /** Take the selected pictures and captions back out of their modules. */
  const handleReleaseFromGrid = useCallback(() => {
    releaseSlots(selectedIds);
  }, [selectedIds]);

  const handleAlign = useCallback(
    (edge: AlignEdge) => {
      const nodes = selectedIds.map((id) => diagramObjects[id]).filter(Boolean) as AnyNode[];
      applyNodePatches(alignSelection(nodes, edge));
    },
    [selectedIds, diagramObjects]
  );

  const handleDistribute = useCallback(
    (axis: DistributeAxis) => {
      const nodes = selectedIds.map((id) => diagramObjects[id]).filter(Boolean) as AnyNode[];
      applyNodePatches(distributeSelection(nodes, axis));
    },
    [selectedIds, diagramObjects]
  );

  const handleToggleLock = useCallback(() => {
    const nodes = selectedIds.map((id) => diagramObjects[id]).filter(Boolean) as AnyNode[];
    const locked = nodes.length > 0 && nodes.every((n) => n.locked);
    applyNodePatches(nodes.map((n) => ({ id: n.id, changes: { locked: !locked } })));
  }, [selectedIds, diagramObjects]);

  const handleHide = useCallback(() => {
    const nodes = selectedIds.map((id) => diagramObjects[id]).filter(Boolean) as AnyNode[];
    const hidden = nodes.length > 0 && nodes.every((n) => n.hidden);
    applyNodePatches(nodes.map((n) => ({ id: n.id, changes: { hidden: !hidden } })));
  }, [selectedIds, diagramObjects]);

  const handleSwapShape = useCallback(
    (kind: ShapeKind, points?: number) => {
      applyNodePatches(
        selectedIds
          .map((id) => diagramObjects[id])
          .filter((n): n is AnyNode => Boolean(n) && n.type === 'shape')
          .map((n) => ({
            id: n.id,
            changes: {
              geometry: swapShapeKind(
                (n as unknown as { geometry: ShapeGeometry }).geometry,
                kind,
                points
              ),
            },
          }))
      );
    },
    [selectedIds, diagramObjects]
  );

  return {
    copy: handleCopy,
    paste: handlePaste,
    duplicate: handleDuplicate,
    remove: handleRemove,
    bringToFront: handleBringToFront,
    sendToBack: handleSendToBack,
    selectAll: handleSelectAll,
    selectAllOfType: handleSelectAllOfType,
    copyPng: handleCopyPng,
    copySvg: handleCopySvg,
    exportSelection: handleExportSelection,
    copyMermaid: handleCopyMermaid,
    editMermaid: handleEditMermaid,
    group: handleGroup,
    ungroup: handleUngroup,
    editLinePoints: handleEditLinePoints,
    'to-path': handleToPath,
    'break-apart': handleBreakApart,
    fillGrid: handleFillGrid,
    releaseFromGrid: handleReleaseFromGrid,
    align: handleAlign,
    distribute: handleDistribute,
    toggleLock: handleToggleLock,
    hide: handleHide,
    swapShape: handleSwapShape,
  };
}
