import React, { Suspense, lazy } from 'react';
import type { AnyNode } from '../../engine/model/schema';
import type { CanvasContextMenuActions, ContextTarget } from '../CanvasContextMenu';
import { CanvasContextMenu } from '../CanvasContextMenu';
import type { DiagramBuildOptions } from '../../engine/diagram/build';
import { useStore } from '../../hooks/useStore';
import { ModalLoader } from '../ui/Loading';

/**
 * The dialogs, none of which is part of opening a board.
 *
 * ## Each import is named twice, on purpose
 *
 * `lazy()` is what React renders through; `warm()` is what fetches the chunk
 * before anybody asks for it. They have to be the same module specifier for
 * the second to be a cache hit for the first, so they are written next to each
 * other where a mismatch is visible.
 */
const loadShare = () => import('../ShareModal');
const loadExport = () => import('../ui/ExportModal');
const loadHelp = () => import('../HelpModal');
const loadMermaid = () => import('../MermaidModal');
const loadPalette = () => import('../CommandPalette');
const loadFlatten = () => import('../ui/FlattenShapeModal');
const loadChartData = () => import('../ChartDataModal');

const ShareModal = lazy(() => loadShare().then(m => ({ default: m.ShareModal })));
const ExportModal = lazy(() => loadExport().then(m => ({ default: m.ExportModal })));
const HelpModal = lazy(() => loadHelp().then(m => ({ default: m.HelpModal })));
const MermaidModal = lazy(() => loadMermaid().then(m => ({ default: m.MermaidModal })));
const CommandPalette = lazy(() => loadPalette().then(m => ({ default: m.CommandPalette })));
const FlattenShapeModal = lazy(() => loadFlatten().then(m => ({ default: m.FlattenShapeModal })));
const ChartDataModal = lazy(() => loadChartData().then(m => ({ default: m.ChartDataModal })));

/**
 * Fetch the cheap dialogs once the board has stopped being busy.
 *
 * Splitting these out keeps them off the critical path. The cost it leaves
 * behind is that the first person to press a button pays a download while
 * looking at a dialog that has not arrived yet, and `requestIdleCallback` is
 * how that cost goes away without coming back to the critical path: it runs
 * when the board is doing nothing else, so the fetch competes with nothing,
 * and by the time anybody reaches for one of these it is in memory. The
 * timeout is a ceiling for a tab that never goes idle at all.
 *
 * ## Why the export dialog is not in this list
 *
 * Because it is not cheap. These three come to about 10kB compressed between
 * them, which is worth spending on a maybe. `ExportModal` statically imports
 * the export engine and brings 440kB with it, and speculatively downloading
 * that on every board open would spend most people's bandwidth on a dialog
 * they will never open. It waits to be asked; `ModalLoader` is what covers
 * the wait when somebody does ask.
 */
function warmDialogs(): () => void {
  const run = () => {
    void loadShare();
    void loadHelp();
    void loadPalette();
  };
  if (typeof window === 'undefined') return () => {};
  const ric = window.requestIdleCallback;
  if (!ric) {
    const t = window.setTimeout(run, 2500);
    return () => window.clearTimeout(t);
  }
  const handle = ric(run, { timeout: 4000 });
  return () => window.cancelIdleCallback?.(handle);
}

export interface RoomModalsProps {
  showShareModal: boolean;
  setShowShareModal: (open: boolean) => void;

  showExportMenu: boolean;
  setShowExportMenu: (open: boolean) => void;
  /** The live selection, so the dialog can offer it as a region. */
  exportSelectionIds: string[];
  /** Whether the dialog was opened *about* that selection or about the board. */
  exportFromSelection: boolean;
  localTitle: string;

  contextTarget: ContextTarget | null;
  setContextTarget: (target: ContextTarget | null) => void;
  diagramObjects: Record<string, AnyNode>;
  contextActions: CanvasContextMenuActions;
  canPaste: boolean;

  showHelp: boolean;
  setShowHelp: (open: boolean) => void;

  diagramOpen: boolean;
  setDiagramOpen: (open: boolean) => void;
  diagramSource: string;
  diagramReplacing: string | null;
  applyDiagram: (source: string, options?: DiagramBuildOptions) => void;

  showCommandPalette: boolean;
  setShowCommandPalette: (open: boolean) => void;
  handleCommandPaletteAction: (actionId: string) => void;
}

export const RoomModals: React.FC<RoomModalsProps> = ({
  showShareModal,
  setShowShareModal,
  showExportMenu,
  setShowExportMenu,
  exportSelectionIds,
  exportFromSelection,
  localTitle,
  contextTarget,
  setContextTarget,
  diagramObjects,
  contextActions,
  canPaste,
  showHelp,
  setShowHelp,
  diagramOpen,
  setDiagramOpen,
  diagramSource,
  diagramReplacing,
  applyDiagram,
  showCommandPalette,
  setShowCommandPalette,
  handleCommandPaletteAction,
}) => {
  /**
   * Rendered only while there is something to flatten.
   *
   * This, `HelpModal` and `MermaidModal` were all mounted unconditionally and
   * told whether they were open by a prop. Each returns `null` when it is not,
   * so nothing was drawn -- but `lazy()` resolves when the element is
   * *rendered*, not when it decides to draw something, so all three chunks
   * were fetched on every board open. They were split out of the bundle and
   * then downloaded anyway, which is the worst of both: the same bytes, plus
   * three extra requests.
   */
  const flattenNodeId = useStore((s) => s.flattenConfirmNodeId);
  const chartDataModalNodeId = useStore((s) => s.chartDataModalNodeId);
  const setChartDataModalNodeId = useStore((s) => s.setChartDataModalNodeId);

  React.useEffect(warmDialogs, []);

  return (
    <>
      <Suspense fallback={showShareModal ? <ModalLoader /> : null}>
        {showShareModal && <ShareModal onClose={() => setShowShareModal(false)} />}
      </Suspense>

      <Suspense fallback={showExportMenu ? <ModalLoader /> : null}>
        {showExportMenu && (
          <ExportModal
            onClose={() => setShowExportMenu(false)}
            title={localTitle}
            selectionIds={exportSelectionIds}
            startWithSelection={exportFromSelection}
          />
        )}
      </Suspense>

      <CanvasContextMenu
        target={contextTarget}
        onClose={() => setContextTarget(null)}
        objects={diagramObjects}
        actions={contextActions}
        canPaste={canPaste}
        allObjects={diagramObjects}
      />

      <Suspense fallback={showHelp ? <ModalLoader /> : null}>
        {showHelp && <HelpModal open onClose={() => setShowHelp(false)} />}
      </Suspense>

      <Suspense fallback={diagramOpen ? <ModalLoader /> : null}>
        {diagramOpen && (
          <MermaidModal
            open
            onClose={() => setDiagramOpen(false)}
            initialSource={diagramSource}
            replacing={Boolean(diagramReplacing)}
            onApply={applyDiagram}
          />
        )}
      </Suspense>

      <Suspense fallback={showCommandPalette ? <ModalLoader /> : null}>
        {showCommandPalette && (
          <CommandPalette
            onClose={() => setShowCommandPalette(false)}
            onSelectAction={handleCommandPaletteAction}
          />
        )}
      </Suspense>

      <Suspense fallback={null}>
        {flattenNodeId && <FlattenShapeModal />}
      </Suspense>

      <Suspense fallback={null}>
        {chartDataModalNodeId && (
          <ChartDataModal
            nodeId={chartDataModalNodeId}
            onClose={() => setChartDataModalNodeId(null)}
          />
        )}
      </Suspense>
    </>
  );
};
