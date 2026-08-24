import React, { useState } from 'react';
import { Circle, Group, Line } from 'react-konva';
import type Konva from 'konva';
import { updateNode } from '../../engine/document';
import { EXPORT_CHROME } from '../../engine/export/chrome';
import { constrainToAngle, lineEndpoints, lineNodeFromEndpoints } from '../../engine/model/lineEnds';
import { bindCandidates } from '../../engine/model/connectorTargets';
import { snapLineEndpoint } from '../../engine/interaction/lineMagneticSnap';
import { useStore } from '../../hooks/useStore';
import type { ShapeNode } from '../../engine/model/schema';

interface Props {
  node: ShapeNode;
  /** World units per screen pixel, so handles stay one size at any zoom. */
  stageScale: number;
}

/** Screen size of a handle, in pixels. Matches the transformer's anchors. */
const HANDLE = 9;
const ACCENT = '#3B82F6';
const SNAP_COLOR = '#10B981';

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
  const [snapMeta, setSnapMeta] = useState<import('../../engine/interaction/lineMagneticSnap').LineSnapIndicator | null>(null);

  const ends = live ?? { a, b };
  const radius = HANDLE / 2 / stageScale;

  const commit = (next: { a: typeof a; b: typeof b }) => {
    // Both halves in one write: the endpoints into `geometry`, and a box that
    // is the extent of what the line draws rather than the diagonal between
    // its ends. See `lineNodeFromEndpoints`.
    updateNode(
      node.id,
      lineNodeFromEndpoints(next.a, next.b, node.geometry, node.appearance?.stroke?.width ?? 2)
    );
    setLive(null);
    setSnapMeta(null);
  };

  const handleFor = (which: 'a' | 'b') => {
    const point = ends[which];
    const anchor = which === 'a' ? ends.b : ends.a;
    const capKind = which === 'a'
      ? (node.geometry.endStart ?? 'none')
      : (node.geometry.endEnd ?? (node.geometry.kind === 'arrow' ? 'arrow' : 'none'));

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
          const evt = e.evt as unknown as { shiftKey?: boolean; altKey?: boolean };
          // Shift constrains to fifteen degrees from the *other* end, which is
          // what makes it read as swinging the line rather than as snapping to
          // a grid the line has no relationship to.
          if (evt.shiftKey) {
            moved = constrainToAngle(anchor, moved);
            setSnapMeta(null);
          } else if (!evt.altKey) {
            // Magnetic snap to shape ports and outlines when not holding Alt
            const candidates = bindCandidates(useStore.getState().objects);
            const snap = snapLineEndpoint(
              moved,
              candidates,
              stageScale,
              {
                anchor,
                endType: which === 'a' ? 'start' : 'end',
                capKind,
                endScale: node.geometry.endScale ?? 1,
                strokeWidth: node.appearance?.stroke?.width ?? 2,
                lineProfile: node.geometry.lineProfile,
                endAlign: node.geometry.endAlign,
              },
              node.id
            );
            if (snap.snapped) {
              moved = snap.point;
              setSnapMeta(snap.meta ?? null);
            } else {
              setSnapMeta(null);
            }
          } else {
            setSnapMeta(null);
          }
          e.target.position(moved);
          setLive(which === 'a' ? { a: moved, b: ends.b } : { a: ends.a, b: moved });
        }}
        onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) => {
          window.dispatchEvent(new CustomEvent('canvas-drag-end'));
          let moved = { x: e.target.x(), y: e.target.y() };
          const evt = e.evt as unknown as { shiftKey?: boolean; altKey?: boolean };
          if (evt.shiftKey) {
            moved = constrainToAngle(anchor, moved);
          } else if (!evt.altKey) {
            const candidates = bindCandidates(useStore.getState().objects);
            const snap = snapLineEndpoint(
              moved,
              candidates,
              stageScale,
              {
                anchor,
                endType: which === 'a' ? 'start' : 'end',
                capKind,
                endScale: node.geometry.endScale ?? 1,
                strokeWidth: node.appearance?.stroke?.width ?? 2,
                lineProfile: node.geometry.lineProfile,
                endAlign: node.geometry.endAlign,
              },
              node.id
            );
            if (snap.snapped) moved = snap.point;
          }
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
      {/* Target shape boundary halo when magnetically locked */}
      {snapMeta && snapMeta.targetBox && (
        <Line
          points={[
            snapMeta.targetBox.x,
            snapMeta.targetBox.y,
            snapMeta.targetBox.x + snapMeta.targetBox.width,
            snapMeta.targetBox.y,
            snapMeta.targetBox.x + snapMeta.targetBox.width,
            snapMeta.targetBox.y + snapMeta.targetBox.height,
            snapMeta.targetBox.x,
            snapMeta.targetBox.y + snapMeta.targetBox.height,
          ]}
          closed
          fill="#10B98112"
          stroke={SNAP_COLOR}
          strokeWidth={1 / stageScale}
          dash={[4 / stageScale, 4 / stageScale]}
          listening={false}
        />
      )}

      {/* Dynamic port indicator with head/tail styling */}
      {snapMeta && (
        <Group listening={false}>
          {/* Concentric outer halo */}
          <Circle
            x={snapMeta.point.x}
            y={snapMeta.point.y}
            radius={8 / stageScale}
            fill="#10B98126"
            stroke={SNAP_COLOR}
            strokeWidth={1.5 / stageScale}
          />
          {/* Inner core marker */}
          <Circle
            x={snapMeta.point.x}
            y={snapMeta.point.y}
            radius={3 / stageScale}
            fill={SNAP_COLOR}
          />
          {/* Directional crosshair ticks */}
          <Line
            points={[
              snapMeta.point.x - 5 / stageScale,
              snapMeta.point.y,
              snapMeta.point.x + 5 / stageScale,
              snapMeta.point.y,
            ]}
            stroke="#FFFFFF"
            strokeWidth={1 / stageScale}
          />
          <Line
            points={[
              snapMeta.point.x,
              snapMeta.point.y - 5 / stageScale,
              snapMeta.point.x,
              snapMeta.point.y + 5 / stageScale,
            ]}
            stroke="#FFFFFF"
            strokeWidth={1 / stageScale}
          />
        </Group>
      )}

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


