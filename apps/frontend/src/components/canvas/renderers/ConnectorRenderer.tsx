import React from 'react';
import { Circle, Group, Label, Line, Tag, Text } from 'react-konva';
import { useShallow } from 'zustand/react/shallow';
import type { ConnectorNode } from '../../../engine/model/schema';
import { connectorBounds, connectorPoints, type Box } from '../../../engine/model/connector';
import { endAngle, endCapShape, endCapSize } from '../../../engine/model/connectorEnds';
import { updateNode } from '../../../engine/document';
import { useStore } from '../../../hooks/useStore';
import { canvasPlateFill } from '../../../engine/ThemeService';
import { strokeColor, strokeDashProps, strokeWidth } from './shared';

interface Props {
  node: ConnectorNode;
}

/**
 * A connector, drawn from wherever its two ends currently are.
 *
 * ## Why the points are offset rather than absolute
 *
 * `ObjectRenderer` wraps every node in a Group translated to `node.x, node.y`.
 * A connector's route is computed in **world** space, so it is drawn relative
 * to that translation — subtract the node's own origin and the line lands
 * exactly where the geometry says, whatever `x`/`y` happen to be.
 *
 * That last part matters more than it looks. `x`/`y`/`width`/`height` on a
 * connector are *derived* — they follow the objects it joins — and keeping
 * them perfectly in step would mean a CRDT write on every frame of every drag
 * of either endpoint. Drawing relative to the stored origin rather than
 * assuming it is correct means a slightly stale box costs nothing visually; it
 * only ever affects culling and the radar, which are allowed to be a frame
 * behind.
 *
 * ## Why it subscribes to exactly two nodes
 *
 * The route depends on the two objects at its ends and nothing else. Reading
 * the whole objects map would re-render every connector on the board whenever
 * anything at all moved — on a flowchart, that is every arrow on every frame
 * of every drag.
 */
export const ConnectorRenderer: React.FC<Props> = React.memo(({ node }) => {
  const fromId = node.from.nodeId;
  const toId = node.to.nodeId;

  const [fromNode, toNode] = useStore(
    useShallow((state) => [
      fromId ? state.objects[fromId] : undefined,
      toId ? state.objects[toId] : undefined,
    ])
  );

  // Subscribed rather than read from the DOM, so the label plate repaints when
  // the theme is toggled instead of keeping whichever one it was born under.
  const dark = useStore((state) => state.darkTheme);

  const boxOf = React.useCallback(
    (id: string): Box | null => {
      const n = id === fromId ? fromNode : id === toId ? toNode : undefined;
      if (!n) return null;
      return {
        x: n.x,
        y: n.y,
        width: n.width * Math.abs(n.scaleX || 1),
        height: n.height * Math.abs(n.scaleY || 1),
      };
    },
    [fromId, toId, fromNode, toNode]
  );

  const world = connectorPoints(node.from, node.to, node.routing, boxOf);

  /**
   * Keep the stored box in step with the route, on a trailing delay.
   *
   * `x`/`y`/`width`/`height` are derived for a connector, but they are not
   * decorative: culling, the radar and marquee selection all read them, and a
   * box left at whatever it was when the connector was drawn means an arrow
   * that vanishes once that stale rectangle leaves the viewport — while the
   * line itself is still on screen.
   *
   * Trailing rather than immediate because the route changes on every frame of
   * a drag, and this is a CRDT write: one per settle instead of sixty per
   * second. Being a beat behind is exactly the staleness the note above says
   * is affordable, since nothing visual depends on it.
   *
   * The guard matters as much as the delay — without it every client watching
   * the board would write the same numbers back on every update, each write
   * waking the others.
   */
  React.useEffect(() => {
    if (world.length < 4) return;
    const box = connectorBounds(world);
    const drifted =
      Math.abs(box.x - node.x) > 0.5 ||
      Math.abs(box.y - node.y) > 0.5 ||
      Math.abs(box.width - node.width) > 0.5 ||
      Math.abs(box.height - node.height) > 0.5;
    if (!drifted) return;

    const timer = window.setTimeout(() => {
      updateNode(node.id, { x: box.x, y: box.y, width: box.width, height: box.height });
    }, 180);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id, node.x, node.y, node.width, node.height, world.join(',')]);

  if (world.length < 4) return null;

  // Into the group's own space. See the note above.
  const points: number[] = [];
  for (let i = 0; i < world.length; i += 2) {
    points.push(world[i] - node.x, world[i + 1] - node.y);
  }

  const stroke = strokeColor(node.appearance) ?? '#64748B';
  const width = strokeWidth(node.appearance) || 2;
  const dash = strokeDashProps(node.appearance);

  const common = {
    points,
    stroke,
    strokeWidth: width,
    ...dash,
    // Absent means `butt`, as everywhere else. New connectors are *created*
    // with a round cap instead of having one imposed here, so the Cap control
    // shows what the line is actually doing and can change it.
    lineCap: dash.lineCap,
    // Corners on an orthogonal route are the one place a connector has a join,
    // and a mitred right angle on a thick line reads as a spike.
    lineJoin: dash.lineJoin ?? ('round' as const),
    // A 2px line is almost impossible to grab. This is the same allowance every
    // other thin thing on the board gets.
    hitStrokeWidth: Math.max(18, width * 4),
    /**
     * No tension, for any routing.
     *
     * A curved connector's curve now lives in its **points** — see
     * `routeCurved` — rather than being a smoothing hint applied at draw time.
     * That is what makes it a real curve: tension over a two-point list does
     * nothing at all, which is why "Curved" used to draw a straight line.
     *
     * Keeping the geometry in the points also means `connectorBounds`,
     * hit-testing, the radar and the board thumbnail all describe the same
     * shape the canvas draws, instead of three of them describing a straight
     * line and one of them bending it.
     */
    tension: 0,
  };

  /**
   * The end markers, and the line shortened to make room for them.
   *
   * Konva's `Arrow` is gone from here: it draws exactly one shape and this
   * needs six. Building the markers from `connectorEnds` means the geometry is
   * described once, in a pure module, rather than living inside a renderer
   * where nothing else can see where a marker actually reaches.
   */
  const size = endCapSize(width);
  const startCap = endCapShape(node.endStart ?? 'none', { x: points[0], y: points[1] }, endAngle(points, true), size);
  const endCap = endCapShape(
    node.endEnd ?? 'none',
    { x: points[points.length - 2], y: points[points.length - 1] },
    endAngle(points, false),
    size
  );

  /**
   * Pull each end of the run back under its own marker.
   *
   * A solid triangle or diamond drawn on top of the line it terminates blurs
   * into one blob at small sizes — the line pokes through the tip and the
   * shape stops reading. Trimming the run by the marker's own depth is what
   * every diagramming tool does, and it costs one interpolation per end.
   */
  const trimmed = [...points];
  const pullBack = (atStart: boolean, inset: number) => {
    if (inset <= 0) return;
    const i = atStart ? 0 : trimmed.length - 2;
    const j = atStart ? 2 : trimmed.length - 4;
    const dx = trimmed[i] - trimmed[j];
    const dy = trimmed[i + 1] - trimmed[j + 1];
    const len = Math.hypot(dx, dy);
    // A degenerate segment has no direction to pull along, and dividing by it
    // is how a connector ends up drawn at NaN.
    if (len <= inset || len === 0) return;
    trimmed[i] -= (dx / len) * inset;
    trimmed[i + 1] -= (dy / len) * inset;
  };
  pullBack(true, startCap?.inset ?? 0);
  pullBack(false, endCap?.inset ?? 0);

  const marker = (cap: typeof startCap, key: string) => {
    if (!cap) return null;
    if (cap.circle) {
      return (
        <Circle
          key={key}
          x={cap.circle.x}
          y={cap.circle.y}
          radius={cap.circle.radius}
          fill={cap.filled ? stroke : undefined}
          stroke={stroke}
          strokeWidth={width}
        />
      );
    }
    return (
      <Line
        key={key}
        points={cap.points ?? []}
        closed={cap.filled}
        fill={cap.filled ? stroke : undefined}
        stroke={stroke}
        strokeWidth={width}
        lineCap="round"
        lineJoin="round"
      />
    );
  };

  return (
    <Group>
      <Line {...common} points={trimmed} />
      {marker(startCap, 'start')}
      {marker(endCap, 'end')}

      {/* A word riding the middle of the run — "yes", "no", "retry". Drawn on
          its own plate so it stays readable where it crosses the line it
          belongs to, which is exactly where it sits. */}
      {node.label ? (
        <Label
          x={points[Math.floor(points.length / 4) * 2] ?? points[0]}
          y={points[(Math.floor(points.length / 4) * 2) + 1] ?? points[1]}
          listening={false}
        >
          <Tag fill={canvasPlateFill(dark)} cornerRadius={3} />
          <Text text={node.label} fontSize={11} padding={3} fill={stroke} />
        </Label>
      ) : null}
    </Group>
  );
});

ConnectorRenderer.displayName = 'ConnectorRenderer';
