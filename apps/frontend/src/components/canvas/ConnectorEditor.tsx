import React, { useMemo, useState } from 'react';
import { Circle, Group, Line, Rect } from 'react-konva';
import type Konva from 'konva';
import { updateNode } from '../../engine/document';
import { EXPORT_CHROME } from '../../engine/export/chrome';
import {
  connectorBounds,
  connectorPoints,
  type ConnectorEnd,
} from '../../engine/model/connector';
import { bindingAt } from '../../engine/model/connectorBinding';
import {
  bindCandidates,
  boxLookup,
  isConnectable,
  attachLookup,
  anchorPointOn,
  bodyOutlinePoints,
  portPointsFor,
} from '../../engine/model/connectorTargets';
import type { ConnectorNode } from '../../engine/model/schema';
import { useStore } from '../../hooks/useStore';
import { claimCursor } from '../../engine/cursor/cursorOverride';
import { useConnectorRoute } from '../../engine/model/connectorRouter/liveRoutes';
import { isAxisSegment, nudgeKey, type LegRef } from '../../engine/model/connectorRouter/pathOps';
import { canEditObjects } from '../../engine/model/permissions';

interface Props {
  node: ConnectorNode;
  /** World units per screen pixel, so handles stay one size at any zoom. */
  stageScale: number;
}

/** Screen size of a handle, in pixels. Matches the line editor's. */
const HANDLE = 10;
const ACCENT = '#3B82F6';

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
  // So the handle sits where the arrow actually touches the shape, not where
  // its bounding box would have put it.
  const attach = useMemo(() => attachLookup(objects), [objects]);
  const candidates = useMemo(() => bindCandidates(objects), [objects]);

  // The route as drawn (avoidance, spreading and nudges included) while the
  // ends rest; a plain reroute of the dragged end while one moves.
  const drawn = useConnectorRoute(node.id);
  const points = live || !drawn ? connectorPoints(from, to, node.routing, lookup, attach) : drawn.flat;
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
    const box = connectorBounds(connectorPoints(nextFrom, nextTo, node.routing, lookup, attach));
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
        onMouseEnter={() => claimCursor('connector-end', 'move')}
        onMouseLeave={() => claimCursor('connector-end', null)}
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
  const spot = liveEnd?.anchor && liveNode ? anchorPointOn(liveNode, liveEnd.anchor) : null;
  // Its own silhouette, not its box — see the same note in `ConnectorTool`.
  const bodyOutline = liveEnd?.port === 'auto' && liveNode ? bodyOutlinePoints(liveNode) : null;

  return (
    <Group name={EXPORT_CHROME}>
      <Group listening={false}>
        {targets.map((n) =>
          // On the outline, so the ring is where the arrow will actually land.
          portPointsFor(n).map(({ side, point: p }) => {
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
          })
        )}
        {bodyOutline && (
          <Line
            points={bodyOutline}
            closed
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
      {!live && drawn?.orthogonal && canEditObjects() && (
        <SegmentHandles node={node} points={drawn.points} legs={drawn.legs ?? []} stageScale={stageScale} />
      )}
      {handleFor('from')}
      {handleFor('to')}
    </Group>
  );
};

/**
 * A grip on the middle of each interior leg of an elbow route.
 *
 * Dragging one slides that leg along its normal, the way Lucidchart and
 * draw.io let you move a segment, and stores the move as an offset from where
 * the router puts the leg, keyed by the leg's axis and its line (`nudges`),
 * not as a point. The route stays derived: the offset holds while the router
 * puts that leg on that line, the route keeps it out of obstacles, and a
 * nudge whose leg is gone is ignored and cleared on the next nudge. Each leg
 * is written under its own key, so two people nudging different legs at once
 * both keep theirs. The first and last legs belong to their ports and have
 * no grip.
 */
const SegmentHandles: React.FC<{
  node: ConnectorNode;
  points: readonly { x: number; y: number }[];
  legs: readonly (LegRef | null)[];
  stageScale: number;
}> = ({ node, points, legs, stageScale }) => {
  const [drag, setDrag] = useState<{ seg: number; delta: number } | null>(null);
  const count = points.length - 1;
  if (count < 3) return null;

  const long = 14 / stageScale;
  const short = 6 / stageScale;

  const commit = (seg: number, delta: number) => {
    setDrag(null);
    const leg = legs[seg];
    if (!leg || Math.abs(delta) < 0.5) return;
    const changes: Record<string, number | undefined> = {};
    // Nudges whose leg this route no longer has.
    const live = new Set(legs.filter((l): l is LegRef => Boolean(l)).map((l) => nudgeKey(l)));
    for (const n of node.nudges ?? []) if (!live.has(nudgeKey(n))) changes[nudgeKey(n)] = undefined;
    // Zero is written, not removed, so it also overrides a copied list's entry.
    changes[nudgeKey(leg)] = Math.round(leg.nudge + delta);
    updateNode(node.id, changes);
  };

  const preview = (() => {
    if (!drag) return null;
    const moved = points.map((p) => ({ ...p }));
    const p = moved[drag.seg];
    const q = moved[drag.seg + 1];
    if (isAxisSegment(p, q) === 'h') {
      p.y += drag.delta;
      q.y += drag.delta;
    } else {
      p.x += drag.delta;
      q.x += drag.delta;
    }
    return moved.flatMap((pt) => [pt.x, pt.y]);
  })();

  const grips: React.ReactNode[] = [];
  for (let seg = 1; seg < count - 1; seg += 1) {
    const p = points[seg];
    const q = points[seg + 1];
    const axis = isAxisSegment(p, q);
    if (!axis || !legs[seg]) continue;
    // Too short to grab without covering the corners either side.
    if (Math.hypot(q.x - p.x, q.y - p.y) < 28 / stageScale) continue;
    const horizontal = axis === 'h';
    const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    const w = horizontal ? long : short;
    const h = horizontal ? short : long;
    grips.push(
      <Rect
        key={seg}
        x={mid.x}
        y={mid.y}
        offsetX={w / 2}
        offsetY={h / 2}
        width={w}
        height={h}
        cornerRadius={short / 2}
        fill="#FFFFFF"
        stroke={ACCENT}
        strokeWidth={1.5 / stageScale}
        draggable
        name={EXPORT_CHROME}
        dragBoundFunc={function (this: Konva.Node, pos) {
          // Only along the leg's normal, in screen space.
          const abs = this.getAbsolutePosition();
          return horizontal ? { x: abs.x, y: pos.y } : { x: pos.x, y: abs.y };
        }}
        onDragStart={() => {
          window.dispatchEvent(new CustomEvent('canvas-drag-start'));
          setDrag({ seg, delta: 0 });
        }}
        onDragMove={(e: Konva.KonvaEventObject<DragEvent>) => {
          const delta = horizontal ? e.target.y() - mid.y : e.target.x() - mid.x;
          setDrag({ seg, delta });
        }}
        onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) => {
          window.dispatchEvent(new CustomEvent('canvas-drag-end'));
          const delta = horizontal ? e.target.y() - mid.y : e.target.x() - mid.x;
          e.target.position(mid);
          commit(seg, delta);
        }}
        onMouseEnter={() => claimCursor('connector-segment', horizontal ? 'ns-resize' : 'ew-resize')}
        onMouseLeave={() => claimCursor('connector-segment', null)}
      />
    );
  }

  return (
    <Group>
      {preview && (
        <Line
          points={preview}
          stroke={ACCENT}
          strokeWidth={1 / stageScale}
          dash={[4 / stageScale, 4 / stageScale]}
          listening={false}
        />
      )}
      {grips}
    </Group>
  );
};
