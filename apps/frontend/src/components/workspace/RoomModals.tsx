import React, { Suspense, lazy } from 'react';
import type { AnyNode } from '../../engine/model/schema';
import type { CanvasContextMenuActions, ContextTarget } from '../CanvasContextMenu';
import { CanvasContextMenu } from '../CanvasContextMenu';

const ShareModal = lazy(() => import('../ShareModal').then(m => ({ default: m.ShareModal })));
const ExportModal = lazy(() => import('../ui/ExportModal').then(m => ({ default: m.ExportModal })));
const HelpModal = lazy(() => import('../HelpModal').then(m => ({ default: m.HelpModal })));
const MermaidModal = lazy(() => import('../MermaidModal').then(m => ({ default: m.MermaidModal })));
const CommandPalette = lazy(() => import('../CommandPalette').then(m => ({ default: m.CommandPalette })));
const FlattenShapeModal = lazy(() => import('../ui/FlattenShapeModal').then(m => ({ default: m.FlattenShapeModal })));

export interface RoomModalsProps {
  showShareModal: boolean;
  setShowShareModal: (open: boolean) => void;

  showExportMenu: boolean;
  setShowExportMenu: (open: boolean) => void;
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
  applyDiagram: (source: string, replaceId?: string) => void;

  showCommandPalette: boolean;
  setShowCommandPalette: (open: boolean) => void;
  handleCommandPaletteAction: (actionId: string) => void;
}

export const RoomModals: React.FC<RoomModalsProps> = ({
  showShareModal,
  setShowShareModal,
  showExportMenu,
  setShowExportMenu,
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
  return (
    <>
      <Suspense fallback={null}>
        {showShareModal && <ShareModal onClose={() => setShowShareModal(false)} />}
      </Suspense>

      <Suspense fallback={null}>
        {showExportMenu && <ExportModal onClose={() => setShowExportMenu(false)} title={localTitle} />}
      </Suspense>

      <CanvasContextMenu
        target={contextTarget}
        onClose={() => setContextTarget(null)}
        objects={diagramObjects}
        actions={contextActions}
        canPaste={canPaste}
        allObjects={diagramObjects}
      />

      <Suspense fallback={null}>
        <HelpModal open={showHelp} onClose={() => setShowHelp(false)} />
      </Suspense>

      <Suspense fallback={null}>
        <MermaidModal
          open={diagramOpen}
          onClose={() => setDiagramOpen(false)}
          initialSource={diagramSource}
          replacing={Boolean(diagramReplacing)}
          onApply={applyDiagram}
        />
      </Suspense>

      <Suspense fallback={null}>
        {showCommandPalette && (
          <CommandPalette
            onClose={() => setShowCommandPalette(false)}
            onSelectAction={handleCommandPaletteAction}
          />
        )}
      </Suspense>

      <Suspense fallback={null}>
        <FlattenShapeModal />
      </Suspense>
    </>
  );
};
