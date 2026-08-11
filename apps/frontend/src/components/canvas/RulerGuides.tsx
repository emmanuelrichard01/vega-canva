import React, { useEffect, useRef, useState } from 'react';
import { Group, Line } from 'react-konva';
import type Konva from 'konva';
import { EXPORT_CHROME } from '../../engine/export/chrome';
import { moveGuide, removeGuide } from '../../engine/document/guides';
import { useRulerGuides } from '../../hooks/useRulerGuides';
import { cameraSystem } from '../../engine/CameraSystem';

interface Props {
  stageScale: number;
  width: number;
  height: number;
}

/** Cyan, so a placed guide is never mistaken for a magenta snap guide. */
const GUIDE_COLOR = '#22D3EE';

/**
 * Dragged past the viewport edge by this much, a guide is being thrown away.
 *
 * In screen pixels, and generous: the gesture is "drag it off", and a tight
 * threshold turns that into a precision task at exactly the moment the user
 * has stopped caring where the thing goes.
 */
const DISCARD_PX = 24;

/**
 * The guides a person placed, drawn on the canvas.
 *
 * Deliberately drawn as ordinary Konva lines rather than as DOM overlays like
 * the rulers: these live in world space and have to be occluded, dragged and
 * hit-tested in the same coordinate system as everything else on the board.
 * The rulers are chrome pinned to the viewport; these are not.
 *
 * Both carry the export-chrome name, though. A guide is scaffolding — nobody
 * wants a cyan line through their PNG.
 */
export const RulerGuides: React.FC<Props> = ({ stageScale, width, height }) => {
  const guides = useRulerGuides();
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const draggedTo = useRef<number>(0);

  // A guide dragged while the document changes underneath would jump; ending
  // the drag is the honest response to the thing you were holding moving.
  useEffect(() => {
    setDragIndex(null);
  }, [guides.length]);

  const hairline = 1 / stageScale;
  // The world rectangle currently on screen, so each guide spans the viewport
  // rather than an arbitrary fixed length that runs out when you pan.
  const view = cameraSystem.getViewportBounds(0);

  return (
    <Group name={EXPORT_CHROME}>
      {guides.map((guide, index) => {
        const vertical = guide.axis === 'x';
        const points = vertical
          ? [guide.position, view.minY, guide.position, view.maxY]
          : [view.minX, guide.position, view.maxX, guide.position];

        return (
          <Line
            key={`${guide.axis}:${guide.position}:${index}`}
            points={points}
            stroke={GUIDE_COLOR}
            strokeWidth={hairline}
            opacity={dragIndex === index ? 1 : 0.7}
            // A hairline is impossible to grab. The hit area is fixed in screen
            // pixels for the same reason the line is: it has to stay grabbable
            // at every zoom.
            hitStrokeWidth={10 / stageScale}
            draggable
            dragBoundFunc={(pos) => {
              // Constrained to its own axis: a vertical guide has no meaningful
              // y, and letting it drift would make the drag feel unanchored.
              const anchored = vertical
                ? { x: pos.x, y: 0 }
                : { x: 0, y: pos.y };
              const world = cameraSystem.screenToWorld(anchored.x, anchored.y);
              draggedTo.current = vertical ? world.x : world.y;
              return anchored;
            }}
            onDragStart={() => setDragIndex(index)}
            onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) => {
              setDragIndex(null);
              // Konva moved the line node itself; the document is the only
              // record that matters, so the node is put back and the position
              // is committed instead.
              e.target.position({ x: 0, y: 0 });

              const screen = vertical
                ? draggedTo.current * cameraSystem.zoom + cameraSystem.x
                : draggedTo.current * cameraSystem.zoom + cameraSystem.y;
              const limit = vertical ? width : height;
              // Dragged off the edge of the viewport is how every tool in this
              // category spells "delete this guide".
              if (screen < -DISCARD_PX || screen > limit + DISCARD_PX) removeGuide(index);
              else moveGuide(index, draggedTo.current);
            }}
            onDblClick={() => removeGuide(index)}
            onDblTap={() => removeGuide(index)}
            perfectDrawEnabled={false}
          />
        );
      })}
    </Group>
  );
};
