import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Circle, Group, Rect, Text } from 'react-konva';
import Konva from 'konva';
import { applyNodePatches, deleteNode, localAuthorId, toggleReaction, updateNode } from '../engine/document';
import { consumePendingEdit, requestCaretOnMount } from '../engine/interaction/pendingEdit';
import { cropMode } from '../engine/interaction/cropMode';
import { pathEdit } from '../engine/interaction/pathEdit';
import { EXPORT_CHROME } from '../engine/export/chrome';
import { moveFrameWithChildren, reassignFrame } from '../engine/interaction/frameMembership';
import { tagFilter } from '../engine/model/tagFilter';
import { matchesTagFilter } from '../engine/model/tags';
import { useStore } from '../hooks/useStore';
import { cameraSystem } from '../engine/CameraSystem';
import { gridSnap } from '../engine/interaction/gridSnap';
import { clearSnapGuides, snapDraggedBox } from '../engine/interaction/objectSnap';
import { presenceManager } from '../engine/presence/PresenceManager';
import { useFlight } from '../engine/physics/flightState';
import { hasText, type AnyNode, type TextBearingNode } from '../engine/model/schema';
import { NodeEditor } from './canvas/NodeEditor';
import { AudioRenderer } from './canvas/renderers/AudioRenderer';
import { ImageRenderer } from './canvas/renderers/ImageRenderer';
import { PathRenderer } from './canvas/renderers/PathRenderer';
import { ShapeRenderer } from './canvas/renderers/ShapeRenderer';
import { StickyRenderer } from './canvas/renderers/StickyRenderer';
import { FrameRenderer } from './canvas/renderers/FrameRenderer';
import { ConnectorRenderer } from './canvas/renderers/ConnectorRenderer';
import { useLayerFilters } from './canvas/renderers/useLayerFilters';
import { TextRenderer } from './canvas/renderers/TextRenderer';
import { caretAt, layoutText } from '../engine/text/layout';
import { measurerFor } from '../engine/text/measure';
import { applyTextCase } from '../engine/model/textCase';

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
export const ObjectRenderer = React.memo(
  ({ objId, isSelected, onSelect, onThrow, stageScale = 1, selectedIdsRef, selectable = true }: ObjectRendererProps) => {
    const node = useStore((state) => state.objects[objId]);
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

    // Claimed during the first render, which is the point: a tool that has
    // just created this node asked for it to open ready to type in, and there
    // is no window between mounting and listening for the request to fall
    // through. See `engine/interaction/pendingEdit.ts`.
    const [isEditing, setIsEditing] = useState(() => consumePendingEdit(objId));
    const [isHovered, setIsHovered] = useState(false);

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

        const selection = selectedIdsRef?.current;
        if (isSelected && selection && selection.length > 1) {
          const stage = e.target.getStage();
          const all = useStore.getState().objects;
          const siblings: Record<string, SiblingDragState> = {};
          /**
           * Every selected sibling, whether or not it is on screen.
           *
           * This used to require a Konva node and skip the sibling when there
           * was none — and the canvas only renders what is in view, so any
           * selected object outside the viewport was silently dropped from the
           * drag and left exactly where it was. On a grid that reads as the
           * modules scattering and their gaps coming apart on every move: the
           * cells you could see moved, the ones you could not did not, and the
           * arrangement tore along the edge of the viewport.
           *
           * A drag is defined by the selection, not by what happens to be
           * drawn, so the snapshot comes from the store and the Konva node is
           * an optional extra for the live preview.
           */
          selection
            .filter((sid) => sid !== objId)
            .forEach((sid) => {
              const sibling = all[sid];
              if (!sibling) return;
              const konvaNode = stage?.findOne('#' + sid);
              siblings[sid] = {
                rawX: sibling.x,
                rawY: sibling.y,
                nodeStartX: konvaNode ? konvaNode.x() : null,
                nodeStartY: konvaNode ? konvaNode.y() : null,
              };
            });
          groupDragRef.current = { startX: e.target.x(), startY: e.target.y(), siblings };
        } else {
          groupDragRef.current = null;
        }
      },
      [isSelected, objId, selectedIdsRef]
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

        if (groupDragRef.current) {
          const stage = e.target.getStage();
          const dx = e.target.x() - groupDragRef.current.startX;
          const dy = e.target.y() - groupDragRef.current.startY;
          Object.entries(groupDragRef.current.siblings).forEach(([sid, s]) => {
            // Only what is drawn needs dragging. A sibling that scrolled into
            // view mid-drag has no start position recorded, so it is left to
            // the commit rather than snapped to a delta it never began.
            if (s.nodeStartX === null || s.nodeStartY === null) return;
            const konvaNode = stage?.findOne('#' + sid);
            if (konvaNode) {
              konvaNode.x(s.nodeStartX + dx);
              konvaNode.y(s.nodeStartY + dy);
            }
          });
          stage?.batchDraw();
        }
      },
      []
    );

    const handleDragEnd = useCallback(
      (e: Konva.KonvaEventObject<DragEvent>) => {
        window.dispatchEvent(new CustomEvent('canvas-drag-end'));
        presenceManager.updateActivity(null);
        // The guides explained a gesture that is now over.
        clearSnapGuides();

        // The Konva group sits at the object's centre (see the offset in the
        // render below), so committing its position back to the document has
        // to subtract the half-extents to recover the stored top-left.
        const current = useStore.getState().objects[objId];
        const halfW = current ? current.width / 2 : 0;
        const halfH = current ? current.height / 2 : 0;

        if (groupDragRef.current) {
          const dx = e.target.x() - groupDragRef.current.startX;
          const dy = e.target.y() - groupDragRef.current.startY;

          /**
           * The whole selection lands in **one** update.
           *
           * It used to be a loop of `updateNode`, one Yjs transaction each. The
           * store observer fires per transaction and every one of them
           * re-renders the canvas, so a nine-cell selection came apart and
           * reassembled over nine frames: the cells written so far sat at their
           * new positions while the rest waited at their old ones, and the
           * arrangement visibly scattered and snapped back on every drop.
           *
           * It is also wrong in the document, not merely on screen. Nine
           * transactions are nine updates a peer receives separately and nine
           * steps the history has to fold, for one thing that happened.
           */
          applyNodePatches([
            ...Object.entries(groupDragRef.current.siblings).map(([sid, s]) => ({
              id: sid,
              changes: { x: s.rawX + dx, y: s.rawY + dy },
            })),
            // Flicking a whole multi-selection into a throw isn't a supported
            // gesture, so the dragged object is a plain move like the rest.
            { id: objId, changes: { x: e.target.x() - halfW, y: e.target.y() - halfH } },
          ]);
          groupDragRef.current = null;
          return;
        }

        const speed = Math.hypot(velocity.current.x, velocity.current.y);
        if (speed > 0.5 && onThrow) {
          // Matter positions bodies by their centre, which is precisely what
          // e.target reports here — no conversion needed.
          onThrow(objId, e.target.x(), e.target.y(), velocity.current.x * 15, velocity.current.y * 15);
        } else {
          const nextX = e.target.x() - halfW;
          const nextY = e.target.y() - halfH;
          updateNode(objId, { x: nextX, y: nextY });

          // Dragging a frame takes its contents with it. Computed from the
          // committed position rather than from Konva's, so it stays correct
          // when the drag was snapped to the grid.
          if (current?.type === 'frame') {
            moveFrameWithChildren(objId, nextX - current.x, nextY - current.y);
          }

          // Where it landed decides which frame it belongs to. Deliberately
          // after the move is committed, because membership is derived from
          // the object's new centre.
          reassignFrame(objId);
        }
      },
      [objId, onThrow]
    );

    const handleDblClick = useCallback((e?: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      if (!node) return;
      if (!isSelected) onSelect(objId);
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
    const x = flight?.x ?? node.x;
    const y = flight?.y ?? node.y;
    const rotation = flight?.rotation ?? node.rotation;

    // Rotate and scale about the centre, the way every design tool does, by
    // placing the group at the centre and pulling its contents back by the
    // same offset. The node's stored x/y therefore remain its top-left corner
    // while `e.target.x()` during a drag reports the centre — which is also
    // exactly what the physics body expects, since Matter positions bodies by
    // their centre of mass.
    const cx = node.width / 2;
    const cy = node.height / 2;

    return (
      <>
        <Group
          id={objId}
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
          draggable={selectable && !flight && !node.locked && !forceToolActive && !filteredOut}
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
            if (isSelected && !e.evt?.shiftKey) return;
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
            clipRect
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
          <NodeContent node={node} isEditing={isEditing} stageScale={stageScale} />

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
  }
};
