import React, { useState, useSyncExternalStore } from 'react';
import { Circle, Group, Line, Rect } from 'react-konva';
import type Konva from 'konva';
import { updateNode } from '../../engine/document';
import { editor } from '../../engine/api/EditorAPI';
import { EXPORT_CHROME } from '../../engine/export/chrome';
import {
  constrainToAngle,
  lineNodeFromVertices,
  localBends,
  runPoints,
  worldVertices,
} from '../../engine/model/lineEnds';
import {
  bendFromPoint,
  bendPoint,
  insertVertex,
  moveVertex,
  nearestSegment,
  polylinePoints,
  removeVertex,
  type Bends,
} from '../../engine/model/polyline';
import { lineEdit } from '../../engine/interaction/lineEdit';
import { promoteLineToConnector } from '../../engine/interaction/lineVertexActions';
import { snapLineEndpoint, type LineSnapIndicator } from '../../engine/interaction/lineMagneticSnap';
import { bindingAt } from '../../engine/model/connectorBinding';
import { connectorPoints, type ConnectorEnd, type Routing } from '../../engine/model/connector';
import { attachLookup, bodyOutlinePoints, boxLookup } from '../../engine/model/connectorTargets';
import { lineBindCandidates, promotion } from '../../engine/model/lineBinding';
import { fractionNearest, lineLabelBox, lineLabelWorld, pointAlongRun } from '../../engine/model/lineLabel';
import { canEditObjects } from '../../engine/model/permissions';
import { useStore } from '../../hooks/useStore';
import type { Point, ShapeNode } from '../../engine/model/schema';
import { claimCursor } from '../../engine/cursor/cursorOverride';

interface Props {
  node: ShapeNode;
  /** World units per screen pixel, so handles stay one size at any zoom. */
  stageScale: number;
}

/** Screen size of a vertex handle, in pixels. Matches the transformer's anchors. */
const HANDLE = 9;
/** Curve handles are smaller, so they read as secondary to the vertices. */
const BEND_HANDLE = 7;
/** A midpoint ghost, smaller again: it is an offer, not a part of the line. */
const GHOST_HANDLE = 6;
/** How near the run an Alt-click has to land to add a vertex, in screen pixels. */
const INSERT_REACH = 12;
/** Canvas chrome blue, shared with the transformer and the connector editor. */
const ACCENT = '#3B82F6';
const SNAP_COLOR = '#10B981';

type Shape = { vertices: Point[]; bends: Bends };

/** A dragged end that would turn the line into a connector on release. */
interface ConnectPreview {
  from: ConnectorEnd;
  to: ConnectorEnd;
  routing: Routing;
  route: number[];
  targets: number[][];
}

/**
 * A line's vertices, curves and label, as handles you can drag.
 *
 * ## Two levels, and why the second is a mode
 *
 * A **selected** line shows its two ends and, on every straight segment, a
 * small ghost at the middle. Dragging an end moves it; dragging a ghost adds a
 * corner there and moves that — the Excalidraw gesture, and the fastest way to
 * bend a route around something. Double-clicking a corner removes it.
 *
 * **Editing** (double-click the line, or ⏎) shows every corner and turns the
 * ghosts into curve handles, drawn as diamonds so the two cannot be mistaken:
 * dragging one bows its segment, Alt-clicking it straightens it again, and an
 * Alt-click on the run adds a corner exactly there. Escape leaves.
 *
 * Nine live targets on a five-corner line is enough to make dragging the line
 * itself hard, which is why the curve handles wait for the mode.
 *
 * ## Ends that land on objects
 *
 * Dragging an end of a two-point line onto an object, while the other end is
 * on another, previews the connector it will become — both objects outlined,
 * the route it will take — and makes it one on release. It is the same rule
 * the tool applies when the line is drawn that way (`lineBinding`). Ctrl or ⌘
 * keeps it a plain line.
 *
 * ## Live, then committed
 *
 * The drag writes to the Konva node every frame and to the document only on
 * release: a CRDT write per pointer move would put a hundred entries in the
 * undo stack for one gesture and broadcast every one of them.
 */
export const LineEditor: React.FC<Props> = ({ node, stageScale }) => {
  const editing = useSyncExternalStore(lineEdit.subscribe, lineEdit.getSnapshot, lineEdit.getSnapshot);
  const open = editing?.nodeId === node.id;
  const picked = open ? editing?.vertex ?? null : null;

  /** The shape being dragged, so the preview follows before anything is stored. */
  const [live, setLive] = useState<Shape | null>(null);
  const [snapMeta, setSnapMeta] = useState<LineSnapIndicator | null>(null);
  const [connect, setConnect] = useState<ConnectPreview | null>(null);
  /** Where a dragged label currently sits, in world space. */
  const [labelDrag, setLabelDrag] = useState<Point | null>(null);
  /** The ghost being dragged, which has to stay mounted while the others hide. */
  const [ghostDrag, setGhostDrag] = useState<number | null>(null);

  // Handles are an offer to edit. A viewer, a commenter or a locked line gets
  // none: the server would refuse the write, and the handle would be a lie.
  if (!canEditObjects() || node.locked) return null;

  const world = worldVertices(node);
  const stored: Shape = { vertices: world, bends: localBends(node, world.length) };
  const shape = live ?? stored;
  const { vertices, bends } = shape;
  const smooth = node.geometry.smooth === true;
  const last = vertices.length - 1;
  const radius = HANDLE / 2 / stageScale;
  const strokeWidth = node.appearance?.stroke?.width || 2;
  const profile = node.geometry.lineProfile ?? 'straight';
  /**
   * Midpoint ghosts only where adding a corner keeps the line looking as it
   * did: a straight two-point line, or a run of corners. A wave or an elbow is
   * drawn from its two ends, and a corner would trade that shape for a run.
   */
  const offersGhosts = !open && !smooth && (vertices.length > 2 || profile === 'straight');

  const commit = (next: Shape) => {
    /**
     * Both halves in one write: the run into `geometry`, and a box that is the
     * extent of what the line draws. `lineNodeFromVertices` is also what the
     * tool commits through, so a drawn line and a reshaped one share a box.
     */
    updateNode(node.id, lineNodeFromVertices(next.vertices, next.bends, node.geometry, strokeWidth));
    setLive(null);
    setSnapMeta(null);
    setConnect(null);
  };

  /**
   * An end being dragged, snapped to whatever it is near.
   *
   * Only the two ends: a corner in the middle of a route has no object to
   * attach to, and having one jump onto a nearby edge as you drag past it is
   * the opposite of helpful.
   */
  const snapEnd = (
    index: number,
    to: Point,
    evt: { shiftKey?: boolean; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }
  ): { point: Point; connect: ConnectPreview | null } => {
    const isEnd = index === 0 || index === last;
    const neighbour = vertices[index === 0 ? 1 : index - 1];
    setConnect(null);

    if (evt.shiftKey) {
      setSnapMeta(null);
      return { point: neighbour ? constrainToAngle(neighbour, to) : to, connect: null };
    }
    if (!isEnd || evt.altKey || evt.ctrlKey || evt.metaKey) {
      setSnapMeta(null);
      return { point: to, connect: null };
    }

    const objects = useStore.getState().objects;
    const candidates = lineBindCandidates(objects).filter((c) => c.id !== node.id);

    // Would this make a connector? Only a two-point line can become one.
    if (vertices.length === 2) {
      const scale = 1 / Math.max(stageScale, 1e-6);
      const moving = bindingAt(to, candidates, { scale });
      const other = bindingAt(vertices[index === 0 ? last : 0], candidates, { scale });
      const from = index === 0 ? moving : other;
      const toEnd = index === 0 ? other : moving;
      const routing = promotion(from, toEnd, { profile, vertexCount: 2, suppressed: false });
      if (routing) {
        const route = connectorPoints(from, toEnd, routing, boxLookup(objects), attachLookup(objects));
        const targets = [from.nodeId, toEnd.nodeId]
          .map((id) => (id ? objects[id] : undefined))
          .filter((n): n is NonNullable<typeof n> => Boolean(n))
          .map((n) => bodyOutlinePoints(n));
        const preview = { from, to: toEnd, routing, route, targets };
        setConnect(preview);
        setSnapMeta(null);
        return { point: to, connect: preview };
      }
    }

    const snap = snapLineEndpoint(
      to,
      candidates,
      stageScale,
      {
        anchor: vertices[index === 0 ? last : 0],
        endType: index === 0 ? 'start' : 'end',
        capKind: index === 0 ? node.geometry.endStart ?? 'none' : node.geometry.endEnd ?? 'none',
        endScale: node.geometry.endScale ?? 1,
        strokeWidth,
        lineProfile: node.geometry.lineProfile,
        endAlign: node.geometry.endAlign,
      },
      node.id
    );
    setSnapMeta(snap.snapped ? snap.meta ?? null : null);
    return { point: snap.snapped ? snap.point : to, connect: null };
  };

  /** Commit an end drag, or make the connector the release point decided on. */
  const finishEndDrag = (next: Shape, connect: ConnectPreview | null) => {
    if (connect && connect.route.length >= 4) {
      const a = { x: connect.route[0], y: connect.route[1] };
      const b = { x: connect.route[connect.route.length - 2], y: connect.route[connect.route.length - 1] };
      const id = promoteLineToConnector(node, { from: connect.from, to: connect.to, a, b, routing: connect.routing });
      setLive(null);
      setConnect(null);
      setSnapMeta(null);
      if (id) editor.select(id);
      return;
    }
    commit(next);
  };

  const removeAt = (index: number) => {
    if (vertices.length <= 2) return;
    const next = removeVertex(vertices, bends, index);
    lineEdit.pick(null);
    commit(next);
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
        // The picked vertex is filled, because Delete acts on it and a
        // destructive key whose target you cannot see is an accident waiting.
        fill={isPicked ? ACCENT : '#FFFFFF'}
        stroke={ACCENT}
        strokeWidth={(isPicked ? 2 : 1) / stageScale}
        draggable
        // Chrome, never part of an export.
        name={EXPORT_CHROME}
        onMouseDown={() => lineEdit.pick(index)}
        onDblClick={(e: Konva.KonvaEventObject<MouseEvent>) => {
          // A corner goes on a double-click. The line's own double-click
          // (open the editor) must not also fire underneath it.
          e.cancelBubble = true;
          removeAt(index);
        }}
        onDragStart={() => {
          window.dispatchEvent(new CustomEvent('canvas-drag-start'));
          lineEdit.pick(index);
          setLive(stored);
        }}
        onDragMove={(e: Konva.KonvaEventObject<DragEvent>) => {
          const { point: moved } = snapEnd(index, { x: e.target.x(), y: e.target.y() }, e.evt as unknown as MouseEvent);
          e.target.position(moved);
          setLive({ vertices: moveVertex(vertices, index, moved), bends });
        }}
        onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) => {
          window.dispatchEvent(new CustomEvent('canvas-drag-end'));
          // Decided from the release itself, not the last move's preview.
          const end = snapEnd(index, { x: e.target.x(), y: e.target.y() }, e.evt as unknown as MouseEvent);
          finishEndDrag({ vertices: moveVertex(vertices, index, end.point), bends }, end.connect);
        }}
        onMouseEnter={() => claimCursor('line-vertex', 'move')}
        onMouseLeave={() => claimCursor('line-vertex', null)}
      />
    );
  };

  /**
   * A ghost at the middle of a segment: drag it and a corner appears there.
   *
   * Drawn where the segment actually is — on its curve when it is bent — so
   * the new corner is born on the line rather than beside it.
   */
  const labelBox = node.text?.trim() ? { at: lineLabelWorld(node), ...lineLabelBox(node.text, strokeWidth) } : null;
  const ghostHandle = (index: number) => {
    const split = insertVertex(stored.vertices, stored.bends, index, 0.5);
    const at = split.vertices[index + 1];
    // Not under the label: the label's own drag owns that spot, and a ghost
    // peeking through the words reads as a stray mark.
    if (
      labelBox &&
      Math.abs(at.x - labelBox.at.x) <= labelBox.width / 2 + GHOST_HANDLE / stageScale &&
      Math.abs(at.y - labelBox.at.y) <= labelBox.height / 2 + GHOST_HANDLE / stageScale
    ) {
      return null;
    }
    return (
      <Circle
        key={`g${index}`}
        x={at.x}
        y={at.y}
        radius={GHOST_HANDLE / 2 / stageScale}
        fill="#FFFFFF"
        stroke={ACCENT}
        strokeWidth={1 / stageScale}
        opacity={0.6}
        draggable
        name={EXPORT_CHROME}
        onDragStart={() => {
          window.dispatchEvent(new CustomEvent('canvas-drag-start'));
          setGhostDrag(index);
          setLive(split);
        }}
        onDragMove={(e: Konva.KonvaEventObject<DragEvent>) => {
          const p = { x: e.target.x(), y: e.target.y() };
          setLive({ vertices: moveVertex(split.vertices, index + 1, p), bends: split.bends });
        }}
        onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) => {
          window.dispatchEvent(new CustomEvent('canvas-drag-end'));
          const p = { x: e.target.x(), y: e.target.y() };
          setGhostDrag(null);
          commit({ vertices: moveVertex(split.vertices, index + 1, p), bends: split.bends });
        }}
        onMouseEnter={(e: Konva.KonvaEventObject<MouseEvent>) => {
          e.target.opacity(1);
          claimCursor('line-ghost', 'copy');
        }}
        onMouseLeave={(e: Konva.KonvaEventObject<MouseEvent>) => {
          e.target.opacity(0.6);
          claimCursor('line-ghost', null);
        }}
      />
    );
  };

  /**
   * The curve handle for one segment, in the editor.
   *
   * A diamond rather than a circle, so it never reads as a corner. On every
   * segment, straight or not, because a handle that only appeared once a
   * segment was already curved could only be found by already knowing it was
   * there. Alt-clicking one straightens its segment.
   */
  const bendHandle = (index: number) => {
    const a = vertices[index];
    const b = vertices[index + 1];
    const at = bendPoint(a, b, bends[index]);
    const curved = bends[index] != null;
    const side = BEND_HANDLE / stageScale;

    return (
      <Rect
        key={`b${index}`}
        x={at.x}
        y={at.y}
        width={side}
        height={side}
        offsetX={side / 2}
        offsetY={side / 2}
        rotation={45}
        fill={curved ? ACCENT : '#FFFFFF'}
        stroke={ACCENT}
        strokeWidth={1 / stageScale}
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
        onMouseEnter={() => claimCursor('line-segment', 'crosshair')}
        onMouseLeave={() => claimCursor('line-segment', null)}
      />
    );
  };

  /**
   * The strip along the run that accepts an Alt-click to add a vertex.
   *
   * Transparent with a generous hit width: the renderer already draws the
   * line. Alt-clicks only, so a plain click falls through to the object and
   * the line stays draggable while the editor is open.
   */
  const insertStrip = (
    <Line
      points={polylinePoints(vertices, bends, smooth).flatMap((p) => [p.x, p.y])}
      stroke="transparent"
      strokeWidth={1 / stageScale}
      hitStrokeWidth={(INSERT_REACH * 2) / stageScale}
      lineJoin="round"
      name={EXPORT_CHROME}
      onMouseDown={(e: Konva.KonvaEventObject<MouseEvent>) => {
        if (!(e.evt as MouseEvent).altKey) return;
        const pointer = e.target.getStage()?.getRelativePointerPosition();
        if (!pointer) return;
        e.cancelBubble = true;
        const hit = nearestSegment(vertices, bends, pointer);
        if (!hit || hit.distance > INSERT_REACH / stageScale) return;
        const next = insertVertex(vertices, bends, hit.index, hit.t);
        // Picked straight away: a point is added in order to move it, and with
        // no pick the next Delete would take the whole line.
        lineEdit.pick(hit.index + 1);
        commit(next);
      }}
    />
  );

  /**
   * The label, draggable along the run.
   *
   * An invisible plate over the drawn one. Wherever the hand goes, the label
   * follows the run to the nearest place on it, and the place is stored as a
   * fraction of the run's length so it survives the line being reshaped.
   */
  const labelHandle = (() => {
    if (!node.text?.trim() || live) return null;
    const runWorld = runPoints(node).map((p) => ({ x: node.x + p.x, y: node.y + p.y }));
    const at = lineLabelWorld(node);
    const box = lineLabelBox(node.text, strokeWidth);
    const ghostAt = labelDrag ?? at;
    return (
      <>
        {labelDrag && (
          <Rect
            x={ghostAt.x - box.width / 2}
            y={ghostAt.y - box.height / 2}
            width={box.width}
            height={box.height}
            cornerRadius={3}
            stroke={ACCENT}
            strokeWidth={1 / stageScale}
            dash={[3 / stageScale, 3 / stageScale]}
            listening={false}
          />
        )}
        <Rect
          x={at.x}
          y={at.y}
          width={box.width}
          height={box.height}
          offsetX={box.width / 2}
          offsetY={box.height / 2}
          fill="transparent"
          draggable
          name={EXPORT_CHROME}
          onMouseEnter={() => claimCursor('line-label', 'grab')}
          onMouseLeave={() => claimCursor('line-label', null)}
          onDragStart={() => window.dispatchEvent(new CustomEvent('canvas-drag-start'))}
          onDragMove={(e: Konva.KonvaEventObject<DragEvent>) => {
            const t = fractionNearest(runWorld, { x: e.target.x(), y: e.target.y() });
            setLabelDrag(pointAlongRun(runWorld, t));
          }}
          onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) => {
            window.dispatchEvent(new CustomEvent('canvas-drag-end'));
            const t = fractionNearest(runWorld, { x: e.target.x(), y: e.target.y() });
            // Back to where it is drawn; the document write moves the real one.
            e.target.position(at);
            setLabelDrag(null);
            updateNode(node.id, { geometry: { ...node.geometry, labelT: Math.round(t * 1000) / 1000 } });
          }}
        />
      </>
    );
  })();

  return (
    <Group name={EXPORT_CHROME}>
      {/* The objects a dragged end is about to connect, by their silhouettes,
          and the route the connector will take. */}
      {connect && (
        <Group listening={false}>
          {connect.targets.map((outline, i) => (
            <Line
              key={`t${i}`}
              points={outline}
              closed
              stroke={ACCENT}
              strokeWidth={1.5 / stageScale}
              dash={[4 / stageScale, 3 / stageScale]}
              fill="rgba(59, 130, 246, 0.06)"
            />
          ))}
          <Line
            points={connect.route}
            stroke={ACCENT}
            strokeWidth={1.5 / stageScale}
            dash={[6 / stageScale, 4 / stageScale]}
            lineJoin="round"
          />
        </Group>
      )}

      {/* The target's silhouette while an end is magnetically locked to it. */}
      {snapMeta && (
        <Group listening={false}>
          {snapMeta.outline && snapMeta.outline.length >= 3 ? (
            <Line
              points={snapMeta.outline.flatMap((p) => [p.x, p.y])}
              closed
              stroke={SNAP_COLOR}
              strokeWidth={1 / stageScale}
              dash={[4 / stageScale, 4 / stageScale]}
            />
          ) : (
            <Rect
              x={snapMeta.targetBox.x}
              y={snapMeta.targetBox.y}
              width={snapMeta.targetBox.width}
              height={snapMeta.targetBox.height}
              stroke={SNAP_COLOR}
              strokeWidth={1 / stageScale}
              dash={[4 / stageScale, 4 / stageScale]}
            />
          )}
          <Circle x={snapMeta.point.x} y={snapMeta.point.y} radius={5 / stageScale} fill="#FFFFFF" stroke={SNAP_COLOR} strokeWidth={1.5 / stageScale} />
          <Circle x={snapMeta.point.x} y={snapMeta.point.y} radius={2 / stageScale} fill={SNAP_COLOR} />
        </Group>
      )}

      {/* A hairline where the run *will* be while it is dragged: the node
          itself does not move until the drag commits. */}
      {live && !connect && (
        <Line
          points={polylinePoints(live.vertices, live.bends, smooth).flatMap((p) => [p.x, p.y])}
          stroke={ACCENT}
          strokeWidth={1 / stageScale}
          dash={[4 / stageScale, 4 / stageScale]}
          lineJoin="round"
          listening={false}
        />
      )}

      {labelHandle}
      {open && insertStrip}
      {/* No curve handles while the run is smooth: the spline decides every
          segment's curvature from its neighbours, so a per-segment bend would
          be a second opinion about the same segment. The bends are kept
          underneath, so turning smoothing off gives back the shape that was. */}
      {open && !smooth && bends.map((_, i) => (i + 1 <= last ? bendHandle(i) : null))}
      {offersGhosts &&
        stored.vertices
          .slice(0, -1)
          .map((_, i) => (!live || ghostDrag === i ? ghostHandle(i) : null))}
      {/* Corners over curve handles, so on a very short segment the corner is
          the one you grab: moving a point is the commoner intent. */}
      {open ? vertices.map((_, i) => vertexHandle(i)) : [vertexHandle(0), last > 0 ? vertexHandle(last) : null]}
      {/* A dragged end that will connect wears the bound look: filled. */}
      {connect && live && (
        <Group listening={false}>
          {[vertices[0], vertices[last]].map((p, i) => (
            <Circle key={`c${i}`} x={p.x} y={p.y} radius={radius} fill={ACCENT} stroke="#FFFFFF" strokeWidth={1.5 / stageScale} />
          ))}
        </Group>
      )}
    </Group>
  );
};
