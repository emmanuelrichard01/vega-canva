import { usePhysics } from '../hooks/usePhysics';
import React, { useRef, useState, useEffect, useCallback, useMemo, useSyncExternalStore } from "react";
import { Stage, Layer, Circle, Group } from "react-konva";
import Konva from "konva";
import { provider, updateNode, nextZIndex, lowestZIndex } from '../engine/document';
import { nanoid } from 'nanoid';
import { useStore } from '../hooks/useStore';
import { FORCE_SPECS, isForceTool } from '../engine/physics/forces';
import { editor } from '../engine/api/EditorAPI';
import { ObjectRenderer } from "./ObjectRenderer";
import { PresenceRenderer } from "../engine/presence/PresenceRenderer";
import { presenceManager } from "../engine/presence/PresenceManager";

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
import { ToolManager, SelectTool, ShapeTool, TextTool, StickyTool, AudioTool, PenTool, BezierPenTool, HandTool, EraserTool, CommentTool, FrameTool } from '../engine/tools';
import { CommentsOverlay } from "./CommentsOverlay";
import { AudioRecordingHUD } from "./AudioRecordingHUD";
import { useComments } from "../hooks/useComments";
import { engineEvents } from '../engine/EventBus';
import { canvasEngine } from '../engine/CanvasEngine';
import { cameraSystem } from '../engine/CameraSystem';
import { useVisibleSet } from '../engine/useVisibleSet';
import { DEFAULT_TYPOGRAPHY } from '../engine/model/schema';
import { SelectionTransformer } from './canvas/SelectionTransformer';
import { CropOverlay } from './canvas/CropOverlay';
import { cropMode } from '../engine/interaction/cropMode';
import { FRAME_PRESETS } from '../engine/model/frames';
import { deleteNodesWithFrames } from '../engine/interaction/frameMembership';

interface CanvasProps {
  activeTool: string;
  selectedIds: string[];
  setSelectedIds: React.Dispatch<React.SetStateAction<string[]>>;
}

export const navigateToViewport = (x: number, y: number, zoom: number) => {
  window.dispatchEvent(new CustomEvent('navigateViewport', { detail: { x, y, zoom } }));
};


export const Canvas: React.FC<CanvasProps> = ({ activeTool, selectedIds, setSelectedIds }) => {
  const stageRef = useRef<Konva.Stage>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  // There used to be a derived `selectedId` and a `setSelectedId` helper here,
  // for the code paths that only ever deal with one object. Both were removed:
  // each was a fresh value on every render, and the effects that closed over
  // them could not state that honestly in a dependency list. The single-object
  // paths now narrow `selectedIds` where they use it, and call the stable
  // `setSelectedIds` directly.

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

  // -- crop mode ------------------------------------------------------------

  const cropSnapshot = useSyncExternalStore(
    cropMode.subscribe,
    cropMode.getSnapshot,
    cropMode.getSnapshot
  );
  const croppingId = cropSnapshot?.nodeId ?? null;

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
      const el = document.activeElement?.tagName;
      if (el === 'INPUT' || el === 'TEXTAREA') return;
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

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Do not intercept if user is typing in an input or textarea
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;
      // Viewing history is read-only. The canvas is showing a past state while
      // the live document sits untouched behind it, so Delete or Cmd+D here
      // would edit objects the user cannot currently see. Read through
      // getState() rather than subscribing: this is an event-time question, and
      // a dependency would re-register the listener on every replay frame.
      if (useStore.getState().isReplaying) return;
      if (selectedIds.length === 0) return;

      if (e.key === 'Escape') {
        setSelectedIds([]);
        return;
      }

      if (e.key === 'Backspace' || e.key === 'Delete') {
        // Through the frame-aware path: deleting a frame has to take its
        // contents, or they are stranded in place still pointing at it.
        deleteNodesWithFrames(selectedIds);
        setSelectedIds([]);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'd') {
        e.preventDefault();
        // Duplicate from the canonical store rather than the raw Y.Map, so a
        // clone of a legacy node is written back in the current schema.
        const store = useStore.getState().objects;
        const newIds = selectedIds.map(id => {
          const obj = store[id];
          if (!obj) return null;
          const cloneId = nanoid();
          editor.createNode({ ...obj, id: cloneId, x: obj.x + 20, y: obj.y + 20 });
          return cloneId;
        }).filter(Boolean) as string[];
        setSelectedIds(newIds);
        return;
      }
      // These used to read `o.zIndex` off the Y.Map instances returned by
      // objectsMap.values(). A Y.Map exposes its fields through .get(), not as
      // plain properties, so every read was `undefined || 0` — meaning maxZ
      // and minZ were *always* 0 and both shortcuts assigned a fixed 1,2,3…
      // regardless of what was actually on the canvas. nextZIndex/
      // lowestZIndex read the document correctly.
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === ']') {
        e.preventDefault();
        const top = nextZIndex();
        selectedIds.forEach((id, i) => updateNode(id, { zIndex: top + i }));
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === '[') {
        e.preventDefault();
        const bottom = lowestZIndex();
        selectedIds.forEach((id, i) => updateNode(id, { zIndex: bottom - selectedIds.length + i }));
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        editor.ungroupNodes(selectedIds);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        editor.groupNodes(selectedIds);
        return;
      }

      // Everything below only makes sense for exactly one selected object.
      if (selectedIds.length !== 1) return;
      // Narrow to the sole id here rather than closing over a value derived up
      // in the component body. Identical result, but the dependency list can be
      // checked statically instead of resting on a reader noticing that the
      // outer value was a function of `selectedIds` all along.
      const soleId = selectedIds[0];
      const obj = useStore.getState().objects[soleId];
      if (!obj) return;

      // Typography lives in one canonical place now, so Cmd+B/I/U and the
      // Properties panel write the same fields — previously the shortcuts
      // wrote content.fontWeight/fontStyle/textDecoration while the renderer
      // read a different set, so none of the three had any visible effect.
      const styled = obj.type === 'text' || obj.type === 'shape' || obj.type === 'sticky';
      if (styled && (e.metaKey || e.ctrlKey) && 'biu'.includes(e.key.toLowerCase())) {
        const typography = (obj as any).typography ?? DEFAULT_TYPOGRAPHY;
        e.preventDefault();
        if (e.key.toLowerCase() === 'b') {
          updateNode(soleId, {
            typography: { ...typography, fontWeight: typography.fontWeight >= 600 ? 400 : 700 },
          });
        } else if (e.key.toLowerCase() === 'i') {
          updateNode(soleId, { typography: { ...typography, italic: !typography.italic } });
        } else {
          updateNode(soleId, { typography: { ...typography, underline: !typography.underline } });
        }
        return;
      }
      if (e.key === 'Enter') {
        if (obj.type === 'text' || obj.type === 'sticky' || obj.type === 'comment') {
          e.preventDefault();
          // We can't directly trigger isEditing inside ObjectRenderer from Canvas easily without an event or ref.
          // But since ObjectRenderer listens to global clicks, we can dispatch an event to the document that ObjectRenderer can catch.
          // For now we'll fire a custom event that ObjectRenderer can listen to.
          document.dispatchEvent(new CustomEvent('requestEditNode', { detail: { id: soleId } }));
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedIds, setSelectedIds]);

  useEffect(() => {
    const handleNavigate = (e: any) => {
      const { x, y, zoom } = e.detail;
      const startX = cameraSystem.x;
      const startY = cameraSystem.y;
      const startZoom = cameraSystem.zoom;

      const targetX = (window.innerWidth / 2) - (x * zoom);
      const targetY = (window.innerHeight / 2) - (y * zoom);

      const duration = 600;
      const start = performance.now();

      const animate = (time: number) => {
        const progress = Math.min((time - start) / duration, 1);
        const ease = 1 - Math.pow(1 - progress, 4);
        
        cameraSystem.x = startX + (targetX - startX) * ease;
        cameraSystem.y = startY + (targetY - startY) * ease;
        cameraSystem.zoom = startZoom + (zoom - startZoom) * ease;
        engineEvents.emit('CameraChanged', cameraSystem);

        if (progress < 1) {
          requestAnimationFrame(animate);
        }
      };
      requestAnimationFrame(animate);
    };
    window.addEventListener('navigateViewport', handleNavigate);
    return () => window.removeEventListener('navigateViewport', handleNavigate);
  }, []);

  useEffect(() => {
    const handleSelectNode = (e: any) => {
      // Calls the stable `setSelectedIds` directly. This went through a
      // single-object helper defined in the component body, which was a fresh
      // closure every render — so listing it as a dependency would have torn
      // down and re-registered both listeners on every single render.
      const id = e.detail?.id ?? null;
      setSelectedIds(id ? [id] : []);
    };
    const handleMarqueeSelect = (e: any) => {
      const { minX, minY, maxX, maxY, additive } = e.detail;
      const storeObjects = Object.values(useStore.getState().objects);

      // Collect every object that intersects the marquee box, not just the first.
      const found = storeObjects
        .filter((obj) => {
          if (obj.locked || obj.hidden) return false;
          return obj.x < maxX && obj.x + obj.width > minX && obj.y < maxY && obj.y + obj.height > minY;
        })
        .map((obj) => obj.id);

      if (additive) {
        setSelectedIds(prev => Array.from(new Set([...prev, ...found])));
      } else {
        setSelectedIds(found);
      }
    };

    document.addEventListener('requestSelectNode', handleSelectNode);
    document.addEventListener('marqueeSelect', handleMarqueeSelect);
    return () => {
      document.removeEventListener('requestSelectNode', handleSelectNode);
      document.removeEventListener('marqueeSelect', handleMarqueeSelect);
    };
  }, [setSelectedIds]);

  const { visibleIds } = useVisibleSet();
  const objects = useStore(state => state.objects);
  const { handleThrow, applyGlobalForce, beginHeldForce, moveHeldForce, endHeldForce } = usePhysics(objects, stageRef);

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

  useEffect(() => {
    const updateSize = () => {
      if (!containerRef.current) return;
      const w = containerRef.current.clientWidth || window.innerWidth;
      const h = containerRef.current.clientHeight || window.innerHeight;
      // A backgrounded tab reports clientWidth AND window.innerWidth as 0, so
      // this fallback chain still resolved to zero and collapsed the stage to
      // a degenerate size — which makes the viewport-culling bounds meaningless
      // and, if an export runs while the tab is hidden, gets that zero size
      // restored afterwards. Keeping the last good size is always closer to
      // correct than zero; a real resize fires again on focus.
      if (w <= 0 || h <= 0) return;
      setDimensions({ width: w, height: h });
      cameraSystem.resize(w, h);
    };
    
    const observer = new ResizeObserver(() => {
      updateSize();
    });

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }
    updateSize(); // Initial sizing

    return () => observer.disconnect();
  }, []);

  // The viewport used to be published from *here as well*, with a raw
  // `setLocalStateField` on every `CameraChanged` — the same two-writer bug
  // that the `cursor` field had, and worse in one way: it had no throttle at
  // all, so a single pan broadcast an awareness update on every frame to
  // every peer, and every peer's presence subscribers woke up for each one.
  // The one publisher is the `presenceManager.updateViewport` call further
  // down, which shares the 15Hz gate with everything else ephemeral.

  // Update selection awareness
  useEffect(() => {
    provider.awareness?.setLocalStateField("selection", selectedIds);
  }, [selectedIds]);

  const {
    comments,
    addComment: handleAddComment,
    addReply: handleAddReply,
    editMessage: handleEditMessage,
    deleteMessage: handleDeleteMessage,
    resolveComment: handleResolveComment,
    currentAuthorId,
  } = useComments();

  const handleObjectSelect = useCallback((id: string, e?: any) => {
    if (activeTool !== 'select') return;
    const isShift = !!e?.evt?.shiftKey;

    // Clicking any member of a group selects the whole group, matching
    // Figma/Illustrator — you have to explicitly ungroup (or, in richer
    // editors, double-click to "enter" the group) to work with one member
    // alone. We don't implement enter-group; that's a deliberate scope cut.
    const clicked = objects[id];
    const groupIds = clicked?.parentId
      ? Object.values(objects).filter((o: any) => o.parentId === clicked.parentId).map((o: any) => o.id)
      : [id];

    if (isShift) {
      setSelectedIds(prev => {
        const allIn = groupIds.every(gid => prev.includes(gid));
        return allIn ? prev.filter(x => !groupIds.includes(x)) : Array.from(new Set([...prev, ...groupIds]));
      });
    } else {
      setSelectedIds(groupIds);
    }
  }, [activeTool, setSelectedIds, objects]);

  const sortedObjects = useMemo(() => {
    return Object.values(objects).sort((a: any, b: any) => (a.zIndex || 0) - (b.zIndex || 0));
  }, [objects]);

  const visibleObjects = useMemo(() => {
    const storeObjects = Object.values(objects);
    if (storeObjects.length === 0) return [];

    // There used to be a Time Travel bypass here that rendered every object in
    // the document while replaying, because replay snapshots never reached the
    // spatial index. `applyReplaySnapshot` now keeps the index in sync, so
    // replay culls like any other frame and the bypass — a performance cliff on
    // exactly the large documents culling exists for — is gone. Nothing needs to
    // gate on `isReplaying` in this memo any more.

    // If spatial culling returned IDs, use them — but always include selected + anything
    // in the store that the spatial index missed (race-condition guard).
    if (visibleIds.length > 0) {
      const visibleSet = new Set(visibleIds);
      selectedIds.forEach(id => visibleSet.add(id));

      // Include all objects from store — the spatial index is advisory, not authoritative.
      // This prevents the "objects exist in layers but not canvas" bug.
      const result = sortedObjects.filter((o: any) => visibleSet.has(o.id));
      
      // If spatial culling returned fewer objects than the store has, and the difference
      // is significant, fall back to showing everything (spatial index probably hasn't caught up)
      if (result.length < storeObjects.length * 0.5 && storeObjects.length < 500) {
        return storeObjects.sort((a: any, b: any) => (a.zIndex || 0) - (b.zIndex || 0));
      }
      return result;
    }
    
    // Fallback: show all store objects sorted by z-index
    return storeObjects.sort((a: any, b: any) => (a.zIndex || 0) - (b.zIndex || 0));
  }, [sortedObjects, visibleIds, selectedIds, objects]);

  // The engine pushes RenderTick every frame. We apply camera to Konva and Grid directly bypassing React!
  useEffect(() => {
    const handleRenderTick = () => {
      if (stageRef.current) {
        stageRef.current.position({ x: cameraSystem.x, y: cameraSystem.y });
        stageRef.current.scale({ x: cameraSystem.zoom, y: cameraSystem.zoom });
      }
      if (containerRef.current) {
        containerRef.current.style.backgroundPosition = `${cameraSystem.x}px ${cameraSystem.y}px`;
        containerRef.current.style.backgroundSize = `${20 * cameraSystem.zoom}px ${20 * cameraSystem.zoom}px`;
      }

      // The force field ring rides the same imperative path as the camera. It
      // was React state written on every mousemove, which re-rendered the whole
      // canvas 60 times a second precisely while a force was being applied —
      // the one moment the frame budget is already spoken for.
      const ring = forceRingRef.current;
      if (ring) {
        const cursor = forceCursorRef.current;
        if (cursor) {
          ring.position(cursor);
          ring.visible(true);
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

  // Room.tsx's export handlers (and ExportModal) read this to reach
  // PNGExporter, which requires a live Stage reference — Canvas.tsx is the
  // only component that actually has one. Without this assignment the global
  // was always undefined, so every PNG export silently failed (Room.tsx's
  // handler no-ops on a falsy stage) or threw (ExportModal calls
  // ExportService directly with no stage at all). There used to be a second,
  // completely separate 'export-png' handler here too, downloading straight
  // from stage.toDataURL() and bypassing ExportService/PNGExporter entirely —
  // two uncoordinated implementations of the same feature, only one of which
  // could ever have actually run depending on which handler happened to fire.
  useEffect(() => {
    (window as any)._konva_stage = stageRef.current;
    return () => {
      if ((window as any)._konva_stage === stageRef.current) {
        (window as any)._konva_stage = null;
      }
    };
  }, []);

  // Reads the pointer from the stage rather than the event, so it works
  // identically for mouse and touch.
  //
  // Both of these go through `presenceManager` rather than writing awareness
  // directly. It owns the throttle and the idle timer, and — the reason this
  // changed — it is now the only writer of the `cursor` field, so leaving the
  // canvas actually clears it instead of being overwritten by the next
  // presence update. See the comment on `PresenceEngine`.
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

  /**
   * Wheel and trackpad, bound natively and exactly once.
   *
   * This used to be a React `onWheel` on *both* the container and the Stage.
   * That was two bugs at once:
   *
   * 1. **It fired twice.** Konva's stage handler ran, and the same native
   *    event then bubbled to the container's React handler, so every scroll
   *    panned and every pinch zoomed twice as far as it should.
   * 2. **`preventDefault` did nothing.** React attaches wheel listeners as
   *    passive, so the call was rejected — hundreds of "Unable to
   *    preventDefault inside passive event listener invocation" warnings, and,
   *    worse, the browser went on to apply its own page zoom and scroll on top
   *    of the canvas camera.
   *
   * A passive listener cannot be opted out of through the React prop, so this
   * has to be bound directly. `{ passive: false }` is the entire point.
   */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheel = (evt: WheelEvent) => {
      evt.preventDefault();
      if (evt.ctrlKey) {
        // The browser reports a trackpad pinch as ctrl+wheel with a continuous
        // delta, so pass it through rather than reducing the gesture to a
        // direction and a fixed step.
        cameraSystem.zoomByWheel(evt.deltaY, evt.clientX, evt.clientY);
      } else {
        cameraSystem.pan(evt.deltaX, evt.deltaY);
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  /**
   * Two-finger pinch-zoom and pan.
   *
   * Touch handling previously routed `onTouchMove` straight into the
   * single-pointer mouse-move path, so a canvas billed as responsive had no
   * pinch-zoom and no two-finger pan at all — on a tablet the only way to
   * move around an infinite canvas was the Hand tool, and there was no way
   * whatsoever to zoom. A second finger also silently kept driving whatever
   * tool was active, so pinching on a touch device drew shapes.
   */
  const pinchRef = useRef<{ dist: number; midX: number; midY: number } | null>(null);
  const isMultiTouchRef = useRef(false);

  const touchMetrics = (touches: TouchList) => {
    const [a, b] = [touches[0], touches[1]];
    const dx = b.clientX - a.clientX;
    const dy = b.clientY - a.clientY;
    return {
      dist: Math.hypot(dx, dy) || 1,
      midX: (a.clientX + b.clientX) / 2,
      midY: (a.clientY + b.clientY) / 2,
    };
  };

  const handleTouchStartNative = (e: React.TouchEvent) => {
    if (e.touches.length >= 2) {
      isMultiTouchRef.current = true;
      pinchRef.current = touchMetrics(e.touches as unknown as TouchList);
      // Cancel any tool interaction the first finger already began.
      toolManager.handlePointerUp({ target: { getStage: () => stageRef.current } });
      setOverlayState(null);
    }
  };

  const handleTouchMoveNative = (e: React.TouchEvent) => {
    if (e.touches.length < 2 || !pinchRef.current) return;
    e.preventDefault();

    const next = touchMetrics(e.touches as unknown as TouchList);
    const prev = pinchRef.current;

    cameraSystem.zoomBy(next.dist / prev.dist, next.midX, next.midY);
    // Panning uses the midpoint delta, so the gesture translates and scales
    // in one motion the way it does in every native map/photo viewer.
    cameraSystem.panBy(next.midX - prev.midX, next.midY - prev.midY);

    pinchRef.current = next;
  };

  const handleTouchEndNative = (e: React.TouchEvent) => {
    if (e.touches.length < 2) {
      pinchRef.current = null;
      // Stay latched until every finger lifts, so the remaining finger of a
      // finished pinch doesn't get interpreted as the start of a drag.
      if (e.touches.length === 0) isMultiTouchRef.current = false;
    }
  };

  /**
   * Publish where this client is looking, so other people stay on the radar.
   *
   * The camera is the durable presence signal — it says where someone is
   * working even when they are reading rather than moving the mouse, or have
   * the pointer over a panel. The cursor cannot do that job: it is correctly
   * cleared when the pointer leaves the canvas, which is exactly when a
   * collaborator used to disappear from the minimap entirely.
   *
   * `cameraSystem.x/y` is the stage translate, so the world point at the
   * top-left of the screen is `-x / zoom`.
   */
  useEffect(() => {
    const publish = () => {
      presenceManager.updateViewport({
        x: -cameraSystem.x / cameraSystem.zoom,
        y: -cameraSystem.y / cameraSystem.zoom,
        width: cameraSystem.width,
        height: cameraSystem.height,
        zoom: cameraSystem.zoom,
      });
    };
    publish();
    engineEvents.on('CameraChanged', publish);
    return () => { engineEvents.off('CameraChanged', publish); };
  }, []);

  // Push ephemeral state to PresenceManager
  useEffect(() => {
    presenceManager.updateTool(activeTool);
  }, [activeTool]);

  useEffect(() => {
    presenceManager.updateSelection(selectedIds);
  }, [selectedIds]);

  const [overlayState, setOverlayState] = useState<any>(null);
  // Dedicated HandTool instance for the "hold Space to pan" convention,
  // independent of whatever tool is actually active — see handleStageClick/
  // handleMouseMoveExt/handleMouseUp below for why this needs its own
  // pointer-event routing rather than going through toolManager.
  const spacePanTool = useRef(new HandTool()).current;
  const spacePanActiveRef = useRef(false);
  const toolManager = useMemo(() => {
    const tm = new ToolManager({ editor, camera: cameraSystem, setOverlayState });
    tm.registerTool(new SelectTool());
    tm.registerTool(new ShapeTool('rect'));
    tm.registerTool(new ShapeTool('ellipse'));
    tm.registerTool(new ShapeTool('triangle'));
    tm.registerTool(new ShapeTool('hexagon'));
    tm.registerTool(new ShapeTool('star'));
    tm.registerTool(new TextTool());
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
    FRAME_PRESETS.forEach((preset) => tm.registerTool(new FrameTool(preset.id)));
    return tm;
  }, []);

  useEffect(() => {
    let mappedTool = activeTool;
    if (activeTool === 'shape' || activeTool === 'shape-rect') mappedTool = 'shape-rect';
    else if (activeTool === 'shape-ellipse') mappedTool = 'shape-ellipse';
    else if (activeTool === 'shape-triangle') mappedTool = 'shape-triangle';
    else if (activeTool === 'shape-hexagon') mappedTool = 'shape-hexagon';
    else if (activeTool === 'shape-star') mappedTool = 'shape-star';
    toolManager.setActiveTool(mappedTool);
  }, [activeTool, toolManager]);

  // ToolManager.handleKeyDown existed but nothing ever called it — tools
  // implementing onKeyDown (e.g. Escape/Enter to finish a bezier path) never
  // actually received keyboard events.
  useEffect(() => {
    const handleToolKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;
      toolManager.handleKeyDown(e);
    };
    window.addEventListener('keydown', handleToolKeyDown);
    return () => window.removeEventListener('keydown', handleToolKeyDown);
  }, [toolManager]);

  const handleStageClick = (e: any) => {
    // A pinch in progress owns the viewport; tools must not also fire.
    if (isMultiTouchRef.current) return;
    // Holding Space is meant to be a temporary pan override regardless of
    // whatever tool is actually active (the Figma/Photoshop convention) —
    // this used to just bail out here with a comment claiming it prevented
    // "creating objects while panning", but nothing ever actually panned:
    // toolManager.handlePointerDown was skipped (so Hand's own drag-tracking
    // never started either, since Hand usually isn't the active tool during
    // a space-hold) and handleMouseMoveExt below only ever forwarded to
    // whichever tool WAS active. Routing straight to a dedicated HandTool
    // instance is what actually makes the space-pan gesture work.
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
        if (activeTool === 'shockwave') {
          // An impulse, not a hold — one burst per press.
          applyGlobalForce(x, y, 'shockwave');
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
    handleMouseMove(); // keep existing awareness broadcast

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
    toolManager.handlePointerUp(e);
  };

  // Remote cursors and selections are DOM overlays (RemoteCursors,
  // PresenceRenderer). The local pointer is the OS one.

  return (
    <div
      className="canvas-container relative w-full h-full overflow-hidden select-none"
      // `index.css` resolves this to a real CSS cursor. A coarse pointer has
      // no cursor to style, so the rule is simply ignored there — which is why
      // the old touch special-case is gone.
      data-cursor-mode={cursorMode}
      style={{ touchAction: 'none' }}
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onTouchStart={handleTouchStartNative}
      onTouchMove={handleTouchMoveNative}
      onTouchEnd={handleTouchEndNative}
      onTouchCancel={handleTouchEndNative}
    >
      {/* Our own pointer, over the canvas only. It sets `data-custom-cursor`
          on this container itself, so if it bails out — touch, forced colors —
          the native `[data-cursor-mode]` cursors stay in force. */}
      <LocalCursor mode={cursorMode} containerRef={containerRef} />
      <Stage
        ref={stageRef}
        width={dimensions.width}
        height={dimensions.height}
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
        draggable={false} // Disable Konva dragging. We will pan manually, or let Spacebar trigger pan in mouse events.
      >
        <Layer>
          {visibleObjects.map((obj: any) => {
            const id = typeof obj === 'string' ? obj : obj.id;
            return (
              <ObjectRenderer
                key={id}
                objId={id}
                isSelected={selectedIds.includes(id)}
                onSelect={handleObjectSelect}
                onThrow={handleThrow}
                stageScale={cameraSystem.zoom}
                selectedIdsRef={selectedIdsRef}
              />
            );
          })}

          {/* The force field, drawn at the radius the simulation will actually
              use. Non-interactive so it never intercepts the press that applies
              the force. */}
          {activeForce && (
            <Group ref={forceRingRef} listening={false} visible={false}>
              <Circle
                radius={activeForce.radius}
                stroke={activeForce.colorToken}
                strokeWidth={2}
                dash={[10, 8]}
                opacity={0.7}
              />
              <Circle radius={activeForce.radius} fill={activeForce.colorToken} opacity={0.06} />
              {/* A solid centre mark, so the point the force originates from is
                  unmistakable even when the ring runs off-screen. */}
              <Circle radius={5} fill={activeForce.colorToken} />
            </Group>
          )}

          {/* One shared Transformer for the whole canvas.
              There used to be one mounted per object — with 100 objects that
              is 100 Transformer instances, 99 of them holding an empty node
              list and each still participating in layer draws. */}
          {/* Hidden while cropping: the crop overlay draws its own handles on
              the same rectangle, and two sets of handles on one object is a
              question with no right answer for whichever one you grab. */}
          {!croppingId && <SelectionTransformer selectedIds={selectedIds} stageRef={stageRef} />}

          {/* Above the transformer's slot so its handles are never buried
              under a selection outline drawn afterwards. */}
          <CropOverlay />

          {toolManager.renderOverlay(overlayState)}
        </Layer>
      </Stage>
      <PresenceRenderer />
      <GestureOverlay />
      {overlayState?.type === 'audio-recording' && (
        <AudioRecordingHUD
          elapsedMs={overlayState.elapsedMs || 0}
          level={overlayState.level || 0}
          levels={overlayState.levels || []}
          remainingMs={overlayState.remainingMs}
          onCancel={overlayState.onCancel}
          onStop={() => toolManager.handlePointerDown({ target: { getStage: () => stageRef.current } })}
        />
      )}
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
  );
};


