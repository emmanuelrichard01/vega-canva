import React, { useState } from 'react';
import { Circle, Group, Line } from 'react-konva';
import type Konva from 'konva';
import { updateNode } from '../../engine/document';
import { EXPORT_CHROME } from '../../engine/export/chrome';
import { boxFromEndpoints, constrainToAngle, lineEndpoints } from '../../engine/model/lineEnds';
import type { ShapeNode } from '../../engine/model/schema';

interface Props {
  node: ShapeNode;
  /** World units per screen pixel, so handles stay one size at any zoom. */
  stageScale: number;
}

/** Screen size of a handle, in pixels. Matches the transformer's anchors. */
const HANDLE = 9;
const ACCENT = '#3B82F6';

/**
 * The two ends of a line, as handles you can drag.
 *
 * ## Why a line does not get the bounding box
 *
 * Every other shape is edited by resizing its box, and for a rectangle that is
 * exactly right. For a line it is not even close: a box offers eight handles,
 * none of which means "move this end", and dragging any of them moves *both*
 * ends because that is what resizing does. Worse, the transformer floors a box
 * at ten units per axis — so the horizontal line and the vertical line, the two
 * anyone draws most, were the two the tool could not produce.
 *
 * Excalidraw and Figma both solve this the same way and it is the obvious one:
 * a line is edited at its ends. The box remains the storage — `width`/`height`
 * are still the only record of bounds — and this is purely the interface over
 * it, which is what `engine/model/lineEnds` exists to convert between.
 *
 * ## Live, then committed
 *
 * The drag writes to the Konva node every frame and to the document only on
 * release. A CRDT write per pointer move would put a hundred entries in the
 * undo stack for one gesture and broadcast every one of them to the room.
 */
export const LineEditor: React.FC<Props> = ({ node, stageScale }) => {
  const { a, b } = lineEndpoints(node);
  /** The end being dragged, so the preview follows it before anything is stored. */
  const [live, setLive] = useState<{ a: typeof a; b: typeof b } | null>(null);

  const ends = live ?? { a, b };
  const radius = HANDLE / 2 / stageScale;

  const commit = (next: { a: typeof a; b: typeof b }) => {
    updateNode(node.id, boxFromEndpoints(next.a, next.b));
    setLive(null);
  };

  const handleFor = (which: 'a' | 'b') => {
    const point = ends[which];
    const anchor = which === 'a' ? ends.b : ends.a;

    return (
      <Circle
        key={which}
        x={point.x}
        y={point.y}
        radius={radius}
        fill="#FFFFFF"
        stroke={ACCENT}
        strokeWidth={1 / stageScale}
        draggable
        // The handle is chrome and must never end up in an export.
        name={EXPORT_CHROME}
        onDragStart={() => {
          window.dispatchEvent(new CustomEvent('canvas-drag-start'));
          setLive({ a, b });
        }}
        onDragMove={(e: Konva.KonvaEventObject<DragEvent>) => {
          let moved = { x: e.target.x(), y: e.target.y() };
          // Shift constrains to fifteen degrees from the *other* end, which is
          // what makes it read as swinging the line rather than as snapping to
          // a grid the line has no relationship to.
          if ((e.evt as unknown as { shiftKey?: boolean }).shiftKey) {
            moved = constrainToAngle(anchor, moved);
            e.target.position(moved);
          }
          setLive(which === 'a' ? { a: moved, b: ends.b } : { a: ends.a, b: moved });
        }}
        onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) => {
          window.dispatchEvent(new CustomEvent('canvas-drag-end'));
          let moved = { x: e.target.x(), y: e.target.y() };
          if ((e.evt as unknown as { shiftKey?: boolean }).shiftKey) moved = constrainToAngle(anchor, moved);
          commit(which === 'a' ? { a: moved, b: ends.b } : { a: ends.a, b: moved });
        }}
        // The pointer says what the handle does before it is pressed.
        onMouseEnter={(e) => {
          const stage = e.target.getStage();
          if (stage) stage.container().style.cursor = 'move';
        }}
        onMouseLeave={(e) => {
          const stage = e.target.getStage();
          if (stage) stage.container().style.cursor = '';
        }}
      />
    );
  };

  return (
    <Group name={EXPORT_CHROME}>
      {/* A hairline along the run while it is being dragged, so the line is
          visible where it *will* be rather than only where it still is — the
          node itself does not move until the drag commits. */}
      {live && (
        <Line
          points={[live.a.x, live.a.y, live.b.x, live.b.y]}
          stroke={ACCENT}
          strokeWidth={1 / stageScale}
          dash={[4 / stageScale, 4 / stageScale]}
          listening={false}
        />
      )}
      {handleFor('a')}
      {handleFor('b')}
    </Group>
  );
};
