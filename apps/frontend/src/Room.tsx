import { nanoid } from 'nanoid';
import React, { useState, useRef, useEffect, useSyncExternalStore, Suspense, lazy } from 'react';
import { Canvas } from './components/Canvas';
import { AuthModal } from './components/AuthModal';
import { WorkspaceShell } from './components/workspace/WorkspaceShell';
import { ToolWorkspace } from './components/workspace/ToolWorkspace';
import { takePendingRestore, takePendingTemplate } from './engine/export/pendingRestore';
import { templateById } from './engine/templates/templates';
import { parseDocumentExport } from './engine/export/DocumentImport';
import { restoreDocument } from './engine/export/restoreDocument';
import { Minimap } from './components/Minimap';
import { PanelRail } from './components/workspace/PanelRail';
import { Eye, Radar, X } from 'lucide-react';
import { ObjectContextToolbar } from './components/ObjectContextToolbar';
import { PropertiesPanel } from './components/PropertiesPanel';
import { LayersPanel } from './components/LayersPanel';
import { useAuth } from './hooks/useAuth';
import { doc, provider, metadataMap, deleteNode, applyNodePatches, nextZIndex, lowestZIndex, localAuthorId, publishLocalIdentity, applyGroupPlan } from './engine/document';
import { useRoomState } from './hooks/useSync';
import { useOpeningFrame } from './hooks/useOpeningFrame';
import { resolvePresenceColor, type ColorClaim } from './engine/presence/ColorPalette';
import { initSyncBridge, useStore } from './hooks/useStore';
import { breakApartGrid } from './engine/grid/gridApply';
import { flattenToPath, textToPath } from './engine/document/vectorOps';
import { pathEdit } from './engine/interaction/pathEdit';
import { editor } from './engine/api/EditorAPI';
import { alignSelection, distributeSelection, type AlignEdge, type DistributeAxis } from './engine/model/align';
import { emptyGroups } from './engine/model/groupTree';
import { ActivityFeed } from './components/ActivityFeed';
import { PresenceEdgeMarkers } from './components/PresenceEdgeMarkers';
import { FollowIndicator } from './components/FollowIndicator';
import { ExportService, exportScope, scopeOptions } from './engine/export';
import { lineEdit } from './engine/interaction/lineEdit';
import { swapShapeKind } from './engine/model/shapeSwap';
import { isLineLike } from './engine/model/lineEnds';
import { isForceTool, type ForceId } from './engine/physics/forces';
import { calculateLayout, animateToLayout, type LayoutMode } from './utils/spatialLayout';
import { Mic, TriangleAlert } from 'lucide-react';
import { RemoteCursors } from './engine/cursor';
import type { ContextTarget } from './components/CanvasContextMenu';
import { RoomModals } from './components/workspace/RoomModals';
import { useRoomShortcuts } from './hooks/useRoomShortcuts';
import { useCanvasAudioRecording } from './hooks/useCanvasAudioRecording';
import { useCanvasDropZone } from './hooks/useCanvasDropZone';

const TimeTravelBar = lazy(() => import('./components/TimeTravelBar').then((m) => ({ default: m.TimeTravelBar })));
const ForcesBar = lazy(() => import('./components/ForcesBar').then((m) => ({ default: m.ForcesBar })));
import { parseMermaid } from './engine/diagram/mermaid';
import { buildDiagram, canEmitDiagram, diagramIdOf, diagramToMermaid } from './engine/diagram/build';
import { demoBox, demoText } from './engine/text/demoText';
import { deleteNodesWithFrames } from './engine/interaction/frameMembership';
import {
  offsetOrigin,
  parseClipboard,
  pasteNodes,
  writeClipboard,
  type ClipboardPayload,
} from './engine/clipboard/clipboard';
import { importSvg, looksLikeSvg } from './engine/clipboard/svgImport';
import { createPastedTextNode } from './engine/clipboard/externalText';
import { DEFAULT_TYPOGRAPHY, type AnyNode, type ShapeGeometry, type ShapeKind } from './engine/model/schema';
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
  const showContextToolbar = useStore((s) => s.showContextToolbar);
  // Mirrored into a ref on every render, for the window-level copy and cut
  // listeners that live for the room and must not re-register on every click.
  const selectionRef = useRef<string[]>([]);
  selectionRef.current = selectedIds;
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
   * Objects copied for an in-app paste.
   *
   * Held in a ref rather than state: nothing renders from it, and putting it in
   * state would re-render the whole room on a copy — which is the one moment
   * the user is expecting nothing to happen at all.
   */
  /**
   * A short, self-clearing confirmation.
   *
   * Paste is the one gesture in this app whose result can be off screen — an
   * SVG converts to twelve objects, or to nine with the text left out, and
   * without a word about it the difference between "worked" and "partly
   * worked" is something you have to go and check. `role="status"` so it is
   * announced as well as shown.
   */
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<number | undefined>(undefined);
  const showToast = React.useCallback((message: string) => {
    window.clearTimeout(noticeTimer.current);
    setNotice(message);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 3200);
  }, []);
  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);

  /** The last copy, so the menu can say whether there is anything to paste. */
  const clipboardRef = useRef<ClipboardPayload | null>(null);

  /**
   * What the right-click menu can do.
   *
   * Built here rather than inside the menu because every one of these already
   * exists somewhere in this room — the menu is a second *route* to them, not a
   * second implementation, and a menu that re-implemented copy would be a copy
   * that could drift from the keyboard's.
   */
  /**
   * Copy, paste and SVG paste — one implementation, reached three ways.
   *
   * The keyboard, the right-click menu and the object toolbar all end up here.
   * The menu used to carry its own copy that kept nodes in a ref: it could not
   * cross a tab, did not survive a reload, and — the real defect — regenerated
   * ids without rewriting the references between them, so a pasted flowchart's
   * arrows stayed attached to the *originals*. Dragging the copy left its
   * arrows behind.
   */
  const copySelection = (): boolean => {
    const nodes = selectionRef.current
      .map((id) => diagramObjects[id])
      .filter(Boolean) as AnyNode[];
    const payload = writeClipboard(nodes);
    if (!payload) return false;

    clipboardRef.current = payload;
    /**
     * Written to the real clipboard as well as remembered here.
     *
     * The in-memory copy is what makes the context menu's "Paste" able to say
     * whether there is anything to paste without asking for clipboard read
     * permission; the system write is what makes the paste work in another tab
     * at all. Failure is ignored on purpose — a denied clipboard permission
     * should degrade to same-tab copy, not report an error for a gesture that
     * visibly worked.
     */
    void navigator.clipboard?.writeText?.(JSON.stringify(payload)).catch(() => {});
    return true;
  };

  /** Where a paste lands when nothing more specific says otherwise. */
  const viewportCentre = () =>
    cameraSystem.screenToWorld(window.innerWidth / 2, window.innerHeight / 2);

  const pasteObjects = (payload: ClipboardPayload, at?: { x: number; y: number }) => {
    // No explicit point means the same board, so it offsets from the originals
    // rather than landing on top of them and looking like nothing happened.
    const target = at ?? offsetOrigin(payload);
    const { nodes, ids, groups } = pasteNodes(payload, target, useStore.getState().groups);
    if (nodes.length === 0) return;
    doc.transact(() => {
      // Folders first: the nodes about to be created point at them, and a
      // peer observing the transaction should never see a node whose group
      // has not arrived.
      for (const record of groups) applyGroupPlan({ nodes: [], groups: [], create: record, remove: [] });
      nodes.forEach((node) => editor.createNode(node as never));
    });
    setSelectedIds(ids);
    showToast(`Pasted ${ids.length} object${ids.length === 1 ? '' : 's'}`);
  };

  const pasteSvg = (text: string) => {
    const art = importSvg(text);
    if (!art) {
      showToast('That SVG could not be read');
      return;
    }
    // Centred on the view, so pasted artwork arrives where you are looking
    // rather than at whatever coordinates the exporting tool used.
    const centre = viewportCentre();
    const originX = centre.x - art.width / 2;
    const originY = centre.y - art.height / 2;

    const made: string[] = [];
    doc.transact(() => {
      art.nodes.forEach((node) => {
        const id = nanoid();
        made.push(id);
        editor.createNode({
          ...node,
          id,
          x: (node.x as number) + originX,
          y: (node.y as number) + originY,
        } as never);
      });
    });
    setSelectedIds(made);

    /**
     * What arrived, and what did not.
     *
     * Naming the skipped elements is the whole difference between a converter
     * and a black box: text and embedded images are the two people notice
     * missing, and being told beats comparing two pictures by eye.
     */
    const noun = `${made.length} object${made.length === 1 ? '' : 's'}`;
    showToast(
      art.skipped.length > 0
        ? `Pasted ${noun}. Not converted: ${art.skipped.join(', ')}`
        : `Pasted ${noun} from SVG`
    );
  };

  const pasteText = (rawText: string, at?: { x: number; y: number }) => {
    const centre = at ?? viewportCentre();
    const node = createPastedTextNode(rawText, centre);
    if (!node) return;
    editor.createNode(node as never);
    setSelectedIds([node.id]);
    showToast('Pasted text');
  };

  const contextActions = {
    copy: () => { void copySelection(); },
    paste: async () => {
      const at = contextTarget
        ? cameraSystem.screenToWorld(contextTarget.x, contextTarget.y)
        : cameraSystem.screenToWorld(window.innerWidth / 2, window.innerHeight / 2);
      const payload = clipboardRef.current;
      if (payload) {
        // Pasted relative to the click, keeping the group's own arrangement —
        // stacking them all on the pointer would destroy the thing that made
        // them worth copying together.
        pasteObjects(payload, at);
        return;
      }
      try {
        const text = await navigator.clipboard?.readText?.();
        if (!text) return;
        const externalPayload = parseClipboard(text);
        if (externalPayload) {
          pasteObjects(externalPayload, at);
          return;
        }
        if (looksLikeSvg(text)) {
          pasteSvg(text);
          return;
        }
        if (text.trim()) {
          pasteText(text, at);
        }
      } catch {
        // Clipboard read permission might be denied
      }
    },
    /**
     * Duplicate is a copy and a paste that never touch the clipboard.
     *
     * It used to spread `...node` and change only the id, which carried
     * **`parentId`** through unchanged — and `parentId` is the synthetic id
     * that *is* the group. So duplicating a group's members produced members of
     * the same group: the copy landed inside the original, and the two moved
     * together from then on. The same spread kept `frameId`, so a duplicate
     * also claimed membership of a frame it had just been offset out of, and
     * left connector ends pointing at the originals.
     *
     * Going through the clipboard's own remapping fixes all three at once and
     * means duplicate, paste and cross-tab paste cannot drift apart — which is
     * exactly how they came to disagree in the first place.
     */
    duplicate: () => {
      const nodes = selectedIds.map((id) => diagramObjects[id]).filter(Boolean) as AnyNode[];
      const payload = writeClipboard(nodes);
      if (!payload) return;
      pasteObjects(payload, offsetOrigin(payload));
    },
    remove: () => {
      deleteNodesWithFrames(selectedIds);
      setSelectedIds([]);
    },
    bringToFront: () => {
      const top = nextZIndex();
      applyNodePatches(selectedIds.map((id, i) => ({ id, changes: { zIndex: top + i } })));
    },
    sendToBack: () => {
      const bottom = lowestZIndex();
      applyNodePatches(selectedIds.map((id, i) => ({ id, changes: { zIndex: bottom - selectedIds.length + i } })));
    },
    selectAll: () => setSelectedIds(Object.keys(diagramObjects)),
    selectAllOfType: () => {
      const type = diagramObjects[selectedIds[0]]?.type;
      if (!type) return;
      setSelectedIds(Object.values(diagramObjects).filter((n) => n.type === type).map((n) => n.id));
    },
    /**
     * Copy what is selected — or the board, when nothing is.
     *
     * ## What these two lost
     *
     * Each of them used to work out its own scope inline, with the same
     * ternary written twice, and neither said anything afterwards. A clipboard
     * write fails for four ordinary reasons — an insecure context, a browser
     * with no `ClipboardItem`, a denied permission, a render that threw — and
     * in every one of them the menu closed, nothing was copied, and the next
     * paste produced whatever had been on the clipboard beforehand. A copy that
     * silently does nothing is worse than one that refuses, because the failure
     * surfaces somewhere else entirely.
     *
     * `exportScope` now answers "what does this cover, and what is it called"
     * once, for the label as well as for the copy, so the menu item and the
     * toast cannot describe different things from what the file contains.
     */
    copyPng: async (ids: string[]) => {
      const scope = exportScope(diagramObjects, ids, localTitle);
      const result = await ExportService.copy('png', {
        ...scopeOptions(scope),
        stage: (window as any)._konva_stage,
      });
      showToast(result.ok ? `Copied ${scope.subject} as PNG` : result.message!);
    },
    copySvg: async (ids: string[]) => {
      const scope = exportScope(diagramObjects, ids, localTitle);
      const result = await ExportService.copy('svg', scopeOptions(scope));
      showToast(result.ok ? `Copied ${scope.subject} as SVG` : result.message!);
    },
    /**
     * The export dialog, opened already pointing at the selection.
     *
     * Everything it offers — six formats, four densities, a background, a live
     * preview — already worked on a selection; there was simply no way to say
     * "this" from the canvas. The dialog's Region control had `Whole canvas`
     * and a list of frames, so exporting three chosen objects meant framing
     * them by hand first.
     */
    exportSelection: (ids: string[]) => {
      // The dialog opens pointing at whatever the menu was about, which is not
      // always the live selection -- right-clicking bare board leaves a
      // selection standing and means "the board".
      setExportFromSelection(ids.length > 0);
      setShowExportMenu(true);
    },
    /**
     * The selection as Mermaid, on the clipboard.
     *
     * Reads whatever is selected rather than only what this feature generated —
     * a flowchart drawn box by box is exactly the case where getting code out
     * is worth the most, and it is the case a "regenerate from source" check
     * would have excluded.
     */
    copyMermaid: () => {
      const selected = selectedIds.map((id) => diagramObjects[id]).filter(Boolean);
      if (!canEmitDiagram(selected)) return;
      void navigator.clipboard.writeText(diagramToMermaid(selected));
    },
    /**
     * The same source, in the editor instead of the clipboard.
     *
     * Applying replaces the objects it came from rather than adding a second
     * copy beside them, which is what makes this "edit" — the diagram id is
     * seeded from the selection so `applyDiagram` knows what to clear.
     */
    editMermaid: () => {
      const selected = selectedIds.map((id) => diagramObjects[id]).filter(Boolean);
      if (!canEmitDiagram(selected)) return;
      setDiagramSource(diagramToMermaid(selected));
      setDiagramReplacing(diagramIdOf(selected.find((n) => diagramIdOf(n)) ?? selected[0]) ?? null);
      setDiagramReplaceIds(selected.map((n) => n.id));
      setDiagramOpen(true);
    },
    /**
     * The four structural commands the menu was missing entirely.
     *
     * They existed on the floating toolbar and nowhere else, so the menu was
     * not a smaller version of it but a differently-shaped one — and which
     * commands you could reach depended on where you asked. `resolveAffordances`
     * now decides *whether* each belongs on a given selection; these decide
     * what it does. One transaction each, so a lock across nine objects is one
     * undo step rather than nine.
     */
    group: () => { if (selectedIds.length > 1) editor.groupNodes(selectedIds); },
    ungroup: () => { if (selectedIds.length > 0) editor.ungroupNodes(selectedIds); },
    /**
     * Open the selected line for point editing.
     *
     * The same entry point as double-click and Enter — three ways in, because
     * the two gestures are invisible and this is the one place someone looking
     * for the feature will actually look.
     */
    editLinePoints: () => {
      const only = selectedIds.length === 1 ? diagramObjects[selectedIds[0]] : null;
      if (only && isLineLike(only) && !only.locked) lineEdit.begin(only.id);
    },
    'to-path': () => {
      if (selectedIds.length !== 1) return;
      const target = diagramObjects[selectedIds[0]];

      // Selected and opened for editing, because converting is something you do
      // in order to edit -- landing on the old selection would make the command
      // look like it did nothing.
      const land = (newId: string) => {
        setSelectedIds([newId]);
        pathEdit.enter(newId);
        window.dispatchEvent(new CustomEvent('legacy_tool_change', { detail: 'direct-select' }));
      };

      /**
       * Text takes the long way round: its letterforms live in the font file,
       * which has to be fetched and parsed, so the command is asynchronous and
       * can fail for reasons worth telling somebody about.
       */
      if (target?.type === 'text') {
        textToPath(selectedIds[0])
          .then((result) => {
            if (!result) {
              showToast('There are no letters in that box to outline');
              return;
            }
            land(result.id);
            // Named rather than silently lost: an underline is drawn by the
            // renderer, not by the font, and inventing bars for it here would
            // be a second implementation of the same decoration.
            if (result.dropped.length > 0) {
              showToast(`Outlined — ${result.dropped.join(', ')} could not come along`);
            }
          })
          .catch((error: unknown) => {
            showToast(error instanceof Error ? error.message : 'That text could not be outlined');
          });
        return;
      }

      const newId = flattenToPath(selectedIds[0]);
      if (newId) land(newId);
    },
    'break-apart': () => {
      if (selectedIds.length !== 1) return;
      const ids = breakApartGrid(selectedIds[0]);
      // Selected, because the point of converting is to edit what comes out,
      // and landing on an empty selection means finding it again first.
      if (ids.length > 0) setSelectedIds(ids);
    },
    align: (edge: AlignEdge) => {
      const nodes = selectedIds.map((id) => diagramObjects[id]).filter(Boolean) as AnyNode[];
      applyNodePatches(alignSelection(nodes, edge));
    },
    distribute: (axis: DistributeAxis) => {
      const nodes = selectedIds.map((id) => diagramObjects[id]).filter(Boolean) as AnyNode[];
      applyNodePatches(distributeSelection(nodes, axis));
    },
    toggleLock: () => {
      const nodes = selectedIds.map((id) => diagramObjects[id]).filter(Boolean) as AnyNode[];
      // Unlock only when *all* of them are locked, so a mixed selection locks
      // rather than half-unlocking — the same rule the group eye follows.
      const locked = nodes.length > 0 && nodes.every((n) => n.locked);
      applyNodePatches(nodes.map((n) => ({ id: n.id, changes: { locked: !locked } })));
    },
    hide: () => {
      const nodes = selectedIds.map((id) => diagramObjects[id]).filter(Boolean) as AnyNode[];
      const hidden = nodes.length > 0 && nodes.every((n) => n.hidden);
      applyNodePatches(nodes.map((n) => ({ id: n.id, changes: { hidden: !hidden } })));
    },
    swapShape: (kind: string, points?: number) => {
      applyNodePatches(
        selectedIds
          .map((id) => diagramObjects[id])
          .filter((n): n is AnyNode => Boolean(n) && n.type === 'shape')
          .map((n) => ({
            id: n.id,
            // Size, paint, position and rotation all survive: only the form
            // changes, which is what makes this a swap and not a redraw.
            changes: {
              // Through `swapShapeKind`, which says what the new kind keeps.
              // Spreading the old geometry carried line-only fields onto a
              // rectangle -- invisible, and waiting to reappear the next time
              // the shape was swapped back. Shared with the rail's picker, so
              // the two surfaces cannot disagree about what survives.
              geometry: swapShapeKind(
                (n as unknown as { geometry: ShapeGeometry }).geometry,
                kind as ShapeKind,
                points
              ),
            },
          }))
      );
    },
  };
  /** The live document, for the diagram round trip. Same source every other consumer here reads. */
  const diagramObjects = useStore((s) => s.objects);

  /**
   * Sweep folders that no longer hold anything.
   *
   * They arise from ordinary editing: delete the last two members of a group
   * and the group record is still there — an empty row that cannot be selected
   * and whose only remaining behaviour is to take up space in the panel.
   *
   * Swept rather than prevented, because the alternative is every deletion
   * path in the app having to know about groups, and there are several. One
   * peer doing it is enough; a delete of a key that is already gone is a no-op
   * in Yjs, so the others racing to agree costs nothing.
   *
   * Terminates in one step: `emptyGroups` already iterates to a fixed point,
   * so the write it triggers cannot produce a second round.
   */
  const groupRecords = useStore((s) => s.groups);
  useEffect(() => {
    const order = Object.keys(diagramObjects);
    const dead = emptyGroups(order, diagramObjects, groupRecords);
    if (dead.length > 0) applyGroupPlan({ nodes: [], groups: [], remove: dead });
  }, [diagramObjects, groupRecords]);


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
  const addTextBlock = (words: number) => {
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
  };

  const openDiagram = () => {
    const selected = selectedIds.map((id) => diagramObjects[id]).filter(Boolean);
    const existing = selected.find((n) => diagramIdOf(n));
    if (existing && canEmitDiagram(selected)) {
      // Everything sharing this diagram's id, not just what happens to be
      // selected — you can click one box of a diagram and still edit the whole
      // thing, which is what anyone would expect that click to mean.
      const id = diagramIdOf(existing)!;
      const whole = Object.values(diagramObjects).filter(
        (n) => diagramIdOf(n) === id
      );
      setDiagramSource(diagramToMermaid(whole));
      setDiagramReplacing(id);
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
  };

  /**
   * Turn the editor's source into objects.
   *
   * A replace deletes the previous generation first, in the same transaction
   * as the new one. Two transactions would put an empty board into history
   * between them, so undo would land on the gap rather than on the diagram —
   * and every collaborator would watch the diagram vanish and reappear.
   */
  const applyDiagram = (source: string) => {
    const { graph } = parseMermaid(source);
    if (!graph) return;
    const origin = cameraSystem.screenToWorld(window.innerWidth / 2, window.innerHeight / 2);
    const built = buildDiagram(
      graph,
      { x: Math.round(origin.x - 200), y: Math.round(origin.y - 140) },
      diagramReplacing ?? undefined
    );

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
          ? Object.values(diagramObjects)
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

  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectTool = (tool: string) => {
    setActiveTool(tool);
    if (tool === 'image' && fileInputRef.current) {
      fileInputRef.current.accept = 'image/*';
      fileInputRef.current.click();
    }
  };
  const { roomId, status, metadata, awarenessUsers } = useRoomState();

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
      avatar: user.avatar,
    };

    /**
     * Compared as a whole, not by colour alone.
     *
     * The first version guarded on the resolved colour, because avoiding a
     * republish on every roster tick was the point — and that silently made
     * the profile editor do nothing. Saving a new face changes `user.avatar`
     * and leaves the colour exactly where it was, so the guard swallowed the
     * publish and the face never left this browser. A cache key has to cover
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

  const handleSaveTitle = (t: string) => {
    // Blurring or hitting Enter with the field cleared saved an empty
    // string as the room's name, synced to every collaborator — the title
    // in the top bar became a blank, still-clickable-but-invisible span.
    const finalTitle = t.trim() || 'Untitled Workspace';
    setLocalTitle(finalTitle);
    metadataMap.set('name', finalTitle);
  };
  // Keyboard Shortcuts routed through dedicated useRoomShortcuts hook
  useRoomShortcuts({
    selectTool,
    selectedIds,
    setSelectedIds,
    setShowCommandPalette,
    setShowHelp,
    setIsUiVisible,
    isCompact,
    panelsOpen,
    setPanelsOpen,
    activeTool,
    setActiveTool,
    openExport: (fromSelection: boolean) => {
      setExportFromSelection(fromSelection);
      setShowExportMenu(true);
    },
  });

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
      const written = copySelection();
      if (written) e.preventDefault();
    };

    const onCut = (e: ClipboardEvent) => {
      if (inTextField()) return;
      const written = copySelection();
      if (!written) return;
      e.preventDefault();
      deleteNodesWithFrames(selectionRef.current);
      setSelectedIds([]);
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
        diagramObjects={diagramObjects}
        contextActions={contextActions}
        canPaste={true}
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

      {/* Connection state is announced, not just coloured — a status conveyed
          only by a red dot is invisible to a screen reader. `polite` so it
          waits for a pause rather than interrupting. */}
      <div className="sr-only" role="status" aria-live="polite">
        {status === 'connected' ? 'Connected. Changes are syncing.' : 'Offline. Changes are saved locally and will sync when you reconnect.'}
      </div>

      {/* What a paste actually produced. Above the dock, out of the way of the
          canvas, and gone by itself — this confirms, it does not ask. */}
      {notice && (
        <div className="canvas-notice" role="status" aria-live="polite">
          {notice}
        </div>
      )}

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
          onExportClick={() => { setExportFromSelection(false); setShowExportMenu(true); }}
          onHelpClick={() => setShowHelp(true)}
          onHideUi={() => setIsUiVisible(false)}
          onToggleTimeline={() => setShowTimeTravel(v => !v)}
          onToggleComments={() => setShowInbox(v => !v)}
          commentUnread={unreadCount(comments, commentMarks, myAuthorId)}
          onTogglePanels={() => setPanelsOpen(v => !v)}
        />
      )}

      {/* RESTORE / TEMPLATE RECEIPT NOTICE */}
      {restoreNotice && (
        <div
          className={`restore-notice ${restoreNotice.ok ? 'is-ok' : 'is-error'}${
            noticeLeaving ? ' is-leaving' : ''
          }`}
          role="status"
        >
          <span>{restoreNotice.message}</span>
          <button
            type="button"
            className="restore-notice__close"
            onClick={() => setRestoreNotice(null)}
            aria-label="Dismiss notice"
          >
            <X size={14} />
          </button>
        </div>
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
          onRequestContextMenu={setContextTarget}
        />
        
        <Suspense fallback={null}>
          {showTimeTravel && (
            <TimeTravelBar
              roomId={roomId}
              onClose={() => { setShowTimeTravel(false); applyReplaySnapshot(null); setTimeTravelSnapshot(null); }}
              onApplySnapshot={(snap, changedIds) => { applyReplaySnapshot(snap, changedIds); setTimeTravelSnapshot(snap); }}
            />
          )}
        </Suspense>
        
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

      {/* FLOATING CONTEXT TOOLBAR — switchable from the View menu. */}
      {showContextToolbar && (
        <ObjectContextToolbar
          selectedId={selectedId}
          selectedIds={selectedIds}
          onDeselect={() => setSelectedIds([])}
          sidebarsVisible={isUiVisible}
        />
      )}

      {/* TOOL WORKSPACE (Dynamic Dock) */}
      {isUiVisible && (
        <ToolWorkspace activeToolId={activeTool} onOpenDiagram={openDiagram} onAddTextBlock={addTextBlock} />
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

      {!isUiVisible && !zenPhysics && !showTimeTravel && (
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
