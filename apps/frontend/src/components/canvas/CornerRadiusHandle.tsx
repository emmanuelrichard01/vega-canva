import React, { useState } from 'react';
import { Circle, Group, Path } from 'react-konva';
import type Konva from 'konva';
import { updateNode } from '../../engine/document';
import { EXPORT_CHROME } from '../../engine/export/chrome';
import type { ShapeNode } from '../../engine/model/schema';

interface Props {
  node: ShapeNode;
  /** World units per screen pixel, so the knob stays one size at any zoom. */
  stageScale: number;
}

const ACCENT = '#3B82F6';
/** Screen size of the knob, a touch smaller than a transformer anchor. */
const KNOB = 8;
/**
 * How far in from the corner the knob sits when the radius is zero.
 *
 * Not *at* the corner: it would sit under the transformer's own resize anchor,
 * and the two would fight for the same pixels. A short inset also gives the
 * knob somewhere to travel from, so its first movement is visible.
 */
const REST_INSET = 14;

/**
 * The corner radius as a knob you drag, the way Illustrator and Photoshop do it.
 *
 * ## Why a knob rather than only a number
 *
 * The radius has always been reachable — a stepper in the properties panel and
 * a slider on the rail. Both are fine for *setting* a value you already know
 * and hopeless for *finding* one, which is what rounding a corner actually is:
 * you are matching a feeling against the rest of the board, and the answer
 * arrives by moving until it looks right rather than by typing 12. Every
 * vector tool puts a handle inside the corner for that reason.
 *
 * ## What it is dragged along
 *
 * The diagonal into the shape. Radius is a distance from the corner along both
 * edges at once, so the honest gesture is one that moves along the bisector —
 * dragging it sideways would have to pick an axis and would then disagree with
 * itself on a non-square rectangle. The pointer is projected onto that
 * diagonal, so the knob tracks the hand without the hand having to be exact.
 *
 * ## The ceiling is the shape's, not the control's
 *
 * Clamped to half the shorter side, which is the same clamp `shapeOutline`
 * applies — past that the corners overlap and Canvas2D draws a rectangle
 * turned inside out at the joins. Clamping here as well means the knob stops
 * where the shape stops rather than running on and appearing to do nothing.
 */
export const CornerRadiusHandle: React.FC<Props> = ({ node, stageScale }) => {
  const [live, setLive] = useState<number | null>(null);

  const w = node.width * Math.abs(node.scaleX || 1);
  const h = node.height * Math.abs(node.scaleY || 1);
  const max = Math.min(w, h) / 2;
  const radius = Math.min(live ?? node.appearance?.cornerRadius ?? 0, max);

  // Along the diagonal from the top-left corner. The rest position keeps the
  // knob off the transformer's anchor when there is no radius yet.
  const offset = Math.max(radius, REST_INSET / stageScale);
  const x = node.x + offset;
  const y = node.y + offset;

  const radiusFor = (px: number, py: number): number => {
    // Project the pointer onto the corner's diagonal: the mean of its two
    // offsets, which is what the dot product with a unit 45-degree vector
    // reduces to and is easier to read than the trigonometry.
    const along = ((px - node.x) + (py - node.y)) / 2;
    return Math.max(0, Math.min(max, along));
  };

  const commit = (value: number) => {
    updateNode(node.id, {
      appearance: { ...(node.appearance ?? {}), cornerRadius: value > 0.5 ? Math.round(value) : undefined },
    } as Partial<ShapeNode>);
    setLive(null);
  };

  return (
    <Group name={EXPORT_CHROME}>
      {/* A ghost of the arc the knob is setting, so the number being chosen is
          visible on the shape rather than only in the panel. */}
      {live !== null && radius > 0 && (
        <Path
          data={`M ${node.x} ${node.y + radius} A ${radius} ${radius} 0 0 1 ${node.x + radius} ${node.y}`}
          stroke={ACCENT}
          strokeWidth={1 / stageScale}
          dash={[3 / stageScale, 3 / stageScale]}
          listening={false}
        />
      )}
      <Circle
        x={x}
        y={y}
        radius={KNOB / 2 / stageScale}
        fill="#FFFFFF"
        stroke={ACCENT}
        strokeWidth={1.5 / stageScale}
        draggable
        name={EXPORT_CHROME}
        onDragStart={() => {
          window.dispatchEvent(new CustomEvent('canvas-drag-start'));
          setLive(node.appearance?.cornerRadius ?? 0);
        }}
        onDragMove={(e: Konva.KonvaEventObject<DragEvent>) => {
          setLive(radiusFor(e.target.x(), e.target.y()));
        }}
        onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) => {
          window.dispatchEvent(new CustomEvent('canvas-drag-end'));
          const value = radiusFor(e.target.x(), e.target.y());
          commit(value);
          // Put the knob back on the diagonal — it is drawn from the radius,
          // not from wherever the pointer let go.
          const settled = Math.max(value, REST_INSET / stageScale);
          e.target.position({ x: node.x + settled, y: node.y + settled });
        }}
        onMouseEnter={(e) => {
          const stage = e.target.getStage();
          if (stage) stage.container().style.cursor = 'nwse-resize';
        }}
        onMouseLeave={(e) => {
          const stage = e.target.getStage();
          if (stage) stage.container().style.cursor = '';
        }}
      />
    </Group>
  );
};
