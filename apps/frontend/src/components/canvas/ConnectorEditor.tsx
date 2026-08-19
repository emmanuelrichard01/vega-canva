import React, { useMemo, useState } from 'react';
import { Circle, Group, Line, Rect } from 'react-konva';
import type Konva from 'konva';
import { updateNode } from '../../engine/document';
import { EXPORT_CHROME } from '../../engine/export/chrome';
import {
  connectorBounds,
  connectorPoints,
  portPoint,
  type ConnectorEnd,
} from '../../engine/model/connector';
import { anchorPoint } from '../../engine/model/connectorAnchor';
import { bindingAt } from '../../engine/model/connectorBinding';
import {
  bindCandidates,
  boxLookup,
  boxOfNode,
  isConnectable,
} from '../../engine/model/connectorTargets';
import type { ConnectorNode } from '../../engine/model/schema';
import { useStore } from '../../hooks/useStore';

interface Props {
  node: ConnectorNode;
  /** World units per screen pixel, so handles stay one size at any zoom. */
  stageScale: number;
}

/** Screen size of a handle, in pixels. Matches the line editor's. */
const HANDLE = 10;
const ACCENT = '#3B82F6';
const SIDES = ['top', 'right', 'bottom', 'left'] as const;

type Which = 'from' | 'to';

/**
 * The two ends of a connector, as handles you can drag onto anything.
 *
 * ## Why a connector did not have these
 *
 * It had the bounding-box transformer instead — the same mistake `LineEditor`
 * exists to correct for lines, and worse here. A connector's `width`/`height`
 * are *derived*: they follow whatever the two ends resolve to. So the eight
 * resize handles were not merely the wrong affordance, they were **inert** —
 * dragging one wrote a box that the next render recomputed and discarded. The
 * only way to change what an arrow joined was to delete it and draw another.
 *
 * ## What a drag means
 *
 * Exactly what the same drop means to the Connector tool, because both ask
 * `bindingAt`. Near an edge midpoint binds to that port; on the perimeter binds
 * to that exact spot as an anchor; well inside binds to the object with the
 * side left open. One gesture covers connect, re-connect and re-place, which is
 * why there is no modifier and no menu.
 *
 * **A drop onto empty board is refused and the end springs back**, for the same
 * reason the tool will not draw one — see the note on `ConnectorTool`. Letting
 * the editor author a loose end while the tool refuses to would be the same
 * object having two sets of rules depending on which surface you reached it
 * through. Detaching is still real, but it is something *deleting a box* does,
 * not something you can do on purpose.
 *
 * ## Live, then committed
 *
 * The drag re-routes locally on every frame and writes to the document once,
 * on release. A CRDT write per pointer move would put a hundred entries in the
 * undo stack for one gesture and broadcast every one of them to the room —
 * the same rule `LineEditor` follows and for the same reason.
 */
export const ConnectorEditor: React.FC<Props> = ({ node, stageScale }) => {
  const objects = useStore((s) => s.objects);
  /** The end being dragged and what it currently resolves to, before storage. */
  const [live, setLive] = useState<{ which: Which; end: ConnectorEnd } | null>(null);

  const from = live?.which === 'from' ? live.end : node.from;
  const to = live?.which === 'to' ? live.end : node.to;

  const lookup = useMemo(() => boxLookup(objects), [objects]);
  const candidates = useMemo(() => bindCandidates(objects), [objects]);

  const points = connectorPoints(from, to, node.routing, lookup);
  const a = { x: points[0], y: points[1] };
  const b = { x: points[points.length - 2], y: points[points.length - 1] };

  const radius = HANDLE / 2 / stageScale;

  /**
   * What the pointer means, minus the connector's own other end.
   *
   * Without the exclusion, dragging one end across the box the other end is
   * already on would bind both to it — a connector from a thing to itself,
   * which describes nothing and draws as a stub inside the shape.
   */
  const resolve = (world: { x: number; y: number }, which: Which): ConnectorEnd => {
    const other = which === 'from' ? node.to : node.from;
    return bindingAt(world, candidates, {
      scale: 1 / stageScale,
      excludeId: other.nodeId ?? null,
    });
  };

  const commit = (which: Which, end: ConnectorEnd) => {
    // Refused rather than written. `setLive(null)` alone puts the handle back
    // where the binding says it is, so a rejected drop reads as a spring-back
    // rather than as nothing happening.
    if (!end.nodeId) {
      setLive(null);
      return;
    }
    const nextFrom = which === 'from' ? end : node.from;
    const nextTo = which === 'to' ? end : node.to;
    const box = connectorBounds(connectorPoints(nextFrom, nextTo, node.routing, lookup));
    // The derived box goes with the binding in one write. It is only read by
    // culling, the radar and marquee selection — but a stale one there is an
    // arrow that vanishes when it scrolls to the edge of the viewport.
    updateNode(node.id, { [which]: end, ...box } as Partial<ConnectorNode>);
    setLive(null);
  };

  const handleFor = (which: Which) => {
    const point = which === 'from' ? a : b;
    const bound = Boolean((which === 'from' ? from : to).nodeId);
    return (
      <Circle
        key={which}
        x={point.x}
        y={point.y}
        radius={radius}
        // Filled when bound, hollow when not. A committed end is always
        // bound, so hollow means one of two things: this end is mid-drag over
        // empty board and will spring back, or its object was deleted and the
        // connector detached. Both are worth seeing at a glance.
        fill={bound ? ACCENT : '#FFFFFF'}
        stroke={ACCENT}
        strokeWidth={1.5 / stageScale}
        draggable
        name={EXPORT_CHROME}
        onDragStart={() => {
          window.dispatchEvent(new CustomEvent('canvas-drag-start'));
          setLive({ which, end: which === 'from' ? node.from : node.to });
        }}
        onDragMove={(e: Konva.KonvaEventObject<DragEvent>) => {
          setLive({ which, end: resolve({ x: e.target.x(), y: e.target.y() }, which) });
        }}
        onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) => {
          window.dispatchEvent(new CustomEvent('canvas-drag-end'));
          commit(which, resolve({ x: e.target.x(), y: e.target.y() }, which));
          // The handle is drawn from the route, not from where the pointer let
          // go — so it has to be put back, or it stays at the drop point until
          // something else re-renders it.
          e.target.position(which === 'from' ? a : b);
        }}
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

  // The same affordance the tool shows while drawing, shown here for the same
  // reason: what you can attach to is not obvious on a board of mixed content,
  // and finding out by trial is the slow way. Only during a drag, because
  // outside one they would be noise on a connector you are merely inspecting.
  const excluded = live ? (live.which === 'from' ? node.to : node.from).nodeId : undefined;
  const targets = live
    ? Object.values(objects).filter((n) => isConnectable(n) && n.id !== excluded)
    : [];

  const liveEnd = live?.end;
  const liveNode = liveEnd?.nodeId ? objects[liveEnd.nodeId] : undefined;
  const spot =
    liveEnd?.anchor && liveNode ? anchorPoint(boxOfNode(liveNode), liveEnd.anchor) : null;
  const bodyBox = liveEnd?.port === 'auto' && liveNode ? boxOfNode(liveNode) : null;

  return (
    <Group name={EXPORT_CHROME}>
      <Group listening={false}>
        {targets.map((n) => {
          const box = boxOfNode(n);
          return SIDES.map((side) => {
            const p = portPoint(box, side);
            const armed = liveEnd?.nodeId === n.id && liveEnd?.port === side;
            return (
              <Circle
                key={n.id + '-' + side}
                x={p.x}
                y={p.y}
                radius={(armed ? 7 : 4) / stageScale}
                fill={armed ? ACCENT : '#FFFFFF'}
                stroke={ACCENT}
                strokeWidth={1.5 / stageScale}
              />
            );
          });
        })}
        {bodyBox && (
          <Rect
            x={bodyBox.x}
            y={bodyBox.y}
            width={bodyBox.width}
            height={bodyBox.height}
            stroke={ACCENT}
            strokeWidth={1.5 / stageScale}
            dash={[4 / stageScale, 3 / stageScale]}
            fill="rgba(59, 130, 246, 0.06)"
          />
        )}
        {/* The route as it will be, drawn over the node as it still is — the
            document is not written until release. */}
        {live && (
          <Line
            points={points}
            // Grey while the dragged end is over nothing, so "this will not
            // stick" is answered during the drag rather than by a spring-back
            // afterwards.
            stroke={live.end.nodeId ? ACCENT : '#9CA3AF'}
            strokeWidth={1 / stageScale}
            dash={[4 / stageScale, 4 / stageScale]}
            lineJoin="round"
          />
        )}
        {spot && (
          <Circle
            x={spot.x}
            y={spot.y}
            radius={5 / stageScale}
            fill={ACCENT}
            stroke="#FFFFFF"
            strokeWidth={1.5 / stageScale}
          />
        )}
      </Group>
      {handleFor('from')}
      {handleFor('to')}
    </Group>
  );
};
