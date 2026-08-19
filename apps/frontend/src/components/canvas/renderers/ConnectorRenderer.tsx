import React from 'react';
import { Circle, Group, Label, Line, Path, Tag, Text } from 'react-konva';
import { roughLoop, roughPolyline, seedFrom } from '../../../engine/model/rough';
import { useShallow } from 'zustand/react/shallow';
import { DEFAULT_CONNECTOR_INK, type ConnectorNode } from '../../../engine/model/schema';
import { connectorBounds, connectorPoints, type Box } from '../../../engine/model/connector';
import { attachPoint } from '../../../engine/model/connectorTargets';
import { capExtentPoints, connectorCaps, trimPolyline } from '../../../engine/model/connectorEnds';
import { updateNode } from '../../../engine/document';
import { useStore } from '../../../hooks/useStore';
import { canvasPlateFill } from '../../../engine/ThemeService';
import { readableOnSurface } from '../../../engine/model/color';
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
/** Konva's flat `[x, y, x, y, ...]` as the point list the sketcher takes. */
function pairsOf(flat: readonly number[]): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push({ x: flat[i], y: flat[i + 1] });
  return out;
}

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

  /**
   * Where each end really lands: on the object's outline, turned by its
   * rotation. The flatten behind it is cached per shape, which is why calling
   * this per render is affordable — the work happens once per shape, not once
   * per frame.
   */
  const attachOf = React.useCallback(
    (id: string, boxPoint: { x: number; y: number }) => {
      const n = id === fromId ? fromNode : id === toId ? toNode : undefined;
      return n ? attachPoint(n, boxPoint) : null;
    },
    [fromId, toId, fromNode, toNode]
  );

  const world = connectorPoints(node.from, node.to, node.routing, boxOf, attachOf);

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
  /**
   * The two things the stored box depends on, as values a dependency array can
   * be checked against statically.
   *
   * `world.join(',')` was already here doing this job for the route. The
   * markers needed the same treatment once the box started accounting for
   * them, and an expression like `node.appearance?.stroke?.width` inline in
   * the array is exactly what the lint rule is warning about: it cannot verify
   * a dependency it cannot name.
   */
  const routeKey = world.join(',');
  const capKey = [
    node.endStart ?? 'none',
    node.endEnd ?? 'none',
    node.endScale ?? 1,
    strokeWidth(node.appearance) || 2,
  ].join(':');

  React.useEffect(() => {
    if (world.length < 4) return;
    // The markers are part of what the connector occupies. An arrowhead
    // extends *sideways* out of the route, and a horizontal connector's route
    // is a one-unit-tall box — so a box computed from the route alone had the
    // arrow culled while its head was still on screen, and a marquee drawn
    // over that head selected nothing. Raising End size is what made it
    // obvious; it was wrong at every size.
    const caps = connectorCaps(world, {
      start: node.endStart ?? 'none',
      end: node.endEnd ?? 'none',
      strokeWidth: strokeWidth(node.appearance) || 2,
      scale: node.endScale,
    });
    const box = connectorBounds([
      ...world,
      ...capExtentPoints(caps.start),
      ...capExtentPoints(caps.end),
    ]);
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
  }, [node.id, node.x, node.y, node.width, node.height, routeKey, capKey]);

  if (world.length < 4) return null;

  // Into the group's own space. See the note above.
  const points: number[] = [];
  for (let i = 0; i < world.length; i += 2) {
    points.push(world[i] - node.x, world[i + 1] - node.y);
  }

  const stroke = strokeColor(node.appearance) ?? DEFAULT_CONNECTOR_INK;
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
  // Sized against the run, so End size at its maximum on two adjacent boxes
  // shortens the marker instead of drawing one longer than the connector.
  const { start: startCap, end: endCap, size: capSize } = connectorCaps(points, {
    start: node.endStart ?? 'none',
    end: node.endEnd ?? 'none',
    strokeWidth: width,
    scale: node.endScale,
  });

  /**
   * Pull each end of the run back under its own marker.
   *
   * A solid triangle or diamond drawn on top of the line it terminates blurs
   * into one blob — the line pokes through the tip and the shape stops
   * reading. Trimming by the marker's own depth is what every diagramming tool
   * does.
   *
   * This was one interpolation against the *last segment*, which is not an
   * edge case but the normal case: a curved route's final segment is a couple
   * of units, so a curved connector was never trimmed at all, and an
   * orthogonal one stopped being trimmed as soon as the marker outgrew its
   * last leg. `trimPolyline` walks back across segments instead. See its note.
   */
  const trimmed = trimPolyline(
    trimPolyline(points, startCap?.inset ?? 0, true),
    endCap?.inset ?? 0,
    false
  );

  /**
   * The size below which a marker is left crisp even in sketch mode.
   *
   * The previous rule was "never sketch a marker", and the reasoning holds at
   * small sizes: an arrowhead is a *symbol* — it has to read as "which way" at
   * a glance — and roughening a six-pixel triangle turns it into a smudge that
   * no longer points anywhere. But it does not hold at twenty, where a crisp
   * head on a hand-drawn line is the one ruled thing in the picture and looks
   * like a mistake.
   *
   * So the rule is a threshold rather than a prohibition: big enough to
   * survive being drawn by hand, and it is drawn by hand.
   */
  const SKETCHABLE_CAP = 13;
  const sketchLevel = node.appearance?.sketch;
  const sketchCaps = Boolean(sketchLevel) && capSize >= SKETCHABLE_CAP;

  const marker = (cap: typeof startCap, key: string) => {
    if (!cap) return null;
    if (cap.circle) {
      // A circle marker is sketched as a closed loop through the drift
      // sampler, the same way an ellipse is — a ring of bowed chords is what
      // made circles come out spiky everywhere else in this codebase.
      if (sketchCaps) {
        const { x, y, radius } = cap.circle;
        const ring = Array.from({ length: 16 }, (_, i) => {
          const a = (i / 16) * Math.PI * 2;
          return { x: x + Math.cos(a) * radius, y: y + Math.sin(a) * radius };
        });
        return (
          <Path
            key={key}
            data={roughLoop(ring, { seed: seedFrom(node.id + key), level: sketchLevel })}
            stroke={stroke}
            strokeWidth={width}
            fill={cap.filled ? stroke : undefined}
            fillEnabled={cap.filled}
            lineCap="round"
            lineJoin="round"
          />
        );
      }
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
    if (sketchCaps && cap.points) {
      // A head is a short run of real corners, so it goes through the polyline
      // sketcher and keeps its overshoot — that is what makes a drawn
      // arrowhead read as two confident strokes rather than a wobble.
      // Filled heads keep their fill: the sketched outline is the shape, and
      // an unfilled triangle on a flowchart means something different.
      return (
        <Path
          key={key}
          data={roughPolyline(pairsOf(cap.points), {
            seed: seedFrom(node.id + key),
            level: sketchLevel,
            closed: cap.filled,
          })}
          stroke={stroke}
          strokeWidth={width}
          fill={cap.filled ? stroke : undefined}
          fillEnabled={cap.filled}
          lineCap="round"
          lineJoin="round"
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

  /**
   * The run, drawn by hand when the connector asks for it.
   *
   * A flowchart is the case this feature is most for — boxes sketched by hand
   * joined by arrows that are visibly not — so a connector that could not be
   * sketched left every diagram half-drafted. It goes through the same
   * `roughPolyline` the shapes use, as an **open** run: a connector has no
   * interior, so it is never closed and never hachured.
   *
   * The markers stay crisp on purpose. An arrowhead is a symbol rather than a
   * drawn stroke — it has to read as *which way* at any size — and sketching a
   * six-pixel triangle turns it into a smudge that no longer points anywhere.
   * The same reasoning keeps the label's plate crisp.
   */
  /**
   * Which sketcher the run goes through, decided by the routing.
   *
   * An orthogonal or straight route is three or four points with *real*
   * corners at its elbows, and the polyline sketcher's overshoot past each
   * one is exactly what makes a hand-drawn flowchart read as drawn — a
   * right angle that stops dead is a ruled right angle.
   *
   * A curved route is not that at all: it is twenty-five sampled points and
   * none of them is a corner, so overshooting every one of them produced the
   * same bristling mess a heart did before `roughLoop` existed. It takes the
   * drift sampler instead, as an open run.
   */
  const sketched = node.appearance?.sketch
    ? node.routing === 'curved'
      ? roughLoop(pairsOf(trimmed), {
          seed: seedFrom(node.id),
          level: node.appearance.sketch,
          closed: false,
        })
      : roughPolyline(pairsOf(trimmed), {
          seed: seedFrom(node.id),
          closed: false,
          level: node.appearance.sketch,
        })
    : '';

  return (
    <Group>
      {sketched ? (
        <Path
          data={sketched}
          stroke={common.stroke}
          strokeWidth={common.strokeWidth}
          lineCap="round"
          lineJoin="round"
          dash={common.dash}
          hitStrokeWidth={Math.max(20, width * 3)}
          perfectDrawEnabled={false}
        />
      ) : (
        <Line {...common} points={trimmed} />
      )}
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
          {/* The ink is lifted against the plate, not taken on trust. A
              connector's colour is arbitrary — a pale one put pale words on a
              pale panel, and the plate only ever solved the *line* crossing
              the text, never the text itself. */}
          <Tag fill={canvasPlateFill(dark)} cornerRadius={3} />
          <Text
            text={node.label.toUpperCase()}
            fontSize={11}
            fontStyle="600"
            letterSpacing={0.4}
            padding={3}
            fill={readableOnSurface(stroke, canvasPlateFill(dark))}
          />
        </Label>
      ) : null}
    </Group>
  );
});

ConnectorRenderer.displayName = 'ConnectorRenderer';
