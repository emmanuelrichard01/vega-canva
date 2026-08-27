import React, { useState, useSyncExternalStore } from 'react';
import { Circle, Group, Line, Rect } from 'react-konva';
import type Konva from 'konva';
import { updateNode } from '../../engine/document';
import { EXPORT_CHROME } from '../../engine/export/chrome';
import {
  constrainToAngle,
  lineNodeFromVertices,
  localBends,
  worldVertices,
} from '../../engine/model/lineEnds';
import {
  bendFromPoint,
  bendPoint,
  insertVertex,
  moveVertex,
  nearestSegment,
  polylinePoints,
  type Bends,
} from '../../engine/model/polyline';
import { lineEdit } from '../../engine/interaction/lineEdit';
import { bindCandidates } from '../../engine/model/connectorTargets';
import { snapLineEndpoint } from '../../engine/interaction/lineMagneticSnap';
import { useStore } from '../../hooks/useStore';
import type { Point, ShapeNode } from '../../engine/model/schema';

interface Props {
  node: ShapeNode;
  /** World units per screen pixel, so handles stay one size at any zoom. */
  stageScale: number;
}

/** Screen size of a vertex handle, in pixels. Matches the transformer's anchors. */
const HANDLE = 9;
/** Curve handles are smaller, so they read as secondary to the vertices. */
const BEND_HANDLE = 6;
/** How near the run an Alt-click has to land to add a vertex, in screen pixels. */
const INSERT_REACH = 12;
const ACCENT = '#3B82F6';
const SNAP_COLOR = '#10B981';

type Shape = { vertices: Point[]; bends: Bends };

/**
 * A line's vertices and curves, as handles you can drag.
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
 * ## Two levels of editing, and why the second one is a mode
 *
 * A selected line shows its two **ends**, always. Moving an end is the
 * commonest thing anyone does to a line, and putting a mode in front of the
 * common case would be a step for nothing.
 *
 * A *run of corners* cannot work that way. Five vertices, four curve handles
 * and four segments that accept an Alt-click is nine live targets sitting on
 * top of the object — enough that dragging the line itself becomes difficult,
 * and enough that selecting a diagram would light it up like a control panel.
 * So the rest is a mode: `Ctrl`/`Cmd`+`Enter`, or a double-click, opens it;
 * `Escape` leaves. `lineEdit` holds which line is open, for the same reasons
 * `cropMode` and `pathEdit` hold theirs.
 *
 * ## Live, then committed
 *
 * The drag writes to the Konva node every frame and to the document only on
 * release. A CRDT write per pointer move would put a hundred entries in the
 * undo stack for one gesture and broadcast every one of them to the room.
 */
export const LineEditor: React.FC<Props> = ({ node, stageScale }) => {
  const editing = useSyncExternalStore(lineEdit.subscribe, lineEdit.getSnapshot, lineEdit.getSnapshot);
  const open = editing?.nodeId === node.id;
  const picked = open ? editing?.vertex ?? null : null;

  const world = worldVertices(node);
  const stored: Shape = { vertices: world, bends: localBends(node, world.length) };

  /** The shape being dragged, so the preview follows before anything is stored. */
  const [live, setLive] = useState<Shape | null>(null);
  const [snapMeta, setSnapMeta] = useState<
    import('../../engine/interaction/lineMagneticSnap').LineSnapIndicator | null
  >(null);

  const shape = live ?? stored;
  const { vertices, bends } = shape;
  const smooth = node.geometry.smooth === true;
  const last = vertices.length - 1;
  const radius = HANDLE / 2 / stageScale;
  const strokeWidth = node.appearance?.stroke?.width ?? 2;

  const commit = (next: Shape) => {
    /**
     * Both halves in one write: the run into `geometry`, and a box that is the
     * extent of what the line draws rather than the diagonal between its ends.
     * See `lineNodeFromVertices` — which is also what the tool commits through,
     * so a line drawn and a line reshaped cannot end up with different boxes.
     */
    updateNode(node.id, lineNodeFromVertices(next.vertices, next.bends, node.geometry, strokeWidth));
    setLive(null);
    setSnapMeta(null);
  };

  /**
   * An end being dragged, snapped to whatever it is near.
   *
   * Only the two ends. Binding means "this line runs from that box to this
   * one", which is a statement about ends — a corner in the middle of a route
   * has no such meaning, and having one jump onto a nearby shape's edge while
   * you drag past it is the opposite of helpful.
   */
  const snapEnd = (index: number, to: Point, evt: { shiftKey?: boolean; altKey?: boolean }) => {
    const isEnd = index === 0 || index === last;
    const neighbour = vertices[index === 0 ? 1 : index - 1];

    if (evt.shiftKey) {
      setSnapMeta(null);
      return neighbour ? constrainToAngle(neighbour, to) : to;
    }
    if (!isEnd || evt.altKey) {
      setSnapMeta(null);
      return to;
    }

    const snap = snapLineEndpoint(
      to,
      bindCandidates(useStore.getState().objects),
      stageScale,
      {
        anchor: vertices[index === 0 ? last : 0],
        endType: index === 0 ? 'start' : 'end',
        capKind:
          index === 0
            ? node.geometry.endStart ?? 'none'
            : node.geometry.endEnd ?? (node.geometry.kind === 'arrow' ? 'arrow' : 'none'),
        endScale: node.geometry.endScale ?? 1,
        strokeWidth,
        lineProfile: node.geometry.lineProfile,
        endAlign: node.geometry.endAlign,
      },
      node.id
    );
    if (snap.snapped) {
      setSnapMeta(snap.meta ?? null);
      return snap.point;
    }
    setSnapMeta(null);
    return to;
  };

  const vertexHandle = (index: number) => {
    const point = vertices[index];
    const isPicked = picked === index;

    return (
      <Circle
        key={`v${index}`}
        x={point.x}
        y={point.y}
        radius={isPicked ? radius * 1.25 : radius}
        /**
         * The picked vertex is filled rather than outlined.
         *
         * `Delete` acts on it, so which one is picked has to be legible without
         * hovering — a destructive key whose target you cannot see is the
         * shape of an accident.
         */
        fill={isPicked ? ACCENT : '#FFFFFF'}
        stroke={ACCENT}
        strokeWidth={(isPicked ? 2 : 1) / stageScale}
        draggable
        // The handle is chrome and must never end up in an export.
        name={EXPORT_CHROME}
        onMouseDown={() => lineEdit.pick(index)}
        onDragStart={() => {
          window.dispatchEvent(new CustomEvent('canvas-drag-start'));
          lineEdit.pick(index);
          setLive(stored);
        }}
        onDragMove={(e: Konva.KonvaEventObject<DragEvent>) => {
          const evt = e.evt as unknown as { shiftKey?: boolean; altKey?: boolean };
          const moved = snapEnd(index, { x: e.target.x(), y: e.target.y() }, evt);
          e.target.position(moved);
          setLive({ vertices: moveVertex(vertices, index, moved), bends });
        }}
        onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) => {
          window.dispatchEvent(new CustomEvent('canvas-drag-end'));
          const evt = e.evt as unknown as { shiftKey?: boolean; altKey?: boolean };
          const moved = snapEnd(index, { x: e.target.x(), y: e.target.y() }, evt);
          commit({ vertices: moveVertex(vertices, index, moved), bends });
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

  /**
   * The curve handle for one segment.
   *
   * Drawn on every segment, straight or not, at the chord's midpoint — which is
   * what makes bending discoverable. A handle that only appeared once a segment
   * was already curved would be a control you could only find by already
   * knowing it was there.
   *
   * Alt-clicking one straightens the segment, because the alternative — drag it
   * back to exactly the middle by eye — is a gesture nobody can perform.
   */
  const bendHandle = (index: number) => {
    const a = vertices[index];
    const b = vertices[index + 1];
    const at = bendPoint(a, b, bends[index]);
    const curved = bends[index] != null;

    return (
      <Circle
        key={`b${index}`}
        x={at.x}
        y={at.y}
        radius={BEND_HANDLE / 2 / stageScale}
        fill={curved ? ACCENT : '#FFFFFF'}
        stroke={ACCENT}
        strokeWidth={1 / stageScale}
        opacity={curved ? 1 : 0.72}
        draggable
        name={EXPORT_CHROME}
        onClick={(e: Konva.KonvaEventObject<MouseEvent>) => {
          if (!(e.evt as MouseEvent).altKey) return;
          e.cancelBubble = true;
          const next = [...bends];
          next[index] = null;
          commit({ vertices, bends: next });
        }}
        onDragStart={() => {
          window.dispatchEvent(new CustomEvent('canvas-drag-start'));
          setLive(stored);
        }}
        onDragMove={(e: Konva.KonvaEventObject<DragEvent>) => {
          const next = [...bends];
          next[index] = bendFromPoint(a, b, { x: e.target.x(), y: e.target.y() });
          setLive({ vertices, bends: next });
        }}
        onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) => {
          window.dispatchEvent(new CustomEvent('canvas-drag-end'));
          const next = [...bends];
          next[index] = bendFromPoint(a, b, { x: e.target.x(), y: e.target.y() });
          commit({ vertices, bends: next });
        }}
        onMouseEnter={(e) => {
          const stage = e.target.getStage();
          if (stage) stage.container().style.cursor = 'crosshair';
        }}
        onMouseLeave={(e) => {
          const stage = e.target.getStage();
          if (stage) stage.container().style.cursor = '';
        }}
      />
    );
  };

  /**
   * The strip along the run that accepts an Alt-click to add a vertex.
   *
   * A transparent stroke with a generous `hitStrokeWidth` rather than a visible
   * one: the line is already drawn by the renderer, and drawing it a second
   * time here would double its weight while the editor was open. Alt-clicks
   * only — a plain click has to fall through to the object underneath, or
   * opening the editor would make the line impossible to drag.
   */
  const insertStrip = (
    <Line
      points={polylinePoints(vertices, bends, smooth).flatMap((p) => [p.x, p.y])}
      stroke="transparent"
      strokeWidth={1 / stageScale}
      hitStrokeWidth={INSERT_REACH * 2 / stageScale}
      lineJoin="round"
      name={EXPORT_CHROME}
      onMouseDown={(e: Konva.KonvaEventObject<MouseEvent>) => {
        if (!(e.evt as MouseEvent).altKey) return;
        const stage = e.target.getStage();
        const pointer = stage?.getRelativePointerPosition();
        if (!pointer) return;
        e.cancelBubble = true;
        const hit = nearestSegment(vertices, bends, pointer);
        if (!hit || hit.distance > INSERT_REACH / stageScale) return;
        const next = insertVertex(vertices, bends, hit.index, hit.t);
        // Picked straight away: adding a point is something you do in order to
        // move it, and landing on no selection would make the next Delete act
        // on the whole line instead.
        lineEdit.pick(hit.index + 1);
        commit(next);
      }}
    />
  );

  return (
    <Group name={EXPORT_CHROME}>
      {/* Target shape boundary halo when magnetically locked */}
      {snapMeta && snapMeta.targetBox && (
        <Rect
          x={snapMeta.targetBox.x}
          y={snapMeta.targetBox.y}
          width={snapMeta.targetBox.width}
          height={snapMeta.targetBox.height}
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
          <Circle
            x={snapMeta.point.x}
            y={snapMeta.point.y}
            radius={8 / stageScale}
            fill="#10B98126"
            stroke={SNAP_COLOR}
            strokeWidth={1.5 / stageScale}
          />
          <Circle x={snapMeta.point.x} y={snapMeta.point.y} radius={3 / stageScale} fill={SNAP_COLOR} />
          <Line
            points={[
              snapMeta.point.x - 5 / stageScale, snapMeta.point.y,
              snapMeta.point.x + 5 / stageScale, snapMeta.point.y,
            ]}
            stroke="#FFFFFF"
            strokeWidth={1 / stageScale}
          />
          <Line
            points={[
              snapMeta.point.x, snapMeta.point.y - 5 / stageScale,
              snapMeta.point.x, snapMeta.point.y + 5 / stageScale,
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
          points={polylinePoints(live.vertices, live.bends, smooth).flatMap((p) => [p.x, p.y])}
          stroke={ACCENT}
          strokeWidth={1 / stageScale}
          dash={[4 / stageScale, 4 / stageScale]}
          lineJoin="round"
          listening={false}
        />
      )}

      {open && insertStrip}
      {/*
        No curve handles while the run is smooth.
        The spline decides every segment's curvature from where the neighbouring
        points are, so a per-segment bend would be a second opinion about the
        same segment — and one of them would have to silently win. The bends are
        kept underneath untouched, so turning smoothing off gives back exactly
        the shape that was there. See `polyline.catmullRomPoints`.
      */}
      {/* Curve handles under the vertices, so a vertex sitting on top of one --
          which happens on a very short segment -- is the one you grab. Moving
          a point is the more common intent and the harder one to undo by eye. */}
      {open && !smooth && bends.map((_, i) => (i + 1 <= last ? bendHandle(i) : null))}
      {open
        ? vertices.map((_, i) => vertexHandle(i))
        : [vertexHandle(0), last > 0 ? vertexHandle(last) : null]}
    </Group>
  );
};
