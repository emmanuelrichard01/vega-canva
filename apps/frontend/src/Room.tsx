import { nanoid } from 'nanoid';
import React, { useState, useRef, useEffect } from 'react';
import { Canvas } from './components/Canvas';
import { AuthModal } from './components/AuthModal';
import { ShareModal } from './components/ShareModal';
import { WorkspaceShell } from './components/workspace/WorkspaceShell';
import { ToolWorkspace } from './components/workspace/ToolWorkspace';
import { Minimap } from './components/Minimap';
import { ObjectContextToolbar } from './components/ObjectContextToolbar';
import { PropertiesPanel } from './components/PropertiesPanel';
import { LayersPanel } from './components/LayersPanel';
import { useAuth } from './hooks/AuthContext';
import { provider, metadataMap, undoManager, updateNode, localAuthor, publishLocalIdentity } from './engine/document';
import { useRoomState } from './hooks/useSync';
import { initSyncBridge, useStore } from './hooks/useStore';
import { editor } from './engine/api/EditorAPI';
import { ActivityFeed } from './components/ActivityFeed';
import { OffScreenPresence } from './components/OffScreenPresence';
import { ExportService } from './engine/export';
import { TimeTravelBar } from './components/TimeTravelBar';
import { ForcesBar } from './components/ForcesBar';
import { isForceTool, type ForceId } from './engine/physics/forces';
import { mediaUploadUrl } from './utils/endpoints';
import { CommandPalette } from './components/CommandPalette';
import { processOfflineMediaQueue, queueOfflineMedia } from './utils/offlineMediaQueue';
import { calculateLayout, animateToLayout, type LayoutMode } from './utils/spatialLayout';
import { Mic } from 'lucide-react';
import { CursorRenderer } from './engine/cursor';
import { ExportModal } from './components/ui/ExportModal';
import { cameraSystem } from './engine/CameraSystem';
import { useBreakpoint } from './hooks/useBreakpoint';
import { CanvasEmptyState } from './components/CanvasEmptyState';

export default function Room() {
  const { user } = useAuth();
  
  useEffect(() => {
    initSyncBridge();
  }, []);
  const [activeTool, setActiveTool] = useState('select');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // Convenience accessors for the many panels that only ever make sense for a
  // single selected object (properties panel, floating toolbar, etc). When 0
  // or 2+ objects are selected these simply fall back to their empty state.
  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null;
  const setSelectedId = (id: string | null) => setSelectedIds(id ? [id] : []);
  const [isPlayMode, setIsPlayMode] = useState(false);
  // `searchQuery`/`rightTab`/`activeEditor`/`showMagicMenu`/`showOnboarding`
  // were all declared here and never read by anything — leftovers from UI that
  // has since been removed or moved. `handleSearch` went with them: it was a
  // complete, working canvas-search implementation with no input wired to it
  // anywhere in the room. Worth reinstating deliberately (the Command Palette
  // is the natural home) rather than leaving as dead weight that looks like a
  // shipped feature.
    const [localTitle, setLocalTitle] = useState("Untitled Workspace");
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
    const [showTimeTravel, setShowTimeTravel] = useState(false);
  const [timeTravelSnapshot, setTimeTravelSnapshot] = useState<Record<string, any> | null>(null);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  // Persisted in the store rather than local state, so the choice survives a
  // reload (and starts from the OS preference).
  const isDarkTheme = useStore((s) => s.darkTheme);
  const setIsDarkTheme = useStore((s) => s.setDarkTheme);
  const applyReplaySnapshot = useStore((s) => s.applyReplaySnapshot);
  const [isUiVisible, setIsUiVisible] = useState(true);

  // Below the compact breakpoint the side panels stop being docked columns —
  // two 260px panels plus the dock leave a canvas narrower than either of
  // them — and become overlays that open on demand. Above it they are always
  // shown, so `panelsOpen` is ignored.
  const { isCompact } = useBreakpoint();
  const [panelsOpen, setPanelsOpen] = useState(false);
  const panelsVisible = !isCompact || panelsOpen;

  // Escape closes the overlay panels, matching every other dismissible
  // surface in the app.
  useEffect(() => {
    if (!isCompact || !panelsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPanelsOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isCompact, panelsOpen]);

  // The theme class is applied once at the app root (App.tsx). This used to
  // assign `document.body.className` wholesale, which also clobbered any other
  // class on <body>.

  // Reflects AudioTool's actual recording state (the real, working
  // implementation) so the "click anywhere to record" hint below gets out of
  // the way once recording genuinely starts, instead of a second, disconnected
  // recording flow that never fired.
  const [isRecording, setIsRecording] = useState(false);
  useEffect(() => {
    const onStart = () => setIsRecording(true);
    const onStop = () => setIsRecording(false);
    window.addEventListener('audio-recording-start', onStart);
    window.addEventListener('audio-recording-stop', onStop);
    return () => {
      window.removeEventListener('audio-recording-start', onStart);
      window.removeEventListener('audio-recording-stop', onStop);
    };
  }, []);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const { roomId, status, metadata } = useRoomState();

  useEffect(() => {
    if (!roomId || roomId === 'home') return;
    localStorage.setItem('lastRoomId', roomId);
    
    try {
      const existing = JSON.parse(localStorage.getItem('recentWorkspaces') || '[]');
      const filtered = existing.filter((w: any) => w.id !== roomId);
      const newWorkspace = {
        id: roomId,
        name: metadata?.name || localTitle || 'Untitled Workspace',
        lastAccessed: Date.now()
      };
      const updated = [newWorkspace, ...filtered].slice(0, 12);
      localStorage.setItem('recentWorkspaces', JSON.stringify(updated));
    } catch { /* corrupt localStorage entry — not worth surfacing */ }
  }, [roomId, metadata?.name, localTitle]);

  // Title editing lives entirely in WorkspaceShell now, which holds its own
  // draft state and only calls back on commit — so this no longer needs to
  // guard against overwriting an in-progress edit.
  useEffect(() => {
    if (metadata?.name) setLocalTitle(metadata.name);
  }, [metadata?.name]);

  // ActivityFeed now sources itself from the shared authoring log rather than
  // from a local array here whose only producer had been commented out.
  const [followingClientId] = useState<number | null>(null);

  useEffect(() => {
    const handleAwarenessUpdate = () => {
      const states = provider.awareness?.getStates();
      (states || new Map()).forEach((state: any, clientId: number) => {
        if (clientId === followingClientId && state.viewport) {
          window.dispatchEvent(new CustomEvent('navigateViewport', {
            detail: { x: state.viewport.x, y: state.viewport.y, zoom: state.viewport.zoom || 1 }
          }));
        }
      });
    };

    provider.awareness?.on('change', handleAwarenessUpdate);
    return () => provider.awareness?.off('change', handleAwarenessUpdate);
  }, [followingClientId]);

  const hasJoined = useRef(false);
  useEffect(() => {
    if (user && !hasJoined.current) {
      provider.awareness?.setLocalStateField('user', {
        name: user.name,
        color: user.color,
      });
      // Awareness is ephemeral and never reaches the update log, so the same
      // identity is recorded in the document too. That is what lets Time Travel
      // name someone who joined and only edited — attribution used to require
      // having created a node.
      publishLocalIdentity(user.name, user.color);
      // pushActivity('join', user.name, user.color, 'joined the workspace'); // Removed to stop spam
      hasJoined.current = true;
    }
  }, [user]);

  const handleSaveTitle = (t: string) => {
    // Blurring or hitting Enter with the field cleared saved an empty
    // string as the room's name, synced to every collaborator — the title
    // in the top bar became a blank, still-clickable-but-invisible span.
    const finalTitle = t.trim() || 'Untitled Workspace';
    setLocalTitle(finalTitle);
    metadataMap.set('name', finalTitle);
  };
  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) undoManager.redo();
        else undoManager.undo();
        return;
      }

      // Object deletion for the current selection is handled in Canvas.tsx,
      // which already owns per-object existence checks for the other
      // selection-scoped shortcuts (duplicate, z-order, bold/italic). Keeping
      // a second Delete/Backspace listener here double-fired deleteNode()
      // for the same id on every press.

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setShowCommandPalette(prev => !prev);
        return;
      }
      
      if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
        e.preventDefault();
        setShowCommandPalette(true);
        // Missing here (unlike the Cmd+Z/Cmd+K checks above) meant this fell
        // through into the switch below, which matches on e.key alone with
        // no modifier check — so Cmd+P didn't just open the palette, it also
        // silently switched the active tool to Bezier Pen (case 'p') at the
        // same time.
        return;
      }

      // Single-key tool shortcuts must never fire while a modifier is held.
      // Without this guard the switch matched on the bare key, so Ctrl+S also
      // selected the Sticky tool (on top of opening the browser's save
      // dialog), Ctrl+R switched to Shape while reloading the page, Ctrl+E
      // selected the Eraser, and so on. Alt is included because it composes
      // OS-level menu accelerators on Windows and Linux.
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      switch (e.key.toLowerCase()) {
        case 'v': selectTool('select'); break;
        case 'h': selectTool('hand'); break; // Advertised by the dock tooltip but never bound
        case 't': selectTool('text'); break;
        case 'r': selectTool('shape'); break;
        case 's': selectTool('sticky'); break;
        case 'c': selectTool('comment'); break; // Advertised by the dock tooltip but never bound
        case 'p': selectTool('bezier-pen'); break; // Pen (anchor points), matching Illustrator
        case 'n': selectTool('pen'); break; // Pencil (freehand), matching Illustrator
        case 'e': selectTool('eraser'); break;
        case '\\': setIsUiVisible(prev => !prev); break;
        case '0':
          // Reset camera to origin
          window.dispatchEvent(new CustomEvent('navigateViewport', { detail: { x: 0, y: 0, zoom: 1 } }));
          break;
      }
    };
    
    const handleToolChange = (e: any) => {
      selectTool(e.detail);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('legacy_tool_change', handleToolChange);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('legacy_tool_change', handleToolChange);
    };
  }, []);

  useEffect(() => {
    const handleExportPNG = () => {
      // Find the Konva Stage reference. Assuming it's the first Stage created
      const stage = (window as any)._konva_stage;
      if (stage) ExportService.export('png', { stage });
    };
    const handleExportSVG = () => ExportService.export('svg');
    const handleExportJSON = () => ExportService.export('json');

    window.addEventListener('export-png', handleExportPNG);
    window.addEventListener('export-svg', handleExportSVG);
    window.addEventListener('export-json', handleExportJSON);
    return () => {
      window.removeEventListener('export-png', handleExportPNG);
      window.removeEventListener('export-svg', handleExportSVG);
      window.removeEventListener('export-json', handleExportJSON);
    }
  }, []);

  const handleCommandPaletteAction = (actionId: string) => {
    switch (actionId) {
      // Tool selection — every id here is a real registered tool id, so the
      // palette and the dock cannot drift apart.
      case 'select':
      case 'hand':
      case 'sticky':
      case 'text':
      case 'comment':
      case 'shape-rect':
        selectTool(actionId);
        break;

      case 'tidy': handleOrganize('smart'); break;
      case 'zoom-fit': editor.zoomToFit(); break;
      case 'reset-view':
        window.dispatchEvent(new CustomEvent('navigateViewport', { detail: { x: 0, y: 0, zoom: 1 } }));
        break;

      case 'play': setIsPlayMode(!isPlayMode); break;
      case 'timetravel': setShowTimeTravel(true); break;
      case 'share': setShowShareModal(true); break;

      case 'export-png': window.dispatchEvent(new Event('export-png')); break;
      case 'export-json': window.dispatchEvent(new Event('export-json')); break;
      case 'export-svg': window.dispatchEvent(new Event('export-svg')); break;
    }
  };

  useEffect(() => {
    if (status === 'connected') {
      processOfflineMediaQueue();
    }
  }, [status]);

  const handleMediaUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const localUrl = URL.createObjectURL(file);
    const type = file.type.startsWith('image/') ? 'image' : 'audio';
    // window.innerWidth/innerHeight are screen pixels, not canvas world
    // coordinates — using them directly placed every uploaded file at a fixed
    // world position regardless of where you'd actually panned/zoomed to, so
    // it would silently land off-screen for any view other than the default.
    const viewCenter = cameraSystem.screenToWorld(window.innerWidth / 2, window.innerHeight / 2);
    const width = type === 'image' ? 300 : 240;
    const height = type === 'image' ? 300 : 64;

    // A single canonical `src`. The asset URL used to be written to both
    // `assetId` and `content.url`, and the post-upload patch only replaced one
    // of them — so the object kept pointing at a `blob:` URL that is valid
    // only inside the uploading tab. Every other collaborator received that
    // dead URL over the CRDT, and even the uploader lost the media on reload.
    const objId = editor.createNode({
      id: nanoid(),
      type,
      x: viewCenter.x - width / 2,
      y: viewCenter.y - height / 2,
      width,
      height,
      src: localUrl,
      ...(type === 'audio'
        ? { durationMs: 0, waveform: [], author: localAuthor() }
        : { appearance: {} }),
    });

    try {
      const formData = new FormData();
      formData.append("media", file);
      const res = await fetch(mediaUploadUrl(roomId), {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (data.url) {
        updateNode(objId, { src: data.url });
        URL.revokeObjectURL(localUrl);
      }
    } catch (err) {
      console.warn("Network upload failed, queuing offline media for sync...", err);
      queueOfflineMedia({
        id: nanoid(),
        objectId: objId,
        roomId,
        fileBlob: file,
        fileName: file.name,
        fileType: file.type,
        mediaType: type as 'image' | 'audio',
      });
    } finally {
      setActiveTool('select');
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const selectTool = (tool: string) => {
    setActiveTool(tool);
    if (tool === 'image' && fileInputRef.current) {
      fileInputRef.current.accept = 'image/*';
      fileInputRef.current.click();
    }
  };

  // Clicking Image opens the native file picker; activeTool only resets back
  // to 'select' from handleMediaUpload's `finally`, which never runs if the
  // user cancels the picker instead of choosing a file — the Image button
  // stayed stuck highlighted "active" indefinitely. The 'cancel' event is
  // Chromium-specific but degrades harmlessly (stays exactly as broken as
  // before) in browsers that don't fire it.
  useEffect(() => {
    const input = fileInputRef.current;
    if (!input) return;
    const handleCancel = () => setActiveTool('select');
    input.addEventListener('cancel', handleCancel);
    return () => input.removeEventListener('cancel', handleCancel);
  }, []);

  // Escape leaves Forces the same way it leaves every other mode here. A mode
  // you can only exit by finding the right button is a mode people feel stuck
  // in, and force is the one mode where feeling stuck is alarming.
  useEffect(() => {
    if (!isForceTool(activeTool)) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const el = document.activeElement?.tagName;
      if (el === 'INPUT' || el === 'TEXTAREA') return;
      setActiveTool('select');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeTool]);


  const handleOrganize = (mode: LayoutMode) => {
    const currentObjects = useStore.getState().objects;
    const targetPositions = calculateLayout(currentObjects, mode);
    animateToLayout(currentObjects, targetPositions);
  };

  if (!user) return <AuthModal />;

  return (
    <div className={`app-container ${isDarkTheme ? 'dark-theme' : 'light-theme'}`} style={{ width: '100%', height: '100vh', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden', background: 'var(--surface-primary)' }}>
      {showShareModal && <ShareModal onClose={() => setShowShareModal(false)} />}
      {showExportMenu && <ExportModal onClose={() => setShowExportMenu(false)} title={localTitle} />}
      
      {/* AUDIO RECORDER HINT — hides once AudioTool's real HUD takes over (isRecording). */}
      {activeTool === 'audio' && !isRecording && (
        <div style={{
          position: 'absolute', top: 80, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(25, 27, 30, 0.75)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
          padding: '20px 32px', borderRadius: 24, border: '1px solid rgba(255,255,255,0.1)',
          zIndex: 150, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20,
          boxShadow: '0 12px 40px rgba(0,0,0,0.4)',
        }}>
          <div style={{ fontWeight: 600, fontSize: 15, display: 'flex', alignItems: 'center', gap: 12, color: 'white' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: '50%', background: 'rgba(255,255,255,0.1)' }}>
              <Mic size={18} color="white" />
            </div>
            Click anywhere to drop a Voice Note
          </div>
        </div>
      )}

      {/* First tab stop: lets keyboard users reach the canvas without
          traversing the entire header and tool dock. */}
      <a href="#canvas-surface" className="skip-link">Skip to canvas</a>

      {/* Connection state is announced, not just coloured — a status conveyed
          only by a red dot is invisible to a screen reader. `polite` so it
          waits for a pause rather than interrupting. */}
      <div className="sr-only" role="status" aria-live="polite">
        {status === 'connected' ? 'Connected. Changes are syncing.' : 'Offline. Changes are saved locally and will sync when you reconnect.'}
      </div>

      {/* OFFLINE BANNER */}
      {status !== 'connected' && (
        <div style={{ position: 'absolute', bottom: 84, left: '50%', transform: 'translateX(-50%)', background: 'var(--surface-elevated)', color: 'var(--text-primary)', padding: '8px 16px', borderRadius: 'var(--radius-pill)', zIndex: 1000, display: 'flex', alignItems: 'center', gap: 10, fontSize: 'var(--text-base)', fontWeight: 500, boxShadow: 'var(--shadow-md)', border: '1px solid var(--border-divider)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--status-offline)' }} />
          Working Offline. Changes will sync automatically.
        </div>
      )}

      {/* WORKSPACE SHELL (Header & Navigation) */}
      {isUiVisible && (
        <WorkspaceShell 
          localTitle={localTitle}
          setLocalTitle={setLocalTitle}
          onTitleSave={handleSaveTitle}
          isDarkTheme={isDarkTheme}
          setIsDarkTheme={setIsDarkTheme}
          onShareClick={() => setShowShareModal(true)}
          onExportClick={() => setShowExportMenu(true)}
          onHideUi={() => setIsUiVisible(false)}
          onToggleTimeline={() => setShowTimeTravel(v => !v)}
          onTogglePanels={() => setPanelsOpen(v => !v)}
        />
      )}

      {/* TIMELINE / SESSION REPLAY OVERLAY */}

      {/* CANVAS AREA (Core Render Engine) */}
      <div
        id="canvas-surface"
        className="canvas-area"
        role="application"
        aria-label="Infinite canvas. Use the tool dock to add objects, or press Ctrl+K for commands."
        tabIndex={-1}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 0 }}
      >
        
        {/* Spatial Intelligence & Radar */}
        {isUiVisible && <Minimap />}
        
        <OffScreenPresence
          stageScale={1}
          stagePos={{ x: 0, y: 0 }}
          dimensions={{ width: window.innerWidth, height: window.innerHeight }}
          onFlyTo={(x, y) => {
            window.dispatchEvent(new CustomEvent('navigateViewport', { detail: { x, y, zoom: 1 } }));
          }}
        />
        
        {/* Cursor System */}
        {isUiVisible && <CursorRenderer />}
        
        <ActivityFeed />

        {/* Teaches the core gesture on a blank canvas, and gets out of the way
            the moment anything exists. */}
        <CanvasEmptyState visible={isUiVisible && !timeTravelSnapshot} />
        
        <input type="file" ref={fileInputRef} style={{ display: 'none' }} onChange={handleMediaUpload} />
        
        {/* `isPlayMode` and `overrideObjects` used to be passed here and were
            read by nothing inside Canvas. Time Travel drives the canvas through
            the store's `isReplaying` flag instead, which is why replay worked
            despite the prop being ignored. */}
        <Canvas
          activeTool={activeTool}
          selectedIds={selectedIds}
          setSelectedIds={setSelectedIds}
        />
        
        {showTimeTravel && (
          <TimeTravelBar
            roomId={roomId}
            onClose={() => { setShowTimeTravel(false); applyReplaySnapshot(null); setTimeTravelSnapshot(null); }}
            /* The snapshot has to reach the store, not just these two panels —
               that is what puts the replay on the canvas. It stays in local
               state as well because Layers and Properties read it directly to
               show history without subscribing to replay state. */
            onApplySnapshot={(snap) => { applyReplaySnapshot(snap); setTimeTravelSnapshot(snap); }}
          />
        )}
        
        {/* Forces mode owns the bottom of the screen while it is active, in the
            same slot and the same shell as Time Travel — both are modes you
            enter, work inside, and leave. */}
        {isForceTool(activeTool) && (
          <ForcesBar
            activeForce={activeTool as ForceId}
            onPickForce={(id) => setActiveTool(id)}
            /* Leaving the tool is enough — Canvas clears the layout snapshot
               for every exit path, including picking another tool. */
            onExit={() => setActiveTool('select')}
          />
        )}

        {showCommandPalette && (
          <CommandPalette 
            onClose={() => setShowCommandPalette(false)} 
            onSelectAction={handleCommandPaletteAction} 
          />
        )}
      </div>

      {/* FLOATING CONTEXT TOOLBAR */}
      <ObjectContextToolbar
        selectedId={selectedId}
        selectedIds={selectedIds}
        onDeselect={() => setSelectedIds([])}
        sidebarsVisible={isUiVisible}
      />

      {/* TOOL WORKSPACE (Dynamic Dock) */}
      {isUiVisible && (
        <ToolWorkspace activeToolId={activeTool} />
      )}

      {/* Scrim — only while the panels float above the canvas, so tapping the
          canvas dismisses them instead of leaving them covering the work. */}
      {isUiVisible && isCompact && panelsOpen && (
        <button
          className="panel-scrim"
          aria-label="Close panels"
          onClick={() => setPanelsOpen(false)}
        />
      )}

      {/* CONTEXT INSPECTOR (Right Sidebar) */}
      {isUiVisible && (
        <div className="context-inspector panel-surface" data-open={panelsVisible}>
          <PropertiesPanel selectedId={selectedId} overrideObjects={timeTravelSnapshot} />
        </div>
      )}

      {/* HIERARCHY PANEL (Left Sidebar) */}
      {isUiVisible && (
        <div className="hierarchy-panel panel-surface" data-open={panelsVisible}>
          <LayersPanel selectedIds={selectedIds} setSelectedId={setSelectedId} setSelectedIds={setSelectedIds} overrideObjects={timeTravelSnapshot} />
        </div>
      )}

      {/* Zen Mode Escape Hint */}
      {!isUiVisible && (
        <>
          <button 
            onClick={() => setIsUiVisible(true)}
            className="panel-surface hover-surface"
            style={{ position: 'absolute', top: 16, right: 16, zIndex: 1000, display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderRadius: 8, fontWeight: 600, fontSize: 13, border: '1px solid var(--border-divider)', boxShadow: 'var(--shadow-md)', cursor: 'pointer', color: 'var(--text-primary)' }}
          >
            Show UI <span style={{ opacity: 0.5, marginLeft: 4 }}>\</span>
          </button>
          <div style={{ position: 'absolute', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: 'var(--surface-elevated)', padding: '8px 16px', borderRadius: 20, color: 'var(--text-secondary)', fontSize: 12, fontWeight: 500, border: '1px solid var(--border-divider)', boxShadow: 'var(--shadow-float)', pointerEvents: 'none', zIndex: 1000 }}>
            Press \ to show UI
          </div>
        </>
      )}
    </div>
  );
}
