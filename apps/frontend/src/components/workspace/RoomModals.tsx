import React, { Suspense, lazy } from 'react';
import type { AnyNode } from '../../engine/model/schema';
import type { CanvasContextMenuActions, ContextTarget } from '../CanvasContextMenu';
import { CanvasContextMenu } from '../CanvasContextMenu';
import type { DiagramBuildOptions } from '../../engine/diagram/build';
import { useStore } from '../../hooks/useStore';
import { ModalLoader } from '../ui/Loading';
import { FeatureBoundary } from '../ui/FeatureBoundary';
import { MotionConfig } from 'framer-motion';
import type { ExportFormat } from '../../engine/export/ExportTypes';

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
const loadTableEditor = () => import('../table/TableEditor');
const TableEditor = lazy(() => loadTableEditor().then(m => ({ default: m.TableEditor })));
const CodeEditor = lazy(() => import('../code/CodeEditor').then(m => ({ default: m.CodeEditor })));
const EmbedLayer = lazy(() => import('../link/EmbedLayer').then(m => ({ default: m.EmbedLayer })));
const LinkComposer = lazy(() => import('../link/LinkComposer').then(m => ({ default: m.LinkComposer })));

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
  /** Viewers get the menu's ways to look and take away, not the ways to change. */
  canEdit: boolean;

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
  canEdit,
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
  const tableEditNodeId = useStore((s) => s.tableEditNodeId);
  const codeEditNodeId = useStore((s) => s.codeEditNodeId);
  const embedActiveNodeId = useStore((s) => s.embedActiveNodeId);
  const linkComposerOpen = useStore((s) => Boolean(s.linkComposer));
  const setTableEditNodeId = useStore((s) => s.setTableEditNodeId);

  React.useEffect(warmDialogs, []);

  /** The format Share's Export tab asked for; the dialog's own default otherwise. */
  const [exportFormat, setExportFormat] = React.useState<ExportFormat | undefined>(undefined);
  const closeExport = () => {
    setShowExportMenu(false);
    setExportFormat(undefined);
  };

  // Reduced motion applies to every dialog's entrance (the palette's spring,
  // the flatten dialog), not only to the dock that declared it first.
  return (
    <MotionConfig reducedMotion="user">
      <FeatureBoundary name="share dialog" variant="modal" resetKey={showShareModal} onClose={() => setShowShareModal(false)}>
        <Suspense fallback={showShareModal ? <ModalLoader /> : null}>
          {showShareModal && (
            <ShareModal
              onClose={() => setShowShareModal(false)}
              onExport={(format) => {
                setShowShareModal(false);
                setExportFormat(format);
                setShowExportMenu(true);
              }}
            />
          )}
        </Suspense>
      </FeatureBoundary>

      <FeatureBoundary name="export dialog" variant="modal" resetKey={showExportMenu} onClose={closeExport}>
        <Suspense fallback={showExportMenu ? <ModalLoader /> : null}>
          {showExportMenu && (
            <ExportModal
              onClose={closeExport}
              initialFormat={exportFormat}
              title={localTitle}
              selectionIds={exportSelectionIds}
              startWithSelection={exportFromSelection}
            />
          )}
        </Suspense>
      </FeatureBoundary>

      <FeatureBoundary name="context menu" variant="modal" resetKey={contextTarget} onClose={() => setContextTarget(null)}>
        <CanvasContextMenu
          target={contextTarget}
          onClose={() => setContextTarget(null)}
          objects={diagramObjects}
          actions={contextActions}
          canEdit={canEdit}
          allObjects={diagramObjects}
        />
      </FeatureBoundary>

      <FeatureBoundary name="help" variant="modal" resetKey={showHelp} onClose={() => setShowHelp(false)}>
        <Suspense fallback={showHelp ? <ModalLoader /> : null}>
          {showHelp && <HelpModal open onClose={() => setShowHelp(false)} />}
        </Suspense>
      </FeatureBoundary>

      <FeatureBoundary name="diagram editor" variant="modal" resetKey={diagramOpen} onClose={() => setDiagramOpen(false)}>
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
      </FeatureBoundary>

      <FeatureBoundary name="command palette" variant="modal" resetKey={showCommandPalette} onClose={() => setShowCommandPalette(false)}>
        <Suspense fallback={showCommandPalette ? <ModalLoader /> : null}>
          {showCommandPalette && (
            <CommandPalette
              onClose={() => setShowCommandPalette(false)}
              onSelectAction={handleCommandPaletteAction}
            />
          )}
        </Suspense>
      </FeatureBoundary>

      <FeatureBoundary name="flatten dialog" variant="modal" resetKey={flattenNodeId} onClose={() => useStore.getState().setFlattenConfirmNodeId(null)}>
        <Suspense fallback={null}>
          {flattenNodeId && <FlattenShapeModal />}
        </Suspense>
      </FeatureBoundary>

      <FeatureBoundary name="data sheet" variant="modal" resetKey={chartDataModalNodeId} onClose={() => setChartDataModalNodeId(null)}>
        <Suspense fallback={null}>
          {chartDataModalNodeId && (
            <ChartDataModal
              nodeId={chartDataModalNodeId}
              onClose={() => setChartDataModalNodeId(null)}
            />
          )}
        </Suspense>
      </FeatureBoundary>

      {/* The table's cells, open in place over the board. */}
      <FeatureBoundary name="table editor" variant="modal" resetKey={tableEditNodeId} onClose={() => setTableEditNodeId(null)}>
        <Suspense fallback={null}>
          {tableEditNodeId && (
            <TableEditor key={tableEditNodeId} nodeId={tableEditNodeId} onClose={() => setTableEditNodeId(null)} />
          )}
        </Suspense>
      </FeatureBoundary>

      {/* A code block's source, open in place; the one live embed; the link field. */}
      <FeatureBoundary name="code editor" variant="modal" resetKey={codeEditNodeId} onClose={() => useStore.getState().setCodeEditNodeId(null)}>
        <Suspense fallback={null}>
          {codeEditNodeId && (
            <CodeEditor key={codeEditNodeId} nodeId={codeEditNodeId} onClose={() => useStore.getState().setCodeEditNodeId(null)} />
          )}
        </Suspense>
      </FeatureBoundary>
      <FeatureBoundary name="embed" variant="panel" resetKey={embedActiveNodeId}>
        <Suspense fallback={null}>{embedActiveNodeId && <EmbedLayer />}</Suspense>
      </FeatureBoundary>
      <FeatureBoundary name="link field" variant="modal" resetKey={linkComposerOpen} onClose={() => useStore.getState().setLinkComposer(null)}>
        <Suspense fallback={null}>{linkComposerOpen && <LinkComposer />}</Suspense>
      </FeatureBoundary>
    </MotionConfig>
  );
};
