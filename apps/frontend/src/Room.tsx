import { nanoid } from 'nanoid';
import React, { useState, useRef, useEffect, useCallback, useSyncExternalStore, Suspense, lazy } from 'react';
import { Canvas } from './components/Canvas';
import { AuthModal } from './components/AuthModal';
import { BoardColumn, BoardHeaderLeft, BoardHeaderRight, UNTITLED_BOARD } from './components/workspace/WorkspaceShell';
import { useBoardPanels, usePublishBoardLayout, useRegionCycle } from './components/workspace/boardLayout';
import { PanelWidthHandle } from './components/workspace/PanelWidthHandle';
import { ToolWorkspace } from './components/workspace/ToolWorkspace';
import { takePendingRestore, takePendingTemplate } from './engine/export/pendingRestore';
import { templateById } from './engine/templates/templates';
import { applyPhysicsPrimer } from './engine/templates/applyPrimer';
import { physicsSettings } from './engine/physics/settings';
import { parseDocumentExport } from './engine/export/DocumentImport';
import { restoreDocument } from './engine/export/restoreDocument';
import { Minimap } from './components/Minimap';
import { BoardFoot } from './components/workspace/BoardFoot';
import { Eye, Radar } from 'lucide-react';
import { ObjectContextToolbar } from './components/ObjectContextToolbar';
import { PropertiesPanel } from './components/PropertiesPanel';
import { LayersPanel } from './components/LayersPanel';
import { useRoomPermissions } from './hooks/useRoomPermissions';
import { useShareCard } from './hooks/useShareCard';
import { useDocumentHead } from './hooks/useDocumentHead';
import { previewsHidden } from './engine/share/shareCard';
import { currentInvite } from './engine/room/invite';
import { rememberBoard } from './components/home/library';
import { useAuth } from './hooks/useAuth';
import { doc, provider, deleteNode, localAuthorId, publishLocalIdentity, setBoardMetadata, whenDocumentReady } from './engine/document';
import { startDocumentUpkeep } from './engine/document/upkeep';
import { storageGet, storageSet } from './utils/safeStorage';
import { OBJECT_HISTORY_EVENT } from './engine/history/objectHistory';
import { useRoomState } from './hooks/useSync';
import { useOpeningFrame } from './hooks/useOpeningFrame';
import { fitPose } from './engine/cameraFit';
import { resolvePresenceColor, type ColorClaim } from './engine/presence/ColorPalette';
import { initSyncBridge, useStore } from './hooks/useStore';
import { editor } from './engine/api/EditorAPI';
import { PresenceEdgeMarkers } from './components/PresenceEdgeMarkers';
import { FollowIndicator } from './components/FollowIndicator';
import { PresenceStage } from './components/PresenceStage';
import { isForceTool, type ForceId } from './engine/physics/forces';
import { usePresenting } from './engine/tools/presentingChrome';
import { calculateLayout, animateToLayout, type LayoutMode } from './utils/spatialLayout';
import { Mic, TriangleAlert } from 'lucide-react';
import { RemoteCursors, cursorHint } from './engine/cursor';
import type { ContextTarget } from './components/CanvasContextMenu';
import { RoomModals } from './components/workspace/RoomModals';
import { useRoomShortcuts } from './hooks/useRoomShortcuts';
import { useCanvasAudioRecording } from './hooks/useCanvasAudioRecording';
import { useCanvasDropZone } from './hooks/useCanvasDropZone';
import { startGridSlotSync } from './engine/grid/gridSlotApply';
import { gridEditMode, selectionMirror } from './engine/grid/gridEditMode';
import { GRID_SETTINGS_EVENT } from './engine/grid/gridSettings';
import { notify } from './engine/ui/notices';
import { useRoomClipboard } from './hooks/useRoomClipboard';
import { useRoomContextMenuActions } from './hooks/useRoomContextMenuActions';
import { useSelectionCommandKeys } from './hooks/useSelectionCommandKeys';

const TimeTravelBar = lazy(() => import('./components/TimeTravelBar').then((m) => ({ default: m.TimeTravelBar })));
const ForcesBar = lazy(() => import('./components/ForcesBar').then((m) => ({ default: m.ForcesBar })));
import { parseMermaid, looksLikeMermaid } from './engine/diagram/mermaid';
import { buildDiagram, canEmitDiagram, diagramIdOf, diagramToMermaid, type DiagramBuildOptions } from './engine/diagram/build';
import { looksLikeSequence, parseSequence } from './engine/diagram/sequence';
import { buildSequenceDiagram } from './engine/diagram/buildSequence';
import { looksLikePie, parsePie } from './engine/diagram/pie';
import { buildPieDiagram } from './engine/diagram/buildPie';
import { isSequenceDiagram, sequenceToMermaid } from './engine/diagram/sequenceEmit';
import { demoBox, demoText } from './engine/text/demoText';
import { deleteNodesWithFrames } from './engine/interaction/frameMembership';
import { parseClipboard } from './engine/clipboard/clipboard';
import { looksLikeSvg } from './engine/clipboard/svgImport';
import { DEFAULT_TYPOGRAPHY } from './engine/model/schema';
import { cameraSystem } from './engine/CameraSystem';
import { useBreakpoint } from './hooks/useBreakpoint';
import { EmptyBoardHints } from './components/onboarding/EmptyBoardHints';
import { LessonCoach } from './components/learn/LessonCoach';
import { WalkthroughGuide } from './components/learn/WalkthroughGuide';
import { TourGuide, TourOffer } from './components/learn/TourGuide';
import { tourState } from './engine/learn/tourState';
import { walkthroughState } from './engine/learn/walkthroughState';
import { learnState } from './engine/learn/learnState';
import { buildPreview, savePreview } from './engine/model/boardPreview';
import { previewColorOf, previewPointsOf } from './engine/model/previewPaint';
import { useComments } from './hooks/useComments';
import { CommentInbox } from './components/comments/CommentInbox';
import { readMarks } from './engine/comments/readMarks';
import { anchorPoint, mentionsMe, unreadCount } from './engine/comments/threads';
import { GroupIsolationBar } from './components/ui/GroupIsolationBar';
import { IconBrowserHost } from './components/icons/IconBrowserHost';
import { useDeviceClass, usePhone } from './components/workspace/usePhone';
import { PhoneContextBar } from './components/workspace/PhoneContextBar';
import { BottomSheet } from './components/ui/BottomSheet';

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
  immediate = false,
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

  const bounds = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  const pose = fitPose(bounds, cameraSystem.width, cameraSystem.height, {
    ...cameraSystem.zoomLimits,
    paddingLeft: chromeVisible ? 80 : 40,
    paddingRight: chromeVisible ? 80 : 40,
    paddingTop: chromeVisible ? 64 : 40,
    paddingBottom: chromeVisible ? 110 : 40,
  });

  if (pose) {
    if (immediate) {
      cameraSystem.setPose(pose.x, pose.y, pose.zoom);
    } else {
      cameraSystem.animateTo(pose.x, pose.y, pose.zoom, { duration: 450 });
    }
  }
}

/** The inbox, subscribed to the document itself so the room need not be. */
function LiveCommentInbox(props: Omit<React.ComponentProps<typeof CommentInbox>, 'objects'>) {
  const objects = useStore((s) => s.objects);
  return <CommentInbox {...props} objects={objects} />;
}

export default function Room() {
  const { user } = useAuth();
  
  useEffect(() => {
    initSyncBridge();
  }, []);

  /**
   * Keep pictures on the grid modules they were placed in.
   *
   * Started here, once, rather than being called from the places a grid
   * changes — a grid's box moves under a drag, the transformer, a nudge, an
   * align, a panel edit, an **undo**, and a **collaborator on another
   * machine**, and the last two have no local call site to add a line to. See
   * `startGridSlotSync` for why that makes a subscription the only correct
   * shape, and why it cannot feed itself.
   */
  useEffect(() => startGridSlotSync(), []);

  /**
   * Group sweep and frame-membership repair. Document-level subscribers rather
   * than effects over store state: see `engine/document/upkeep.ts`.
   */
  useEffect(() => startDocumentUpkeep(), []);


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
        // After the document is ready, so the seed is not written into a copy
        // that IndexedDB or the server is about to merge over.
        void whenDocumentReady().then(() => {
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
            nodes.forEach((node) => editor.createNode(node, { keepReactions: true }));
          });

          // A physics board primes the Forces bar for what it was built to show.
          const bar = useStore.getState();
          applyPhysicsPrimer(template.id, {
            setLastForce: bar.setLastForce,
            setForceRadiusScale: bar.setForceRadiusScale,
            setForceFalloff: bar.setForceFalloff,
            setForceLatch: bar.setForceLatch,
            setForceLatchSeconds: bar.setForceLatchSeconds,
            setGravityAngle: (deg) => physicsSettings.setGravityAngle(deg),
          });

          // And one short fade, so the board resolves into place rather than
          // being stamped onto the screen in a single frame.
          window.dispatchEvent(new CustomEvent('boardArriving'));
          /**
           * A greeting, not a confirmation, which is why it is the one notice
           * here that leaves by itself.
           *
           * It names the board you just opened and tells you it is editable,
           * and it has nothing to confirm — so leaving it pinned makes the
           * first thing you see on a new board a piece of chrome you have to
           * close. Six seconds is long enough to read a board's name twice at
           * a glance and short enough to be gone before anyone reaches for it.
           */
          notify({
            message: `${template.name} is on the board. Click anything to edit it.`,
            tone: 'info',
            duration: 6000,
          });
        });
      }
      return;
    }

    const text = takePendingRestore();
    if (!text) return;

    // A replace must run after the server's state has arrived, or what the
    // server held would merge back over it. Offline, it settles for the local
    // copy, which is all there is to replace.
    void whenDocumentReady().then(() => {
      const result = parseDocumentExport(text);
      if (!result.ok) {
        notify({ message: result.error, tone: 'error' });
        return;
      }
      const summary = restoreDocument(result.document, 'replace');
      /**
       * Pinned, unlike an ordinary confirmation: a restore replaces the whole
       * board, and the receipt must not vanish while you are still checking
       * what arrived against what you remember.
       */
      notify({
        message: `Restored ${summary.added} object${summary.added === 1 ? '' : 's'} from your backup.`,
        tone: 'success',
        duration: null,
      });
    });
  }, []);

  const [activeTool, setActiveTool] = useState('select');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const showContextToolbar = useStore((s) => s.showContextToolbar);
  // What this session is allowed to do. The write path enforces it; this is
  // what keeps the interface from offering what the write path will refuse.
  const { canEdit } = useRoomPermissions();
  // Mirrored into a ref on every render, for the window-level copy and cut
  // listeners that live for the room and must not re-register on every click.
  const selectionRef = useRef<string[]>([]);
  selectionRef.current = selectedIds;
  // Convenience accessors for the many panels that only ever make sense for a
  // single selected object (properties panel, floating toolbar, etc). When 0
  // or 2+ objects are selected these simply fall back to their empty state.
  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null;
  const setSelectedId = useCallback((id: string | null) => setSelectedIds(id ? [id] : []), []);
  const clearSelection = useCallback(() => setSelectedIds([]), []);
  // Edit cells belongs to the selected grid: Escape leaves it (the overlay
  // handles that), and so does selecting anything else or clicking empty board.
  useEffect(() => {
    const editing = gridEditMode.get().gridId;
    if (editing && !selectedIds.includes(editing)) gridEditMode.exit();
    // Grids outline the module that holds a selected object.
    selectionMirror.set(selectedIds);
  }, [selectedIds]);
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
  /** Whether the dialog was opened *about* the selection, or about the board. */
  const [exportFromSelection, setExportFromSelection] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [diagramOpen, setDiagramOpen] = useState(false);
  /**
   * The source the diagram editor opens with.
   *
   * Held here rather than derived inside the modal, because *what* it opens
   * with depends on the selection at the moment it is opened — a flowchart you
   * have selected becomes its own source, and everything else starts from the
   * example. Deciding that inside the modal would mean reading the selection
   * on every render of a dialog whose whole job is to be stable while you type.
   */
  const [diagramSource, setDiagramSource] = useState<string | undefined>(undefined);
  const [diagramReplacing, setDiagramReplacing] = useState<string | null>(null);
  /**
   * The exact objects an apply should clear, when there is no diagram id.
   *
   * A generated diagram is found by its shared id, but a flowchart drawn by
   * hand has none — and "edit this as code" on one has to replace *those*
   * objects, not add a second diagram beside them. Holding the ids covers both
   * cases without inventing an id for objects the user never asked to tag.
   */
  const [diagramReplaceIds, setDiagramReplaceIds] = useState<string[]>([]);
  const [contextTarget, setContextTarget] = useState<ContextTarget | null>(null);

  /**
   * The room does not subscribe to `objects`: every collaborator's edit would
   * re-render this whole tree. Handlers read the document when they run, and
   * the few views that need it live subscribe to it themselves.
   */
  const liveObjects = () => useStore.getState().objects;

  const {
    showToast,
    clipboardRef,
    copySelection,
    pasteObjects,
    pasteSvg,
    pasteText,
  } = useRoomClipboard({
    selectionRef,
    setSelectedIds,
  });

  const contextActions = useRoomContextMenuActions({
    selectedIds,
    setSelectedIds,
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
  });

  // The menu's shortcuts, bound to the menu's own actions. See the hook.
  useSelectionCommandKeys({
    actions: contextActions,
    selectedIds,
    canEdit,
    openMenu: setContextTarget,
  });




  /**
   * Open the diagram editor, seeded from the selection where there is one.
   *
   * A selected flowchart opens as its own source and updating replaces it; an
   * empty selection opens the example and adding creates a new one. The same
   * button therefore covers "write me a diagram" and "let me edit this
   * diagram", which are the same intention arriving from two directions.
   */
  /**
   * Drop a paragraph of placeholder copy, sized to itself.
   *
   * `resize: 'height'` rather than `fixed`: the box gets the measure that reads
   * well for that many words and then grows to whatever the text needs, so the
   * block is never clipped and never has slack under it. Selected on arrival,
   * because the next thing anyone does with a placeholder is move it or replace
   * its words.
   */
  const addTextBlock = useCallback((words: number) => {
    const box = demoBox(words);
    const centre = cameraSystem.screenToWorld(window.innerWidth / 2, window.innerHeight / 2);
    const id = editor.createNode({
      id: nanoid(),
      type: 'text',
      x: Math.round(centre.x - box.width / 2),
      y: Math.round(centre.y - box.height / 2),
      width: box.width,
      height: box.height,
      text: demoText(words),
      resize: 'height',
      typography: { ...DEFAULT_TYPOGRAPHY, fontSize: 16, lineHeight: 1.5 },
    });
    setSelectedIds([id]);
  }, []);

  // Stable, and reads the selection through its ref, so the dock it is handed
  // to does not re-render on every selection change.
  const openDiagram = useCallback(() => {
    const diagramObjects = liveObjects();
    const selected = selectionRef.current.map((id) => diagramObjects[id]).filter(Boolean);
    const existing = selected.find((n) => diagramIdOf(n));
    if (existing && canEmitDiagram(selected)) {
      // Everything sharing this diagram's id, not just what happens to be
      // selected — you can click one box of a diagram and still edit the whole
      // thing, which is what anyone would expect that click to mean.
      const id = diagramIdOf(existing)!;
      const whole = Object.values(diagramObjects).filter(
        (n) => diagramIdOf(n) === id
      );
      /**
       * Which kind of diagram this is, before writing it out.
       *
       * `diagramToMermaid` only knows how to write flowcharts, so pointing it
       * at a sequence diagram produced a flowchart made of lifelines and arrow
       * stubs -- and applying that replaced a correct diagram with the
       * nonsense. Editing was destructive on exactly the diagrams this feature
       * had just learned to draw.
       */
      setDiagramSource(
        (isSequenceDiagram(whole) ? sequenceToMermaid(whole) : null) ?? diagramToMermaid(whole)
      );
      setDiagramReplacing(id);
    } else if (isSequenceDiagram(selected)) {
      // A sequence diagram whose objects carry no id -- pasted, or a
      // generation whose tag was lost. Readable, but not claimed.
      setDiagramSource(sequenceToMermaid(selected) ?? undefined);
      setDiagramReplacing(null);
    } else if (canEmitDiagram(selected)) {
      // A flowchart drawn by hand has no diagram id, and reading it out as code
      // is most of the value here — so it seeds the editor without claiming
      // ownership of the objects it came from.
      setDiagramSource(diagramToMermaid(selected));
      setDiagramReplacing(null);
    } else {
      setDiagramSource(undefined);
      setDiagramReplacing(null);
    }
    setDiagramReplaceIds(existing || canEmitDiagram(selected) ? selected.map((n) => n.id) : []);
    setDiagramOpen(true);
  }, []);

  /**
   * Turn the editor's source into objects.
   *
   * A replace deletes the previous generation first, in the same transaction
   * as the new one. Two transactions would put an empty board into history
   * between them, so undo would land on the gap rather than on the diagram —
   * and every collaborator would watch the diagram vanish and reappear.
   */
  const applyDiagram = (source: string, options?: DiagramBuildOptions) => {
    const origin = cameraSystem.screenToWorld(window.innerWidth / 2, window.innerHeight / 2);
    const at = { x: Math.round(origin.x - 200), y: Math.round(origin.y - 140) };

    /**
     * Which kind of diagram this is, decided once and here.
     *
     * A flowchart is a graph and goes to dagre; a sequence diagram is a
     * timeline and goes to its own layout, for the reason `sequence.ts` opens
     * with. Both end at the same place -- a list of nodes and a shared id --
     * so everything below this point is common, and adding a third kind is a
     * branch here rather than a second copy of the replace-and-select logic.
     */
    const built = looksLikeSequence(source)
      ? (() => {
          const { diagram } = parseSequence(source);
          return diagram
            ? buildSequenceDiagram(diagram, at, diagramReplacing ?? undefined, options)
            : null;
        })()
      : looksLikePie(source)
        ? (() => {
            const { chart } = parsePie(source);
            return chart
              ? buildPieDiagram(chart, at, diagramReplacing ?? undefined, options)
              : null;
          })()
        : (() => {
            const { graph } = parseMermaid(source);
            return graph ? buildDiagram(graph, at, diagramReplacing ?? undefined, options) : null;
          })();
    if (!built) return;

    /**
     * What this apply replaces.
     *
     * A generated diagram is cleared by its shared id, which catches every part
     * of it whether or not it was selected. An explicitly-listed set — from
     * "Edit as Mermaid" on a hand-drawn flowchart — is cleared as given. The
     * union rather than one or the other, so editing a generated diagram that
     * has since had a box added by hand removes both.
     */
    const stale = Array.from(
      new Set([
        ...(diagramReplacing
          ? Object.values(liveObjects())
              .filter((n) => diagramIdOf(n) === diagramReplacing)
              .map((n) => n.id)
          : []),
        ...diagramReplaceIds,
      ])
    );

    doc.transact(() => {
      stale.forEach((id) => deleteNode(id));
      built.nodes.forEach((node) => editor.createNode(node));
    });
    setSelectedIds(built.nodes.map((n) => String(n.id)));
    setDiagramReplacing(built.diagramId);
    // The new generation carries an id, so the explicit list has done its job.
    setDiagramReplaceIds([]);
  };
  const [showShareModal, setShowShareModal] = useState(false);
  const [showTimeTravel, setShowTimeTravel] = useState(false);
  const [timeTravelSnapshot, setTimeTravelSnapshot] = useState<Record<string, any> | null>(null);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showInbox, setShowInbox] = useState(false);

  // The canvas reads comments too; both share one observer and one list.
  const { comments } = useComments();
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
   * Held here because three surfaces share one anchor above the dock, and only
   * one of them may occupy it at a time. The dock coach asks first; the
   * first-run guide and the lesson coach both take over once it has settled,
   * and the lesson coach wins over the guide when both apply.
   */
  /**
   * Whether the walkthrough has been settled, one way or the other.
   *
   * The lesson coach waits for it. A tour and a coach mark both explaining the
   * board at once is two voices, and the tour is the one that was asked for.
   */
  const tour = useSyncExternalStore(
    tourState.subscribe,
    tourState.getSnapshot,
    tourState.getSnapshot
  );
  const tourSettled = tour.seen && tour.step === null;

  /**
   * Arm the tool a walkthrough is about, the moment it starts.
   *
   * `Walkthrough.tool` has always said it was "the tool it arms when it
   * starts" and nothing read it, so the first step of every walkthrough had a
   * silent prerequisite it never mentioned: "drag from the edge of a box" is
   * not a thing you can do until the connector tool is armed, and the card
   * does not say to arm it — the whole point of the walkthrough is that you
   * are being shown rather than told.
   *
   * Here rather than in `HelpModal`, which is where a walkthrough is started
   * from, because this is where the armed tool actually lives. A dialog
   * reaching into `toolManager` directly would set the engine's tool and leave
   * the dock's highlight pointing at the old one.
   *
   * Keyed on the walkthrough itself so it fires once per start, not on every
   * step: re-arming on each advance would take the tool away from somebody who
   * had deliberately switched to Select to move what they had just made.
   */
  const walkStarted = useSyncExternalStore(
    walkthroughState.subscribe,
    walkthroughState.getSnapshot,
    walkthroughState.getSnapshot
  ).walk;

  useEffect(() => {
    if (walkStarted?.tool) setActiveTool(walkStarted.tool);
  }, [walkStarted]);

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
  /** A phone: the bottom bar, sheets instead of columns, and the compact selection bar. */
  const phone = usePhone();
  /**
   * A tablet in portrait floats its columns over the board, one at a time,
   * and a tap on the board puts them away. In landscape it docks them like a desktop.
   */
  const tablet = useDeviceClass() === 'tablet';
  // A landscape tablet has the width for docked panels, as a desktop does; only
  // a narrow window (a portrait tablet, a small laptop) floats them.
  const overlayPanels = isCompact;
  const oneColumn = phone || (tablet && isCompact);
  const [panelsOpen, setPanelsOpen] = useState(false);
  const panelsVisible = !overlayPanels || panelsOpen;

  /**
   * Whether each side panel is expanded, and whether the radar is showing.
   *
   * Persisted per origin, because this is a working preference rather than a
   * property of the board — the same call the tag filter and the comment read
   * marks make. A collaborator's screen must not change because you collapsed
   * your own inspector.
   *
   * ## Why all three now start closed
   *
   * They used to start open, on the argument that nothing should move for
   * anyone who liked the old layout. That was the right call at the time and it
   * is the wrong default for a first visit: two fixed 260px panels and a radar
   * spend most of a laptop window before anything is on the board, and what
   * they spend it on is a layer list with nothing in it and an inspector with
   * nothing selected. The first thing anybody sees is the canvas at half size,
   * surrounded by empty controls.
   *
   * Closed, the board opens at nearly full width and the three rails still say
   * what they are. The cost is that a newcomer might not learn what is behind
   * them, and that is paid for directly: `panel-properties` is offered the
   * first time something is selected and `panel-layers` once there is enough on
   * the board to be worth navigating. Teaching at the moment of use beats
   * showing an empty panel for ever in the hope it is noticed.
   *
   * Anybody who has already expressed a preference keeps it: the check is for
   * the stored value being `expanded`, so only a browser that has never been
   * told gets the new default.
   */
  const { roomId, status, metadata, awarenessUsers, synced } = useRoomState();
  const {
    left: leftExpanded,
    right: rightExpanded,
    setLeft: setLeftExpanded,
    setRight: setRightExpanded,
  } = useBoardPanels(roomId);
  const [radarOpen, setRadarOpen] = useState(
    () => storageGet('vega_radar') === 'expanded'
  );

  /**
   * Opening a panel is what "learned" means for a panel lesson.
   *
   * The coach retires a *tool* lesson by watching for a new object, which is a
   * loose test that costs nothing when it is wrong. Opening a panel makes
   * nothing, so that test can never fire, and these three call sites are the
   * exact answer instead. Three is affordable; sixteen, one per tool, would not
   * have been.
   *
   * The layers lesson covers the radar as well as the list, because both sit on
   * the left edge and both answer the same question, so either one satisfies it.
   */
  const openLayers = useCallback(() => {
    setLeftExpanded(true);
    learnState.learn('panel-layers');
  }, [setLeftExpanded]);
  const openProperties = useCallback(() => {
    setRightExpanded(true);
    learnState.learn('panel-properties');
  }, [setRightExpanded]);
  const openRadar = useCallback(() => {
    setRadarOpen(true);
    learnState.learn('panel-layers');
  }, []);
  useEffect(() => {
    storageSet('vega_radar', radarOpen ? 'expanded' : 'collapsed');
  }, [radarOpen]);




  // The theme class is applied once at the app root (App.tsx). This used to
  // assign `document.body.className` wholesale, which also clobbered any other
  // class on <body>.

  // Reflects AudioTool's actual recording state. Once recording finishes, is cancelled,
  // or errors out, automatically resets activeTool back to the default 'select' tool
  // so the user doesn't accidentally trigger another recording on subsequent clicks.
  const { isRecording, micError, setMicError } = useCanvasAudioRecording({
    onStop: () => {
      setActiveTool((current) => (current === 'audio' ? 'select' : current));
    },
    onError: () => {
      setActiveTool((current) => (current === 'audio' ? 'select' : current));
    },
  });
  // The pointer wears the recording state for as long as a voice note records.
  useEffect(() => {
    if (!isRecording) return;
    cursorHint.set('recording');
    return () => cursorHint.set('idle');
  }, [isRecording]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectTool = (tool: string) => {
    setActiveTool(tool);
    if (tool === 'image' && fileInputRef.current) {
      fileInputRef.current.accept = 'image/*';
      fileInputRef.current.click();
    }
  };

  /**
   * Frame the board when it opens, rather than inheriting the last one's view.
   *
   * `cameraSystem` is a module singleton and outlives a route change, so
   * without this, board B opened at board A's camera. See `useOpeningFrame`.
   */
  useOpeningFrame(roomId);

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
  useEffect(() => {
    if (!roomId) return;
    let t = 0;
    const write = () => {
      const objects = useStore.getState().objects;
      savePreview(
        roomId,
        buildPreview(Object.values(objects), previewColorOf, (node) => previewPointsOf(node, objects))
      );
    };
    // A store subscription rather than an effect over `objects`, so a board
    // change does not re-render this component just to schedule the write.
    const off = useStore.subscribe((state, prev) => {
      if (state.objects === prev.objects) return;
      window.clearTimeout(t);
      t = window.setTimeout(write, 2000);
    });
    t = window.setTimeout(write, 2000);
    return () => {
      off();
      window.clearTimeout(t);
    };
  }, [roomId]);


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
    storageSet('lastRoomId', roomId);

    // Uncapped, and merged with what is stored rather than rewritten, so no
    // board is ever dropped from the dashboard to make room for this one. The
    // invite it was opened through is kept, so the dashboard can act on the
    // board with the access this device actually has.
    const invite = currentInvite();
    rememberBoard({
      id: roomId,
      name: metadata?.name || localTitle || 'Untitled Workspace',
      lastAccessed: Date.now(),
      ...(invite && invite.roomId === roomId
        ? { invite: invite.token, role: invite.role, inviteExpires: invite.expiresAt }
        : {}),
    });
  }, [roomId, metadata?.name, localTitle]);

  /**
   * What this board looks like from outside it: the card its link unfurls
   * into when shared, and the browser tab — its name, and a mark on the icon
   * when comments are waiting.
   */
  const boardName = metadata?.name || localTitle || 'Untitled Workspace';
  useShareCard({ roomId, name: boardName, hidden: previewsHidden(metadata), synced, canEdit });
  useDocumentHead({ title: boardName, unread: unreadCount(comments, commentMarks, myAuthorId), indexable: false });

  // Title editing lives entirely in WorkspaceShell now, which holds its own
  // draft state and only calls back on commit — so this no longer needs to
  // guard against overwriting an in-progress edit.
  useEffect(() => {
    if (metadata?.name) setLocalTitle(metadata.name);
  }, [metadata?.name]);


  /**
   * Publish who I am, in a colour nobody else in this room is already using.
   *
   * ## Why this is not just `user.color`
   *
   * The stored colour is a hash of the user id, so two people collided at
   * exactly the rate the birthday problem says they would — with the old ten
   * colours, four people in a room made it likelier than not. And colour is
   * the *only* thing that says who somebody is on this board: a cursor, a
   * selection ring, an avatar, the layer panel's editing pill and the radar's
   * pings all carry the colour and no name. Two people sharing one is two
   * people merged into one on every surface at once.
   *
   * Nothing could have caught it, because a hash is a function of one person
   * and uniqueness is a property of a group — there was no code anywhere that
   * could see the group. Awareness can. `resolvePresenceColor` takes the
   * roster and returns a colour that converges without a coordinator; the
   * reasoning for why it converges is there rather than here.
   *
   * It re-runs on every roster change rather than only on join, which is the
   * point: a collision is created by somebody *else* arriving, and the person
   * who has to move is the one who was not there first.
   */
  const published = useRef<string | null>(null);
  useEffect(() => {
    if (!user) return;

    const mine = provider.awareness?.clientID ?? 0;
    const peers: ColorClaim[] = [];
    awarenessUsers.forEach((state: any, clientId: number) => {
      if (clientId === mine || !state?.user?.color) return;
      peers.push({ clientId, color: state.user.color });
    });

    const color = resolvePresenceColor(user.id, mine, peers);

    const identity = {
      // The persisted identity, not the per-session client id — this is what
      // `localAuthorId()` stamps on comments and nodes, and it has to survive
      // a reload or "your own" comment stops being yours. See mutations.ts.
      id: user.id,
      name: user.name,
      color,
    };

    /**
     * Compared as a whole, not by colour alone.
     *
     * The first version guarded on the resolved colour, because avoiding a
     * republish on every roster tick was the point — and that silently made
     * the profile editor do nothing. A rename changes `user.name` and leaves
     * the colour exactly where it was, so the guard swallowed the publish and
     * the new name never left this browser. A cache key has to cover
     * everything the value depends on.
     */
    const signature = JSON.stringify(identity);
    if (published.current === signature) return;
    published.current = signature;

    provider.awareness?.setLocalStateField('user', identity);
    // Awareness is ephemeral and never reaches the update log, so the same
    // identity is recorded in the document too. That is what lets Time Travel
    // name someone who joined and only edited — attribution used to require
    // having created a node.
    publishLocalIdentity(user.name, color);
  }, [user, awarenessUsers]);

  const handleSaveTitle = useCallback((t: string) => {
    // Blurring or hitting Enter with the field cleared saved an empty
    // string as the room's name, synced to every collaborator — the title
    // in the top bar became a blank, still-clickable-but-invisible span.
    const finalTitle = t.trim() || UNTITLED_BOARD;
    setLocalTitle(finalTitle);
    setBoardMetadata('name', finalTitle);
  }, []);

  // Stable handlers for the memoised header, so it re-renders only when what
  // it shows changes.
  const openShare = useCallback(() => setShowShareModal(true), []);
  const openBoardExport = useCallback(() => {
    setExportFromSelection(false);
    setShowExportMenu(true);
  }, []);
  const openHelp = useCallback(() => setShowHelp(true), []);
  const hideUi = useCallback(() => setIsUiVisible(false), []);
  const toggleTimeline = useCallback(() => setShowTimeTravel((v) => !v), []);
  /** "Show history" on an object opens Time Travel; the timeline takes the parked id on mount. */
  useEffect(() => {
    const open = () => setShowTimeTravel(true);
    window.addEventListener(OBJECT_HISTORY_EVENT, open);
    return () => window.removeEventListener(OBJECT_HISTORY_EVENT, open);
  }, []);
  const toggleInbox = useCallback(() => setShowInbox((v) => !v), []);
  const openCommands = useCallback(() => setShowCommandPalette(true), []);
  const collapseRight = useCallback(() => setRightExpanded(false), [setRightExpanded]);
  const collapseLeft = useCallback(() => setLeftExpanded(false), [setLeftExpanded]);
  const commentUnread = unreadCount(comments, commentMarks, myAuthorId);
  const commentMentioned = commentUnread > 0 && comments.some((t) => !t.resolved && mentionsMe(t, commentMarks, myAuthorId));

  /**
   * The board's frame, UI3-style: a left column, the canvas edge to edge, and a
   * right column. A column that is closed, or hidden on a narrow window, is a
   * pill in its top corner instead. See `boardLayout.ts`.
   */
  const leftOpen = isUiVisible && panelsVisible && leftExpanded;
  const rightOpen = isUiVisible && panelsVisible && rightExpanded && canEdit;
  usePublishBoardLayout(leftOpen, rightOpen);
  useRegionCycle();
  /** A pill's expand button. On a narrow window the panels float, so show them too. */
  const expandLeft = useCallback(() => {
    if (overlayPanels) setPanelsOpen(true);
    // A phone shows one sheet at a time.
    if (oneColumn) setRightExpanded(false);
    openLayers();
  }, [overlayPanels, oneColumn, setRightExpanded, openLayers]);
  const expandRight = useCallback(() => {
    if (overlayPanels) setPanelsOpen(true);
    if (oneColumn) setLeftExpanded(false);
    openProperties();
  }, [overlayPanels, oneColumn, setLeftExpanded, openProperties]);
  /** A phone's layers or properties sheet, put away. */
  const closePhoneSheets = useCallback(() => {
    setPanelsOpen(false);
    setLeftExpanded(false);
    setRightExpanded(false);
  }, [setLeftExpanded, setRightExpanded]);
  /**
   * The grid rail's "Grid settings": the one deliberate way the properties
   * panel opens for a grid. Selecting never does.
   */
  useEffect(() => {
    const onRequest = () => {
      expandRight();
      window.setTimeout(() => {
        document
          .querySelector<HTMLElement>('[data-section="grid-system"]')
          ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }, 120);
    };
    window.addEventListener(GRID_SETTINGS_EVENT, onRequest);
    return () => window.removeEventListener(GRID_SETTINGS_EVENT, onRequest);
  }, [expandRight]);
  /** Mod+\: both columns to pills and back, as UI3 does. */
  const togglePanelsCollapsed = useCallback(() => {
    if (overlayPanels) {
      setPanelsOpen((v) => !v);
      return;
    }
    const anyOpen = leftExpanded || (rightExpanded && canEdit);
    setLeftExpanded(!anyOpen);
    setRightExpanded(!anyOpen);
  }, [overlayPanels, leftExpanded, rightExpanded, canEdit, setLeftExpanded, setRightExpanded]);
  // Keyboard Shortcuts routed through dedicated useRoomShortcuts hook
  useRoomShortcuts({
    selectTool,
    selectedIds,
    setSelectedIds,
    setShowCommandPalette,
    setShowHelp,
    setIsUiVisible,
    isCompact: overlayPanels,
    panelsOpen,
    setPanelsOpen,
    activeTool,
    setActiveTool,
    openExport: (fromSelection: boolean) => {
      setExportFromSelection(fromSelection);
      setShowExportMenu(true);
    },
    togglePanelsCollapsed,
  });

  useEffect(() => {
    /**
     * Fetched when somebody exports, not when the board opens.
     *
     * `ExportService` reaches the SVG writer, the PDF writer and the raster
     * path behind them, which is 440kB. Naming it in a static import at the
     * top of this file put all of that in front of the first frame of every
     * board, to serve three menu items that most sessions never touch.
     */
    const handleExportPNG = async () => {
      // Find the Konva Stage reference. Assuming it's the first Stage created
      const stage = (window as any)._konva_stage;
      if (!stage) return;
      const { ExportService } = await import('./engine/export');
      ExportService.export('png', { stage });
    };
    const handleExportSVG = async () => {
      const { ExportService } = await import('./engine/export');
      ExportService.export('svg');
    };
    const handleExportJSON = async () => {
      const { ExportService } = await import('./engine/export');
      ExportService.export('json');
    };

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
      case 'code':
      case 'link':
        selectTool(actionId);
        break;

      case 'tidy': handleOrganize('smart'); break;
      case 'diagram': openDiagram(); break;
      case 'help': setShowHelp(true); break;
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

  const { dropActive, placeFiles } = useCanvasDropZone({
    roomId: roomId ?? 'global',
    status,
    setSelectedIds,
  });

  const handleMediaUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (fileInputRef.current) fileInputRef.current.value = '';
    await placeFiles(files);
    setActiveTool('select');
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

    /**
     * One paste handler, three kinds of payload.
     *
     * Order matters and is not arbitrary. A copy of our own objects is checked
     * first because it is the only unambiguous case; SVG next, because Figma
     * and Illustrator put the markup on the clipboard as *text* alongside a
     * rendered PNG, and taking the image would silently hand back a picture
     * when vector was available — the one failure that looks like success.
     * Files last, which is what a screenshot or a copied image is.
     */
    const onPaste = (e: ClipboardEvent) => {
      if (inTextField()) return;

      const text = e.clipboardData?.getData('text/plain') ?? '';

      const payload = parseClipboard(text);
      if (payload) {
        e.preventDefault();
        pasteObjects(payload);
        return;
      }

      if (looksLikeSvg(text)) {
        e.preventDefault();
        pasteSvg(text);
        return;
      }

      if (looksLikeMermaid(text)) {
        e.preventDefault();
        setDiagramSource(text);
        setDiagramReplacing(null);
        setDiagramReplaceIds([]);
        setDiagramOpen(true);
        notify('Opened Diagram from Code with pasted Mermaid');
        return;
      }

      const files = Array.from(e.clipboardData?.items ?? [])
        .filter((item) => item.kind === 'file')
        .map((item) => item.getAsFile())
        .filter((f): f is File => Boolean(f));
      if (files.length > 0) {
        e.preventDefault();
        // Pasted content has no position of its own, so it lands in the middle
        // of what you are looking at — which is where you were looking when you
        // decided to paste.
        void placeFiles(files);
        return;
      }

      if (text.trim()) {
        e.preventDefault();
        pasteText(text);
      }
    };

    /**
     * Copy and cut, from the same event the browser already gives us.
     *
     * Listening for `copy` rather than binding Cmd+C means the browser decides
     * what "copy" means — so it still does the right thing inside a text field,
     * on a native selection, and with whatever key the platform actually uses.
     */
    const onCopy = (e: ClipboardEvent) => {
      if (inTextField()) return;
      // The event is handed down so the payload is written *through* it,
      // synchronously, rather than by an async call racing the
      // `preventDefault` below. See `copySelection`.
      if (copySelection(e).written) e.preventDefault();
    };

    /**
     * Cut removes exactly what it copied, and nothing else.
     *
     * It used to copy the selection and then delete `selectionRef.current` —
     * two different sets, because `writeClipboard` refuses comment pins. Cutting
     * a selection that contained one therefore put everything *else* on the
     * clipboard and destroyed the pin along with it: silent data loss,
     * discovered only when the paste came back short.
     */
    const onCut = (e: ClipboardEvent) => {
      if (inTextField()) return;
      const { written, ids } = copySelection(e);
      if (!written || ids.length === 0) return;
      e.preventDefault();
      deleteNodesWithFrames(ids);
      setSelectedIds((current) => current.filter((id) => !ids.includes(id)));
    };

    window.addEventListener('copy', onCopy);
    window.addEventListener('cut', onCut);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('copy', onCopy);
      window.removeEventListener('cut', onCut);
      window.removeEventListener('paste', onPaste);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, placeFiles]);



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

  /**
   * A word at the moment the room empties.
   *
   * Focus mode is now reachable from the View menu, which fixes half the
   * problem — but the half that stranded people was never getting *in*, it
   * was that every panel vanishing looks like something went wrong, and
   * nothing on screen says the backslash key brings them back. The exit
   * control sits at a third opacity in a corner, deliberately quiet, which is
   * right for chrome and useless as a first explanation.
   *
   * So it is said once, when it is true, and then it leaves — the same shape
   * as the template greeting. Not shown for the physics room, where the
   * Forces bar is already on screen carrying its own Done.
   */
  const [focusHint, setFocusHint] = useState(false);
  const [focusHintLeaving, setFocusHintLeaving] = useState(false);
  useEffect(() => {
    if (isUiVisible || isForceTool(activeTool)) { setFocusHint(false); return; }
    setFocusHint(true);
    setFocusHintLeaving(false);
    const fade = window.setTimeout(() => setFocusHintLeaving(true), 3600);
    const drop = window.setTimeout(() => setFocusHint(false), 4020);
    return () => { window.clearTimeout(fade); window.clearTimeout(drop); };
  }, [isUiVisible, activeTool]);

  /**
   * Time Travel clears the room by itself, rather than asking you to.
   *
   * Physics enters its immersive mode only once you have *also* hidden the
   * chrome, because arming a force tool is still editing and the panels remain
   * useful. Replay is not: the canvas is showing a document from the past,
   * every tool is inert (`Canvas` gates on `isReplaying`), and the two side
   * panels are describing a moment you cannot edit. The supporting cast is
   * furniture for a job that is not merely deprioritised but impossible — so
   * entering replay hides it, and leaving puts back exactly what was there.
   *
   * The previous state is captured in a ref rather than derived, so closing
   * restores a hidden dock as hidden rather than helpfully revealing it.
   */
  const chromeBeforeReplay = useRef<boolean | null>(null);
  useEffect(() => {
    if (showTimeTravel) {
      if (chromeBeforeReplay.current === null) {
        chromeBeforeReplay.current = isUiVisible;
        setIsUiVisible(false);
      }
      return;
    }
    if (chromeBeforeReplay.current !== null) {
      setIsUiVisible(chromeBeforeReplay.current);
      chromeBeforeReplay.current = null;
    }
  }, [showTimeTravel, isUiVisible]);

  /** Drives the immersive treatment in CSS. See `[data-zen]` in `index.css`. */
  const zenPhysics = isForceTool(activeTool) && !isUiVisible;
  /**
   * The chrome is down while a presentation runs. Unmounting the columns, the
   * dock and the rail closes whatever they had open; the stylesheet hides the
   * rest of the page on the same state (see `framePresenter.css`).
   */
  const presenting = usePresenting();
  const chromeOn = isUiVisible && !presenting;
  useEffect(() => {
    // Replay wins when both could apply: you cannot arm a force while the
    // document on screen is a historical one.
    document.body.dataset.zen = showTimeTravel ? 'replay' : zenPhysics ? 'physics' : '';
    return () => { document.body.dataset.zen = ''; };
  }, [zenPhysics, showTimeTravel]);


  const handleOrganize = (mode: LayoutMode) => {
    const currentObjects = useStore.getState().objects;
    const targetPositions = calculateLayout(currentObjects, mode);
    animateToLayout(currentObjects, targetPositions);
  };

  if (!user) return <AuthModal />;

  return (
    <div className={`app-container ${isDarkTheme ? 'dark-theme' : 'light-theme'}`} style={{ width: '100%', height: '100vh', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden', background: 'var(--surface-primary)' }}>
      <RoomModals
        showShareModal={showShareModal}
        setShowShareModal={setShowShareModal}
        showExportMenu={showExportMenu}
        setShowExportMenu={setShowExportMenu}
        exportSelectionIds={selectedIds}
        exportFromSelection={exportFromSelection}
        localTitle={localTitle}
        contextTarget={contextTarget}
        setContextTarget={setContextTarget}
        diagramObjects={liveObjects()}
        contextActions={contextActions}
        canEdit={canEdit}
        showHelp={showHelp}
        setShowHelp={setShowHelp}
        diagramOpen={diagramOpen}
        setDiagramOpen={setDiagramOpen}
        diagramSource={diagramSource ?? ''}
        diagramReplacing={diagramReplacing}
        applyDiagram={applyDiagram}
        showCommandPalette={showCommandPalette}
        setShowCommandPalette={setShowCommandPalette}
        handleCommandPaletteAction={handleCommandPaletteAction}
      />
      
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

      {/* Connection state is announced by the header's own indicator, which
          carries `role="status"` and `aria-live` itself. A hidden twin here
          was a second wording of the same fact for a second audience — and the
          two had already drifted, one saying "saved locally" and the other
          "saved on this device". */}

      {/**
       * Everything the application says, in one place.
       *
       * This replaced three surfaces. Two of them were here: a transient toast
       * for what a paste produced, and an **offline banner in fifteen inline
       * style properties** that said, in different words, what the header's
       * sync dot was already saying four inches away.
       *
       * The banner is gone rather than restyled, because being offline is a
       * *state* and not an event: it does not happen at a moment you want to be
       * told about, it persists, and a notification that cannot be dismissed
       * and must not be missed is not a notification — it is a status light in
       * the wrong place. The header indicator owns it now and says more when
       * there is more to say.
       */}

      {/* LEFT COLUMN: the board (name, menu, save state) above its layers.
          First in the document, so focus runs left header, layers, canvas,
          right header, properties. Closed, it is a pill in the top-left. */}
      {chromeOn && (
        <>
          <BoardColumn
            side="left"
            open={leftOpen}
            onPin={expandLeft}
            panelLabel="Board and layers"
            pillLabel="Board"
            region={0}
            tour="layers"
            panelClassName="hierarchy-panel panel-surface"
            panelData={{ 'data-radar-collapsed': !radarOpen }}
            onClose={closePhoneSheets}
            sheetLabel="Layers"
            pill={(toggle) => (
              <BoardHeaderLeft
                variant="pill"
                toggle={toggle}
                localTitle={localTitle}
                setLocalTitle={setLocalTitle}
                onTitleSave={handleSaveTitle}
                isDarkTheme={isDarkTheme}
                setIsDarkTheme={setIsDarkTheme}
                onShareClick={openShare}
                onExportClick={openBoardExport}
                onHelpClick={openHelp}
                onHideUi={hideUi}
                onToggleTimeline={toggleTimeline}
                timelineOpen={showTimeTravel}
                onOpenCommands={openCommands}
              />
            )}
          >
            <BoardHeaderLeft
              variant="panel"
              localTitle={localTitle}
              setLocalTitle={setLocalTitle}
              onTitleSave={handleSaveTitle}
              isDarkTheme={isDarkTheme}
              setIsDarkTheme={setIsDarkTheme}
              onShareClick={openShare}
              onExportClick={openBoardExport}
              onHelpClick={openHelp}
              onHideUi={hideUi}
              onToggleTimeline={toggleTimeline}
              timelineOpen={showTimeTravel}
              onOpenCommands={openCommands}
            />
            <LayersPanel
              selectedIds={selectedIds}
              setSelectedId={setSelectedId}
              setSelectedIds={setSelectedIds}
              overrideObjects={timeTravelSnapshot}
              onCollapse={phone ? undefined : collapseLeft}
            />
            <PanelWidthHandle />
          </BoardColumn>
          <GroupIsolationBar />
        </>
      )}


      {/* TIMELINE / SESSION REPLAY OVERLAY */}

      {/* CANVAS AREA (Core Render Engine) */}
      <div
        id="canvas-surface"
        data-region="1"
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
        {chromeOn && (radarOpen ? (
          <Minimap onCollapse={() => setRadarOpen(false)} onHelp={openHelp} />
        ) : (
          // Zoom and help stay on screen beside the pill; see `BoardFoot`.
          <div className="radar-collapsed" style={{ position: 'absolute', left: 16, bottom: 24, zIndex: 90 }}>
            <button
              type="button"
              className="radar-summon"
              data-tour="radar"
              onClick={openRadar}
              aria-label="Show the radar"
              data-tooltip="The whole board, and everyone on it"
              data-tooltip-pos="right"
            >
              <Radar size={15} />
              Radar
            </button>
            <BoardFoot onHelp={openHelp} />
          </div>
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

        {/* Deliberately outside `isUiVisible`, for the same reason the remote
            cursors are: this is not chrome. Following takes control of the
            camera, and a canvas that moves on its own with nothing on screen
            to explain it reads as a broken app — presentation mode most of
            all, where it would be least expected. */}
        <FollowIndicator />

        {/* The return path: who is watching *you*, and anyone asking to be
            watched. Outside `isUiVisible` for exactly the reason above — it is
            people, not chrome — and never more so than in presentation mode,
            which is where knowing you have an audience matters most. */}
        <PresenceStage />

        {/* Teaches the core gesture on a blank canvas, and gets out of the way
            the moment anything exists. */}
        <EmptyBoardHints visible={chromeOn && !timeTravelSnapshot} />
        
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
          onRequestContextMenu={setContextTarget}
        />
        
        <Suspense fallback={null}>
          {showTimeTravel && (
            <TimeTravelBar
              roomId={roomId}
              onClose={() => { setShowTimeTravel(false); applyReplaySnapshot(null); setTimeTravelSnapshot(null); }}
              onApplySnapshot={(snap, changedIds, listed) => { applyReplaySnapshot(snap, changedIds); setTimeTravelSnapshot(listed ?? snap); }}
            />
          )}
        </Suspense>
        
        <IconBrowserHost />

        <Suspense fallback={null}>
          {isForceTool(activeTool) && (
            <ForcesBar
              activeForce={activeTool as ForceId}
              onPickForce={(id) => setActiveTool(id)}
              onExit={() => setActiveTool('select')}
              onCalm={() => window.dispatchEvent(new CustomEvent('physics-calm'))}
              selectedCount={selectedIds.length}
            />
          )}
        </Suspense>
      </div>

      {/* FLOATING CONTEXT TOOLBAR — switchable from the View menu.
          Gated on `canEdit` as well: every control on it (fill, stroke, bold,
          italic, the shape swapper) is an edit, so for a viewer it is a rail
          of buttons that cannot do anything. The write path refuses them
          regardless -- see `mutations.ts` -- and this is the half that stops
          somebody pressing them and wondering. */}
      {showContextToolbar && canEdit && !presenting && phone && (
        <PhoneContextBar
          selectedId={selectedId}
          selectedIds={selectedIds}
          menuActions={contextActions}
          onEdit={expandRight}
          editing={rightOpen}
        />
      )}
      {showContextToolbar && canEdit && !presenting && !phone && (
        <ObjectContextToolbar
          selectedId={selectedId}
          selectedIds={selectedIds}
          onDeselect={clearSelection}
          sidebarsVisible={isUiVisible}
          menuActions={contextActions}
        />
      )}

      {/* TOOL WORKSPACE (Dynamic Dock) */}
      {chromeOn && (
        <ToolWorkspace activeToolId={activeTool} onOpenDiagram={openDiagram} onAddTextBlock={addTextBlock} />
      )}

      {/* Scrim — only while the panels float above the canvas, so tapping the
          canvas dismisses them instead of leaving them covering the work. */}
      {chromeOn && overlayPanels && panelsOpen && !phone && (
        <button
          className="panel-scrim"
          aria-label="Close panels"
          onClick={() => setPanelsOpen(false)}
        />
      )}

      {/* COMMENT INBOX — every thread in the room, in one list.
          Sits above the Properties panel rather than beside it: both own the
          right-hand column, and two 300px columns leave no canvas. */}
      {chromeOn && showInbox && !phone && (
        <LiveCommentInbox
          threads={comments}
          marks={commentMarks}
          myAuthorId={myAuthorId}
          onClose={() => setShowInbox(false)}
          onOpenThread={(thread) => {
            const at = anchorPoint(
              thread,
              thread.objectId ? liveObjects()[thread.objectId] : null
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
      {/* On a phone the inbox is a full-height sheet. */}
      {chromeOn && phone && (
        <BottomSheet open={showInbox} onClose={() => setShowInbox(false)} label="Comments" headless snaps={['full']} className="phone-comments-sheet">
          <LiveCommentInbox
            threads={comments}
            marks={commentMarks}
            myAuthorId={myAuthorId}
            onClose={() => setShowInbox(false)}
            onOpenThread={(thread) => {
              // The sheet covers the board; the thread opens on it.
              setShowInbox(false);
              const at = anchorPoint(
                thread,
                thread.objectId ? liveObjects()[thread.objectId] : null
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
        </BottomSheet>
      )}

      {/* CONTEXT INSPECTOR (Right Sidebar)
          Editors only. The panel is an inspector *for editing* -- fill,
          stroke, type, transform, effects -- and with the write path refusing
          a viewer's changes, every control in it would be one that looks live
          and does nothing. A viewer keeps the board, the minimap and the
          comments; they lose a column of dead switches and get the width
          back. */}
      {/* RIGHT COLUMN: who is here and how work leaves, above Properties.
          Viewers have no properties to change, so for them it is always the
          pill. Closed, it is a pill in the top-right. */}
      {chromeOn && (
        <BoardColumn
          side="right"
          open={rightOpen}
          canOpen={canEdit}
          onPin={expandRight}
          panelLabel="People and properties"
          pillLabel="People"
          region={3}
          tour="properties"
          panelClassName="context-inspector panel-surface"
          onClose={closePhoneSheets}
          sheetLabel="Properties"
          sheetSnaps={['peek', 'half', 'full']}
          sheetInitialSnap="half"
          pill={(toggle) => (
            <BoardHeaderRight
              variant="pill"
              toggle={toggle}
              onShareClick={openShare}
              onToggleTimeline={toggleTimeline}
              onToggleComments={toggleInbox}
              commentsOpen={showInbox}
              timelineOpen={showTimeTravel}
              commentUnread={commentUnread}
              commentMentioned={commentMentioned}
            />
          )}
        >
          <BoardHeaderRight
            variant="panel"
            onShareClick={openShare}
            onToggleTimeline={toggleTimeline}
            onToggleComments={toggleInbox}
            commentsOpen={showInbox}
            timelineOpen={showTimeTravel}
            commentUnread={commentUnread}
            commentMentioned={commentMentioned}
          />
          <PropertiesPanel
            selectedIds={selectedIds}
            overrideObjects={timeTravelSnapshot}
            onCollapse={phone ? undefined : collapseRight}
          />
        </BoardColumn>
      )}

      {/* What this product is for is said on the way in, on the auth screen's
          other half, while somebody types their name. There used to be a
          three-beat card here saying the same three things one screen later,
          which put an interruption on the one surface whose whole promise is
          not being interrupted, and said it twice. See `AuthShowcase`. */}

      {/**
        * Two cards used to sit here and both have gone.
        *
        * `DockCoach` asked, the first time anything appeared on a board,
        * whether you wanted a frame to design into. `FirstRunGuide` then
        * offered two more things worth knowing. Both were written before there
        * was a walkthrough, and once there was one they became the third and
        * fourth card to interrupt somebody in their first two minutes -- the
        * second and third arriving, annoyingly, on the single act of putting a
        * shape down.
        *
        * Everything they taught is still taught, at a better moment.
        *
        * - Frames: the `frame-page` lesson, which arrives when you pick up the
        *   frame tool. That is the moment the question "should this be a frame"
        *   is actually being asked, rather than a moment chosen for you.
        * - Bringing somebody in: step five of the tour, which points at the
        *   Share button rather than describing where it is.
        * - Focus mode: the view menu, the reference under Navigation, and the
        *   key itself, which is the one thing on that list a card was never
        *   going to make more memorable.
        *
        * The rule this leaves behind is worth keeping: a first run gets **one**
        * offer, it is made once, and declining it is as final as accepting it.
        */}

      {/**
        * The gesture a tool cannot describe, offered when the tool is picked up
        * and retired the moment it is used. It reads the same lesson list the
        * help screen does, so the canvas and the reference cannot teach one
        * gesture two different ways.
        *
        * All three coaching surfaces share the band above the dock, and the
        * order they resolve in is deliberate rather than incidental.
        *
        * The dock question comes first and settles for good, so this and the
        * first-run guide both simply wait one answer for it.
        *
        * This and the guide can then both be true at once, and this one wins:
        * the guide is about the product, this is about the tool now in your
        * hand, and somebody who has just armed the grid tool is asking the
        * second question. It is rendered *after* the guide so the stylesheet
        * can say that in one rule -- see `.guide:has(~ .coach)`.
        */}
      <LessonCoach activeTool={activeTool} visible={chromeOn && tourSettled} />

      {/**
        * The same lesson, performed rather than read.
        *
        * Rendered *after* the coach mark so the stylesheet can stand the coach
        * down while this is up -- `.coach:has(~ .walk)` -- for the reason the
        * guide does the same above. Two cards teaching one tool at once, only
        * one of which is counting what you do, is the surface existing twice.
        *
        * It takes the selection because a step can be about what is picked
        * rather than about what was made, and `selectedIds` lives here.
        */}
      <WalkthroughGuide selectedIds={selectedIds} visible={chromeOn && tourSettled} />

      {/**
        * Where things live, pointed at rather than described.
        *
        * The offer shares the band above the dock with everything else that
        * coaches, so it waits for the dock question like they do and stands
        * down once anything else is up. The tour itself is not in that band at
        * all: it portals to the body and travels the whole screen, which is
        * the point of it.
        */}
      {/**
        * Offered on arrival, including on a board with nothing on it.
        *
        * It used to wait for the dock question *and* for the board to have an
        * object on it, which made it unreachable on exactly the screen it is
        * for: the dock coach only appears once something exists, so somebody
        * who opened a new board and looked around was offered nothing at all
        * and had no way to find the tour but the reference panel's footer.
        *
        * An empty board is the best moment for it, not the worst. There is
        * nothing to interrupt, nothing to lose, and every question a person has
        * at that moment is "where is anything". `EmptyBoardHints` sits in the
        * middle of the canvas and this sits above the dock, so the two do not
        * collide.
        */}
      <TourOffer visible={chromeOn} />
      <TourGuide />

      {/* FOCUS MODE.
          It used to be a light switch: every surface dropped at once, leaving
          a "Show UI" button and a permanent hint pill sitting on the artwork.
          That is an off switch, not a focus mode — changing tool meant turning
          the whole interface back on.

          Now the board is the whole screen and the tools come back when you
          reach for them. The grabber at the bottom edge is what stops that
          being a secret: an invisible hot zone is not an affordance, it is
          folklore. */}
      {/* Not in the physics room, and not in the history room either.

          The dock's whole job there would be to leave the mode, which Done
          and Escape already do — and it reveals itself from the bottom edge,
          which is precisely where the Forces bar now sits. Two panels fighting
          for the same thirty pixels, one of which appears on hover, is a way
          to make the instrument feel unreliable.

          Replay has the same collision and a stronger reason on top of it:
          every tool in the dock is inert while a historical document is on
          screen, so revealing it offers eleven controls that will not do
          anything. An affordance that does nothing when used is worse than no
          affordance. */}
      {focusHint && !showTimeTravel && (
        <div className={`focus-hint${focusHintLeaving ? ' is-leaving' : ''}`} role="status">
          Panels hidden. Press <kbd>\</kbd> to bring them back.
        </div>
      )}

      {!isUiVisible && !presenting && !zenPhysics && !showTimeTravel && (
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
            <ToolWorkspace activeToolId={activeTool} onOpenDiagram={openDiagram} onAddTextBlock={addTextBlock} />
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
