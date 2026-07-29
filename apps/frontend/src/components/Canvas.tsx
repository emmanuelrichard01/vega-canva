import { usePhysics } from '../hooks/usePhysics';
import React, { useRef, useState, useEffect, useCallback, useMemo } from "react";
import { Stage, Layer } from "react-konva";
import Konva from "konva";
import { provider, deleteNode, updateNode, nextZIndex, lowestZIndex } from '../engine/document';
import { nanoid } from 'nanoid';
import { useStore } from '../hooks/useStore';
import { editor } from '../engine/api/EditorAPI';
import { ObjectRenderer } from "./ObjectRenderer";
import { PresenceRenderer } from "../engine/presence/PresenceRenderer";
import { presenceManager } from "../engine/presence/PresenceManager";
import { cursorManager } from '../engine/cursor/CursorManager';
import { GestureOverlay } from "./GestureOverlay";
import { ToolManager, SelectTool, ShapeTool, TextTool, StickyTool, AudioTool, PenTool, BezierPenTool, HandTool, EraserTool, CommentTool } from '../engine/tools';
import { CommentsOverlay } from "./CommentsOverlay";
import { AudioRecordingHUD } from "./AudioRecordingHUD";
import { useComments } from "../hooks/useComments";
import { engineEvents } from '../engine/EventBus';
import { canvasEngine } from '../engine/CanvasEngine';
import { cameraSystem } from '../engine/CameraSystem';
import { useVisibleSet } from '../engine/useVisibleSet';
import { DEFAULT_TYPOGRAPHY } from '../engine/model/schema';
import { SelectionTransformer } from './canvas/SelectionTransformer';

interface CanvasProps {
  activeTool: string;
  selectedIds: string[];
  setSelectedIds: React.Dispatch<React.SetStateAction<string[]>>;
}

/** Coarse pointer / no hover — used to skip cursor affordances that need a mouse. */
const isTouchDevice =
  typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches;

// Simple throttle
const useThrottle = (cb: Function, delay: number) => {
  const lastCall = useRef(0);
  return useCallback((...args: any[]) => {
    const now = new Date().getTime();
    if (now - lastCall.current >= delay) {
      lastCall.current = now;
      cb(...args);
    }
  }, [cb, delay]);
};

export const navigateToViewport = (x: number, y: number, zoom: number) => {
  window.dispatchEvent(new CustomEvent('navigateViewport', { detail: { x, y, zoom } }));
};


export const Canvas: React.FC<CanvasProps> = ({ activeTool, selectedIds, setSelectedIds }) => {
  const stageRef = useRef<Konva.Stage>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  // Single-object convenience accessor + a plain setter, for the many code
  // paths below (tool-created nodes, per-object keyboard shortcuts) that only
  // ever deal with one object at a time.
  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null;
  const setSelectedId = (id: string | null) => setSelectedIds(id ? [id] : []);

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

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Do not intercept if user is typing in an input or textarea
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;
      if (selectedIds.length === 0) return;

      if (e.key === 'Escape') {
        setSelectedIds([]);
        return;
      }

      if (e.key === 'Backspace' || e.key === 'Delete') {
        selectedIds.forEach(id => deleteNode(id));
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
      const obj = useStore.getState().objects[selectedId!];
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
          updateNode(selectedId!, {
            typography: { ...typography, fontWeight: typography.fontWeight >= 600 ? 400 : 700 },
          });
        } else if (e.key.toLowerCase() === 'i') {
          updateNode(selectedId!, { typography: { ...typography, italic: !typography.italic } });
        } else {
          updateNode(selectedId!, { typography: { ...typography, underline: !typography.underline } });
        }
        return;
      }
      if (e.key === 'Enter') {
        if (obj.type === 'text' || obj.type === 'sticky' || obj.type === 'comment') {
          e.preventDefault();
          // We can't directly trigger isEditing inside ObjectRenderer from Canvas easily without an event or ref.
          // But since ObjectRenderer listens to global clicks, we can dispatch an event to the document that ObjectRenderer can catch.
          // For now we'll fire a custom event that ObjectRenderer can listen to.
          document.dispatchEvent(new CustomEvent('requestEditNode', { detail: { id: selectedId } }));
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedIds]);

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
      setSelectedId(e.detail.id);
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
  const isReplaying = useStore(state => state.isReplaying);
  const { handleThrow, applyAttractRepel, commitNudges, applyGlobalForce } = usePhysics(objects, stageRef);

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

  // Update viewport awareness (handled by CameraSystem changes, but we still broadcast it here for legacy components)
  useEffect(() => {
    const handleCameraChange = () => {
      provider.awareness?.setLocalStateField("viewport", {
        x: -cameraSystem.x / cameraSystem.zoom,
        y: -cameraSystem.y / cameraSystem.zoom,
        zoom: cameraSystem.zoom,
        width: dimensions.width,
        height: dimensions.height,
      });
    };
    engineEvents.on('CameraChanged', handleCameraChange);
    return () => engineEvents.off('CameraChanged', handleCameraChange);
  }, [dimensions]);

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
    
    // Time Travel Replay bypass: replay snapshots don't update the Spatial Index
    // to save performance. So we render all objects directly during replay.
    if (isReplaying) {
      return storeObjects.sort((a: any, b: any) => (a.zIndex || 0) - (b.zIndex || 0));
    }
    
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

  useEffect(() => {
    if (containerRef.current) {
      // Space now pans regardless of the active tool (see handleStageClick),
      // so the cursor needs to reflect that universally too — previously
      // this only switched to the pan cursor when the Hand tool itself was
      // selected, so e.g. holding Space while the Shape tool was active
      // still showed a crosshair while you were actually panning.
      if (isSpacePressed) {
        cursorManager.setState('drag');
        return;
      }
      switch (activeTool) {
        case 'hand':
          cursorManager.setState('idle');
          break;
        case 'pen':
        case 'bezier-pen':
        case 'shape':
        case 'shape-rect':
        case 'shape-ellipse':
        case 'shape-triangle':
        case 'shape-hexagon':
        case 'shape-star':
          cursorManager.setState('draw');
          break;
        case 'eraser':
          cursorManager.setState('draw'); // or eraser specific state
          break;
        case 'text':
          cursorManager.setState('typing');
          break;
        case 'sticky':
        case 'comment':
          cursorManager.setState('comment');
          break;
        case 'select':
        default:
          cursorManager.setState('idle');
          break;
      }
    }
  }, [activeTool, isSpacePressed]);

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

  const updateCursor = useThrottle((x: number, y: number) => {
    provider.awareness?.setLocalStateField("cursor", { x, y });
  }, 66); // Throttle to 15Hz for massive bandwidth savings, local LERP smooths it

  // Reads the pointer from the stage rather than the event, so it works
  // identically for mouse and touch.
  const handleMouseMove = () => {
    const stage = stageRef.current;
    if (!stage) return;
    const pointerPosition = stage.getPointerPosition();
    if (pointerPosition) {
      const x = (pointerPosition.x - stage.x()) / stage.scaleX();
      const y = (pointerPosition.y - stage.y()) / stage.scaleY();
      updateCursor(x, y);
    }
  };

  const handleMouseLeave = () => {
    provider.awareness?.setLocalStateField("cursor", null);
  };

  const handleWheel = (e: any) => {
    const evt = e.evt || e;
    if (evt.preventDefault) evt.preventDefault();
    if (evt.ctrlKey) {
      const direction = evt.deltaY > 0 ? -1 : 1;
      cameraSystem.zoomAt(direction, evt.clientX, evt.clientY);
    } else {
      cameraSystem.pan(evt.deltaX, evt.deltaY);
    }
  };

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

    if (activeTool === 'shockwave') {
      const stage = stageRef.current;
      if (stage) {
        const pointerPosition = stage.getPointerPosition();
        if (pointerPosition) {
          const x = (pointerPosition.x - cameraSystem.x) / cameraSystem.zoom;
          const y = (pointerPosition.y - cameraSystem.y) / cameraSystem.zoom;
          applyGlobalForce(x, y, 'shockwave');
        }
      }
    }

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

    if (e.evt && e.evt.buttons === 1) { // Mouse is held down
      if (activeTool === 'magnet') {
        applyGlobalForce(x, y, 'magnet');
      } else if (activeTool === 'repel') {
        applyGlobalForce(x, y, 'repel');
      } else if (activeTool === 'wind') {
        applyGlobalForce(x, y, 'wind', { dx: e.evt.movementX, dy: e.evt.movementY });
      }
    }
  };

  const handleMouseUp = (e: any) => {
    if (isMultiTouchRef.current) return;
    if (spacePanActiveRef.current) {
      spacePanActiveRef.current = false;
      spacePanTool.onPointerUp({ editor, camera: cameraSystem, setOverlayState }, e);
      return;
    }
    toolManager.handlePointerUp(e);
  };

  // Cursors and remote selections are now handled via DOM overlay (PresenceRenderer)

  return (
    <div
      className="canvas-container relative w-full h-full overflow-hidden select-none"
      // `cursor: none` hides the system cursor in favour of the custom one,
      // but a touch device has no cursor to replace — and CursorRenderer only
      // tracks mousemove, so on touch this left no pointer feedback at all.
      style={{ touchAction: 'none', cursor: isTouchDevice ? 'default' : 'none' }}
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onWheel={handleWheel}
      onTouchStart={handleTouchStartNative}
      onTouchMove={handleTouchMoveNative}
      onTouchEnd={handleTouchEndNative}
      onTouchCancel={handleTouchEndNative}
    >
      <Stage
        ref={stageRef}
        width={dimensions.width}
        height={dimensions.height}
        x={cameraSystem.x}
        y={cameraSystem.y}
        scaleX={cameraSystem.zoom}
        scaleY={cameraSystem.zoom}
        onWheel={handleWheel}
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
                onDragMoveHandler={applyAttractRepel}
                onDragEndHandler={commitNudges}
                stageScale={cameraSystem.zoom}
                selectedIdsRef={selectedIdsRef}
              />
            );
          })}

          {/* One shared Transformer for the whole canvas.
              There used to be one mounted per object — with 100 objects that
              is 100 Transformer instances, 99 of them holding an empty node
              list and each still participating in layer draws. */}
          <SelectionTransformer selectedIds={selectedIds} stageRef={stageRef} />

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


