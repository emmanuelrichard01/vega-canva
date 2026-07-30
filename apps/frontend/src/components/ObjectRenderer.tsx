import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Circle, Group, Rect, Text } from 'react-konva';
import Konva from 'konva';
import { deleteNode, updateNode } from '../engine/document';
import { useStore } from '../hooks/useStore';
import { cameraSystem } from '../engine/CameraSystem';
import { gridSnap } from '../engine/interaction/gridSnap';
import { presenceManager } from '../engine/presence/PresenceManager';
import { useFlight } from '../engine/physics/flightState';
import { hasText, type AnyNode, type TextBearingNode } from '../engine/model/schema';
import { ObjectPresenceIndicator } from './canvas/ObjectPresenceIndicator';
import { NodeEditor } from './canvas/NodeEditor';
import { AudioRenderer } from './canvas/renderers/AudioRenderer';
import { ImageRenderer } from './canvas/renderers/ImageRenderer';
import { PathRenderer } from './canvas/renderers/PathRenderer';
import { ShapeRenderer } from './canvas/renderers/ShapeRenderer';
import { StickyRenderer } from './canvas/renderers/StickyRenderer';
import { TextRenderer } from './canvas/renderers/TextRenderer';

interface ObjectRendererProps {
  objId: string;
  isSelected: boolean;
  onSelect: (id: string, e?: Konva.KonvaEventObject<MouseEvent>) => void;
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
  nodeStartX: number;
  nodeStartY: number;
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
  ({ objId, isSelected, onSelect, onThrow, stageScale = 1, selectedIdsRef }: ObjectRendererProps) => {
    const node = useStore((state) => state.objects[objId]);
    const forceToolActive = useStore((state) => state.forceToolActive);

    const shapeRef = useRef<Konva.Group>(null);
    const lastPos = useRef({ x: 0, y: 0, time: 0 });
    const velocity = useRef({ x: 0, y: 0 });
    const groupDragRef = useRef<{ startX: number; startY: number; siblings: Record<string, SiblingDragState> } | null>(null);

    const [isEditing, setIsEditing] = useState(false);
    const [isHovered, setIsHovered] = useState(false);

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
      presenceManager.updateActivity('✏️ Typing');
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
        lastPos.current = { x: e.target.x(), y: e.target.y(), time: performance.now() };
        velocity.current = { x: 0, y: 0 };

        const selection = selectedIdsRef?.current;
        if (isSelected && selection && selection.length > 1) {
          const stage = e.target.getStage();
          const all = useStore.getState().objects;
          const siblings: Record<string, SiblingDragState> = {};
          selection
            .filter((sid) => sid !== objId)
            .forEach((sid) => {
              const sibling = all[sid];
              const konvaNode = stage?.findOne('#' + sid);
              if (sibling && konvaNode) {
                siblings[sid] = { rawX: sibling.x, rawY: sibling.y, nodeStartX: konvaNode.x(), nodeStartY: konvaNode.y() };
              }
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

        // The Konva group sits at the object's centre (see the offset in the
        // render below), so committing its position back to the document has
        // to subtract the half-extents to recover the stored top-left.
        const current = useStore.getState().objects[objId];
        const halfW = current ? current.width / 2 : 0;
        const halfH = current ? current.height / 2 : 0;

        if (groupDragRef.current) {
          const dx = e.target.x() - groupDragRef.current.startX;
          const dy = e.target.y() - groupDragRef.current.startY;
          Object.entries(groupDragRef.current.siblings).forEach(([sid, s]) => {
            updateNode(sid, { x: s.rawX + dx, y: s.rawY + dy });
          });
          groupDragRef.current = null;
          // Flicking a whole multi-selection into a throw isn't a supported
          // gesture, so treat the dragged object as a plain move too.
          updateNode(objId, { x: e.target.x() - halfW, y: e.target.y() - halfH });
          return;
        }

        const speed = Math.hypot(velocity.current.x, velocity.current.y);
        if (speed > 0.5 && onThrow) {
          // Matter positions bodies by their centre, which is precisely what
          // e.target reports here — no conversion needed.
          onThrow(objId, e.target.x(), e.target.y(), velocity.current.x * 15, velocity.current.y * 15);
        } else {
          updateNode(objId, { x: e.target.x() - halfW, y: e.target.y() - halfH });
        }
      },
      [objId, onThrow]
    );

    const handleDblClick = useCallback(() => {
      if (!node) return;
      if (!isSelected) onSelect(objId);
      if (hasText(node)) setIsEditing(true);
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

        updateNode(objId, size ? { text, ...size } : { text });
      },
      [node, objId]
    );

    const handleCancel = useCallback(() => {
      setIsEditing(false);
      if (node?.type === 'text' && !node.text.trim()) deleteNode(objId);
    }, [node, objId]);

    if (!node || node.hidden) return null;

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
          opacity={node.opacity}
          // Not draggable while a force tool is armed: pressing on or near an
          // object would otherwise start a drag instead of applying the force,
          // which made the tools look inert exactly where you would aim them.
          draggable={!flight && !node.locked && !forceToolActive}
          listening={!node.locked}
          onClick={(e) => onSelect(objId, e)}
          onTap={(e) => onSelect(objId, e as unknown as Konva.KonvaEventObject<MouseEvent>)}
          onDblClick={handleDblClick}
          onDblTap={handleDblClick}
          onDragStart={handleDragStart}
          onDragMove={handleDragMove}
          onDragEnd={handleDragEnd}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          dragBoundFunc={(pos) => {
            if (!gridSnap.shouldSnap()) return pos;
            // Snapping is done in world space on the node's *top-left* corner,
            // then mapped back. Snapping the raw screen position would give a
            // grid whose spacing changed with zoom, and snapping the centre
            // would leave odd-sized objects permanently off-grid.
            const world = cameraSystem.screenToWorld(pos.x, pos.y);
            const snapped = gridSnap.snapPoint(world.x - cx, world.y - cy);
            return {
              x: (snapped.x + cx) * cameraSystem.zoom + cameraSystem.x,
              y: (snapped.y + cy) * cameraSystem.zoom + cameraSystem.y,
            };
          }}
        >
          <NodeContent node={node} isSelected={isSelected} isEditing={isEditing} />

          {isHovered && !isSelected && (
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
            />
          )}

          <ObjectPresenceIndicator objId={objId} width={node.width} cx={0} cy={0} />
        </Group>

        {isEditing && hasText(node) && (
          <NodeEditor node={node as TextBearingNode} onCommit={handleCommit} onCancel={handleCancel} />
        )}
      </>
    );
  },
  (prev, next) =>
    prev.objId === next.objId &&
    prev.isSelected === next.isSelected &&
    prev.stageScale === next.stageScale
);

ObjectRenderer.displayName = 'ObjectRenderer';

/** Typed dispatch to the per-type renderer. */
const NodeContent: React.FC<{ node: AnyNode; isSelected: boolean; isEditing: boolean }> = ({ node, isSelected, isEditing }) => {
  switch (node.type) {
    case 'text':
      return <TextRenderer node={node} visible={!isEditing} />;
    case 'shape':
      return <ShapeRenderer node={node} showLabel={!isEditing} />;
    case 'sticky':
      return <StickyRenderer node={node} isSelected={isSelected} showText={!isEditing} />;
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
      return (
        <Group>
          <Rect
            width={node.width}
            height={node.height}
            fill={node.appearance.fill?.[0]?.color ?? '#FFFFFF'}
            cornerRadius={node.appearance.cornerRadius ?? 0}
            shadowColor="black"
            shadowBlur={20}
            shadowOpacity={0.05}
            shadowOffsetY={10}
          />
          <Text text={node.title ?? 'Frame'} y={-24} fontSize={14} fill="#9CA3AF" fontFamily="Inter" listening={false} />
        </Group>
      );
  }
};
