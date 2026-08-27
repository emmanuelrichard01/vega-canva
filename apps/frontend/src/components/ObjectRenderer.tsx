import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Circle, Group, Rect, Text } from 'react-konva';
import Konva from 'konva';
import { applyGroupPlan, applyNodePatches, deleteNode, doc, localAuthorId, toggleReaction, updateNode } from '../engine/document';
import { editor } from '../engine/api/EditorAPI';
import { pasteNodes, writeClipboard } from '../engine/clipboard/clipboard';
import { consumePendingEdit, onPendingEdit, requestCaretOnMount } from '../engine/interaction/pendingEdit';
import { cropMode } from '../engine/interaction/cropMode';
import { pathEdit } from '../engine/interaction/pathEdit';
import { lineEdit } from '../engine/interaction/lineEdit';
import { fitLineToBox, isLineLike } from '../engine/model/lineEnds';
import { EXPORT_CHROME } from '../engine/export/chrome';
import { OBJECT_NODE } from '../engine/export/isolate';
import { moveFrameWithChildren, reassignFrame } from '../engine/interaction/frameMembership';
import { gridCellsOf } from '../engine/grid/gridNode';
import { addTextToCell, cellAtPoint, isCellFree, reassignGridSlot } from '../engine/grid/gridSlotApply';
import { roundPolygon } from '../engine/grid/gridLayout';
import { tagFilter } from '../engine/model/tagFilter';
import { matchesTagFilter } from '../engine/model/tags';
import { useStore } from '../hooks/useStore';
import { cameraSystem } from '../engine/CameraSystem';
import { gridSnap } from '../engine/interaction/gridSnap';
import { clearSnapGuides, snapDraggedBox } from '../engine/interaction/objectSnap';
import { presenceManager } from '../engine/presence/PresenceManager';
import { useFlight } from '../engine/physics/flightState';
import { hasText, isPinned, type AnyNode, type TextBearingNode } from '../engine/model/schema';
import { NodeEditor } from './canvas/NodeEditor';
import { AudioRenderer } from './canvas/renderers/AudioRenderer';
import { ImageRenderer } from './canvas/renderers/ImageRenderer';
import { PathRenderer } from './canvas/renderers/PathRenderer';
import { ShapeRenderer } from './canvas/renderers/ShapeRenderer';
import { GridRenderer } from './canvas/renderers/GridRenderer';
import { StickyRenderer } from './canvas/renderers/StickyRenderer';
import { FrameRenderer } from './canvas/renderers/FrameRenderer';
import { ConnectorRenderer } from './canvas/renderers/ConnectorRenderer';
import { useLayerFilters } from './canvas/renderers/useLayerFilters';
import { TextRenderer } from './canvas/renderers/TextRenderer';
import { caretAt, layoutText } from '../engine/text/layout';
import { measurerFor } from '../engine/text/measure';
import { applyTextCase } from '../engine/model/textCase';
import { liveTransformStore, useLiveTransform } from '../engine/model/liveTransformStore';
import { connectorDragPatch, syncConnectedConnectors } from '../engine/model/connectorTargets';
import { fitPathToBox } from '../engine/model/pathGeometry';
import { duplicationSet, travelledEnough } from '../engine/interaction/altDuplicate';

/**
 * Which character a click inside a text node landed on.
 *
 * Lays the text out again rather than reaching for the renderer's copy: this
 * runs once per click, the layout is cheap, and reaching across for a memo
 * owned by another component would couple the two in the one direction that
 * makes the renderer harder to change.
 */
function caretOffsetFor(node: AnyNode, local: { x: number; y: number }): number {
  if (node.type !== 'text') return 0;
  const t = node.typography;
  const layout = layoutText({
    text: applyTextCase(node.text, t.textCase),
    list: t.list,
    wrap: node.resize === 'width' ? 'none' : 'word',
    width: node.width,
    height: node.resize === 'fixed' ? node.height : undefined,
    fontSize: t.fontSize,
    lineHeight: t.lineHeight,
    letterSpacing: t.letterSpacing,
    paragraphSpacing: t.paragraphSpacing,
    align: t.align,
    verticalAlign: t.verticalAlign,
    measure: measurerFor(t),
  });
  return caretAt(layout, local, measurerFor(t), t.letterSpacing);
}

interface ObjectRendererProps {
  objId: string;
  isSelected: boolean;
  onSelect: (id: string, e?: Konva.KonvaEventObject<MouseEvent>) => void;
  /**
   * Whether the active tool can select this object.
   *
   * Gates the hover outline as well as being the reason the click will land.
   * Without it the outline appeared under every tool and quietly lied.
   *
   * It also gates **dragging**, which is the same question asked of the
   * pointer instead of the click, and which it did not gate for a long time:
   * with the Connector tool armed, pressing on a shape to draw an arrow from
   * it started a Konva drag and *moved the shape* instead. The tool did still
   * receive its events, so the gesture both moved the box and drew a
   * connector from wherever the box had ended up. The same was true of the
   * eraser and of every shape variant. If a tool cannot select an object it
   * has no business moving it either.
   */
  selectable?: boolean;
  onThrow?: (id: string, x: number, y: number, vx: number, vy: number) => void;
  stageScale?: number;
  /**
   * Whether Alt-drag duplication is permitted.
   * Only true when the active tool is the Select tool ('select' / V).
   * In Direct Select tool ('direct-select' / A), Alt is reserved for breaking curve handles.
   */
  canDuplicate?: boolean;
  /**
   * Stable-identity ref holding the live multi-selection, read imperatively
   * during a drag so moving one selected object carries the rest. Passed as a
   * ref rather than a prop so a selection change doesn't re-render every
   * object on the canvas.
   */
  selectedIdsRef?: React.MutableRefObject<string[]>;
}

interface SiblingDragState {
  rawX: number;
  rawY: number;
  /**
   * Where its Konva node started, or `null` when it has none.
   *
   * The canvas only renders what is in view, so a selected object scrolled off
   * the edge has no Konva node to move. That is fine for the *live* drag --
   * nothing is drawn there — and fatal for the commit, which is why the two are
   * now separate: the position comes from the store and only the preview needs
   * a node.
   */
  nodeStartX: number | null;
  nodeStartY: number | null;
}

/**
 * Renders one canvas object and owns its interaction.
 *
 * This file used to be a 989-line `@ts-nocheck` switch that also inlined the
 * audio player, four separate textarea editors, and every shape primitive.
 * Drawing now dispatches to a typed per-type renderer; this component keeps
 * only what is genuinely shared across all types: transform, selection,
 * dragging, editing lifecycle and presence.
 *
 * Note there is no `<Transformer>` here. One per object meant 100 objects
 * mounted 100 transformer instances, 99 of them with an empty node list. A
 * single shared transformer lives in Canvas and is pointed at the selection.
 */
/**
 * Module-level reactive store for active Alt-drag duplication ghost rendering.
 * Tracks which node IDs are currently being duplicated via Alt-drag
 * so their origin ghost twins remain anchored and visible during drag gestures.
 */
/**
 * Duplicate a selection, offset by a drag.
 *
 * ## Why this goes through the clipboard rather than calling `createNode`
 *
 * Alt-drag had its own duplication written out by hand: a loop spreading each
 * node into `createNode` with a new id. Every property that makes a *correct*
 * copy was missing from it, and each one is a bug somebody would eventually
 * report separately:
 *
 *  - **Connectors kept pointing at the originals.** `from.nodeId` was copied
 *    verbatim, so duplicating a flowchart gave you a second set of boxes with
 *    every arrow still bound to the first set.
 *  - **Grouped objects joined the original's group** rather than forming their
 *    own, because `parentId` was copied verbatim too. Alt-dragging a group gave
 *    you one group of twice the size.
 *  - **`zIndex`, `createdAt`, `createdBy` were copied**, which `EditorAPI`'s own
 *    contract says callers must never supply -- so the copy shared a stacking
 *    position with its original and claimed its authorship and timestamp.
 *  - **One transaction per node**, so a nine-object duplicate was nine updates
 *    a peer received separately and nine steps to undo.
 *
 * `writeClipboard` / `pasteNodes` is the implementation that already gets all
 * of that right, and it is the one Copy-Paste and the Duplicate command use.
 * There is no version of this worth maintaining twice; the only thing Alt-drag
 * needs that a paste does not is *where* to put the result, and that is a
 * parameter.
 */
function duplicateAt(ids: readonly string[], dx: number, dy: number): void {
  const objects = useStore.getState().objects;
  const nodes = ids.map((id) => objects[id]).filter(Boolean) as AnyNode[];
  const payload = writeClipboard(nodes);
  if (!payload) return;

  const { nodes: made, ids: newIds, groups } = pasteNodes(
    payload,
    // The selection's own top-left plus the distance travelled, so the copy
    // lands exactly under the pointer rather than at a fixed paste offset.
    { x: payload.origin.x + dx, y: payload.origin.y + dy },
    useStore.getState().groups
  );
  if (made.length === 0) return;

  doc.transact(() => {
    // Folders first: the nodes about to be created point at them, and a peer
    // observing the transaction should never see a node whose group is missing.
    for (const record of groups) applyGroupPlan({ nodes: [], groups: [], create: record, remove: [] });
    made.forEach((node: unknown) => editor.createNode(node as never));
  });

  if (newIds.length > 0) {
    window.dispatchEvent(new CustomEvent('requestSelectNodes', { detail: { ids: newIds } }));
  }
}

/**
 * The system's own "you are copying this" cursor, while the gesture will copy.
 *
 * The signal every desktop application uses for this, and it costs the canvas
 * nothing: no extra chrome to draw, nothing to place, nothing that can end up
 * on top of the artwork. It is set on the stage's container rather than the
 * body so it disappears the moment the pointer leaves the canvas, and cleared
 * to '' rather than 'default' so whatever the active tool had set comes back.
 */
function setDuplicateCursor(stage: Konva.Stage | null | undefined, on: boolean) {
  const container = stage?.container();
  if (!container) return;
  if (on) {
    if (container.dataset.cursorBeforeCopy === undefined) {
      container.dataset.cursorBeforeCopy = container.style.cursor;
    }
    container.style.cursor = 'copy';
  } else if (container.dataset.cursorBeforeCopy !== undefined) {
    container.style.cursor = container.dataset.cursorBeforeCopy;
    delete container.dataset.cursorBeforeCopy;
  }
}

const altDragState = {
  activeIds: new Set<string>(),
  listeners: new Set<() => void>(),
  set(ids: string[]) {
    this.activeIds = new Set(ids);
    this.listeners.forEach((l) => l());
  },
  clear() {
    if (this.activeIds.size === 0) return;
    this.activeIds = new Set();
    this.listeners.forEach((l) => l());
  },
  subscribe(listener: () => void) {
    altDragState.listeners.add(listener);
    return () => {
      altDragState.listeners.delete(listener);
    };
  },
  getSnapshot() {
    return altDragState.activeIds;
  },
};

export const ObjectRenderer = React.memo(
  ({
    objId,
    isSelected,
    onSelect,
    onThrow,
    stageScale = 1,
    selectedIdsRef,
    selectable = true,
    canDuplicate = true,
  }: ObjectRendererProps) => {
    const node = useStore((state) => state.objects[objId]);
    const live = useLiveTransform(objId);
    const isAltDuplicating = useSyncExternalStore(
      altDragState.subscribe,
      altDragState.getSnapshot,
      altDragState.getSnapshot
    ).has(objId);
    /**
     * The frame that owns this object, if any.
     *
     * Selected as the node itself rather than as a derived rectangle: the
     * store hands back a stable reference between changes, whereas returning a
     * fresh `{x, y, width, height}` from the selector would be a new object on
     * every read and re-render this component forever.
     */
    const ownerFrame = useStore((state) =>
      node?.frameId ? state.objects[node.frameId] : undefined
    );
    const clipRect =
      ownerFrame && ownerFrame.type === 'frame'
        ? { x: ownerFrame.x, y: ownerFrame.y, width: ownerFrame.width, height: ownerFrame.height }
        : null;

    /**
     * The grid module a picture is sitting in, when it is in one.
     *
     * Selected as the grid *node* for the same reason `ownerFrame` above is:
     * the store hands back a stable reference between changes, and returning a
     * freshly computed cell from the selector would be a new object on every
     * read and would re-render this component forever.
     */
    const slotGrid = useStore((state) => {
      const slot = node && 'gridSlot' in node ? node.gridSlot : undefined;
      return slot ? state.objects[slot.gridId] : undefined;
    });

    /**
     * A picture in a non-rectangular module is cut to that module's silhouette.
     *
     * Only for the shapes a rectangle cannot express. A rectangular module —
     * every kind but `radial`, which draws ring sectors — needs no clipping at
     * all: `gridReflow` gives the picture the module's exact box and its corner
     * radius, and `ImageRenderer` hands that radius to Konva, which clips to it
     * natively. Drawing a clip path for those would be a second implementation
     * of rounding that could disagree with the first.
     *
     * Expressed in the picture's own local space, which is offset to its
     * centre — the group is positioned at the centre and its contents drawn
     * back from there. No transform inversion is needed here, unlike the frame
     * clip below: the picture's box *is* the module's box and it carries the
     * grid's own rotation, so the two spaces differ by that offset and nothing
     * else. `roundPolygon` is the same rounder the grid drew the module with,
     * so the picture's edge and the module's edge are the same curve.
     */
    const slotClip = useMemo(() => {
      const slot = node && 'gridSlot' in node ? node.gridSlot : undefined;
      if (!slot || !slotGrid || slotGrid.type !== 'grid') return null;
      const cell = gridCellsOf(slotGrid).find((c) => c.index === slot.cell);
      if (!cell?.outline) return null;
      return roundPolygon(cell.outline, cell.radius).map((p) => ({
        x: p.x - cell.width / 2,
        y: p.y - cell.height / 2,
      }));
    }, [node, slotGrid]);
    const forceToolActive = useStore((state) => state.forceToolActive);

    /**
     * Paint that belongs to the whole layer rather than to one shape inside it.
     *
     * Blend mode and layer blur are read here, not in the per-type renderers,
     * because they apply to everything the object draws — a shape *and* its
     * text label, an image *and* its border. Applying them one level down
     * would blur the fill and leave the caption sharp.
     *
     * `audio`, `sticky` and `comment` carry no `appearance`, so this is
     * undefined for them and both features are simply absent — which is
     * correct: there is no control offering either on those types.
     */
    const appearance = node && 'appearance' in node ? node.appearance : undefined;

    const shapeRef = useRef<Konva.Group>(null);
    const lastPos = useRef({ x: 0, y: 0, time: 0 });
    const velocity = useRef({ x: 0, y: 0 });
    const groupDragRef = useRef<{ startX: number; startY: number; siblings: Record<string, SiblingDragState> } | null>(null);
    /**
     * Selected connectors, held aside for the length of a group drag.
     *
     * Kept out of `siblings` because everything in there is translated, and a
     * connector must not be. They are patched at drop instead, where a loose
     * end can be offset and a bound one left to follow its object.
     */
    const connectorDragRef = useRef<string[]>([]);
    const altDragRef = useRef(false);

    // Claimed during the first render, which is the point: a tool that has
    // just created this node asked for it to open ready to type in, and there
    // is no window between mounting and listening for the request to fall
    // through. See `engine/interaction/pendingEdit.ts`.
    const [isEditing, setIsEditing] = useState(() => consumePendingEdit(objId));
    const [isHovered, setIsHovered] = useState(false);

    /**
     * And the same claim again, for a request aimed at a node already on screen.
     *
     * The mount-time claim serves a node being created. A rail button asking an
     * existing object to open for editing has nothing to hook into — which is
     * why a line's label used to be reachable only by double-clicking the line,
     * the gesture that now opens its vertex editor. Every mounted renderer is
     * woken; `consumePendingEdit` is what picks one.
     */
    useEffect(() => onPendingEdit(() => {
      if (consumePendingEdit(objId)) setIsEditing(true);
    }), [objId]);

    // Layer blur, and the Konva cache it requires. The dependency list is
    // everything the cached bitmap depends on: the object's size, and the
    // paint drawn into it. `appearance` is a stable reference between changes
    // because the store hands back the node itself.
    useLayerFilters(shapeRef, appearance?.blur, [node?.width, node?.height, appearance]);

    // A tag filter is a way of looking, so it lives outside the document —
    // narrowing to `risk` must not empty everyone else's board.
    const activeTags = useSyncExternalStore(
      tagFilter.subscribe,
      tagFilter.getSnapshot,
      tagFilter.getSnapshot
    );

    // A physics throw broadcast by whichever client owns the simulation.
    // Previously every object scanned every peer's awareness state on every
    // render to find this — O(objects x peers) per frame. It is now a single
    // shared subscription publishing an id-keyed map.
    const flight = useFlight(objId);

    useEffect(() => {
      const handleRequestEdit = (e: Event) => {
        const detail = (e as CustomEvent<{ id: string }>).detail;
        if (detail?.id === objId) setIsEditing(true);
      };
      document.addEventListener('requestEditNode', handleRequestEdit);
      return () => document.removeEventListener('requestEditNode', handleRequestEdit);
    }, [objId]);

    useEffect(() => {
      if (!isEditing) return;
      presenceManager.updateActivity('typing');
      // The floating toolbar anchors to the last committed bounds, which don't
      // move while typing — a growing text box would slide out from under it.
      // Reusing the drag-hide signal keeps it clear for the whole edit.
      window.dispatchEvent(new CustomEvent('canvas-drag-start'));
      return () => {
        presenceManager.updateActivity(null);
        window.dispatchEvent(new CustomEvent('canvas-drag-end'));
      };
    }, [isEditing]);

    // Sticky mount animation.
    useEffect(() => {
      if (node?.type !== 'sticky' || !shapeRef.current) return;
      if (Date.now() - node.createdAt > 2000) return;
      const konvaNode = shapeRef.current;
      konvaNode.scale({ x: 0.5, y: 0.5 });
      konvaNode.to({ scaleX: 1, scaleY: 1, duration: 0.4, easing: Konva.Easings.ElasticEaseOut });
      // Intentionally mount-only.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleDragStart = useCallback(
      (e: Konva.KonvaEventObject<DragEvent>) => {
        window.dispatchEvent(new CustomEvent('canvas-drag-start'));
        // Not labelled next to their name — you can see the object moving.
        // It keeps their name chip up while they work and pings the radar.
        presenceManager.updateActivity('moving');
        lastPos.current = { x: e.target.x(), y: e.target.y(), time: performance.now() };
        velocity.current = { x: 0, y: 0 };
        const isAlt = Boolean((e.evt as MouseEvent)?.altKey) && canDuplicate;
        altDragRef.current = isAlt;
        /**
         * Raise the twin here, not only on the first move.
         *
         * Holding Alt *before* pressing is how the gesture is normally started,
         * and it was the one way that never showed anything: this handler set
         * the flag, and the move handler's test is "Alt is down and the flag is
         * not" -- already false. So the ghost appeared only if you began the
         * drag first and reached for Alt afterwards.
         */
        if (isAlt) altDragState.set(duplicationSet(objId, isSelected, selectedIdsRef?.current));
        setDuplicateCursor(e.target.getStage(), isAlt);

        const currentObj = useStore.getState().objects[objId];
        const halfW = currentObj ? currentObj.width / 2 : 0;
        const halfH = currentObj ? currentObj.height / 2 : 0;

        const selection = selectedIdsRef?.current;
        if (isSelected && selection && selection.length > 1) {
          const stage = e.target.getStage();
          const all = useStore.getState().objects;
          const siblings: Record<string, SiblingDragState> = {};
          connectorDragRef.current = [];
          const batch: Array<[string, { x: number; y: number }]> = [
            [objId, { x: e.target.x() - halfW, y: e.target.y() - halfH }],
          ];
          selection
            .filter((sid) => sid !== objId)
            .forEach((sid) => {
              const sibling = all[sid];
              if (!sibling) return;
              /**
               * A connector is carried by its ends, never translated.
               *
               * Its route is drawn at `world - node.x`, so moving the group it
               * sits in shifts the frame and the route compensates the other
               * way: the arrow visibly lags and slides away from the objects it
               * joins for the length of the drag, then snaps back on release
               * when the box is recomputed. Bound ends follow their objects on
               * their own; loose ends are moved at drop by
               * `connectorDragPatch`.
               */
              if (sibling.type === 'connector') {
                connectorDragRef.current.push(sid);
                return;
              }
              const konvaNode = stage?.findOne('#' + sid);
              const sHalfW = sibling.width / 2;
              const sHalfH = sibling.height / 2;
              const sx = konvaNode ? konvaNode.x() - sHalfW : sibling.x;
              const sy = konvaNode ? konvaNode.y() - sHalfH : sibling.y;
              batch.push([sid, { x: sx, y: sy }]);
              siblings[sid] = {
                rawX: sibling.x,
                rawY: sibling.y,
                nodeStartX: konvaNode ? konvaNode.x() : null,
                nodeStartY: konvaNode ? konvaNode.y() : null,
              };
            });
          liveTransformStore.setBatch(batch);
          groupDragRef.current = { startX: e.target.x(), startY: e.target.y(), siblings };
          if (isAlt) {
            altDragState.set(selection);
          } else {
            altDragState.clear();
          }
        } else {
          liveTransformStore.set(objId, { x: e.target.x() - halfW, y: e.target.y() - halfH });
          groupDragRef.current = null;
          connectorDragRef.current = [];
          if (isAlt) {
            altDragState.set([objId]);
          } else {
            altDragState.clear();
          }
        }
      },
      [canDuplicate, isSelected, objId, selectedIdsRef]
    );

    const handleDragMove = useCallback(
      (e: Konva.KonvaEventObject<DragEvent>) => {
        const now = performance.now();
        const dt = now - lastPos.current.time;
        if (dt > 16) {
          velocity.current = {
            x: (e.target.x() - lastPos.current.x) / dt,
            y: (e.target.y() - lastPos.current.y) / dt,
          };
          lastPos.current = { x: e.target.x(), y: e.target.y(), time: now };
        }
        const isAlt = Boolean((e.evt as MouseEvent)?.altKey) && canDuplicate;
        if (isAlt !== altDragRef.current) {
          altDragRef.current = isAlt;
          if (isAlt) altDragState.set(duplicationSet(objId, isSelected, selectedIdsRef?.current));
          else altDragState.clear();
          setDuplicateCursor(e.target.getStage(), isAlt);
        }

        const currentObj = useStore.getState().objects[objId];
        const halfW = currentObj ? currentObj.width / 2 : 0;
        const halfH = currentObj ? currentObj.height / 2 : 0;

        if (groupDragRef.current) {
          const stage = e.target.getStage();
          const all = useStore.getState().objects;
          const dx = e.target.x() - groupDragRef.current.startX;
          const dy = e.target.y() - groupDragRef.current.startY;
          const batch: Array<[string, { x: number; y: number }]> = [
            [objId, { x: e.target.x() - halfW, y: e.target.y() - halfH }],
          ];
          Object.entries(groupDragRef.current.siblings).forEach(([sid, s]) => {
            if (s.nodeStartX === null || s.nodeStartY === null) return;
            const sx = s.nodeStartX + dx;
            const sy = s.nodeStartY + dy;
            const sibling = all[sid];
            const sHalfW = sibling ? sibling.width / 2 : 0;
            const sHalfH = sibling ? sibling.height / 2 : 0;
            batch.push([sid, { x: sx - sHalfW, y: sy - sHalfH }]);
            const konvaNode = stage?.findOne('#' + sid);
            if (konvaNode) {
              konvaNode.x(sx);
              konvaNode.y(sy);
            }
          });
          liveTransformStore.setBatch(batch);
          stage?.batchDraw();
        } else {
          liveTransformStore.set(objId, { x: e.target.x() - halfW, y: e.target.y() - halfH });
        }
      },
      [canDuplicate, isSelected, objId, selectedIdsRef]
    );

    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Alt' && canDuplicate) {
          if (shapeRef.current?.isDragging()) {
            altDragRef.current = true;
            altDragState.set(duplicationSet(objId, isSelected, selectedIdsRef?.current));
            setDuplicateCursor(shapeRef.current.getStage(), true);
          }
        }
      };
      const handleKeyUp = (e: KeyboardEvent) => {
        if (e.key === 'Alt') {
          if (shapeRef.current?.isDragging()) {
            altDragRef.current = false;
            altDragState.clear();
            setDuplicateCursor(shapeRef.current.getStage(), false);
          }
        }
      };
      window.addEventListener('keydown', handleKeyDown);
      window.addEventListener('keyup', handleKeyUp);
      return () => {
        window.removeEventListener('keydown', handleKeyDown);
        window.removeEventListener('keyup', handleKeyUp);
      };
    }, [canDuplicate, isSelected, objId, selectedIdsRef]);

    const handleDragEnd = useCallback(
      (e: Konva.KonvaEventObject<DragEvent>) => {
        window.dispatchEvent(new CustomEvent('canvas-drag-end'));
        presenceManager.updateActivity(null);
        clearSnapGuides();
        // Batch-clear all live transforms for the drag group in one notification pass.
        const idsToClean = [objId];
        if (groupDragRef.current) {
          idsToClean.push(...Object.keys(groupDragRef.current.siblings));
        }
        liveTransformStore.deleteBatch(idsToClean);

        const current = useStore.getState().objects[objId];
        const halfW = current ? current.width / 2 : 0;
        const halfH = current ? current.height / 2 : 0;
        const isAlt = Boolean((e.evt as MouseEvent)?.altKey || altDragRef.current) && canDuplicate;
        altDragRef.current = false;
        altDragState.clear();
        setDuplicateCursor(e.target.getStage(), false);

        if (groupDragRef.current) {
          const dx = e.target.x() - groupDragRef.current.startX;
          const dy = e.target.y() - groupDragRef.current.startY;

          if (isAlt && travelledEnough(dx, dy, cameraSystem.zoom)) {
            // Everything goes back where it was: an Alt-drag leaves the
            // originals untouched and hands you the copies.
            const stage = e.target.getStage();
            e.target.x(groupDragRef.current.startX);
            e.target.y(groupDragRef.current.startY);
            Object.entries(groupDragRef.current.siblings).forEach(([sid, sib]) => {
              if (sib.nodeStartX === null || sib.nodeStartY === null) return;
              const kn = stage?.findOne('#' + sid);
              if (kn) {
                kn.x(sib.nodeStartX);
                kn.y(sib.nodeStartY);
              }
            });
            stage?.batchDraw();

            const ids = [objId, ...Object.keys(groupDragRef.current.siblings)];
            groupDragRef.current = null;
            connectorDragRef.current = [];
            duplicateAt(ids, dx, dy);
            return;
          }

          const all = useStore.getState().objects;
          const updatedObjects = { ...all };
          const nodePatches: Array<{ id: string; changes: Record<string, unknown> }> = [];

          Object.entries(groupDragRef.current.siblings).forEach(([sid, s]) => {
            const newPos = { x: s.rawX + dx, y: s.rawY + dy };
            nodePatches.push({ id: sid, changes: newPos });
            if (updatedObjects[sid]) {
              updatedObjects[sid] = { ...updatedObjects[sid], ...newPos };
            }
          });

          const mainPos = { x: e.target.x() - halfW, y: e.target.y() - halfH };
          nodePatches.push({ id: objId, changes: mainPos });
          if (updatedObjects[objId]) {
            updatedObjects[objId] = { ...updatedObjects[objId], ...mainPos };
          }

          /**
           * Selected connectors, resolved once at the end.
           *
           * A fully bound one contributes nothing: both its ends belong to
           * objects, and `syncConnectedConnectors` below recomputes its box
           * from wherever they landed. One with a loose end has that end
           * carried by the drag, which is what dragging a half-attached arrow
           * visibly does.
           */
          for (const cid of connectorDragRef.current) {
            const c = all[cid];
            if (c?.type !== 'connector') continue;
            const patch = connectorDragPatch(c, dx, dy);
            if (!patch) continue;
            nodePatches.push({ id: cid, changes: patch });
            updatedObjects[cid] = { ...c, ...patch } as AnyNode;
          }

          const modifiedIds = [objId, ...Object.keys(groupDragRef.current.siblings)];
          const connectorPatches = syncConnectedConnectors(modifiedIds, updatedObjects);
          applyNodePatches([...nodePatches, ...connectorPatches]);
          groupDragRef.current = null;
          connectorDragRef.current = [];
          return;
        }

        const nextX = e.target.x() - halfW;
        const nextY = e.target.y() - halfH;
        const dx = nextX - (current?.x ?? 0);
        const dy = nextY - (current?.y ?? 0);

        if (isAlt && current && travelledEnough(dx, dy, cameraSystem.zoom)) {
          // Back where it was; the copy is what moved.
          e.target.x(current.x + halfW);
          e.target.y(current.y + halfH);
          e.target.getStage()?.batchDraw();
          duplicateAt([objId], dx, dy);
          return;
        }

        const speed = Math.hypot(velocity.current.x, velocity.current.y);
        if (speed > 0.5 && onThrow) {
          onThrow(objId, e.target.x(), e.target.y(), velocity.current.x * 15, velocity.current.y * 15);
        } else if (current?.type === 'connector') {
          /**
           * Dragging a connector by itself moves its loose ends, not its box.
           *
           * Writing `x`/`y` here was the single-selection form of the same bug:
           * the stored origin is derived, so the write did nothing but put a
           * stale box in the document, and the arrow sprang back to its ends the
           * moment anything recomputed it. A connector bound at both ends now
           * simply does not move, which is the truth -- it is held by the
           * objects it joins.
           */
          const patch = connectorDragPatch(current, dx, dy);
          if (patch) {
            const all = useStore.getState().objects;
            const updated = { ...all, [objId]: { ...current, ...patch } as AnyNode };
            applyNodePatches([
              { id: objId, changes: patch },
              ...syncConnectedConnectors([objId], updated),
            ]);
          }
          // Back where it started either way: the Konva node was dragged, and
          // nothing in the document authorises it to stay there.
          e.target.x(current.x + halfW);
          e.target.y(current.y + halfH);
        } else {
          const all = useStore.getState().objects;
          const updatedObjects = {
            ...all,
            [objId]: { ...(current ?? {}), x: nextX, y: nextY } as AnyNode,
          };
          const connectorPatches = syncConnectedConnectors([objId], updatedObjects);
          if (connectorPatches.length > 0) {
            applyNodePatches([
              { id: objId, changes: { x: nextX, y: nextY } },
              ...connectorPatches,
            ]);
          } else {
            updateNode(objId, { x: nextX, y: nextY });
          }

          if (current?.type === 'frame') {
            moveFrameWithChildren(objId, nextX - current.x, nextY - current.y);
          }
          reassignFrame(objId);
          // Where a picture came to rest decides whether it is in a grid
          // module, on the same geometric-membership rule as frames above.
          if (current?.type === 'image') reassignGridSlot(objId);
        }
      },
      [objId, onThrow, canDuplicate]
    );

    const handleDblClick = useCallback((e?: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      if (!node) return;
      if (!isSelected) onSelect(objId);
      /**
       * The inside of a line is its vertices.
       *
       * Double-click already meant "go inside this object" — the editor for
       * text, the framing for an image, the anchors for a path — and a line's
       * vertices are the same answer for the same question. It used to open the
       * line's *label*, which was the only way to reach one; that moved to the
       * contextual rail, which is where it should have been, since a label is
       * an annotation on a line rather than something inside it.
       */
      if (isLineLike(node)) {
        lineEdit.begin(objId);
        return;
      }
      if (hasText(node)) {
        /**
         * The caret lands where you clicked.
         *
         * The editor is focused programmatically and never sees the click that
         * opened it, so without this the caret goes to the start and editing a
         * sentence means opening the editor and then clicking again where you
         * were already aiming.
         *
         * This used to run on a *single* click of an already-selected text
         * object, which made the first click select and the second edit — but
         * it also meant a text object could not be clicked twice without
         * entering the editor, so selecting one and reaching for the toolbar
         * was a race. Editing now needs a deliberate double-click, and a
         * single click does what it does for every other object: selects it
         * and shows the rail.
         */
        const stage = e?.target?.getStage?.();
        const pointer = stage?.getPointerPosition?.();
        if (pointer && node.type === 'text') {
          const world = cameraSystem.screenToWorld(pointer.x, pointer.y);
          requestCaretOnMount(objId, caretOffsetFor(node, { x: world.x - node.x, y: world.y - node.y }));
        }
        setIsEditing(true);
        return;
      }
      // Double-click means "go inside this object". For text that is the
      // editor; for an image the inside is its framing. The snapshot is taken
      // here rather than in the overlay because this is the moment before
      // anything has changed — the overlay's first render already sees a
      // document that a stray drag could have touched.
      if (node.type === 'image') {
        cropMode.enter({
          nodeId: objId,
          node: { x: node.x, y: node.y, width: node.width, height: node.height },
          crop: node.crop,
        });
      }
      // And the inside of a path is its anchors. A freehand blob has none —
      // its "path" is the outline of a stroke, not a run of control points —
      // so double-clicking one has nothing to open.
      if (node.type === 'path' && node.geometry.kind === 'bezier') {
        pathEdit.enter(objId);
      }
      /**
       * The inside of a grid is the module you aimed at, and what a module can
       * hold that nothing else provides is a caption.
       *
       * Double-click has meant "go inside this object" for every other type on
       * this canvas — the editor for text, the framing for an image, the
       * anchors for a path, the vertices for a line — and a grid was the one
       * type where it meant nothing at all. Typing into a module is the thing
       * you want often enough to deserve the gesture everything else uses,
       * rather than a button that has to be found first.
       *
       * A module that already holds something is left alone: the double-click
       * would land on that object rather than on the grid anyway, and stacking
       * a caption on top of a picture is a composition the person can build
       * deliberately if they want it.
       */
      if (node.type === 'grid') {
        const stage = e?.target?.getStage?.();
        const pointer = stage?.getPointerPosition?.();
        if (!pointer) return;
        const world = cameraSystem.screenToWorld(pointer.x, pointer.y);
        const cell = cellAtPoint(node, world);
        if (cell === null || !isCellFree(node.id, cell)) return;
        const id = addTextToCell(node.id, cell);
        if (id) onSelect(id);
      }
    }, [isSelected, node, objId, onSelect]);

    const handleCommit = useCallback(
      (text: string, size?: { width: number; height: number }) => {
        setIsEditing(false);
        if (!node) return;

        // A bare text node never typed into is invisible clutter; professional
        // editors discard it rather than leaving a permanent ghost object.
        if (node.type === 'text' && !text.trim()) {
          deleteNode(objId);
          return;
        }

        // An empty sticky is worse than invisible — it is a coloured square
        // that looks like content. Clicking away from one you never wrote in,
        // or emptying one, removes it, which is what makes "drop a note and
        // start typing" safe to do freely.
        //
        // Unless somebody reacted to it: a note other people have engaged with
        // is not yours to delete by clearing its text.
        if (node.type === 'sticky' && !text.trim()) {
          if (Object.keys(node.reactions).length === 0) {
            deleteNode(objId);
            return;
          }
        }

        updateNode(objId, size ? { text, ...size } : { text });
      },
      [node, objId]
    );

    const handleCancel = useCallback(() => {
      setIsEditing(false);
      if (!node) return;
      // Escape out of a note you never wrote in and it should not survive
      // either — same reasoning as committing an empty one.
      const abandonedText = node.type === 'text' && !node.text.trim();
      const abandonedSticky =
        node.type === 'sticky' &&
        !node.text.trim() &&
        Object.keys(node.reactions).length === 0;
      if (abandonedText || abandonedSticky) deleteNode(objId);
    }, [node, objId]);

    if (!node || node.hidden) return null;

    // Only stickies carry tags, so nothing else can ever be excluded by a tag
    // filter — dimming an image because it has no tags would be nonsense.
    const filteredOut = node.type === 'sticky' && !matchesTagFilter(node, activeTags as Set<string>);

    // A node in flight renders at the owner's broadcast position rather than
    // its (stale) committed one.
    /**
     * The live store is applied unconditionally again.
     *
     * It was gated for a while, because Konva's `Transformer` was writing this
     * node's `x`, `y`, `scale` and `rotation` at the same time and the two
     * overwrote each other -- a feedback loop that made objects distort and, at
     * its worst, leave the screen.
     *
     * The transformer drives an invisible proxy now and never touches a document
     * object, so React is the only writer again and there is nothing to guard
     * against. The gate would now do harm rather than good: it would suppress
     * exactly the geometry the gesture is trying to preview.
     */
    const x = flight?.x ?? live?.x ?? node.x;
    const y = flight?.y ?? live?.y ?? node.y;
    const width = live?.width ?? node.width;
    const height = live?.height ?? node.height;
    const rotation = flight?.rotation ?? live?.rotation ?? node.rotation;

    // Rotate and scale about the centre, the way every design tool does, by
    // placing the group at the centre and pulling its contents back by the
    // same offset. The node's stored x/y therefore remain its top-left corner
    // while `e.target.x()` during a drag reports the centre.
    const cx = width / 2;
    const cy = height / 2;

    /**
     * The node the *content* is drawn from, carrying the gesture's live size.
     *
     * ## Why the shape stuck to the top-left
     *
     * The group is positioned and sized from the live store, but the renderers
     * inside it read `node.width` -- the committed size. That was invisible
     * while Konva scaled the group, because the scale grew the drawing whether
     * it knew about the resize or not; it was also the distortion. With nothing
     * scaling any more, the group grew and the artwork inside it did not, so a
     * shape sat at its old size against the box's top-left corner and only
     * snapped to fit on release.
     *
     * Merging the live size into the node fixes every type at once, rather than
     * each renderer having to remember to ask. Only the size: `x`, `y` and
     * `rotation` are the group's to apply, and a renderer that read them would
     * apply them a second time.
     *
     * A path is the one type whose size does not live in `width`/`height`: it
     * lives in the outline, so the outline has to be refitted too or the stroke
     * would sit unchanged inside a box that had already grown. `fitPathToBox`
     * measures rather than accumulates, so calling it sixty times a second from
     * the committed geometry lands in the same place as calling it once.
     */
    const resizing = Boolean(live) && (live?.width !== undefined || live?.height !== undefined);
    let liveNode: AnyNode = node;
    if (resizing) {
      liveNode = { ...node, width, height } as AnyNode;
      if (liveNode.type === 'path') {
        const fitted = fitPathToBox(liveNode.geometry, width, height);
        if (fitted) liveNode = { ...liveNode, geometry: fitted };
      }
      // The same refit the commit does — see `SelectionTransformer`. Without
      // it a line in a multi-object resize sits still through the whole drag
      // and then jumps into place on release, which reads as a glitch rather
      // than as the correction it is.
      if (liveNode.type === 'shape' && isLineLike(liveNode)) {
        const fitted = fitLineToBox(
          liveNode.geometry,
          { width: node.width, height: node.height },
          { width, height }
        );
        if (fitted) liveNode = { ...liveNode, geometry: fitted } as AnyNode;
      }
    }

    return (
      <>
        {/*
          The original, left standing where it was.

          ## What this is, and what it was

          An Alt-drag makes a copy: the original does not move. But the thing
          Konva is dragging *is* the original -- it is put back at the drop and
          the copy is created at the pointer -- so for the length of the gesture
          there is nothing at the place the object came from. This draws it.

          It was positioned at `x, y`: the **live** coordinates, which the drag
          is updating sixty times a second. So the "origin anchor twin" was
          pinned to the pointer, exactly on top of the object it was a twin of,
          and the feature was invisible for as long as it has existed. It reads
          from `node` -- the document, which an Alt-drag never changes.

          Drawn solid, with no dashed box round it. It is not a ghost or a
          preview; it is what the original will look like when the gesture ends,
          which is exactly what it looked like before the gesture began.
          Fading it, or ringing it in chrome, would say the original was in
          question -- and the one promise of this gesture is that it is not.
        */}
        {isAltDuplicating && (
          <Group
            x={node.x + node.width / 2}
            y={node.y + node.height / 2}
            offsetX={node.width / 2}
            offsetY={node.height / 2}
            rotation={node.rotation}
            scaleX={node.scaleX}
            scaleY={node.scaleY}
            skewX={node.skewX ? Math.tan((node.skewX * Math.PI) / 180) : 0}
            skewY={node.skewY ? Math.tan((node.skewY * Math.PI) / 180) : 0}
            opacity={node.opacity ?? 1}
            listening={false}
            name={EXPORT_CHROME}
          >
            <NodeContent node={node} isEditing={false} stageScale={stageScale} />
          </Group>
        )}

        <Group
          id={objId}
          /**
           * Named so an export can find every object in one traversal.
           *
           * A selection-scoped raster capture has to hide everything outside
           * the selection -- otherwise the PNG of one sticky note also contains
           * the frame behind it, while the SVG of the same selection does not.
           * Konva's `findOne('#id')` walks the whole tree per call in this
           * version; one `find('.canvas-object')` collects them all. See
           * `engine/export/isolate.ts`.
           */
          name={OBJECT_NODE}
          ref={shapeRef}
          x={x + cx}
          y={y + cy}
          offsetX={cx}
          offsetY={cy}
          rotation={rotation}
          scaleX={node.scaleX}
          scaleY={node.scaleY}
          // Degrees in the document, matrix coefficients here. Konva's
          // `skewX` is the coefficient itself, not an angle, and this `tan` is
          // the only place the two conventions meet — the same arrangement
          // `fontStyle` has, for the same reason.
          skewX={node.skewX ? Math.tan((node.skewX * Math.PI) / 180) : 0}
          skewY={node.skewY ? Math.tan((node.skewY * Math.PI) / 180) : 0}
          // Dimmed, not hidden, when a tag filter excludes this object. Hiding
          // would make the board look emptied and lose the spatial context —
          // the point of filtering on a canvas is to see the matches *among*
          // everything else, which is the difference between a canvas filter
          // and a list filter.
          opacity={node.opacity * (filteredOut ? 0.12 : 1)}
          // How this object's pixels combine with what is beneath it. Konva
          // takes Canvas2D's own vocabulary, which is what the model stores,
          // so there is no lookup table between the two to fall out of step.
          // `normal` is stored as absent and Konva's default is `source-over`,
          // which is the same thing under a different name.
          globalCompositeOperation={
            (appearance?.blendMode as GlobalCompositeOperation | undefined) ?? undefined
          }
          listening={!node.locked && !filteredOut}
          // Not draggable while a force tool is armed: pressing on or near an
          // object would otherwise start a drag instead of applying the force,
          // which made the tools look inert exactly where you would aim them.
          // And not draggable under a tool that cannot select — see
          // `selectable`, and `canSelectWith` for why one predicate answers
          // both questions.
          /**
           * A pinned note is held where it is.
           *
           * `pinned` used to be drawn and honoured by nothing, while the
           * properties panel's hint promised the note "stays put" -- a field
           * the renderer showed and the document ignored. It is the lighter
           * half of `locked`: the note cannot be dragged, and everything else
           * about it stays live. Its own pin is the way out, and so are the
           * rail and the panel.
           */
          draggable={selectable && !flight && !node.locked && !isPinned(node) && !forceToolActive && !filteredOut}
          /**
           * Selection happens on **press**, not on click.
           *
           * ## Why the click was losing them
           *
           * Konva fires `click` on mouseup only if no drag happened in
           * between, and its drag threshold is three pixels. A real hand
           * crosses three pixels on the way to letting go — more on a
           * trackpad — so pressing an object, twitching, and releasing moved
           * it slightly and selected *nothing*. Intermittent by nature, which
           * is why it reads as "sometimes clicking doesn't work", and why the
           * reliable workaround people find is to marquee over the object
           * instead: the marquee is not a click and never gets swallowed.
           *
           * Pressing is also simply what a selection tool does. Figma,
           * Illustrator and Sketch all select on mousedown, because the press
           * is what begins the drag and the thing you are about to drag has
           * to be selected before it moves — otherwise the first frame of
           * every drag operates on the wrong selection.
           *
           * ## Why an already-selected object is left alone
           *
           * Pressing one member of a multi-selection to drag the whole group
           * must not collapse the selection to that one object. So a press on
           * something already selected changes nothing and lets the drag
           * proceed; only a press on something *outside* the selection
           * replaces it. Shift is always passed through, because adding and
           * removing is exactly what shift is for.
           */
          onMouseDown={(e) => {
            if (!selectable) return;
            const isAdditive = Boolean(e.evt?.shiftKey || e.evt?.ctrlKey || e.evt?.metaKey);
            if (isSelected && !isAdditive) return;
            onSelect(objId, e);
          }}
          onTap={(e) => onSelect(objId, e as unknown as Konva.KonvaEventObject<MouseEvent>)}
          onDblClick={handleDblClick}
          onDblTap={handleDblClick}
          /**
           * Clip this object to the frame that owns it.
           *
           * Children are siblings of their frame in the layer, not nested
           * inside its `Group` — the flat list is what makes per-object
           * subscriptions and spatial culling work, and nesting frames would
           * mean rebuilding both. So the clip is applied to the *child*, and
           * has to be expressed in the child's own local space, which is
           * rotated, scaled and offset to its centre.
           *
           * Inverting the group's absolute transform and mapping the frame's
           * four corners through it is what makes that correct under rotation:
           * clipping to a plain rectangle in local coordinates would rotate
           * the clip along with the object, so a tilted sticky would be cut by
           * a tilted window instead of by the frame's actual edge.
           */
          clipFunc={
            slotClip
              ? /**
                 * The module wins over the frame when a picture is in both.
                 *
                 * Konva takes one clip path per node and two subpaths would
                 * *union* rather than intersect, so these cannot simply be
                 * combined. The module is chosen because it is the tighter
                 * constraint in every arrangement that actually occurs — the
                 * picture is inside the module, which is inside the grid, which
                 * is inside the frame — and because it is the one the reader
                 * can see. The frame still clips the grid itself.
                 */
                (ctx: Konva.Context) => {
                  ctx.beginPath();
                  ctx.moveTo(slotClip[0].x, slotClip[0].y);
                  for (let i = 1; i < slotClip.length; i++) ctx.lineTo(slotClip[i].x, slotClip[i].y);
                  ctx.closePath();
                }
              : clipRect
              ? (ctx: Konva.Context) => {
                  const group = shapeRef.current;
                  const stage = group?.getStage();
                  if (!group || !stage) return;
                  // World -> absolute is the stage's transform, since the
                  // camera lives there. Absolute -> this group's local space is
                  // the inverse of its own absolute transform. Composing the
                  // two maps a frame's world rectangle into the coordinates
                  // this clip path is drawn in.
                  const toAbsolute = stage.getAbsoluteTransform();
                  const toLocal = group.getAbsoluteTransform().copy().invert();
                  const corners = [
                    { x: clipRect.x, y: clipRect.y },
                    { x: clipRect.x + clipRect.width, y: clipRect.y },
                    { x: clipRect.x + clipRect.width, y: clipRect.y + clipRect.height },
                    { x: clipRect.x, y: clipRect.y + clipRect.height },
                  ].map((corner) => toLocal.point(toAbsolute.point(corner)));
                  ctx.beginPath();
                  ctx.moveTo(corners[0].x, corners[0].y);
                  for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].x, corners[i].y);
                  ctx.closePath();
                }
              : undefined
          }
          onDragStart={handleDragStart}
          onDragMove={handleDragMove}
          onDragEnd={handleDragEnd}
          onMouseEnter={() => setIsHovered(selectable)}
          onMouseLeave={() => setIsHovered(false)}
          dragBoundFunc={(pos) => {
            // Snapping is done in world space on the node's *top-left* corner,
            // then mapped back. Snapping the raw screen position would give a
            // grid whose spacing changed with zoom, and snapping the centre
            // would leave odd-sized objects permanently off-grid.
            const world = cameraSystem.screenToWorld(pos.x, pos.y);
            let topLeft = { x: world.x - cx, y: world.y - cy };

            // The grid first, because it is the coarser rule: an object pulled
            // onto the grid can still be nudged onto a neighbour's edge, but a
            // grid applied afterwards would undo every object snap it landed
            // between two grid lines.
            if (gridSnap.shouldSnap()) {
              topLeft = gridSnap.snapPoint(topLeft.x, topLeft.y);
            }

            // Then other objects. Always on, suppressed by the same modifier
            // grid snap uses — an escape hatch you hold rather than a setting
            // you go and find is what every tool in this category does.
            topLeft = snapDraggedBox(
              objId,
              { ...topLeft, width: node.width * Math.abs(node.scaleX), height: node.height * Math.abs(node.scaleY) },
              selectedIdsRef?.current
            );

            return {
              x: (topLeft.x + cx) * cameraSystem.zoom + cameraSystem.x,
              y: (topLeft.y + cy) * cameraSystem.zoom + cameraSystem.y,
            };
          }}
        >
          <NodeContent node={liveNode} isEditing={isEditing} stageScale={stageScale} />

          {isHovered && selectable && !isSelected && (
            // Sized from the node's real bounds. This used to read
            // `content.width`, which is undefined for shapes, text and
            // stickies — so the hover affordance was an 8x8px stub.
            <Rect
              x={-4}
              y={-4}
              width={node.width + 8}
              height={node.height + 8}
              stroke="#3B82F6"
              strokeWidth={1.5 / stageScale}
              listening={false}
              name={EXPORT_CHROME}
            />
          )}

          {/* `ObjectPresenceIndicator` was mounted here on every object. It
              read an awareness field called `editing` that nothing has ever
              written (`EditorAPI.setEditingMode` has no callers), so it had
              never rendered — a per-object awareness subscription and a
              react-konva `Html` portal, on every object in the document, to
              draw nothing. Who has an object is now shown on the remote
              selection outline itself: see `engine/presence/PresenceRenderer`. */}
        </Group>

        {isEditing && hasText(node) && (
          <NodeEditor node={node as TextBearingNode} onCommit={handleCommit} onCancel={handleCancel} />
        )}
      </>
    );
  },
  /**
   * Every prop this component's *output* depends on has to be here.
   *
   * `selectable` was missing, and that turned out to matter enormously once it
   * started gating selection. It changes when the active tool does — the whole
   * point of it — but the comparator said "nothing changed", so an object that
   * had not re-rendered for some other reason kept the old value: `draggable`
   * stayed false and the press handler kept a closure over `selectable ===
   * false`. Clicking it did nothing.
   *
   * The symptom was maddeningly selective, and the selectivity is the tell:
   * objects that happened to re-render for another reason — moved, edited, or
   * unmounted by culling and remounted on the way back — picked up the fresh
   * prop and behaved. Ones that had sat untouched did not. "It refuses to
   * select things that have been sitting there a while" is exactly what a
   * stale memo looks like from the outside.
   *
   * It was wrong before too, and invisible: `selectable` only gated the hover
   * outline, so a stale one meant an outline that failed to appear. Making it
   * gate the click promoted a cosmetic bug to a functional one — which is the
   * general hazard in widening what an existing prop controls, and worth
   * checking the memo for every time.
   */
  (prev, next) =>
    prev.objId === next.objId &&
    prev.isSelected === next.isSelected &&
    prev.selectable === next.selectable &&
    prev.canDuplicate === next.canDuplicate &&
    prev.stageScale === next.stageScale
);

ObjectRenderer.displayName = 'ObjectRenderer';

/**
 * Typed dispatch to the per-type renderer.
 *
 * No renderer takes `isSelected` any more: selection is one hairline ring
 * drawn once, above, for every object type. The sticky was the last holdout
 * with a look of its own.
 */
const NodeContent: React.FC<{ node: AnyNode; isEditing: boolean; stageScale?: number }> = ({
  node,
  isEditing,
  stageScale = 1,
}) => {
  switch (node.type) {
    case 'text':
      return <TextRenderer node={node} visible={!isEditing} />;
    case 'shape':
      return <ShapeRenderer node={node} showLabel={!isEditing} />;
    case 'sticky':
      return (
        <StickyRenderer
          node={node}
          showText={!isEditing}
          myAuthorId={localAuthorId()}
          onToggleReaction={(emoji) => toggleReaction(node.id, emoji, localAuthorId())}
          onTogglePin={() => updateNode(node.id, { pinned: !node.pinned })}
        />
      );
    case 'image':
      return <ImageRenderer node={node} />;
    case 'audio':
      return <AudioRenderer node={node} />;
    case 'path':
      return <PathRenderer node={node} />;
    case 'comment':
      return (
        <Group>
          <Circle x={16} y={16} radius={16} fill="#222427" shadowColor="rgba(0,0,0,0.2)" shadowBlur={5} shadowOffsetY={2} />
          <Text x={6} y={7} text="💬" fontSize={16} listening={false} />
        </Group>
      );
    case 'frame':
      return <FrameRenderer node={node} stageScale={stageScale} />;
    case 'connector':
      return <ConnectorRenderer node={node} />;
    case 'grid':
      return <GridRenderer node={node} />;
  }
};
