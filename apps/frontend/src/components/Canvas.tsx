import { usePhysics } from '../hooks/usePhysics';
import React, { useRef, useState, useEffect, useCallback, useMemo, useSyncExternalStore } from "react";
import { Stage, Layer, Circle, Group, Path } from "react-konva";
import Konva from "konva";
import { selectionWithin } from '../engine/model/groupTree';
import { updateNode } from '../engine/document';
import { useStore } from '../hooks/useStore';
import { FORCE_SPECS, canLatch, isForceTool } from '../engine/physics/forces';
import { editor } from '../engine/api/EditorAPI';
import { EXPORT_CHROME } from '../engine/export/chrome';
import { DataLinkOverlay } from './canvas/DataLinkOverlay';
import { LayerHoverOutline } from './canvas/LayerHoverOutline';
import { boardBackgroundStyle, useBoardBackground } from './canvas/boardBackground';
import { SmartGuides } from './canvas/SmartGuides';
import { MeasureOverlay } from './canvas/MeasureOverlay';
import { RulerGuides } from './canvas/RulerGuides';
import { PathEditor } from './canvas/PathEditor';
import { deletePickedAnchor, nudgePickedAnchors, selectAllAnchors } from '../engine/interaction/pathAnchorActions';
import { pathEdit } from '../engine/interaction/pathEdit';
import { booleanPreview } from '../engine/interaction/booleanPreview';
import { renderScope } from '../engine/export/renderScope';
import { lineEdit } from '../engine/interaction/lineEdit';
import { contourData } from '../engine/model/pathGeometry';
import { RULER_SIZE, Rulers } from './canvas/Rulers';
import { tickStep } from '../engine/interaction/rulerTicks';
import { ALL_SHAPE_PRESETS } from './workspace/shapeCatalog';
import { ObjectRenderer } from "./ObjectRenderer";
import { PresenceRenderer } from "../engine/presence/PresenceRenderer";
import { presenceManager } from "../engine/presence/PresenceManager";
import { useCanvasNavigation } from '../hooks/useCanvasNavigation';
import { useCanvasSelection } from '../hooks/useCanvasSelection';

/**
 * Tools whose press begins a mark on the shared canvas.
 *
 * Not derived from `cursorModeForTool`'s `draw` mode: that groups shapes with
 * the pen because they share a crosshair, while this is about whether anything
 * is being *authored*, which is a different question and will drift.
 */
const DRAWING_TOOLS = new Set([
  'pen',
  'bezier-pen',
  'eraser',
  'shape',
  'shape-rect',
  'shape-ellipse',
  'shape-triangle',
  'shape-hexagon',
  'shape-star',
  // Drawing a frame is authoring too, and it is the one gesture where a
  // collaborator most wants to know something is being laid out before it
  // appears. The preset variants are matched by prefix below.
  'frame',
]);

/** `frame-desktop`, `frame-a4`, … all count as authoring. */
const isDrawingTool = (toolId: string) => DRAWING_TOOLS.has(toolId) || toolId.startsWith('frame-');
import { cursorModeForTool, LocalCursor } from '../engine/cursor';
import { GestureOverlay } from "./GestureOverlay";
import { ToolManager, SelectTool, ShapeTool, TextTool, StickyTool, AudioTool, PenTool, BezierPenTool, HandTool, EraserTool, CommentTool, FrameTool, GridTool, ChartTool, TableTool, CodeTool, LinkTool, ConnectorTool } from '../engine/tools';
import { canSelectWith } from '../engine/tools/shortcuts';
import { DirectSelectTool } from '../engine/tools/DirectSelectTool';

/**
 * Which way each arrow key nudges, as a unit vector.
 */
const NUDGE_KEYS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};
import { setSlotFit } from '../engine/grid/gridSlotApply';
import { CommentsOverlay } from "./CommentsOverlay";
import { FramePresenter } from './canvas/FramePresenter';
import { useContentShortcuts } from './canvas/useContentShortcuts';
import { AudioRecordingHUD } from "./AudioRecordingHUD";
import { useComments } from "../hooks/useComments";
import { engineEvents } from '../engine/EventBus';
import { canvasEngine } from '../engine/CanvasEngine';
import { cameraSystem } from '../engine/CameraSystem';
import { useVisibleSet } from '../engine/useVisibleSet';
import { isOpenShape } from '../engine/model/schema';
import { SelectionTransformer } from './canvas/SelectionTransformer';
import { useRoomPermissions } from '../hooks/useRoomPermissions';
import { LineEditor } from './canvas/LineEditor';
import { ConnectorEditor } from './canvas/ConnectorEditor';
import { CornerRadiusHandle } from './canvas/CornerRadiusHandle';
import { ShapeParamHandles } from './canvas/ShapeParamHandles';
import { isLineLike } from '../engine/model/lineEnds';
import type { ConnectorNode, ShapeNode } from '../engine/model/schema';
import { CropOverlay } from './canvas/CropOverlay';
import { SlotReframeOverlay } from './canvas/SlotReframeOverlay';
import { cropMode } from '../engine/interaction/cropMode';
import { slotReframe } from '../engine/interaction/slotReframe';
import { textEditing } from '../engine/interaction/textEditing';
import { FRAME_PRESETS } from '../engine/model/frames';
import { keyBelongsToFocus } from '../engine/interaction/keyTarget';
import { useCanvasShortcuts } from './canvas/useCanvasShortcuts';
import { toolOverlay, useToolOverlay } from '../engine/tools/toolOverlay';
import { sortByStacking } from '../engine/model/stacking';
import { useCameraZoom } from '../engine/useCameraZoom';

interface CanvasProps {
  activeTool: string;
  selectedIds: string[];
  setSelectedIds: React.Dispatch<React.SetStateAction<string[]>>;
  /** Right-click on the board. Resolved here, shown by `Room`. */
  onRequestContextMenu?: (target: { x: number; y: number; ids: string[] }) => void;
}

/** Tools publish their live preview here; see `toolOverlay`. */
const setOverlayState = toolOverlay.set;

export const Canvas: React.FC<CanvasProps> = ({ activeTool, selectedIds, setSelectedIds, onRequestContextMenu }) => {
  const stageRef = useRef<Konva.Stage>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  /**
   * How far apart the dots should sit on screen, whatever the zoom.
   *
   * Twenty is what the field looked like at 1:1 before it scaled, and it is
   * comfortably more than the 3px a dot occupies — close enough to read as a
   * grid, far enough not to merge into a tone.
   */
  const DOT_GAP_PX = 20;

  const showRulers = useStore((s) => s.showRulers);
  const showGrid = useStore((s) => s.showGrid);
  /** One number for the stage, the grid and the panels. See the Stage below. */
  const rulerInset = showRulers ? RULER_SIZE : 0;

  // The panels clear the rulers through `--ruler-size`, so the flag has to
  // reach CSS as well as the stage. One variable, one truth about how tall a
  // ruler is.
  useEffect(() => {
    document.body.dataset.rulers = showRulers ? 'on' : 'off';
    return () => { delete document.body.dataset.rulers; };
  }, [showRulers]);

  const { canEdit, canTransform } = useRoomPermissions();
  /**
   * Read imperatively by the keydown handler below, which is registered once.
   * A dependency would re-register the listener; a bare `canEdit` would be
   * captured stale by the closure.
   */
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;

  // Stable-identity ref mirroring selectedIds, read imperatively by
  // ObjectRenderer during drags so a move on one selected object carries the
  // rest of the selection with it, without making every object's props
  // change (and re-render) on every selection change.
  const selectedIdsRef = useRef<string[]>(selectedIds);
  useEffect(() => {
    selectedIdsRef.current = selectedIds;
  }, [selectedIds]);

  // Engine lifecycle
  useEffect(() => {
    canvasEngine.start();
    return () => canvasEngine.stop();
  }, []);

  // WebGL / Canvas Context Loss & Restore handling
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleContextLost = (e: Event) => {
      // Must prevent default to allow the browser to restore the canvas context
      e.preventDefault();
      console.warn('Canvas context lost. Awaiting GPU restoration...');
    };

    const handleContextRestored = () => {
      console.log('Canvas context restored. Re-rendering stage layers...');
      stageRef.current?.batchDraw();
      engineEvents.emit('CameraChanged', {
        x: cameraSystem.x,
        y: cameraSystem.y,
        zoom: cameraSystem.zoom,
      });
    };

    container.addEventListener('contextlost', handleContextLost, { capture: true });
    container.addEventListener('webglcontextlost', handleContextLost, { capture: true });
    container.addEventListener('contextrestored', handleContextRestored, { capture: true });
    container.addEventListener('webglcontextrestored', handleContextRestored, { capture: true });

    return () => {
      container.removeEventListener('contextlost', handleContextLost, { capture: true });
      container.removeEventListener('webglcontextlost', handleContextLost, { capture: true });
      container.removeEventListener('contextrestored', handleContextRestored, { capture: true });
      container.removeEventListener('webglcontextrestored', handleContextRestored, { capture: true });
    };
  }, []);

  // -- crop mode ------------------------------------------------------------

  const cropSnapshot = useSyncExternalStore(
    cropMode.subscribe,
    cropMode.getSnapshot,
    cropMode.getSnapshot
  );
  const croppingId = cropSnapshot?.nodeId ?? null;

  // -- reframe mode ---------------------------------------------------------

  /**
   * The picture being reframed inside its module.
   *
   * Its own mode rather than a flag on the crop above, because the two move
   * opposite things: cropping drags the frame, reframing drags the picture
   * inside a frame that belongs to the grid. See `slotReframe.ts`.
   */
  const reframeSnapshot = useSyncExternalStore(
    slotReframe.subscribe,
    slotReframe.getSnapshot,
    slotReframe.getSnapshot
  );
  const reframingId = reframeSnapshot?.nodeId ?? null;

  // -- path edit mode -------------------------------------------------------

  /** The node currently holding a text caret, if any. */
  const editingTextId = useSyncExternalStore(
    textEditing.subscribe,
    textEditing.getSnapshot,
    textEditing.getSnapshot
  );

  const pathSelection = useSyncExternalStore(
    pathEdit.subscribe,
    pathEdit.getSnapshot,
    pathEdit.getSnapshot
  );
  const booleanGhost = useSyncExternalStore(
    booleanPreview.subscribe,
    booleanPreview.getSnapshot,
    booleanPreview.getSnapshot
  );
  const editingPathId = pathSelection?.nodeId ?? null;

  /**
   * Escape leaves the path; Delete removes the picked anchor.
   *
   * On capture, ahead of the selection handler below, for exactly the reason
   * the crop's keys are: both listen to the same event, and Delete reaching
   * the second one would remove the entire path when the user meant one point
   * of it. Delete with no anchor picked falls through, which is how you still
   * delete the path itself.
   */
  useEffect(() => {
    if (!editingPathId) return;
    const onKey = (e: KeyboardEvent) => {
      if (keyBelongsToFocus(e.key)) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        pathEdit.exit();
      } else if ((e.key === 'Backspace' || e.key === 'Delete') && deletePickedAnchor()) {
        e.stopPropagation();
        e.preventDefault();
      } else if (NUDGE_KEYS[e.key]) {
        /**
         * Arrows move the picked anchors, not the node.
         *
         * While a path is open, moving the whole object is the opposite of what
         * direct selection is for — and with nothing picked this falls through
         * to the node nudge, so the key never simply stops working.
         */
        const [dx, dy] = NUDGE_KEYS[e.key];
        const step = e.shiftKey ? 10 : 1;
        if (nudgePickedAnchors(dx * step, dy * step)) {
          e.stopPropagation();
          e.preventDefault();
        }
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a' && selectAllAnchors()) {
        // Select-all means "every anchor on this path" while one is open, which
        // is the only reading of it that acts on what you are looking at.
        e.stopPropagation();
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [editingPathId]);

  // When activeTool is direct-select and an eligible object is selected, open it for anchor editing.
  // When leaving direct-select, exit path editing so the transformer returns.
  useEffect(() => {
    if (activeTool === 'direct-select') {
      if (selectedIds.length === 1 && (!editingPathId || editingPathId !== selectedIds[0])) {
        const openedId = DirectSelectTool.open(selectedIds[0]);
        if (openedId && openedId !== selectedIds[0]) {
          setSelectedIds([openedId]);
        }
      }
    } else {
      pathEdit.exit();
    }
  }, [activeTool, selectedIds, editingPathId, setSelectedIds]);

  useEffect(() => {
    if (editingPathId && !selectedIds.includes(editingPathId)) pathEdit.exit();
  }, [selectedIds, editingPathId]);

  /**
   * Put back exactly what the crop started from.
   *
   * Cropping writes to the document on every drag frame, which is what makes
   * it feel direct — so cancelling cannot mean "stop writing". Undo is not the
   * answer either: one drag is many writes, and the user thinks of the whole
   * gesture as one action.
   */
  const cancelCrop = useCallback(() => {
    const restoring = cropMode.cancel();
    if (!restoring) return;
    updateNode(restoring.nodeId, {
      x: restoring.node.x,
      y: restoring.node.y,
      width: restoring.node.width,
      height: restoring.node.height,
      crop: restoring.crop,
    });
  }, []);

  useEffect(() => {
    if (!croppingId) return;
    const onKey = (e: KeyboardEvent) => {
      if (keyBelongsToFocus(e.key)) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        cancelCrop();
      } else if (e.key === 'Enter') {
        e.stopPropagation();
        cropMode.commit();
      }
    };
    // Capture, so Escape ends the crop rather than clearing the selection —
    // the selection handler below is on the same event and would otherwise
    // both fire, leaving you cropping an object you can no longer see selected.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [croppingId, cancelCrop]);

  /**
   * Picking any tool ends the crop, keeping what is there.
   *
   * Crop is a mode belonging to one object, not a tool, so it has no entry in
   * the dock and nothing in `ToolManager` clears it. Committing on a tool
   * change is what stops it outliving the reason it was entered — otherwise
   * the handles sit on the image while you draw somewhere else entirely.
   */
  useEffect(() => {
    if (croppingId) cropMode.commit();
    // Deliberately keyed on the tool alone: re-running this when `croppingId`
    // changes would commit the crop on the frame it was entered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTool]);

  // Deselecting is leaving the object, so it ends the crop too.
  useEffect(() => {
    if (croppingId && !selectedIds.includes(croppingId)) cropMode.commit();
  }, [selectedIds, croppingId]);

  /**
   * Put back exactly what the reframe started from.
   *
   * The fit, not the crop it produced. The crop is derived from the fit and the
   * module's size on every reflow, so restoring the fit restores the picture
   * even if the grid was re-laid underneath the gesture -- restoring the crop
   * would put back a window cut for a module that may no longer be that shape.
   */
  const cancelReframe = useCallback(() => {
    const restoring = slotReframe.cancel();
    if (!restoring) return;
    setSlotFit(restoring.nodeId, restoring.fit ?? {});
  }, []);

  useEffect(() => {
    if (!reframingId) return;
    const onKey = (e: KeyboardEvent) => {
      if (keyBelongsToFocus(e.key)) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        cancelReframe();
      } else if (e.key === 'Enter') {
        e.stopPropagation();
        slotReframe.commit();
      }
    };
    // Capture, for the same reason the crop's handler uses it: Escape has to
    // end the mode rather than clear the selection, and both handlers sit on
    // the same event.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [reframingId, cancelReframe]);

  // Picking a tool, and leaving the picture, both end it keeping what is there.
  useEffect(() => {
    if (reframingId) slotReframe.commit();
    // Keyed on the tool alone: re-running on `reframingId` would commit on the
    // frame it was entered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTool]);

  useEffect(() => {
    if (reframingId && !selectedIds.includes(reframingId)) slotReframe.commit();
  }, [selectedIds, reframingId]);

  /**
   * And leaving the line ends its editor.
   *
   * Same rule as the crop above, and it covers the two ways out that are not a
   * keypress: selecting something else, and the object being deleted by a
   * collaborator. Without it the editor would keep drawing handles for a line
   * nobody has selected — or, in the delete case, for a line that is gone.
   */
  const editingLineId = useSyncExternalStore(
    lineEdit.subscribe,
    lineEdit.getSnapshot,
    lineEdit.getSnapshot
  )?.nodeId ?? null;
  useEffect(() => {
    if (!editingLineId) return;
    // Read at effect time rather than subscribed: this asks a question about
    // the moment the selection changed, and depending on the whole object map
    // would re-run it on every keystroke anyone in the room types.
    const stillThere = Boolean(useStore.getState().objects[editingLineId]);
    if (!selectedIds.includes(editingLineId) || !stillThere) lineEdit.end(editingLineId);
  }, [selectedIds, editingLineId]);

  useCanvasShortcuts({ selectedIds, setSelectedIds, canEditRef });
  useContentShortcuts({ selectedIds });

  useEffect(() => {
    const handleNavigate = (e: any) => {
      const { x, y, zoom, immediate } = e.detail;

      const targetX = (cameraSystem.width / 2) - (x * zoom);
      const targetY = (cameraSystem.height / 2) - (y * zoom);

      if (immediate) {
        cameraSystem.setPose(targetX, targetY, zoom);
        return;
      }

      cameraSystem.animateTo(targetX, targetY, zoom, { duration: 550 });
    };
    window.addEventListener('navigateViewport', handleNavigate);
    return () => {
      cameraSystem.cancelAnimation();
      window.removeEventListener('navigateViewport', handleNavigate);
    };
  }, []);

  /**
   * A board that arrives all at once should still arrive *gently*.
   *
   * Forty objects committed in one transaction paint in a single frame, which
   * is correct and fast and reads as a glitch — the canvas is empty, and then
   * without transition it is not. The flag drives one short fade-and-settle
   * on the stage, so a template resolves into place instead of being stamped
   * onto the screen.
   *
   * It is CSS rather than a tween on the camera on purpose: the camera has
   * already been put exactly where it belongs by the time this runs, and
   * moving it again to make an entrance would undo the framing that the whole
   * arrival exists to get right.
   */
  const boardBackground = useBoardBackground();
  const [arriving, setArriving] = useState(false);
  useEffect(() => {
    const onArrive = () => {
      setArriving(true);
      window.setTimeout(() => setArriving(false), 900);
    };
    window.addEventListener('boardArriving', onArrive);
    return () => window.removeEventListener('boardArriving', onArrive);
  }, []);

  const { visibleIds } = useVisibleSet();
  const objects = useStore((state) => state.objects);
  const groups = useStore((state) => state.groups);

  // Hook-managed selection and nested group stepping
  const { enteredGroupRef, handleObjectSelect } = useCanvasSelection({
    activeTool,
    selectedIds,
    setSelectedIds,
  });
  const {
    handleThrow, applyGlobalForce,
    beginHeldForce, moveHeldForce, endHeldForce,
    latchField, releaseLatch,
    calmAll,
  } = usePhysics(objects, stageRef, selectedIdsRef);

  // The Forces panel renders up in Room, two levels above the physics loop.
  useEffect(() => {
    const onCalm = () => calmAll();
    window.addEventListener('physics-calm', onCalm);
    return () => window.removeEventListener('physics-calm', onCalm);
  }, [calmAll]);

  /**
   * Cursor position while a force tool is held, in world space.
   *
   * Drives the field ring below. A force you cannot see the extent of is a
   * force you cannot aim, which is most of why these tools felt like a slot
   * machine: you pressed, and some unpredictable set of objects reacted.
   */
  const forceCursorRef = useRef<{ x: number; y: number } | null>(null);
  const forceRingRef = useRef<Konva.Group>(null);
  const activeForce = isForceTool(activeTool) ? FORCE_SPECS[activeTool] : null;
  // Subscribed, so dragging the Area slider resizes the ring as you drag it.
  const forceRadiusScale = useStore((state) => state.forceRadiusScale);

  // The force ring follows the pointer and pulses on the render tick, so the
  // frame loop must keep running while a force tool is armed.
  useEffect(() => {
    if (!activeForce) return;
    return canvasEngine.hold();
  }, [activeForce]);

  // Entering a force tool snapshots the layout so the whole session can be put
  // back, and leaving it drops the ring.
  useEffect(() => {
    const armed = isForceTool(activeTool);
    useStore.getState().setForceToolActive(armed);
    if (armed) {
      if (!useStore.getState().layoutSnapshot) useStore.getState().captureLayoutSnapshot();
    } else {
      forceCursorRef.current = null;
      endHeldForce();
      // Clearing lives here, not in the bar's Done/Escape handlers, because
      // this is the one place that sees *every* way of leaving force mode.
      // Picking another tool from the dock skipped those handlers entirely, so
      // the snapshot survived — and since re-entering only captures when none
      // exists, "Restore layout" would silently put you back to a baseline
      // from some earlier session with the tool.
      useStore.getState().clearLayoutSnapshot();
    }
  }, [activeTool, endHeldForce]);





  const {
    comments,
    addComment: handleAddComment,
    addReply: handleAddReply,
    editMessage: handleEditMessage,
    deleteMessage: handleDeleteMessage,
    resolveComment: handleResolveComment,
    currentAuthorId,
  } = useComments();

  /**
   * Every id in draw order, bottom first.
   *
   * Re-sorted only when membership or a z-index changed: most transactions
   * move or restyle something, and re-sorting the board for each was an
   * O(n log n) pass on every remote edit. The check is O(n) and keeps the
   * array's identity, so nothing downstream recomputes either.
   */
  const orderRef = useRef<{ ids: string[]; z: Map<string, number> } | null>(null);
  const orderedIds = useMemo(() => {
    const prev = orderRef.current;
    const keys = Object.keys(objects);
    if (prev && prev.ids.length === keys.length) {
      let same = true;
      for (const id of keys) {
        const z = prev.z.get(id);
        if (z === undefined || z !== (objects[id]?.zIndex || 0)) {
          same = false;
          break;
        }
      }
      if (same) return prev.ids;
    }
    const sorted = sortByStacking(Object.values(objects) as Array<{ id: string; zIndex?: number }>);
    const next = { ids: sorted.map((o) => o.id), z: new Map(sorted.map((o) => [o.id, o.zIndex || 0])) };
    orderRef.current = next;
    return next.ids;
  }, [objects]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  /**
   * Objects an export needs mounted regardless of where the camera is.
   *
   * Culling is a viewport optimisation, and an export is not looking through
   * the viewport: it reframes the stage imperatively and captures, which gives
   * React no chance to mount anything. So a board wider than the window used to
   * export at the right dimensions with the off-screen half blank -- while the
   * SVG of the same board, built from the document, had all of it.
   *
   * The mechanism is the one already here for selection, generalised. See
   * `engine/export/renderScope.ts`.
   */
  const requiredIds = useSyncExternalStore(renderScope.subscribe, renderScope.getSnapshot, renderScope.getSnapshot);

  /**
   * The ids to mount, in draw order: what the culler says is in view, plus the
   * selection (whose handles must work off-screen) and anything an export has
   * asked for. Before the culler's first report, everything.
   */
  const mountedIds = useMemo(() => {
    if (!visibleIds) return orderedIds;
    return orderedIds.filter((id) => visibleIds.has(id) || selectedSet.has(id) || requiredIds?.has(id));
  }, [orderedIds, visibleIds, selectedSet, requiredIds]);

  // The engine pushes RenderTick every frame. We apply camera to Konva and Grid directly bypassing React!
  useEffect(() => {
    const handleRenderTick = () => {
      if (stageRef.current) {
        stageRef.current.position({ x: cameraSystem.x, y: cameraSystem.y });
        stageRef.current.scale({ x: cameraSystem.zoom, y: cameraSystem.zoom });
      }
      if (containerRef.current) {
        // Offset by the rulers for the same reason the stage is: the grid is
        // world-space decoration and has to line up with what is drawn on it.
        const inset = useStore.getState().showRulers ? RULER_SIZE : 0;
        /**
         * The dot spacing re-steps with zoom instead of scaling with it.
         *
         * A fixed 20 world units multiplied by the zoom is right at 1:1 and
         * falls apart either side of it: at 0.2 the dots land four pixels
         * apart while still being three pixels across, so the field closes up
         * into a flat grey wash, and at 4 they are eighty pixels apart and
         * stop reading as a grid at all.
         *
         * `tickStep` is the same function the rulers use to choose their
         * divisions, asked for the smallest round world step that keeps its
         * marks at least `DOT_GAP_PX` apart on screen. The result is a field
         * that looks identical at every zoom — always about twenty pixels
         * between dots — while each dot still sits on a real world coordinate,
         * on the round numbers the ruler is marking. That is the part a
         * screen-fixed grid could never do, and the reason not to simply pin
         * it back to 24px and call it consistent.
         */
        const step = tickStep(cameraSystem.zoom, DOT_GAP_PX);
        const pitch = step * cameraSystem.zoom;
        containerRef.current.style.backgroundPosition = `${cameraSystem.x + inset}px ${cameraSystem.y + inset}px`;
        containerRef.current.style.backgroundSize = `${pitch}px ${pitch}px`;
      }

      // The force field ring rides the same imperative path as the camera. It
      // was React state written on every mousemove, which re-rendered the whole
      // canvas 60 times a second precisely while a force was being applied —
      // the one moment the frame budget is already spoken for.
      const ring = forceRingRef.current;
      if (ring) {
        /**
         * A latched field outranks the cursor.
         *
         * The ring is the only thing that says where a force is being applied.
         * While one is running it belongs to the *field*, not to the pointer —
         * leaving it under the cursor would draw the ring somewhere the force
         * is not, which is worse than not drawing it at all.
         */
        const live = latchRef.current;
        const cursor = live ?? forceCursorRef.current;
        if (cursor) {
          ring.position(cursor);
          ring.visible(true);
          /**
           * Latched rings pulse, and fade as the field runs out.
           *
           * A ring that sits perfectly still is indistinguishable from the
           * one that tracks the cursor, so nothing on screen would say the
           * field is live or how much of it is left. Opacity carries the
           * countdown; the pulse says it is running rather than parked.
           */
          if (live) {
            const pulse = 1 + 0.03 * Math.sin(performance.now() / 260);
            ring.scale({ x: pulse, y: pulse });
            ring.opacity(0.45 + 0.55 * Math.min(1, live.remainingMs / 1200));
          } else {
            ring.scale({ x: 1, y: 1 });
            ring.opacity(1);
          }
          // Keep the outline a constant thickness on screen at any zoom.
          const invZoom = 1 / (cameraSystem.zoom || 1);
          ring.getChildren().forEach((child) => {
            if (typeof (child as Konva.Circle).strokeWidth === 'function' && (child as Konva.Circle).stroke()) {
              (child as Konva.Circle).strokeWidth(2 * invZoom);
              (child as Konva.Circle).dash([10 * invZoom, 8 * invZoom]);
            }
          });
        } else if (ring.visible()) {
          ring.visible(false);
        }
      }
    };
    engineEvents.on('RenderTick', handleRenderTick);
    return () => engineEvents.off('RenderTick', handleRenderTick);
  }, []);

  /**
   * The live latched field, mirrored for the ring to draw.
   *
   * A ref rather than state: the countdown ticks every frame, and putting it
   * in state would re-render the whole canvas sixty times a second for a
   * number nothing but one ring reads — the same reason the ring's position
   * is written imperatively.
   */
  const latchRef = useRef<{ x: number; y: number; remainingMs: number } | null>(null);
  useEffect(() => {
    const onLatch = (v: { x: number; y: number; remainingMs: number } | null) => {
      latchRef.current = v;
    };
    engineEvents.on('ForceLatchChanged', onLatch);
    return () => engineEvents.off('ForceLatchChanged', onLatch);
  }, []);

  /**
   * Escape stops a running field.
   *
   * Registered in the capture phase and only while something is actually
   * latched, so it cannot swallow an Escape meant for a dialog, an editor or
   * the selection when no field is running.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (releaseLatch()) e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [releaseLatch]);

  const [isSpacePressed, setIsSpacePressed] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === 'Space') {
        e.preventDefault();
        setIsSpacePressed(true);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsSpacePressed(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // The container carries this as `data-cursor-mode` and `index.css` turns it
  // into a real CSS cursor. Nothing here draws a pointer any more.
  const cursorMode = cursorModeForTool(activeTool, { spacePressed: isSpacePressed });

  // The raster exporters need the live Stage, and this is the component that
  // owns it; Room and the export dialog read it from here.
  useEffect(() => {
    (window as any)._konva_stage = stageRef.current;
    return () => {
      if ((window as any)._konva_stage === stageRef.current) {
        (window as any)._konva_stage = null;
      }
    };
  }, []);

  // Reads the pointer from the stage rather than the event, so it works
  // identically for mouse and touch. Both go through `presenceManager`, the
  // one writer of the `cursor` field, which owns the throttle and idle timer.
  const handleMouseMove = () => {
    const stage = stageRef.current;
    if (!stage) return;
    const pointerPosition = stage.getPointerPosition();
    if (pointerPosition) {
      const x = (pointerPosition.x - stage.x()) / stage.scaleX();
      const y = (pointerPosition.y - stage.y()) / stage.scaleY();
      presenceManager.updateCursor(x, y);
    }
  };

  const handleMouseLeave = () => {
    presenceManager.clearCursor();
  };

  // Push ephemeral state to PresenceManager
  useEffect(() => {
    presenceManager.updateTool(activeTool);
  }, [activeTool]);

  useEffect(() => {
    presenceManager.updateSelection(selectedIds);
  }, [selectedIds]);

  // Dedicated HandTool instance for the "hold Space to pan" convention,
  // independent of whatever tool is actually active — see handleStageClick/
  // handleMouseMoveExt/handleMouseUp below for why this needs its own
  // pointer-event routing rather than going through toolManager.
  const spacePanTool = useRef(new HandTool()).current;
  const spacePanActiveRef = useRef(false);
  /** A press on the stage that has not yet been released. */
  const pressActiveRef = useRef(false);
  const contentLayerRef = useRef<Konva.Layer>(null);
  const toolManager = useMemo(() => {
    const tm = new ToolManager({ editor, camera: cameraSystem, setOverlayState });
    tm.registerTool(new SelectTool());
    tm.registerTool(new DirectSelectTool());
    /**
     * Every preset, across both dock seats.
     *
     * This read `SHAPE_KINDS`, which was the whole list until line and arrow
     * moved to a seat of their own — at which point those two stopped being
     * registered and picking either armed a tool id that did not exist. The
     * dock lit up, the cursor changed, and clicking the board did nothing at
     * all. `ALL_SHAPE_PRESETS` is the union, and is what the resolver reads too,
     * so a preset cannot be offered by a seat and missing from the manager.
     */
    ALL_SHAPE_PRESETS.forEach((preset) => tm.registerTool(new ShapeTool(preset)));
    tm.registerTool(new TextTool());
    tm.registerTool(new ConnectorTool());
    tm.registerTool(new StickyTool());
    tm.registerTool(new AudioTool());
    tm.registerTool(new PenTool());
    tm.registerTool(new BezierPenTool());
    tm.registerTool(new HandTool());
    tm.registerTool(new EraserTool());
    tm.registerTool(new CommentTool());
    // One instance per preset, like the shape kinds, so the dock's flyout, the
    // tool id and the frame that gets created cannot drift apart.
    tm.registerTool(new FrameTool());
    tm.registerTool(new GridTool());
    tm.registerTool(new ChartTool());
    tm.registerTool(new TableTool());
    tm.registerTool(new CodeTool());
    tm.registerTool(new LinkTool());
    FRAME_PRESETS.forEach((preset) => tm.registerTool(new FrameTool(preset.id)));
    return tm;
  }, []);

  const {
    dimensions,
    isMultiTouchRef,
    handleTouchStartNative,
    handleTouchMoveNative,
    handleTouchEndNative,
  } = useCanvasNavigation({
    containerRef,
    stageRef,
    onCancelInteractions: () => {
      pressActiveRef.current = false;
      toolManager.handlePointerUp({ target: { getStage: () => stageRef.current } });
      setOverlayState(null);
    },
  });

  useEffect(() => {
    let mappedTool = activeTool;
    if (activeTool === 'shape') mappedTool = 'shape-rect';
    toolManager.setActiveTool(mappedTool);
  }, [activeTool, toolManager]);

  // Keys reach the active tool (Escape/Enter to finish a path, Shift held to
  // constrain), behind the same focus guard as every other canvas shortcut.
  useEffect(() => {
    const handleToolKeyDown = (e: KeyboardEvent) => {
      if (keyBelongsToFocus(e.key)) return;
      toolManager.handleKeyDown(e);
    };
    // Key-ups always reach the tool, so a modifier released while focus moved
    // into a field cannot leave a "held" state stuck.
    const handleToolKeyUp = (e: KeyboardEvent) => {
      toolManager.handleKeyUp(e);
    };
    window.addEventListener('keydown', handleToolKeyDown);
    window.addEventListener('keyup', handleToolKeyUp);
    return () => {
      window.removeEventListener('keydown', handleToolKeyDown);
      window.removeEventListener('keyup', handleToolKeyUp);
    };
  }, [toolManager]);

  const handleStageClick = (e: any) => {
    // A pinch in progress owns the viewport; tools must not also fire.
    if (isMultiTouchRef.current) return;
    pressActiveRef.current = true;
    // Holding Space pans whatever tool is active (the Figma/Photoshop
    // convention), through a dedicated HandTool so the active tool never sees
    // the gesture.
    if (isSpacePressed) {
      spacePanActiveRef.current = true;
      spacePanTool.onPointerDown({ editor, camera: cameraSystem, setOverlayState }, e);
      return;
    }
    const clickedOnEmpty = e.target === e.target.getStage();
    if (clickedOnEmpty) {
      setSelectedIds([]);
    }

    if (isForceTool(activeTool)) {
      const stage = stageRef.current;
      const pointerPosition = stage?.getPointerPosition();
      if (pointerPosition) {
        const x = (pointerPosition.x - cameraSystem.x) / cameraSystem.zoom;
        const y = (pointerPosition.y - cameraSystem.y) / cameraSystem.zoom;
        const { forceLatch, forceLatchSeconds } = useStore.getState();
        if (activeTool === 'shockwave') {
          // An impulse, not a hold — one burst per press. Latching a single
          // impulse would just be repeat-fire, which is a different tool.
          applyGlobalForce(x, y, 'shockwave');
        } else if (forceLatch && canLatch(activeTool)) {
          /**
           * Latched: place the field and let go.
           *
           * Pressing again while one is running cancels rather than moving it,
           * so the same gesture that started it also stops it — otherwise the
           * only way out is Escape, and a field you cannot stop where you
           * started it is a trap.
           */
          if (!releaseLatch()) latchField(activeTool, x, y, forceLatchSeconds);
        } else {
          beginHeldForce(activeTool, x, y);
        }
      }
      // A force press is not a selection or a tool gesture; don't let the
      // select tool start a marquee underneath the force being applied.
      return;
    }

    // A gesture that is about to put marks on the shared canvas. Broadcast as
    // an activity so collaborators' name chips stay up and the radar pings
    // where the work is happening — but deliberately *not* as a word next to
    // their name, because the stroke appearing is already the message.
    if (isDrawingTool(activeTool)) presenceManager.updateActivity('drawing');

    toolManager.handlePointerDown(e);
  };

  const handleMouseMoveExt = (e: any) => {
    if (isMultiTouchRef.current) return;
    // The container's own mousemove already publishes the cursor for a mouse;
    // a touch drag fires no mousemove, so it is published from here.
    if (typeof e?.evt?.type === 'string' && e.evt.type.startsWith('touch')) handleMouseMove();

    // Keyed off the ref (which tool actually started this drag), not the
    // live isSpacePressed flag — so releasing Space mid-drag doesn't yank
    // control away from the pan gesture partway through it.
    if (spacePanActiveRef.current) {
      spacePanTool.onPointerMove({ editor, camera: cameraSystem, setOverlayState }, e);
      return;
    }

    toolManager.handlePointerMove(e);

    const stage = stageRef.current;
    if (!stage) return;
    const pointerPosition = stage.getPointerPosition();
    if (!pointerPosition) return;
    const x = (pointerPosition.x - cameraSystem.x) / cameraSystem.zoom;
    const y = (pointerPosition.y - cameraSystem.y) / cameraSystem.zoom;

    // Track the cursor in world space while a force tool is active, so the field
    // ring can be drawn where the force will actually land. Only while a force
    // tool is active — this is a per-move setState and must not exist otherwise.
    if (isForceTool(activeTool)) {
      // A ref, not state: the ring is repositioned by the render tick above.
      forceCursorRef.current = { x, y };
      // Steer the held force. The force itself is applied by the physics frame
      // loop, not from here, so holding still keeps working.
      moveHeldForce(x, y, e.evt?.movementX ?? 0, e.evt?.movementY ?? 0);
    }
  };

  const handleMouseUp = (e: any) => {
    if (isMultiTouchRef.current) return;
    const hadPress = pressActiveRef.current;
    pressActiveRef.current = false;
    if (spacePanActiveRef.current) {
      spacePanActiveRef.current = false;
      spacePanTool.onPointerUp({ editor, camera: cameraSystem, setOverlayState }, e);
      return;
    }
    // Releasing always ends a held force, including when the release happens
    // over a panel or outside the stage.
    endHeldForce();
    // Cleared unconditionally: this runs for every release, including ones
    // that end over a panel, which is exactly where a "still drawing" state
    // would otherwise get stuck forever.
    presenceManager.updateActivity(null);
    // Only a press this canvas saw gets a release: a window-level release
    // below may already have ended it.
    if (hadPress || toolManager.gestureActive) toolManager.handlePointerUp(e);
  };

  /**
   * End a gesture whose release the stage will never see.
   *
   * The stage only hears pointer-up over itself. Released over a panel, the
   * dock or the rulers — or cancelled by the browser, or interrupted by the
   * window losing focus — a stroke kept drawing with the button up, a marquee
   * stayed open and Space-pan kept panning. Releases over the stage are left
   * to the stage's own handler, which runs with Konva's event.
   */
  const handleMouseUpRef = useRef(handleMouseUp);
  handleMouseUpRef.current = handleMouseUp;
  useEffect(() => {
    const endOutside = (ev: Event) => {
      if (!pressActiveRef.current && !spacePanActiveRef.current) return;
      const stage = stageRef.current;
      const overStage =
        ev.type === 'pointerup' && stage && ev.target instanceof Node && stage.container().contains(ev.target);
      if (overStage) return;
      handleMouseUpRef.current({ target: stage ?? { getStage: () => null }, evt: ev });
    };
    window.addEventListener('pointerup', endOutside);
    window.addEventListener('pointercancel', endOutside);
    window.addEventListener('blur', endOutside);
    return () => {
      window.removeEventListener('pointerup', endOutside);
      window.removeEventListener('pointercancel', endOutside);
      window.removeEventListener('blur', endOutside);
    };
  }, []);

  /**
   * The content layer's hit graph is switched off while the camera moves.
   *
   * Nothing can be hovered or picked mid-pan, and redrawing a hit canvas for
   * every object on every pan frame doubled the cost of the move. It comes
   * back a moment after the camera settles — or at once, before Konva
   * hit-tests, when a press arrives first, so a click straight after a scroll
   * still lands on what is under it.
   */
  useEffect(() => {
    let timer = 0;
    const restore = () => {
      window.clearTimeout(timer);
      const layer = contentLayerRef.current;
      if (!layer || layer.listening()) return;
      layer.listening(true);
      layer.drawHit();
    };
    const off = engineEvents.on('CameraChanged', () => {
      const layer = contentLayerRef.current;
      if (!layer) return;
      if (layer.listening()) layer.listening(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(restore, 150);
    });
    const container = containerRef.current;
    const layer = contentLayerRef.current;
    container?.addEventListener('pointerdown', restore, true);
    return () => {
      off();
      container?.removeEventListener('pointerdown', restore, true);
      window.clearTimeout(timer);
      layer?.listening(true);
    };
  }, []);

  // Remote cursors and selections are DOM overlays (RemoteCursors,
  // PresenceRenderer). The local pointer is the OS one.

  return (
    <div
      className="canvas-container relative w-full h-full overflow-hidden select-none"
      // `index.css` resolves this to a real CSS cursor. A coarse pointer has
      // no cursor to style, so the rule is simply ignored there — which is why
      // the old touch special-case is gone.
      data-cursor-mode={cursorMode}
      data-arriving={arriving ? 'true' : undefined}
      // The dot field is a CSS background on this element, so switching it off
      // is one attribute rather than a second painting path.
      data-grid={showGrid ? 'on' : 'off'}
      style={{ touchAction: 'none', ...boardBackgroundStyle(boardBackground) }}
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onTouchStart={handleTouchStartNative}
      onTouchMove={handleTouchMoveNative}
      onTouchEnd={handleTouchEndNative}
      onTouchCancel={handleTouchEndNative}
    >
      {/* Our pointer art, installed as real CSS cursors. It renders nothing:
          a drawn element is composited with the page and is a frame behind the
          compositor-drawn OS cursor by construction, which is what "the cursor
          lags" turned out to be. It writes `--cursor-tool` and friends; if it
          bails out — touch, forced colors — the keyword `[data-cursor-mode]`
          rules above are still in force and the board still has a pointer. */}
      <LocalCursor mode={cursorMode} containerRef={containerRef} activeTool={activeTool} />
      {/* Outside the stage: the rulers are chrome pinned to the viewport, and
          drawing them inside a transformed canvas would mean fighting that
          transform on every pan. */}
      {showRulers && <Rulers width={dimensions.width} height={dimensions.height} />}
      <Stage
        ref={stageRef}
        /**
         * Inset by the rulers, so screen coordinates inside the stage and the
         * marks along the rulers describe the same world position. Without it
         * the two disagree by 22px, which is the one failure that makes a
         * ruler worse than no ruler.
         *
         * Which is exactly why hiding them cannot just stop drawing them: the
         * inset is structural, and leaving it would strand a dead 22px margin
         * down two edges of a board someone hid the rulers to see more of.
         * One number, read by the stage, the grid and the panels alike.
         */
        style={{ position: 'absolute', top: rulerInset, left: rulerInset }}
        width={Math.max(1, dimensions.width - rulerInset)}
        height={Math.max(1, dimensions.height - rulerInset)}
        x={cameraSystem.x}
        y={cameraSystem.y}
        scaleX={cameraSystem.zoom}
        scaleY={cameraSystem.zoom}
        onMouseDown={handleStageClick}
        onTouchStart={handleStageClick}
        onMouseMove={handleMouseMoveExt}
        onTouchMove={handleMouseMoveExt}
        onMouseUp={handleMouseUp}
        onTouchEnd={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        /**
         * Right-click opens the board's own menu.
         *
         * `preventDefault` on the native event, or Chrome shows its own menu on
         * top of ours — and the browser's has nothing on it that applies to a
         * canvas. Which object was under the pointer is resolved here rather
         * than in the menu: the stage already knows, and asking again from
         * screen coordinates would be a second hit test that could disagree
         * with the one that drew the selection.
         */
        onContextMenu={(e) => {
          e.evt.preventDefault();
          /**
           * Walk up until an ancestor carries a node id.
           *
           * A click lands on whatever leaf is under it — a `Path`, a `Text`, one
           * stroke of a sketch — and only the object's outermost `Group` carries
           * the id. Checking the target and one parent covered the simple
           * renderers and missed anything nested deeper, which is every sketched
           * shape and every labelled line: right-clicking one gave the
           * empty-board menu while plainly being on top of an object.
           */
          let cursor: { id?: () => string; getParent?: () => unknown } | null = e.target;
          let underPointer: string | null = null;
          for (let depth = 0; cursor && depth < 8; depth++) {
            const id = cursor.id?.();
            if (id && objects[id]) {
              underPointer = id;
              break;
            }
            cursor = (cursor.getParent?.() ?? null) as typeof cursor;
          }
          // Right-clicking something outside the current selection selects it
          // first, which is what every editor does — acting on a hidden
          // selection is how a menu deletes the wrong thing.
          /**
           * Right-clicking one member of a group targets the whole group.
           *
           * The left-click path already does this; the menu did not, so a
           * grouped flowchart right-clicked on one of its boxes offered actions
           * for that box alone. Grouping is the clearest signal a person can
           * give that a set of objects is one thing — it is the answer to "how
           * does the canvas know this is a diagram" — so the menu has to read
           * it the same way selection does.
           */
          const grouped = (id: string): string[] =>
            selectionWithin(
              Object.keys(objects),
              objects as Record<string, { id: string; parentId?: string }>,
              groups,
              id,
              enteredGroupRef.current
            );

          const ids = underPointer
            ? selectedIds.includes(underPointer)
              ? selectedIds
              : grouped(underPointer)
            : [];
          if (underPointer && !selectedIds.includes(underPointer)) setSelectedIds?.(ids);
          onRequestContextMenu?.({ x: e.evt.clientX, y: e.evt.clientY, ids });
        }}
        draggable={false} // Disable Konva dragging. We will pan manually, or let Spacebar trigger pan in mouse events.
      >
        {/* The board's content, in its own layer so that redrawing the
            chrome (a marquee, a handle, a guide) does not repaint every
            object, and so its hit graph can be switched off while panning. */}
        <Layer ref={contentLayerRef}>
          {mountedIds.map((id) => (
            <ObjectRenderer
              key={id}
              objId={id}
              isSelected={selectedSet.has(id)}
              onSelect={handleObjectSelect}
              selectable={canSelectWith(activeTool)}
              canDuplicate={activeTool === 'select'}
              onThrow={handleThrow}
              selectedIdsRef={selectedIdsRef}
            />
          ))}
        </Layer>

        {/* Chrome: everything drawn over the content that is not the content. */}
        <Layer>
          <DataLinkOverlay selectedIds={selectedIds} />
          <LayerHoverOutline />

          {/* The force field, drawn at the radius the simulation will actually
              use. Non-interactive so it never intercepts the press that applies
              the force. */}
          {activeForce && (
            <Group ref={forceRingRef} listening={false} visible={false} name={EXPORT_CHROME}>
              {/* Scaled by the Area control. Without this the ring would keep
                  drawing the force's built-in radius while the simulation used
                  the adjusted one — a sight worse than no ring at all, because
                  it would be confidently wrong about where the force reaches. */}
              <Circle
                radius={activeForce.radius * forceRadiusScale}
                stroke={activeForce.colorToken}
                strokeWidth={2}
                dash={[10, 8]}
                opacity={0.7}
              />
              <Circle
                radius={activeForce.radius * forceRadiusScale}
                fill={activeForce.colorToken}
                opacity={0.06}
              />
              {/* A solid centre mark, so the point the force originates from is
                  unmistakable even when the ring runs off-screen. */}
              <Circle radius={5} fill={activeForce.colorToken} />
            </Group>
          )}

          {/* One shared Transformer for the whole canvas. */}
          {/* Hidden while cropping: the crop overlay draws its own handles on
              the same rectangle, and two sets of handles on one object is a
              question with no right answer for whichever one you grab. */}
          {/* Text editing joins the same guard. A text node is *selected*
              while you type into it, so the handles attached themselves to its
              box and sat over the words — and on a fresh node that box is the
              provisional seed size, which is why they appeared as a crumpled
              cluster rather than a frame. You cannot resize and type at the
              same time; they come back the moment the caret leaves. */}
          {/* `canTransform` is view mode: resize handles on a board whose edits
              cannot sync are an invitation to work that gets thrown away. */}
          {canTransform && !croppingId && !reframingId && !editingPathId && !editingTextId && activeTool !== 'direct-select' && (
            <SelectionTransformer selectedIds={selectedIds} stageRef={stageRef} />
          )}

          {/* A line is edited at its two ends. The transformer stands down for
              a solo line — see its own note — so exactly one set of handles is
              ever on screen. */}
          <ZoomScope>{(zoom) => (<>
          {!croppingId && !reframingId && !editingPathId && !editingTextId && activeTool !== 'direct-select' && selectedIds.length === 1 && (() => {
            const only = objects[selectedIds[0]];
            if (!only) return null;
            if (isLineLike(only)) {
              return <LineEditor node={only as ShapeNode} stageScale={zoom} />;
            }
            // A connector is edited at its ends for the same reason, and the
            // transformer stands down for it under the same rule.
            if (only.type === 'connector') {
              return <ConnectorEditor node={only as ConnectorNode} stageScale={zoom} />;
            }
            // The corner knob rides *alongside* the transformer rather than
            // replacing it: rounding a corner is not an alternative to resizing
            // the way editing a line's ends is, it is a second thing you do to
            // the same box. Rect only — it is the one kind that has corners.
            // Any closed shape: the knob finds the shape's own corners rather
            // than assuming a rectangle's, and shows nothing when there are
            // none — see `cornersOf`. Open runs are excluded because a line
            // has no corner to round.
            if (only.type === 'shape' && !isOpenShape(only.geometry?.kind) && !only.locked) {
              return (
                <>
                  <CornerRadiusHandle node={only as ShapeNode} stageScale={zoom} />
                  <ShapeParamHandles node={only as ShapeNode} stageScale={zoom} />
                </>
              );
            }
            return null;
          })()}

          {/* Above the transformer's slot so its handles are never buried
              under a selection outline drawn afterwards. */}
          <CropOverlay />

          {/* The module holds still and the picture moves inside it. No
              handles, because the box belongs to the grid. */}
          <SlotReframeOverlay />

          {/* Anchors and handles. Hidden behind the same rule the crop
              overlay hides the transformer with: a resize box drawn around a
              path you are editing point by point is a second set of handles
              answering a different question. */}
          <PathEditor stageScale={zoom} />

          {/* Guides a person placed. Below the snap guides, because a snap
              guide explains what is happening right now and has to win. */}
          <RulerGuides stageScale={zoom} width={dimensions.width} height={dimensions.height} />

          {/* Alignment and spacing guides. Above everything, because they are
              the explanation for a snap and are useless if an object can cover
              them — which the object being dragged routinely would. */}
          <SmartGuides stageScale={zoom} />
          <MeasureOverlay selectedIds={selectedIds} />

          {/* Tool previews: the marquee, a frame's size readout, the pen's stroke. */}
          <ToolOverlay toolManager={toolManager} />

          {/* The shape a combine would produce, while the pointer is on its
              button. Four icons of two overlapping squares cannot say which of
              union, subtract, intersect and exclude you want — the answer
              depends on which shape is in front and what the overlap actually
              is, neither of which an icon can show. Drawn from the same
              geometry the button will commit, so the outline is the result. */}
          {booleanGhost && (
            <Group name={EXPORT_CHROME} listening={false}>
              <Path
                data={contourData(booleanGhost)}
                fill="rgba(59, 130, 246, 0.14)"
                fillRule="evenodd"
                stroke="#3B82F6"
                strokeWidth={1.5 / zoom}
                dash={[6 / zoom, 4 / zoom]}
              />
            </Group>
          )}
          </>)}</ZoomScope>
        </Layer>
      </Stage>
      {/* Canvas-space DOM overlays: positioned to match the Stage's exact coordinate origin (including rulerInset). */}
      <div
        className="canvas-overlays"
        style={{
          position: 'absolute',
          top: rulerInset,
          left: rulerInset,
          width: Math.max(1, dimensions.width - rulerInset),
          height: Math.max(1, dimensions.height - rulerInset),
          pointerEvents: 'none',
          overflow: 'hidden',
        }}
      >
        <PresenceRenderer />
        <GestureOverlay />
        <FramePresenter />
        <CommentsOverlay
          comments={comments}
          objects={objects}
          onAddComment={handleAddComment}
          onAddReply={handleAddReply}
          onEditMessage={handleEditMessage}
          onDeleteMessage={handleDeleteMessage}
          onResolveComment={handleResolveComment}
          currentAuthorId={currentAuthorId}
        />
      </div>

      <AudioRecordingOverlay
        onStop={() => toolManager.handlePointerDown({ target: { getStage: () => stageRef.current } })}
      />
      
    </div>
  );
};

/** Re-renders its children, and only them, when the camera zoom changes. */
const ZoomScope: React.FC<{ children: (zoom: number) => React.ReactNode }> = ({ children }) => {
  const zoom = useCameraZoom();
  return <>{children(zoom)}</>;
};

/**
 * The active tool's live preview — marquee, shape being dragged out, pen
 * stroke. Wrapped rather than tagged per tool: a new tool would otherwise have
 * to remember, and forgetting means its preview lands in someone's export.
 */
const ToolOverlay: React.FC<{ toolManager: ToolManager }> = ({ toolManager }) => {
  const overlay = useToolOverlay();
  return <Group name={EXPORT_CHROME}>{toolManager.renderOverlay(overlay)}</Group>;
};

const AudioRecordingOverlay: React.FC<{ onStop: () => void }> = ({ onStop }) => {
  const overlay = useToolOverlay();
  if (overlay?.type !== 'audio-recording') return null;
  return (
    <AudioRecordingHUD
      elapsedMs={overlay.elapsedMs || 0}
      levels={overlay.levels || []}
      remainingMs={overlay.remainingMs}
      paused={overlay.paused}
      silent={overlay.silent}
      onCancel={overlay.onCancel}
      onTogglePause={overlay.onTogglePause}
      onStop={onStop}
    />
  );
};
