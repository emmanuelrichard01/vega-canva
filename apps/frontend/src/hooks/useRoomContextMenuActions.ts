import { useCallback, useMemo } from 'react';
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
import { applyNodePatches } from '../engine/document';
// The scope helpers are pure and tiny and belong with the canvas; the export
// engine behind `ExportService` is 440kB and is fetched when it is used. See
// the note in `vite.config.ts` about which of these ship with the board.
import { exportScope, scopeOptions } from '../engine/export/exportScope';
import { canEmitDiagram, diagramToMermaid, diagramIdOf } from '../engine/diagram/build';
import { editor } from '../engine/api/EditorAPI';
import { isLineLike } from '../engine/model/lineEnds';
import { lineEdit } from '../engine/interaction/lineEdit';
import { pathEdit } from '../engine/interaction/pathEdit';
import { textToPath, flattenToPath, outlineStrokeOf } from '../engine/document/vectorOps';
import { breakApartGrid } from '../engine/grid/gridApply';
import { fillGridWithImages, releaseSlots } from '../engine/grid/gridSlotApply';
import type { CopyResult } from './useRoomClipboard';
import { alignSelection, distributeSelection } from '../engine/model/align';
import { swapShapeKind } from '../engine/model/shapeSwap';
import { cameraSystem } from '../engine/CameraSystem';
import { restackSelection, type RestackOp } from '../engine/model/restack';
import { applyStylePatches, extractStyle, styleClipboard } from '../engine/model/styleClipboard';
import { kindNoun, matchingIds } from '../engine/model/selectMatching';
import { clientToWorld } from '../engine/interaction/clientToWorld';
import { addShapeAt, addStickyAt, addTextAt } from '../engine/interaction/quickCreate';
import { engineEvents } from '../engine/EventBus';
import { createTableFromCsvFile } from '../engine/table/tableApply';
import type { ShapePreset } from '../components/workspace/shapeCatalog';
import { createCode } from '../engine/code/codeApply';
import { CodeTool } from '../engine/tools/CodeTool';
import { useStore } from './useStore';

export interface UseRoomContextMenuActionsOptions {
  selectedIds: string[];
  setSelectedIds: (ids: string[]) => void;
  diagramObjects: Record<string, AnyNode>;
  contextTarget: ContextTarget | null;
  localTitle: string;
  clipboardRef: React.MutableRefObject<ClipboardPayload | null>;
  copySelection: (event?: ClipboardEvent) => CopyResult;
  pasteObjects: (
    payload: ClipboardPayload,
    at?: { x: number; y: number },
    options?: { quiet?: boolean }
  ) => void;
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

/** Where on the board "here" is: the menu's spot, or the middle of the view. */
function spotOf(target: ContextTarget | null): { x: number; y: number } {
  if (target && !target.viaKeyboard) return clientToWorld(target.x, target.y);
  const stage = typeof document !== 'undefined'
    ? document.querySelector('.konvajs-content')?.getBoundingClientRect()
    : null;
  return stage
    ? clientToWorld(stage.left + stage.width / 2, stage.top + stage.height / 2)
    : cameraSystem.screenToWorld(window.innerWidth / 2, window.innerHeight / 2);
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
  const selectedNodes = useCallback(
    () => selectedIds.map((id) => diagramObjects[id]).filter(Boolean) as AnyNode[],
    [selectedIds, diagramObjects]
  );

  const handleCopy = useCallback(() => {
    void copySelection();
  }, [copySelection]);

  /**
   * Cut removes exactly what it copied — the same rule the `cut` event keeps.
   * `writeClipboard` refuses comment pins, so deleting the whole selection would
   * destroy a pin that never reached the clipboard.
   */
  const handleCut = useCallback(() => {
    const { written, ids } = copySelection();
    if (!written || ids.length === 0) return;
    deleteNodesWithFrames(ids);
    setSelectedIds(selectedIds.filter((id) => !ids.includes(id)));
  }, [copySelection, selectedIds, setSelectedIds]);

  /**
   * Paste, from the menu rather than from a keystroke.
   *
   * ## Why the system clipboard is asked first
   *
   * This used to prefer `clipboardRef` — the last copy made *in this tab* — and
   * only fall back to the real clipboard when there had been none. So copying
   * in one tab and right-click-pasting in another gave you that tab's older
   * copy instead of what you had just taken, while Ctrl+V in the same spot gave
   * the right thing. The system clipboard is the shared truth; the ref is a
   * cache for when it cannot be read (Firefox's permission prompt, Safari
   * outside a gesture).
   *
   * ## Where it lands
   *
   * At the pointer, when the menu was opened at one — measured from the stage,
   * not the window. It used to hand `clientX` straight to `screenToWorld`,
   * which takes stage coordinates, so every "Paste here" landed a ruler's width
   * up and to the left of where it was asked for. Opened from the rail or the
   * keyboard there is no "here", and the paste takes the keyboard's rule:
   * beside the original when it is on screen.
   */
  const handlePaste = useCallback(async () => {
    const at = contextTarget && !contextTarget.viaKeyboard
      ? clientToWorld(contextTarget.x, contextTarget.y)
      : undefined;

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
          pasteText(text, at ?? spotOf(null));
          return;
        }
      }
    } catch {
      // Read permission denied, or no clipboard API. The cache below is
      // exactly what that case is for.
    }

    if (clipboardRef.current) pasteObjects(clipboardRef.current, at);
  }, [contextTarget, clipboardRef, pasteObjects, pasteSvg, pasteText]);

  /**
   * Duplicate through the clipboard's paste, not `createNode` per object.
   *
   * The rail and the keyboard cloned each node with its fields intact — which
   * copies a connector still bound to the *originals'* ids and a group member
   * still pointing at the original group. `pasteNodes` remaps both. Quiet,
   * because "Pasted 3 objects" is the wrong sentence for a duplicate and the
   * new selection already says what happened.
   */
  const handleDuplicate = useCallback(() => {
    const payload = writeClipboard(selectedNodes());
    if (!payload) return;
    pasteObjects(payload, offsetOrigin(payload), { quiet: true });
  }, [selectedNodes, pasteObjects]);

  const handleRemove = useCallback(() => {
    deleteNodesWithFrames(selectedIds);
    setSelectedIds([]);
  }, [selectedIds, setSelectedIds]);

  const handleRestack = useCallback(
    (op: RestackOp) => {
      const patches = restackSelection(Object.values(diagramObjects), selectedIds, op);
      if (patches.length > 0) applyNodePatches(patches);
      else if (op === 'forward' || op === 'backward') {
        showToast(op === 'forward' ? 'Nothing overlapping above it' : 'Nothing overlapping below it');
      }
    },
    [diagramObjects, selectedIds, showToast]
  );

  const handleSelectAll = useCallback(() => {
    setSelectedIds(Object.keys(diagramObjects));
  }, [diagramObjects, setSelectedIds]);

  const handleSelectMatching = useCallback(
    (mode: 'kind' | 'style') => {
      const seeds = selectedNodes();
      if (seeds.length === 0) return;
      const ids = matchingIds(Object.values(diagramObjects), seeds, mode);
      setSelectedIds(ids);
      const added = ids.length - seeds.length;
      if (added === 0) showToast('Nothing else on the board matches');
    },
    [selectedNodes, diagramObjects, setSelectedIds, showToast]
  );

  const handleCopyPng = useCallback(
    async (ids: string[]) => {
      const scope = exportScope(diagramObjects, ids, localTitle);
      const { ExportService } = await import('../engine/export');
      const result = await ExportService.copy('png', {
        ...scopeOptions(scope),
        stage: (window as unknown as { _konva_stage?: unknown })._konva_stage,
      } as never);
      showToast(result.ok ? `Copied ${scope.subject} as PNG` : result.message!);
    },
    [diagramObjects, localTitle, showToast]
  );

  const handleCopySvg = useCallback(
    async (ids: string[]) => {
      const scope = exportScope(diagramObjects, ids, localTitle);
      const { ExportService } = await import('../engine/export');
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
    const selected = selectedNodes();
    if (!canEmitDiagram(selected)) return;
    // Said, because a copy that shows nothing is indistinguishable from one
    // that failed — and this one can fail, outside a secure origin.
    navigator.clipboard
      .writeText(diagramToMermaid(selected))
      .then(() => showToast('Copied as Mermaid'))
      .catch(() => showToast('The clipboard refused the copy'));
  }, [selectedNodes, showToast]);

  const handleEditMermaid = useCallback(() => {
    const selected = selectedNodes();
    if (!canEmitDiagram(selected)) return;
    setDiagramSource(diagramToMermaid(selected));
    setDiagramReplacing(diagramIdOf(selected.find((n) => diagramIdOf(n)) ?? selected[0]) ?? null);
    setDiagramReplaceIds(selected.map((n) => n.id));
    setDiagramOpen(true);
  }, [selectedNodes, setDiagramSource, setDiagramReplacing, setDiagramReplaceIds, setDiagramOpen]);

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

  const handleOutlineStroke = useCallback(() => {
    if (selectedIds.length !== 1) return;
    const id = outlineStrokeOf(selectedIds[0]);
    if (id) setSelectedIds([id]);
  }, [selectedIds, setSelectedIds]);

  const handleBreakApart = useCallback(() => {
    if (selectedIds.length !== 1) return;
    const ids = breakApartGrid(selectedIds[0]);
    if (ids.length > 0) setSelectedIds(ids);
  }, [selectedIds, setSelectedIds]);

  /**
   * Put the selected pictures into the selected grid.
   *
   * Stacking order, not click order: it is what the Layers panel shows and what
   * the board looks like, so two people making the same selection two ways get
   * the same arrangement. And it says what did not fit, rather than leaving the
   * three that overflowed to be counted.
   */
  const handleFillGrid = useCallback(() => {
    const nodes = selectedNodes();
    const grid = nodes.find((n) => n.type === 'grid');
    if (!grid) return;

    const images = nodes
      .filter((n) => n.type === 'image')
      .sort((a, b) => a.zIndex - b.zIndex)
      .map((n) => n.id);

    const { placed, overflow } = fillGridWithImages(grid.id, images);
    if (placed > 0) setSelectedIds(images.filter((id) => !overflow.includes(id)));

    if (placed === 0) showToast('No free modules in that grid');
    else if (overflow.length > 0) showToast(`Placed ${placed}, and ${overflow.length} did not fit`);
    else showToast(`Placed ${placed} image${placed === 1 ? '' : 's'}`);
  }, [selectedNodes, setSelectedIds, showToast]);

  const handleReleaseFromGrid = useCallback(() => {
    releaseSlots(selectedIds);
  }, [selectedIds]);

  const handleAlign = useCallback(
    (edge: AlignEdge) => applyNodePatches(alignSelection(selectedNodes(), edge)),
    [selectedNodes]
  );

  const handleDistribute = useCallback(
    (axis: DistributeAxis) => applyNodePatches(distributeSelection(selectedNodes(), axis)),
    [selectedNodes]
  );

  /** Each object mirrors in place; one transaction, so one undo. */
  const handleFlip = useCallback(
    (axis: 'horizontal' | 'vertical') => {
      const key = axis === 'horizontal' ? 'scaleX' : 'scaleY';
      applyNodePatches(
        selectedNodes()
          .filter((n) => !n.locked)
          .map((n) => ({ id: n.id, changes: { [key]: -((n[key] as number) || 1) } }))
      );
    },
    [selectedNodes]
  );

  const handleToggleLock = useCallback(() => {
    const nodes = selectedNodes();
    const locked = nodes.length > 0 && nodes.every((n) => n.locked);
    applyNodePatches(nodes.map((n) => ({ id: n.id, changes: { locked: !locked } })));
  }, [selectedNodes]);

  const handleHide = useCallback(() => {
    const nodes = selectedNodes();
    const hidden = nodes.length > 0 && nodes.every((n) => n.hidden);
    applyNodePatches(nodes.map((n) => ({ id: n.id, changes: { hidden: !hidden } })));
  }, [selectedNodes]);

  const handleSwapShape = useCallback(
    (kind: ShapeKind, points?: number) => {
      applyNodePatches(
        selectedNodes()
          .filter((n) => n.type === 'shape')
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
    [selectedNodes]
  );

  const handleCopyStyle = useCallback(() => {
    const [source] = selectedNodes();
    if (!source) return;
    styleClipboard.set(extractStyle(source));
    showToast(`Copied the ${kindNoun(source, false)}’s style`);
  }, [selectedNodes, showToast]);

  const handlePasteStyle = useCallback(() => {
    const style = styleClipboard.get();
    if (!style) return;
    const patches = applyStylePatches(selectedNodes(), style);
    if (patches.length > 0) applyNodePatches(patches);
  }, [selectedNodes]);

  const handleComment = useCallback(() => {
    const [node] = selectedNodes();
    if (!node) return;
    engineEvents.emit('CommentDraftRequested', { x: node.x + node.width, y: node.y, objectId: node.id });
  }, [selectedNodes]);

  const handleZoomToSelection = useCallback(() => {
    editor.zoomToNodes(selectedNodes());
  }, [selectedNodes]);

  const handleZoomToFit = useCallback(() => editor.zoomToFit(), []);

  /** 100%, about the middle of what you are looking at — not a jump to the origin. */
  const handleZoomReset = useCallback(() => {
    const centre = spotOf(null);
    const stage = document.querySelector('.konvajs-content')?.getBoundingClientRect();
    const w = stage?.width ?? window.innerWidth;
    const h = stage?.height ?? window.innerHeight;
    cameraSystem.setPose(w / 2 - centre.x, h / 2 - centre.y, 1);
  }, []);

  const handleAddSticky = useCallback(() => {
    addStickyAt(spotOf(contextTarget));
  }, [contextTarget]);

  const handleAddText = useCallback(() => {
    addTextAt(spotOf(contextTarget));
  }, [contextTarget]);

  const handleAddShape = useCallback(
    (preset: ShapePreset) => {
      addShapeAt(preset, spotOf(contextTarget));
    },
    [contextTarget]
  );

  const handleAddComment = useCallback(() => {
    const at = spotOf(contextTarget);
    engineEvents.emit('CommentDraftRequested', { x: at.x, y: at.y });
  }, [contextTarget]);

  const handleRenderDiagram = useCallback(
    (source: string) => {
      setDiagramSource(source);
      setDiagramReplacing(null);
      setDiagramReplaceIds([]);
      setDiagramOpen(true);
    },
    [setDiagramSource, setDiagramReplacing, setDiagramReplaceIds, setDiagramOpen]
  );

  const handleAddCode = useCallback(() => {
    const at = spotOf(contextTarget);
    const id = createCode(at, '', { language: CodeTool.language });
    setSelectedIds([id]);
    useStore.getState().setCodeEditNodeId(id);
  }, [contextTarget, setSelectedIds]);

  const handleAddLink = useCallback(() => {
    const at = spotOf(contextTarget);
    const client = contextTarget && !contextTarget.viaKeyboard ? { clientX: contextTarget.x, clientY: contextTarget.y } : { clientX: window.innerWidth / 2, clientY: window.innerHeight / 2 };
    useStore.getState().setLinkComposer({ ...client, ...at });
  }, [contextTarget]);

  const handleImportCsvTable = useCallback(() => {
    void createTableFromCsvFile(spotOf(contextTarget)).then((id) => {
      if (id) setSelectedIds([id]);
    });
  }, [contextTarget, setSelectedIds]);

  return useMemo(
    () => ({
      copy: handleCopy,
      cut: handleCut,
      paste: handlePaste,
      duplicate: handleDuplicate,
      remove: handleRemove,
      restack: handleRestack,
      bringToFront: () => handleRestack('front'),
      sendToBack: () => handleRestack('back'),
      selectAll: handleSelectAll,
      selectAllOfType: () => handleSelectMatching('kind'),
      selectMatching: handleSelectMatching,
      copyPng: handleCopyPng,
      copySvg: handleCopySvg,
      exportSelection: handleExportSelection,
      copyMermaid: handleCopyMermaid,
      editMermaid: handleEditMermaid,
      group: handleGroup,
      ungroup: handleUngroup,
      editLinePoints: handleEditLinePoints,
      'to-path': handleToPath,
      outlineStroke: handleOutlineStroke,
      'break-apart': handleBreakApart,
      fillGrid: handleFillGrid,
      releaseFromGrid: handleReleaseFromGrid,
      align: handleAlign,
      distribute: handleDistribute,
      flip: handleFlip,
      toggleLock: handleToggleLock,
      hide: handleHide,
      swapShape: handleSwapShape,
      copyStyle: handleCopyStyle,
      pasteStyle: handlePasteStyle,
      comment: handleComment,
      zoomToSelection: handleZoomToSelection,
      zoomToFit: handleZoomToFit,
      zoomReset: handleZoomReset,
      addSticky: handleAddSticky,
      addText: handleAddText,
      addShape: handleAddShape,
      addComment: handleAddComment,
      importCsvTable: handleImportCsvTable,
      renderDiagram: handleRenderDiagram,
      addCode: handleAddCode,
      addLink: handleAddLink,
    }),
    [
      handleCopy, handleCut, handlePaste, handleDuplicate, handleRemove, handleRestack,
      handleSelectAll, handleSelectMatching, handleCopyPng, handleCopySvg, handleExportSelection,
      handleCopyMermaid, handleEditMermaid, handleGroup, handleUngroup, handleEditLinePoints,
      handleToPath, handleOutlineStroke, handleBreakApart, handleFillGrid, handleReleaseFromGrid,
      handleAlign, handleDistribute, handleFlip, handleToggleLock, handleHide, handleSwapShape,
      handleCopyStyle, handlePasteStyle, handleComment, handleZoomToSelection, handleZoomToFit,
      handleZoomReset, handleAddSticky, handleAddText, handleAddShape, handleAddComment,
      handleImportCsvTable, handleRenderDiagram, handleAddCode, handleAddLink,
    ]
  );
}
