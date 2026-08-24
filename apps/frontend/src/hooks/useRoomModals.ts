import { useState, useCallback } from 'react';

/**
 * Hook for managing workspace modal dialogs, export overlays, and command palette state.
 */
export function useRoomModals() {
  const [showShareModal, setShowShareModal] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [diagramOpen, setDiagramOpen] = useState(false);
  const [diagramSource, setDiagramSource] = useState('');
  const [diagramReplacing, setDiagramReplacing] = useState<string | null>(null);

  const openDiagramModal = useCallback((source = '', replacingId: string | null = null) => {
    setDiagramSource(source);
    setDiagramReplacing(replacingId);
    setDiagramOpen(true);
  }, []);

  const closeDiagramModal = useCallback(() => {
    setDiagramOpen(false);
    setDiagramReplacing(null);
  }, []);

  return {
    showShareModal,
    setShowShareModal,
    showExportMenu,
    setShowExportMenu,
    showHelp,
    setShowHelp,
    showCommandPalette,
    setShowCommandPalette,
    diagramOpen,
    setDiagramOpen,
    diagramSource,
    diagramReplacing,
    openDiagramModal,
    closeDiagramModal,
  };
}
