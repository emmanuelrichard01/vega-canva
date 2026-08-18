import { nanoid } from 'nanoid';
import React, { useState, useRef, useEffect, useSyncExternalStore } from 'react';
import { Canvas } from './components/Canvas';
import { AuthModal } from './components/AuthModal';
import { ShareModal } from './components/ShareModal';
import { WorkspaceShell } from './components/workspace/WorkspaceShell';
import { ToolWorkspace } from './components/workspace/ToolWorkspace';
import { TOOL_FOR_KEY } from './engine/tools/shortcuts';
import { takePendingRestore, takePendingTemplate } from './engine/export/pendingRestore';
import { templateById } from './engine/templates/templates';
import { parseDocumentExport } from './engine/export/DocumentImport';
import { restoreDocument } from './engine/export/restoreDocument';
import { Minimap } from './components/Minimap';
import { PanelRail } from './components/workspace/PanelRail';
import { Eye, Radar } from 'lucide-react';
import { ObjectContextToolbar } from './components/ObjectContextToolbar';
import { PropertiesPanel } from './components/PropertiesPanel';
import { LayersPanel } from './components/LayersPanel';
import { useAuth } from './hooks/AuthContext';
import { doc, provider, metadataMap, undoManager, updateNode, localAuthor, localAuthorId, publishLocalIdentity } from './engine/document';
import { useRoomState } from './hooks/useSync';
import { initSyncBridge, useStore } from './hooks/useStore';
import { editor } from './engine/api/EditorAPI';
import { ActivityFeed } from './components/ActivityFeed';
import { PresenceEdgeMarkers } from './components/PresenceEdgeMarkers';
import { FollowIndicator } from './components/FollowIndicator';
import { ExportService } from './engine/export';
import { TimeTravelBar } from './components/TimeTravelBar';
import { ForcesBar } from './components/ForcesBar';
import { isForceTool, type ForceId } from './engine/physics/forces';
import { mediaUploadUrl } from './utils/endpoints';
import { CommandPalette } from './components/CommandPalette';
import { processOfflineMediaQueue, queueOfflineMedia } from './utils/offlineMediaQueue';
import { calculateLayout, animateToLayout, type LayoutMode } from './utils/spatialLayout';
import { Mic, TriangleAlert, X } from 'lucide-react';
import { RemoteCursors } from './engine/cursor';
import { ExportModal } from './components/ui/ExportModal';
import { cameraSystem } from './engine/CameraSystem';
import { useBreakpoint } from './hooks/useBreakpoint';
import { CanvasEmptyState } from './components/CanvasEmptyState';
import { FirstRunGuide } from './components/FirstRunGuide';
import { WelcomeSequence } from './components/WelcomeSequence';
import { DockCoach } from './components/DockCoach';
import { buildPreview, savePreview } from './engine/model/boardPreview';
import { previewColorOf, previewPointsOf } from './engine/model/previewPaint';
import { useComments } from './hooks/useComments';
import { CommentInbox } from './components/comments/CommentInbox';
import { readMarks } from './engine/comments/readMarks';
import { anchorPoint, unreadCount } from './engine/comments/threads';

/**
 * Whether this page load has already taken the pending backup.
 *
 * Module scope rather than a ref, because StrictMode remounts the component and
 * a ref would be recreated with it. A page load can only ever receive one
 * backup, so the flag's lifetime is the page's.
 */
let restoreConsumed = false;

/**
 * Frame a freshly opened board so all of it is visible at once.
 *
 * ## Why a template must not open at 100%
 *
 * Several of these boards are deliberately large — five hundred shapes on a
 * spiral, a thousand on a wave. Landing at 1:1 shows you a corner of one and
 * no indication that the rest exists, which is the opposite of the first
 * impression a showcase is for.
 *
 * ## Why fit-to-content rather than a fixed zoom
 *
 * A fixed 50% would still crop the wave field and would shrink a six-note
 * retro to something unreadable. Fitting means every board arrives at the size
 * that shows all of it, whatever it happens to be.
 *
 * ## Why the panels are subtracted
 *
 * The Layers panel and the Properties panel float **over** the canvas, so the
 * stage is the full window width while the part you can actually see is nearly
 * six hundred pixels narrower. Fitting to the stage puts the left and right
 * edges of the board underneath the panels — visible to the renderer, hidden
 * from the person. The usable middle is what the content is fitted into.
 */
function fitBoardToView(
  nodes: Array<{ x: number; y: number; width: number; height: number }>,
  /**
   * Frame without the glide.
   *
   * Used when the board is not on screen yet: gliding across an empty canvas
   * and letting the content land mid-flight is what made a template arrive as
   * a lurch. See the note in `Canvas`'s navigate handler.
   */
  immediate = false,
  /**
   * Whether the side panels and the dock are actually on screen.
   *
   * The insets below are subtracted unconditionally, which is right while the
   * chrome is up and wrong the moment it is not: in focus mode — and now
   * whenever a force is armed — there are no panels, so reserving six hundred
   * pixels for them fits the board into a band twice as narrow as the one it
   * has, and centres it in a space that does not exist.
   */
  chromeVisible = true
): void {
  if (nodes.length === 0) return;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  nodes.forEach((n) => {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.width);
    maxY = Math.max(maxY, n.y + n.height);
  });
  if (!Number.isFinite(minX)) return;

  const boardW = Math.max(1, maxX - minX);
  const boardH = Math.max(1, maxY - minY);
  const usableW = Math.max(320, cameraSystem.width - (chromeVisible ? PANEL_INSET * 2 : 0));
  const usableH = Math.max(240, cameraSystem.height - (chromeVisible ? VERTICAL_INSET : 0));

  const zoom = Math.min(
    (usableW / boardW) * FIT_MARGIN,
    (usableH / boardH) * FIT_MARGIN,
    // Never magnify: a board smaller than the window should sit at its own
    // size rather than being blown up to fill the screen.
    1
  );

  /**
   * Centred in the *usable* band, not the stage.
   *
   * The tool dock sits over the bottom of the canvas and nothing sits over the
   * top, so the space you can actually see is not centred on the stage — it is
   * about half the dock's height higher. Centring on the stage put the bottom
   * of every fitted board underneath the dock.
   */
  const verticalShift = chromeVisible ? DOCK_OBSTRUCTION / 2 / Math.max(0.02, zoom) : 0;

  window.dispatchEvent(
    new CustomEvent('navigateViewport', {
      detail: {
        x: minX + boardW / 2,
        y: minY + boardH / 2 - verticalShift,
        zoom: Math.max(0.02, zoom),
        immediate,
      },
    })
  );
}

/** Roughly a side panel, so a fitted board is not tucked under one. */
const PANEL_INSET = 300;
/** Header, ruler and the tool dock along the bottom. */
const VERTICAL_INSET = 190;
/** How much of the bottom the dock covers, in screen pixels. */
const DOCK_OBSTRUCTION = 96;
/** A little air around the content, so nothing touches an edge. */
const FIT_MARGIN = 0.92;

/** The longest edge a freshly placed image is fitted to, in world units. */
const IMAGE_PLACE_MAX = 420;

/** How far each additional file in one drop is offset, so none is hidden. */
const MULTI_PLACE_STEP = 28;

/**
 * The pixel dimensions of an image file, or null if it cannot be read.
 *
 * Resolves rather than rejects on failure: a picture the browser cannot decode
 * should still be placed — at the fallback size, where it shows as a broken
 * image the user can delete — rather than making the whole drop do nothing.
 */
function measureImage(url: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export default function Room() {
  const { user } = useAuth();
  
  useEffect(() => {
    initSyncBridge();
  }, []);

  /** Result of a restore-on-open, shown once and dismissible. */
  /**
   * `transient` separates a greeting from a confirmation.
   *
   * The notice used to be dismiss-only for every case, on the reasoning that
   * a restore confirmation must not vanish while you are still checking the
   * board against what you remember. That is right — for a *restore*. A
   * template notice is a greeting: it names the board you just opened and
   * tells you it is editable, and it has nothing to confirm. Leaving it
   * pinned over the canvas makes the first thing you see on a new board a
   * piece of chrome you have to close.
   *
   * So greetings fade and confirmations stay. Errors always stay, because an
   * error you did not finish reading is an error you did not read.
   */
  const [restoreNotice, setRestoreNotice] = useState<
    { ok: boolean; message: string; transient?: boolean } | null
  >(null);
  const [noticeLeaving, setNoticeLeaving] = useState(false);
  /** True while a file is being dragged over the window. */
  const [dropActive, setDropActive] = useState(false);

  /**
   * Pour in a backup, if this room was opened to receive one.
   *
   * The rooms page validates the file, stashes it, then navigates here — see
   * `pendingRestore` for why the handoff goes through `sessionStorage` rather
   * than through props or a store. The re-parse is deliberate: this validates
   * with the same code that accepted the file rather than trusting a shape
   * that has been through serialisation.
   *
   * ## Why the guard is a module flag and not the stash itself
   *
   * The first version read-and-cleared the stash, then scheduled the restore
   * behind a `setTimeout` and returned a cleanup that cleared that timer. Under
   * StrictMode — which this app runs in — React mounts, unmounts and remounts
   * every effect in development. So: the first pass took the backup out of
   * storage and armed the timer, the cleanup disarmed it, and the remount found
   * an empty stash and did nothing. The file was consumed and destroyed without
   * ever being applied, and the failure was silent.
   *
   * Two changes, and both are needed. A module-level flag makes consumption
   * idempotent no matter how many times the effect runs, and nothing cancels
   * the pending work — the restore is not a subscription to tear down, it is a
   * one-shot the user has already asked for.
   */
  useEffect(() => {
    if (restoreConsumed) return;
    restoreConsumed = true;

    /**
     * A template, if this room was opened from one.
     *
     * Shares the consumed-once guard with the restore below for the same
     * StrictMode reason: the effect runs, unmounts and runs again in
     * development, and seeding twice would give a board with two of everything.
     */
    const templateId = takePendingTemplate();
    if (templateId) {
      const template = templateById(templateId);
      if (template) {
        window.setTimeout(() => {
          const nodes = template.build();

          /**
           * Frame, then fill, then settle — in that order.
           *
           * It used to fill, then frame: forty objects were committed at
           * whatever the camera happened to be showing, and the camera then
           * glided six hundred milliseconds to where they actually were. So
           * the first thing anyone saw of a template was a burst of shapes in
           * the wrong place, sliding. Framing the *empty* board first costs
           * nothing — there is nothing on screen to move — and means the
           * content appears already composed, centred, and clear of the
           * panels and the dock.
           */
          fitBoardToView(nodes, true, uiVisibleRef.current);

          // One transaction, so a template is one undo step — someone who
          // opens one and decides against it presses Cmd+Z once, not forty
          // times. It is also one broadcast rather than forty.
          doc.transact(() => {
            nodes.forEach((node) => editor.createNode(node));
          });

          // And one short fade, so the board resolves into place rather than
          // being stamped onto the screen in a single frame.
          window.dispatchEvent(new CustomEvent('boardArriving'));
          setRestoreNotice({
            ok: true,
            transient: true,
            message: `${template.name} — click anything to edit it.`,
          });
        }, 400);
      }
      return;
    }

    const text = takePendingRestore();
    if (!text) return;

    // Deferred a beat so `y-indexeddb` and the provider have attached. A brand
    // new room is empty either way, but writing before local persistence is
    // listening means writing into a document it is about to replace.
    window.setTimeout(() => {
      const result = parseDocumentExport(text);
      if (!result.ok) {
        setRestoreNotice({ ok: false, message: result.error });
        return;
      }
      const summary = restoreDocument(result.document, 'replace');
      setRestoreNotice({
        ok: true,
        message: `Restored ${summary.added} object${summary.added === 1 ? '' : 's'} from your backup.`,
      });
    }, 400);
  }, []);
  /**
   * A greeting shows its welcome, then leaves.
   *
   * Two stages rather than one: the leaving class runs the exit animation,
   * and the node is removed only once it has finished. Unmounting straight
   * away would make it disappear rather than fade, which on a board that has
   * just filled with objects reads as a glitch.
   *
   * Six seconds — long enough to read a board's name twice at a glance, short
   * enough that it is gone before anyone reaches for the close button.
   */
  useEffect(() => {
    if (!restoreNotice?.transient) return;
    const fade = window.setTimeout(() => setNoticeLeaving(true), 6000);
    const drop = window.setTimeout(() => {
      setRestoreNotice(null);
      setNoticeLeaving(false);
    }, 6000 + 420);
    return () => { window.clearTimeout(fade); window.clearTimeout(drop); };
  }, [restoreNotice]);

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
  /**
   * Whether the share sheet has been opened at all this session.
   *
   * The guide asks "have you discovered sharing?", which `showShareModal`
   * cannot answer — it goes false again the moment the sheet closes, so the
   * step would tick and immediately untick.
   */
  const [hasShared, setHasShared] = useState(false);
  useEffect(() => {
    if (showShareModal) setHasShared(true);
  }, [showShareModal]);
    const [showTimeTravel, setShowTimeTravel] = useState(false);
  const [timeTravelSnapshot, setTimeTravelSnapshot] = useState<Record<string, any> | null>(null);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showInbox, setShowInbox] = useState(false);

  // A second `useComments()` subscription, deliberately. `commentsMap` is a
  // module-level Y.Map, so both this and the canvas's read the same source and
  // update on the same observer — there is no drift to worry about, only one
  // extra (cheap) observer. The alternative was drilling seven comment props
  // through Canvas to reach an overlay several levels down.
  const { comments } = useComments();
  const commentObjects = useStore((s) => s.objects);
  const commentMarks = useSyncExternalStore(
    readMarks.subscribe,
    readMarks.getSnapshot,
    readMarks.getSnapshot
  );
  const myAuthorId = localAuthorId();
  // Persisted in the store rather than local state, so the choice survives a
  // reload (and starts from the OS preference).
  const isDarkTheme = useStore((s) => s.darkTheme);
  const setIsDarkTheme = useStore((s) => s.setDarkTheme);
  const applyReplaySnapshot = useStore((s) => s.applyReplaySnapshot);
  const [isUiVisible, setIsUiVisible] = useState(true);
  /**
   * Read by the template effect, which runs once on mount and must not list
   * `isUiVisible` as a dependency — doing so would re-seed the board every
   * time the chrome was toggled.
   */
  const uiVisibleRef = useRef(isUiVisible);
  uiVisibleRef.current = isUiVisible;

  /**
   * Whether the tool dock is showing while the rest of the chrome is hidden.
   *
   * Entry is immediate: reaching for the bottom edge is already the decision.
   * Exit waits, because leaving the dock is more often overshoot than intent —
   * hiding on the first `mouseleave` makes it flicker along the bottom of the
   * screen the whole time you are working near it, which is the failure mode
   * that makes reveal-on-hover feel broken everywhere it feels broken.
   */
  /**
   * Whether the frame-or-canvas question has been answered.
   *
   * Held here because two surfaces share one anchor above the dock, and only
   * one of them may occupy it at a time — the coach asks first, the first-run
   * guide takes over once it has settled.
   */
  const [dockAnswered, setDockAnswered] = useState(
    () => localStorage.getItem('vega_dock_coach_v1') === 'answered'
  );

  const [dockRevealed, setDockRevealed] = useState(false);
  const dockHideTimer = useRef<number | null>(null);

  const revealDock = () => {
    if (dockHideTimer.current !== null) {
      window.clearTimeout(dockHideTimer.current);
      dockHideTimer.current = null;
    }
    setDockRevealed(true);
  };
  const scheduleDockHide = () => {
    if (dockHideTimer.current !== null) window.clearTimeout(dockHideTimer.current);
    dockHideTimer.current = window.setTimeout(() => setDockRevealed(false), 450);
  };

  // Leaving focus mode must not strand the dock in its revealed state, and the
  // pending timer must not fire into an unmounted tree.
  useEffect(() => {
    if (isUiVisible) setDockRevealed(false);
    return () => {
      if (dockHideTimer.current !== null) window.clearTimeout(dockHideTimer.current);
    };
  }, [isUiVisible]);

  // Below the compact breakpoint the side panels stop being docked columns —
  // two 260px panels plus the dock leave a canvas narrower than either of
  // them — and become overlays that open on demand. Above it they are always
  // shown, so `panelsOpen` is ignored.
  const { isCompact } = useBreakpoint();
  const [panelsOpen, setPanelsOpen] = useState(false);
  const panelsVisible = !isCompact || panelsOpen;

  /**
   * Whether each side panel is expanded, and whether the radar is showing.
   *
   * Persisted per origin, because this is a working preference rather than a
   * property of the board — the same call the tag filter and the comment read
   * marks make. A collaborator's screen must not change because you collapsed
   * your own inspector.
   *
   * They start expanded so nothing has moved for anyone who liked the old
   * layout; the point is that the space can now be *taken back*, not that it
   * is taken away by default.
   */
  const [leftExpanded, setLeftExpanded] = useState(
    () => localStorage.getItem('vega_panel_left') !== 'collapsed'
  );
  const [rightExpanded, setRightExpanded] = useState(
    () => localStorage.getItem('vega_panel_right') !== 'collapsed'
  );
  // Shown by default. It was briefly opt-in to reclaim its footprint, but the
  // radar is how you answer "where is everything, and where is everyone" on a
  // surface with no edges — a question you have continuously, not one you
  // think to go looking for. Collapsing it stays one click away and persists.
  const [radarOpen, setRadarOpen] = useState(
    () => localStorage.getItem('vega_radar') !== 'collapsed'
  );
  useEffect(() => {
    localStorage.setItem('vega_panel_left', leftExpanded ? 'expanded' : 'collapsed');
  }, [leftExpanded]);
  useEffect(() => {
    localStorage.setItem('vega_panel_right', rightExpanded ? 'expanded' : 'collapsed');
  }, [rightExpanded]);
  useEffect(() => {
    localStorage.setItem('vega_radar', radarOpen ? 'expanded' : 'collapsed');
  }, [radarOpen]);


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
  // A blocked or missing microphone used to fail into `console.error` — from
  // the user's side, clicking the canvas simply did nothing at all.
  const [micError, setMicError] = useState<string | null>(null);
  useEffect(() => {
    const onStart = () => {
      setIsRecording(true);
      setMicError(null);
    };
    const onStop = () => setIsRecording(false);
    const onError = (e: Event) => {
      setIsRecording(false);
      setMicError((e as CustomEvent<{ message: string }>).detail?.message ?? null);
    };
    window.addEventListener('audio-recording-start', onStart);
    window.addEventListener('audio-recording-stop', onStop);
    window.addEventListener('audio-recording-error', onError);
    return () => {
      window.removeEventListener('audio-recording-start', onStart);
      window.removeEventListener('audio-recording-stop', onStop);
      window.removeEventListener('audio-recording-error', onError);
    };
  }, []);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const { roomId, status, metadata } = useRoomState();

  /**
   * Keep a small picture of this board for the dashboard.
   *
   * Written from here because this is where the objects already are — the
   * rooms page has no connection to any document, which is exactly why its
   * covers used to be a hash of the room id. Debounced hard: a preview is only
   * ever looked at on another screen, so it costs nothing to be a few seconds
   * stale and it must not run on every keystroke of a drag.
   *
   * Colour is resolved here rather than in the pure module, because a sticky's
   * colour lives in `THEMES`, which belongs to its renderer.
   */
  const previewObjects = useStore((s) => s.objects);
  useEffect(() => {
    if (!roomId) return;
    const t = window.setTimeout(() => {
      const nodes = Object.values(previewObjects);
      savePreview(
        roomId,
        buildPreview(
          nodes,
          previewColorOf,
          (node) => previewPointsOf(node, previewObjects)
        )
      );
    }, 2000);
    return () => window.clearTimeout(t);
  }, [previewObjects, roomId]);


  // Read state is per person and per room, so it has to be pointed at the room
  // before anything asks what is unread.
  useEffect(() => {
    if (roomId) readMarks.load(roomId);
  }, [roomId]);

  // Drop marks for threads that no longer exist, so the store does not grow a
  // permanent tail of deleted conversations.
  useEffect(() => {
    if (comments.length === 0) return;
    readMarks.prune(comments.map((c) => c.id));
  }, [comments]);

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
  //
  // Follow mode used to live here as `const [followingClientId] =
  // useState(null)` — declared without a setter, so the value was permanently
  // null and the awareness effect underneath it could never fire. It is
  // `engine/presence/followMode.ts` now, driven from the shared presence frame
  // loop, because a viewport change never reaches React: `collaboratorStore`
  // mutates positions in place and publishes only roster changes.

  const hasJoined = useRef(false);
  useEffect(() => {
    if (user && !hasJoined.current) {
      provider.awareness?.setLocalStateField('user', {
        // The persisted identity, not the per-session client id — this is what
        // `localAuthorId()` stamps on comments and nodes, and it has to survive
        // a reload or "your own" comment stops being yours. See mutations.ts.
        id: user.id,
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

      const key = e.key.toLowerCase();

      // Resolved through the same map the dock renders its badges from, so a
      // hint and its binding cannot drift apart. This used to be a switch of
      // twelve hand-written cases sitting opposite twelve hand-written
      // tooltips, and two of those tooltips advertised keys nothing bound.
      const tool = TOOL_FOR_KEY[key];
      if (tool) {
        selectTool(tool);
        return;
      }

      switch (key) {
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

  /**
   * Place one file on the board.
   *
   * Split out from the file-input handler so the same path serves every way a
   * file can arrive — the picker, a paste, a drag from the desktop. Those were
   * three journeys the app only offered one of, and duplicating the upload,
   * the offline queue and the aspect measurement for each is how they drift
   * into behaving differently.
   */
  const placeFile = async (file: File, at?: { x: number; y: number }, index = 0) => {
    const localUrl = URL.createObjectURL(file);
    const type = file.type.startsWith('image/') ? 'image' : 'audio';

    /**
     * An image is placed at the shape it actually is.
     *
     * Every upload was created 300×300 regardless of the picture, so a 16:9
     * photo was squashed into a square — Konva stretches a bitmap to whatever
     * box it is given. `naturalWidth`/`naturalHeight` were backfilled by the
     * renderer once the file loaded, but nothing ever used them to correct the
     * box, so the distortion was permanent unless you resized it by hand.
     *
     * Measured from the local blob before the node exists, so it is born
     * correct rather than being created wrong and reflowed a moment later —
     * which every collaborator would have seen as a jump.
     */
    const measured = type === 'image' ? await measureImage(localUrl) : null;
    // window.innerWidth/innerHeight are screen pixels, not canvas world
    // coordinates — using them directly placed every uploaded file at a fixed
    // world position regardless of where you'd actually panned/zoomed to, so
    // it would silently land off-screen for any view other than the default.
    const viewCenter = at ?? cameraSystem.screenToWorld(window.innerWidth / 2, window.innerHeight / 2);
    let width = type === 'image' ? 300 : 240;
    let height = type === 'image' ? 300 : 64;
    if (measured) {
      // Fitted inside a sensible placement box rather than pasted at full
      // size: a 4000px photo dropped at its own dimensions covers the board
      // and lands mostly outside the viewport.
      const fit = Math.min(IMAGE_PLACE_MAX / measured.width, IMAGE_PLACE_MAX / measured.height, 1);
      width = Math.max(1, Math.round(measured.width * fit));
      height = Math.max(1, Math.round(measured.height * fit));
    }

    // A single canonical `src`. The asset URL used to be written to both
    // `assetId` and `content.url`, and the post-upload patch only replaced one
    // of them — so the object kept pointing at a `blob:` URL that is valid
    // only inside the uploading tab. Every other collaborator received that
    // dead URL over the CRDT, and even the uploader lost the media on reload.
    const objId = editor.createNode({
      id: nanoid(),
      type,
      /**
       * Fanned out by index, so dropping six files gives six visible objects
       * rather than one visible object and five hidden exactly beneath it.
       */
      x: viewCenter.x - width / 2 + index * MULTI_PLACE_STEP,
      y: viewCenter.y - height / 2 + index * MULTI_PLACE_STEP,
      width,
      height,
      src: localUrl,
      // Recorded at creation, so the crop tool and the aspect-lock have real
      // numbers from the first frame rather than waiting for a render.
      ...(measured ? { naturalWidth: measured.width, naturalHeight: measured.height } : {}),
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
    }
  };

  /**
   * Place several files, sequentially.
   *
   * Sequential rather than `Promise.all`: each one uploads, and firing a dozen
   * multipart requests at once is how a slow connection turns a drop into a
   * stall. They appear on the board immediately regardless — the node is
   * created from a local blob URL before its upload starts.
   */
  const placeFiles = async (files: File[], at?: { x: number; y: number }) => {
    const usable = files.filter((f) => f.type.startsWith('image/') || f.type.startsWith('audio/'));
    if (usable.length === 0) return;
    for (let i = 0; i < usable.length; i += 1) {
      await placeFile(usable[i], at, i);
    }
    setActiveTool('select');
  };

  const handleMediaUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    // Cleared before the await: the picker must be able to offer the same file
    // again immediately, and `value` is what makes a repeat selection fire.
    if (fileInputRef.current) fileInputRef.current.value = '';
    await placeFiles(files);
  };

  /**
   * Paste an image from the clipboard, and drop one from the desktop.
   *
   * Two journeys the app simply did not have: the only way to get a picture
   * onto the board was the dock button and a file dialog. Screenshotting
   * something and pressing Cmd+V is how most images actually reach a
   * whiteboard, and dragging a file onto the window is the other.
   *
   * Both are declined while a text field has focus — pasting into a note must
   * paste text, not drop a picture beside it.
   */
  useEffect(() => {
    const inTextField = () => {
      const el = document.activeElement;
      return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el as HTMLElement)?.isContentEditable;
    };

    const onPaste = (e: ClipboardEvent) => {
      if (inTextField()) return;
      const files = Array.from(e.clipboardData?.items ?? [])
        .filter((item) => item.kind === 'file')
        .map((item) => item.getAsFile())
        .filter((f): f is File => Boolean(f));
      if (files.length === 0) return;
      e.preventDefault();
      // Pasted content has no position of its own, so it lands in the middle
      // of what you are looking at — which is where you were looking when you
      // decided to paste.
      void placeFiles(files);
    };

    const onDragOver = (e: DragEvent) => {
      if (!e.dataTransfer?.types?.includes('Files')) return;
      // Without this the browser navigates away to the dropped file, which
      // loses the board.
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setDropActive(true);
    };

    const onDragLeave = (e: DragEvent) => {
      // Only when the pointer has actually left the window; dragging across a
      // child element fires `dragleave` constantly and would flicker the hint.
      if (e.relatedTarget === null) setDropActive(false);
    };

    const onDrop = (e: DragEvent) => {
      const files = Array.from(e.dataTransfer?.files ?? []);
      setDropActive(false);
      if (files.length === 0) return;
      e.preventDefault();
      // Dropped where the pointer released, so a file lands where it was aimed
      // rather than in the middle of the view.
      const stage = document.querySelector('.konvajs-content')?.getBoundingClientRect();
      const at = stage
        ? cameraSystem.screenToWorld(e.clientX - stage.left, e.clientY - stage.top)
        : undefined;
      void placeFiles(files, at);
    };

    window.addEventListener('paste', onPaste);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

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

  /**
   * Arming a force clears the room.
   *
   * ## Why this mode gets its own screen
   *
   * Force is the one thing in the dock that is not a *tool*. Every other one
   * places something precisely, which is the job the Layers panel, the
   * inspector and the rulers exist to serve. Here you are not editing at all —
   * you are arranging by feel and watching what happens. So the whole
   * supporting cast is furniture for a job you have stopped doing, and it is
   * literally covering the thing you are trying to see: a field reaches 600 to
   * 1000 world units and the two panels take about six hundred pixels of
   * width between them.
   *
   * ## Why it reuses focus mode rather than inventing a second one
   *
   * `isUiVisible` already hides exactly this chrome, on the `\` key, with the
   * transitions already written. A parallel "physics view" would be a second
   * thing to keep in step with the first, and they would drift.
   *
   * ## Why it does not fight you
   *
   * Taking someone's panels away because they picked a tool is a strong move,
   * so it is only ever done *once* per arming. Press `\` to bring the chrome
   * back and it stays back — the flag below stops this effect reasserting
   * itself, because an interface that undoes your correction is worse than one
   * that never helped.
   */
  // Remembered so the dock can arm the mode in one press next time.
  useEffect(() => {
    if (isForceTool(activeTool)) useStore.getState().setLastForce(activeTool as ForceId);
  }, [activeTool]);

  const zenClaimed = useRef(false);
  const uiBeforeForce = useRef(true);
  useEffect(() => {
    if (isForceTool(activeTool)) {
      if (zenClaimed.current) return;
      zenClaimed.current = true;
      // Read through the ref, not the value: this effect must fire on the
      // tool changing and on nothing else. Depending on `isUiVisible` would
      // re-run it every time the chrome was toggled — which is precisely the
      // moment it must not reassert itself.
      uiBeforeForce.current = uiVisibleRef.current;
      setIsUiVisible(false);
      return;
    }
    // Leaving the mode puts the room back the way it was found — including
    // leaving it hidden for someone who was already in focus mode.
    if (zenClaimed.current) {
      zenClaimed.current = false;
      setIsUiVisible(uiBeforeForce.current);
    }
  }, [activeTool]);

  /** Drives the immersive treatment in CSS. See `[data-zen]` in `index.css`. */
  const zenPhysics = isForceTool(activeTool) && !isUiVisible;
  useEffect(() => {
    document.body.dataset.zen = zenPhysics ? 'physics' : '';
    return () => { document.body.dataset.zen = ''; };
  }, [zenPhysics]);


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

      {/* Microphone refused or missing. Dismissible, and it says what to do
          about it — a permission a browser is auto-denying is invisible
          otherwise, and the feature just appears broken. */}
      {micError && (
        <div className="mic-error panel-surface" role="alert">
          <TriangleAlert size={15} />
          <span>{micError}</span>
          <button type="button" onClick={() => setMicError(null)} aria-label="Dismiss">
            ×
          </button>
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
          onToggleComments={() => setShowInbox(v => !v)}
          commentUnread={unreadCount(comments, commentMarks, myAuthorId)}
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
        /* Starts below the header, and this is the fix for a bug that hid a
           whole feature: the rulers live at the top-left of this box, but the
           header is opaque, 56px tall and z-index 100 against their z-index 5 —
           so `elementFromPoint` over the horizontal ruler returned the header,
           and the ruler had never once been visible to anyone.

           Running the canvas *under* an opaque header bought nothing: those
           pixels could not be seen. Starting the viewport below it costs
           nothing, makes the rulers visible where every tool in this category
           puts them, and leaves the coordinate maths alone — Konva reports
           pointer positions relative to the stage, so everything that reads
           `getPointerPosition()` is unaffected. */
        style={{
          position: 'absolute',
          // Below the header normally; the whole screen in focus mode, where
          // there is no header to sit below. Reserving its height anyway left
          // a 56px dead band above the ruler — the one mode whose entire
          // purpose is giving the board the screen was the one still paying
          // for chrome that had gone.
          top: isUiVisible ? 'var(--header-h)' : 0,
          // Height, not `bottom`. `.canvas-area` carries an explicit
          // `height: 100%`, and an absolutely positioned box with both a
          // height and a bottom is over-constrained — the height wins and the
          // bottom is ignored. Offsetting the top therefore pushed the whole
          // box 56px past the viewport, taking the radar (anchored 24px from
          // *its* bottom) off the bottom of the screen with it.
          height: isUiVisible ? 'calc(100% - var(--header-h))' : '100%',
          left: 0, right: 0, zIndex: 0,
        }}
      >
        
        {/* The radar: visible when needed, not permanently parked.
            It was a 260×214 block that never went away — about 55,000px² of
            always-on chrome for a surface you glance at every few minutes.
            Collapsed it is a single pill in exactly the same corner, so the
            place you look for it never moves. */}
        {isUiVisible && (radarOpen ? (
          <Minimap onCollapse={() => setRadarOpen(false)} />
        ) : (
          <button
            type="button"
            className="radar-summon"
            style={{ position: 'absolute', left: 16, bottom: 24, zIndex: 90 }}
            onClick={() => setRadarOpen(true)}
            aria-label="Show the radar"
            data-tooltip="Radar — the whole board, and everyone on it"
            data-tooltip-pos="right"
          >
            <Radar size={15} />
            Radar
          </button>
        ))}
        
        {/* Which way everyone is, when they are off the edge of your screen.
            Takes no props: it reads the camera singleton directly, which is
            what the version it replaces got wrong — it was handed a hardcoded
            identity camera and so described a view nobody was looking at. */}
        <PresenceEdgeMarkers />

        {/* Other people's pointers.

            Deliberately not behind `isUiVisible`: that flag hides *chrome*, and
            other people are not chrome. Hiding them was also inconsistent —
            remote selection outlines (PresenceRenderer) and the off-screen
            collaborator markers just above both stay up in presentation mode,
            so presenting used to leave everyone's selections visible while
            their cursors vanished. Presenting is usually presenting *to* the
            people whose pointers these are. */}
        <RemoteCursors />

        <ActivityFeed />

        {/* Deliberately outside `isUiVisible`, for the same reason the remote
            cursors are: this is not chrome. Following takes control of the
            camera, and a canvas that moves on its own with nothing on screen
            to explain it reads as a broken app — presentation mode most of
            all, where it would be least expected. */}
        <FollowIndicator />

        {/* Teaches the core gesture on a blank canvas, and gets out of the way
            the moment anything exists. */}
        <CanvasEmptyState visible={isUiVisible && !timeTravelSnapshot} />
        
        {/* `multiple`, because selecting eight photos and getting one is not
            a limitation anyone expects from a file picker. */}
        <input type="file" multiple ref={fileInputRef} style={{ display: 'none' }} onChange={handleMediaUpload} />

        {/* Says the window will accept what is being dragged. Without it a
            drag over the board looks exactly like a drag over anything else
            that will refuse it. */}
        {dropActive && (
          <div className="drop-veil" aria-hidden="true">
            <span className="drop-veil__label">Drop to place</span>
          </div>
        )}
        
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
            /* The simulation lives inside Canvas, which owns the physics loop.
               Announced rather than threaded down through Room as a prop, the
               same way tool changes are — the alternative is lifting the whole
               physics hook up two levels to serve one button. */
            onCalm={() => window.dispatchEvent(new CustomEvent('physics-calm'))}
            selectedCount={selectedIds.length}
          />
        )}

        {/* Says what happened when a room was opened to receive a backup, or
            names the template it was opened from.

            A restore confirmation is dismissible rather than timed: it is the
            evidence the recovery worked, and it must not vanish while you are
            still checking the board against what you remember. A template
            greeting has nothing to confirm, so it fades on its own — see the
            effect above. */}
        {restoreNotice && (
          <div
            className={`restore-notice ${restoreNotice.ok ? 'is-ok' : 'is-error'}${noticeLeaving ? ' is-leaving' : ''}`}
            role="status"
          >
            <span>{restoreNotice.message}</span>
            <button
              type="button"
              onClick={() => setRestoreNotice(null)}
              aria-label="Dismiss"
              className="restore-notice__close"
            >
              <X size={14} />
            </button>
          </div>
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

      {/* COMMENT INBOX — every thread in the room, in one list.
          Sits above the Properties panel rather than beside it: both own the
          right-hand column, and two 300px columns leave no canvas. */}
      {isUiVisible && showInbox && (
        <CommentInbox
          threads={comments}
          objects={commentObjects}
          marks={commentMarks}
          myAuthorId={myAuthorId}
          onClose={() => setShowInbox(false)}
          onOpenThread={(thread) => {
            const at = anchorPoint(
              thread,
              thread.objectId ? commentObjects[thread.objectId] : null
            );
            window.dispatchEvent(
              new CustomEvent('navigateViewport', {
                detail: { x: at.x, y: at.y, zoom: Math.max(cameraSystem.zoom, 0.6) },
              })
            );
            // After the fly-to, so the thread opens where the camera lands.
            window.dispatchEvent(
              new CustomEvent('focusCommentThread', { detail: { id: thread.id } })
            );
          }}
        />
      )}

      {/* CONTEXT INSPECTOR (Right Sidebar) */}
      {isUiVisible && (
        <div
          className={rightExpanded ? 'context-inspector panel-surface' : 'context-inspector'}
          data-open={panelsVisible}
          data-collapsed={!rightExpanded}
        >
          {rightExpanded ? (
            <PropertiesPanel
              selectedIds={selectedIds}
              overrideObjects={timeTravelSnapshot}
              onCollapse={() => setRightExpanded(false)}
            />
          ) : (
            <PanelRail
              side="right"
              label="Design"
              count={selectedIds.length}
              onExpand={() => setRightExpanded(true)}
            />
          )}
        </div>
      )}

      {/* HIERARCHY PANEL (Left Sidebar) */}
      {isUiVisible && (
        <div
          className={leftExpanded ? 'hierarchy-panel panel-surface' : 'hierarchy-panel'}
          data-open={panelsVisible}
          data-collapsed={!leftExpanded}
          data-radar-collapsed={!radarOpen}
        >
          {leftExpanded ? (
            <LayersPanel
              selectedIds={selectedIds}
              setSelectedId={setSelectedId}
              setSelectedIds={setSelectedIds}
              overrideObjects={timeTravelSnapshot}
              onCollapse={() => setLeftExpanded(false)}
            />
          ) : (
            <PanelRail
              side="left"
              label="Layers"
              count={Object.keys(commentObjects).length}
              onExpand={() => setLeftExpanded(true)}
            />
          )}
        </div>
      )}

      {/* Once ever: what this is for. Everything that can be discovered by
          using the product is taught in place instead — see `FirstRunGuide`
          and `CanvasEmptyState`. */}
      <WelcomeSequence />

      {/* What the screen cannot say for itself: that other people can be here,
          and that the chrome will get out of the way. Everything else a first
          run needs is already said in place by the empty state. */}
      {/* The fork the dock cannot present for itself: an endless surface, or a
          frame at a real size. Asked once, both answers recorded the same.
          Shown before the first-run guide so the two never stack. */}
      {isUiVisible && <DockCoach visible={isUiVisible} onSettled={() => setDockAnswered(true)} />}

      {isUiVisible && dockAnswered && (
        <FirstRunGuide
          hasShared={hasShared}
          hasReclaimedSpace={!leftExpanded || !rightExpanded}
        />
      )}

      {/* FOCUS MODE.
          It used to be a light switch: every surface dropped at once, leaving
          a "Show UI" button and a permanent hint pill sitting on the artwork.
          That is an off switch, not a focus mode — changing tool meant turning
          the whole interface back on.

          Now the board is the whole screen and the tools come back when you
          reach for them. The grabber at the bottom edge is what stops that
          being a secret: an invisible hot zone is not an affordance, it is
          folklore. */}
      {/* Not in the physics room.

          The dock's whole job there would be to leave the mode, which Done
          and Escape already do — and it reveals itself from the bottom edge,
          which is precisely where the Forces bar now sits. Two panels fighting
          for the same thirty pixels, one of which appears on hover, is a way
          to make the instrument feel unreliable. */}
      {!isUiVisible && !zenPhysics && (
        <>
          <div
            className="focus-edge"
            onMouseEnter={revealDock}
            aria-hidden="true"
          />
          <div className="focus-grabber" aria-hidden="true" />

          <div
            className={`focus-dock${dockRevealed ? ' is-revealed' : ''}`}
            onMouseEnter={revealDock}
            onMouseLeave={scheduleDockHide}
          >
            <ToolWorkspace activeToolId={activeTool} />
          </div>

          <button
            type="button"
            className="focus-exit"
            onClick={() => setIsUiVisible(true)}
            aria-label="Leave focus mode"
          >
            <Eye size={14} />
            Focus
            <span style={{ opacity: 0.55 }}>\</span>
          </button>
        </>
      )}
    </div>
  );
}
