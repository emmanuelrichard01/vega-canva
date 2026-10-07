import React, { useState } from 'react';
import { Group, Rect } from 'react-konva';
import type Konva from 'konva';
import { updateNode } from '../../engine/document';
import { canEditObjects } from '../../engine/model/permissions';
import { EXPORT_CHROME } from '../../engine/export/chrome';
import type { ShapeGeometry, ShapeNode } from '../../engine/model/schema';
import { liveTransformStore, useLiveTransform } from '../../engine/model/liveTransformStore';
import { claimCursor } from '../../engine/cursor/cursorOverride';
import { handlePosition, handleValue, paramHandles, type ParamHandle } from '../../engine/model/shapes/paramHandles';

/**
 * Control points for a shape's parametric fields, drawn on the shape.
 *
 * A diamond rather than the transformer's square or the corner knob's circle,
 * so the three kinds of handle on one selection are told apart by shape: a
 * square resizes, a circle rounds, a diamond reshapes.
 *
 * The drag writes only to `liveTransformStore`, which the renderer merges over
 * the stored geometry, and commits once on release: one undo step and one
 * document update per gesture.
 */

/** The selection chrome's colour, shared with the transformer and the corner knob. */
const CHROME = '#3B82F6';
/** Screen size of the diamond's bounding square. */
const KNOB = 9;

interface Props {
  node: ShapeNode;
  /** World units per screen pixel, so the knob stays one size at any zoom. */
  stageScale: number;
}

export const ShapeParamHandles: React.FC<Props> = ({ node, stageScale }) => {
  const live = useLiveTransform(node.id);
  const [dragging, setDragging] = useState<string | null>(null);
  const handles = paramHandles(node.geometry.kind);
  if (handles.length === 0 || node.locked || !canEditObjects()) return null;

  const x = live?.x ?? node.x;
  const y = live?.y ?? node.y;
  const width = live?.width ?? node.width;
  const height = live?.height ?? node.height;
  const rotation = live?.rotation ?? node.rotation ?? 0;
  const geometry: ShapeGeometry = live?.geometry ? { ...node.geometry, ...live.geometry } : node.geometry;
  const cx = width / 2;
  const cy = height / 2;
  const size = KNOB / stageScale;

  const valueAt = (handle: ParamHandle, target: Konva.Node) =>
    handleValue(geometry, handle, width, height, { x: target.x(), y: target.y() });

  return (
    <Group
      x={x + cx}
      y={y + cy}
      offsetX={cx}
      offsetY={cy}
      rotation={rotation}
      scaleX={node.scaleX}
      scaleY={node.scaleY}
      name={EXPORT_CHROME}
    >
      {handles.map((handle) => {
        const at = handlePosition(geometry, handle, width, height);
        return (
          <Rect
            key={handle.field}
            x={at.x}
            y={at.y}
            width={size}
            height={size}
            offsetX={size / 2}
            offsetY={size / 2}
            rotation={45}
            fill={dragging === handle.field ? CHROME : '#FFFFFF'}
            stroke={CHROME}
            strokeWidth={1.5 / stageScale}
            hitStrokeWidth={8 / stageScale}
            draggable
            name={EXPORT_CHROME}
            onDragStart={() => {
              window.dispatchEvent(new CustomEvent('canvas-drag-start'));
              setDragging(handle.field);
            }}
            onDragMove={(e: Konva.KonvaEventObject<DragEvent>) => {
              const value = valueAt(handle, e.target);
              liveTransformStore.set(node.id, { geometry: { ...(live?.geometry ?? {}), [handle.field]: value } });
              // The knob rides the feature it controls, not the raw pointer.
              const settled = handle.position(width, height, value);
              e.target.position(settled);
            }}
            onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) => {
              window.dispatchEvent(new CustomEvent('canvas-drag-end'));
              const value = valueAt(handle, e.target);
              setDragging(null);
              liveTransformStore.delete(node.id);
              updateNode(node.id, { geometry: { ...node.geometry, [handle.field]: value } } as Partial<ShapeNode>);
            }}
            onMouseEnter={() => claimCursor(`shape-param-${handle.field}`, 'pointer')}
            onMouseLeave={() => claimCursor(`shape-param-${handle.field}`, null)}
          />
        );
      })}
    </Group>
  );
};
