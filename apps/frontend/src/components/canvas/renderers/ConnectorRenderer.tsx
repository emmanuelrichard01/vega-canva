import React from 'react';
import { Circle, Group, Line, Path, Rect, Text } from 'react-konva';
import { Html } from 'react-konva-utils';
import { nanoid } from 'nanoid';
import type Konva from 'konva';
import { sketchedCap, sketchedRun } from '../../../engine/model/connectorSketch';
import { useSketchLevel } from '../../../engine/model/roughBoard';
import {
  publishConnectorLabel,
  retractConnectorLabel,
  slotFor,
  subscribeConnectorLabels,
} from '../../../engine/model/connectorLabelStore';
import { DEFAULT_CONNECTOR_INK, type ConnectorLabel, type ConnectorNode } from '../../../engine/model/schema';
import { connectorBounds, ELBOW_RADIUS, type Box } from '../../../engine/model/connector';
import { capExtentPoints, connectorCaps, trimRunForCaps } from '../../../engine/model/connectorEnds';
import { provider, updateNode } from '../../../engine/document';
import { scheduleDerivedPatch } from '../../../engine/document/derivedPatches';
import { electedClient, isElectedWriter } from '../../../engine/document/election';
import { canEditObjects } from '../../../engine/model/permissions';
import { collaboratorStore } from '../../../engine/presence/collaboratorStore';
import { useStore } from '../../../hooks/useStore';
import { useGround } from '../../../hooks/useSurface';
import { canvasPlateFill } from '../../../engine/ThemeService';
import { readableOnSurface } from '../../../engine/model/color';
import { liveTransformStore } from '../../../engine/model/liveTransformStore';
import { useCameraZoom } from '../../../engine/useCameraZoom';
import { cameraSystem } from '../../../engine/CameraSystem';
import { useConnectorRoute } from '../../../engine/model/connectorRouter/liveRoutes';
import { connectorPathData } from '../../../engine/model/connectorRouter/pathOps';
import {
  LABEL_GAP,
  autoLabelKey,
  autoLabelRequests,
  labelCentre,
  labelEditStore,
  labelFontSize,
  labelTextWidth,
  labelsOf,
  projectOnRoute,
  resample,
  sentenceCase,
} from '../../../engine/model/connectorLabelLayout';
import { strokeColor, strokeDashProps, strokeWidth } from './shared';
import { DropShadow } from './ShapeEffects';
import { capSilhouette, mergeSilhouettes, pointsBox } from './shadowInk';
import { castsShadow, colorHasAlpha } from '../../../engine/model/dropShadow';
import '../connectorLabel.css';

interface Props {
  node: ConnectorNode;
}

/** Screen size of a line jump's arc, matching `--route-hop`. */
const HOP_SCREEN = 6;
/** No jump is drawn closer than this to a bend or an end, in screen px. */
const HOP_CLEARANCE_SCREEN = 8;
/** How long a curve takes to settle into a new route. */
const EASE_MS = 120;

/** Konva's flat `[x, y, x, y, ...]` as the point list the sketcher takes. */
function pairsOf(flat: readonly number[]): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push({ x: flat[i], y: flat[i + 1] });
  return out;
}

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * A curve, eased into each new route over `EASE_MS`.
 *
 * The ends never ease: they stay on the objects they are attached to, so a
 * curve following a dragged box bends smoothly behind it instead of
 * detaching. Interior points carry the difference from the previous shape,
 * weighted toward the middle and decaying to nothing.
 */
function useEasedCurve(flat: number[], curved: boolean): number[] {
  const [shown, setShown] = React.useState(flat);
  const shownRef = React.useRef(flat);
  const frame = React.useRef(0);
  const key = flat.join(',');

  React.useEffect(() => {
    cancelAnimationFrame(frame.current);
    const prev = shownRef.current;
    if (!curved || reducedMotion() || prev.length < 4 || flat.length < 4) {
      shownRef.current = flat;
      setShown(flat);
      return;
    }
    const count = flat.length / 2;
    const from = resample(prev, count);
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / EASE_MS);
      const remain = Math.pow(1 - t, 3);
      const out = flat.slice();
      for (let i = 1; i + 1 < count; i += 1) {
        const w = Math.sin((Math.PI * i) / (count - 1)) * remain;
        out[i * 2] += (from[i * 2] - flat[i * 2]) * w;
        out[i * 2 + 1] += (from[i * 2 + 1] - flat[i * 2 + 1]) * w;
      }
      shownRef.current = out;
      setShown(out);
      if (t < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
    // `key` carries the content of `flat`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, curved]);

  return curved ? shown : flat;
}

/**
 * A connector, drawn from the route store's answer for it.
 *
 * Routes are computed once per connector, for the whole board, by
 * `routeStore`: avoidance, channel spreading and line jumps all depend on
 * other connectors, so no renderer can work its own route out alone. This
 * subscribes to its own id and redraws only when its drawing changes.
 *
 * The route is in world space; the group `ObjectRenderer` places at
 * `node.x, node.y` is subtracted back out, so a slightly stale stored box costs
 * nothing visually. That box is still kept in step (culling, the radar and
 * marquee selection read it), by one elected editor, on a trailing delay.
 */
export const ConnectorRenderer: React.FC<Props> = React.memo(({ node }) => {
  const route = useConnectorRoute(node.id);
  // Resolved against the board's sketch mode; a hook, so above the early return.
  const sketchLevel = useSketchLevel(node.appearance);
  const target = route?.flat ?? [];
  const world = useEasedCurve(target, Boolean(route?.curved));
  const zoom = useCameraZoom();
  const dark = useStore((state) => state.darkTheme);
  // A label on a frame reads against the frame's fill, not the board.
  const ground = useGround(node);
  const draft = React.useSyncExternalStore(labelEditStore.subscribe, labelEditStore.get, labelEditStore.get);

  const labels = React.useMemo(() => labelsOf(node), [node]);
  const drafting = draft && draft.connectorId === node.id ? draft : null;
  const shownLabels: ConnectorLabel[] =
    drafting?.isNew ? [...labels, { id: drafting.labelId, text: '', t: drafting.t }] : labels;

  // Labels nobody placed join the board-wide arrangement, one entry each,
  // exactly as the export arranges them (`autoLabelRequests`).
  const autoKey = labels
    .filter((l) => l.t === undefined)
    .map((l) => `${l.id}:${l.text}`)
    .join('|');
  React.useEffect(() => {
    const requests = autoLabelRequests(node, target);
    for (const r of requests) publishConnectorLabel(r.id, r.text, r.points);
    return () => {
      for (const r of requests) retractConnectorLabel(r.id);
    };
    // `target` is compared by content inside the store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id, autoKey, target]);
  const slotsVersion = React.useSyncExternalStore(
    subscribeConnectorLabels,
    () => labels.map((l) => slotFor(autoLabelKey(node.id, l.id))).map((s) => (s ? `${s.x},${s.y}` : '-')).join('|'),
    () => ''
  );
  void slotsVersion;

  /**
   * Keep the stored box in step with the route, on a trailing delay.
   *
   * Written by one client: the room's elected writer (`isElectedWriter`)
   * when its viewport shows the connector, and otherwise the lowest clientID
   * among the editors whose viewport does (only they have it mounted).
   * Viewers and commenters never take part, since the server refuses their
   * writes. Never during a gesture, and only when the box has drifted by more
   * than a unit.
   */
  const routeKey = target.join(',');
  const capKey = [node.endStart ?? 'none', node.endEnd ?? 'none', node.endScale ?? 1, strokeWidth(node.appearance) || 2].join(':');
  React.useEffect(() => {
    if (target.length < 4 || !canEditObjects()) return;
    if (liveTransformStore.active) return;

    const remotes = collaboratorStore.live();
    const fromId = node.from.nodeId;
    const toId = node.to.nodeId;
    const otherHasSelection = remotes.some((person) => {
      const s = person.selection;
      return (fromId && s.includes(fromId)) || (toId && s.includes(toId)) || s.includes(node.id);
    });
    if (otherHasSelection) return;

    const caps = connectorCaps(target, {
      start: node.endStart ?? 'none',
      end: node.endEnd ?? 'none',
      strokeWidth: strokeWidth(node.appearance) || 2,
      scale: node.endScale,
    });
    const rawBox = connectorBounds([...target, ...capExtentPoints(caps.start), ...capExtentPoints(caps.end)]);

    if (!isElectedWriter()) {
      const awareness = provider.awareness;
      const myId = awareness?.clientID || 0;
      const states = awareness?.getStates?.();
      const showing = remotes.filter(
        (r) => states?.get(r.clientId)?.canWrite === true && r.viewport && viewportShows(r.viewport, rawBox)
      );
      const elected = states ? electedClient(states) : null;
      // The elected writer has it on screen and will write it.
      if (elected !== null && showing.some((r) => r.clientId === elected)) return;
      const editors = showing.map((r) => r.clientId);
      if (editors.length > 0 && Math.min(myId, ...editors) !== myId) return;
    }

    const box = {
      x: Math.round(rawBox.x),
      y: Math.round(rawBox.y),
      width: Math.round(rawBox.width),
      height: Math.round(rawBox.height),
    };
    const drifted =
      Math.abs(box.x - node.x) >= 2 ||
      Math.abs(box.y - node.y) >= 2 ||
      Math.abs(box.width - node.width) >= 2 ||
      Math.abs(box.height - node.height) >= 2;
    if (!drifted) return;

    // Bookkeeping, not an edit: kept out of everyone's undo stack, and
    // committed with every other connector's in one transaction.
    return scheduleDerivedPatch(
      node.id,
      { x: box.x, y: box.y, width: box.width, height: box.height },
      { guard: () => !liveTransformStore.active }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id, node.x, node.y, node.width, node.height, routeKey, capKey]);

  if (world.length < 4 || !route) return null;

  // Into the group's own space.
  const points: number[] = [];
  for (let i = 0; i < world.length; i += 2) points.push(world[i] - node.x, world[i + 1] - node.y);

  const stroke = strokeColor(node.appearance) ?? DEFAULT_CONNECTOR_INK;
  const width = strokeWidth(node.appearance) || 2;
  const dash = strokeDashProps(node.appearance);
  const dashed = Boolean(node.appearance?.stroke?.dash?.length);

  const { start: startCap, end: endCap, size: capSize } = connectorCaps(points, {
    start: node.endStart ?? 'none',
    end: node.endEnd ?? 'none',
    strokeWidth: width,
    scale: node.endScale,
  });

  const trimmed = trimRunForCaps(points, route.curved ? [] : route.hops, startCap?.inset ?? 0, endCap?.inset ?? 0);

  const sketch = sketchLevel
    ? { id: node.id, sketchSeed: node.appearance?.sketchSeed, level: sketchLevel, width, curved: route.curved, dashed }
    : null;

  const marker = (cap: typeof startCap, key: 'start' | 'end') => {
    if (!cap) return null;
    const rough = sketch ? sketchedCap(cap, key, capSize, sketch) : null;
    if (rough) {
      return (
        <Path
          key={key}
          data={rough}
          stroke={stroke}
          strokeWidth={width}
          fill={cap.filled ? stroke : undefined}
          fillEnabled={cap.filled}
          lineCap="round"
          lineJoin="round"
        />
      );
    }
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

  // A sketched run goes through the sketcher: elbows keep their overshoot,
  // curves take one continuous pass, and a dashed line takes one lap.
  const sketched = sketch ? sketchedRun(pairsOf(trimmed.flat), sketch) : '';

  const data = sketched
    ? sketched
    : connectorPathData(pairsOf(trimmed.flat), {
        cornerRadius: route.orthogonal ? node.cornerRadius ?? ELBOW_RADIUS : 0,
        hops: trimmed.hops,
        hopRadius: HOP_SCREEN / zoom,
        hopClearance: HOP_CLEARANCE_SCREEN / zoom,
      });

  const editable = canEditObjects();

  /** Double-click the line to add a word where you clicked. */
  const addLabelAt = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (!editable) return;
    e.cancelBubble = true;
    const stage = e.target.getStage();
    const pointer = stage?.getPointerPosition();
    if (!pointer) return;
    const p = cameraSystem.screenToWorld(pointer.x, pointer.y);
    const { t } = projectOnRoute(target, p);
    labelEditStore.set({ connectorId: node.id, labelId: nanoid(6), t, isNew: true });
  };

  const fontSize = labelFontSize(width);
  const plate = ground ?? canvasPlateFill(dark);
  const ink = readableOnSurface(stroke, plate);
  const PAD = 3;

  /**
   * Where each label sits, in the group's space, and the box the line breaks
   * around. The break is a real gap in the line (the line is clipped), not a
   * plate painted over it, so a label reads the same over a coloured zone as
   * over the board.
   */
  const placed = shownLabels.map((label) => {
    const anchor = labelCentre(label, target, label.t === undefined ? slotFor(autoLabelKey(node.id, label.id)) : null);
    const editing = drafting?.labelId === label.id;
    const textWidth = labelTextWidth(editing ? label.text || 'Label' : label.text, fontSize);
    const w = textWidth + PAD * 2;
    const h = fontSize + PAD * 2;
    return { label, editing, x: anchor.x - node.x, y: anchor.y - node.y, w, h };
  });
  const gaps = placed
    .filter((p) => p.editing || p.label.text.trim())
    .map((p) => ({
      x: p.x - p.w / 2 - LABEL_GAP,
      y: p.y - p.h / 2 - LABEL_GAP,
      w: p.w + LABEL_GAP * 2,
      h: p.h + LABEL_GAP * 2,
    }));
  const clipGaps = gaps.length
    ? (ctx: Konva.Context) => {
        // Everything, minus each label's box: even-odd makes the boxes holes.
        ctx.rect(-1e6, -1e6, 2e6, 2e6);
        for (const g of gaps) ctx.rect(g.x, g.y, g.w, g.h);
        return ['evenodd'] as never;
      }
    : undefined;

  /**
   * The connector's drop shadow: the routed line and both markers as one
   * silhouette. Inside the label clip, so the line's shadow breaks where the
   * line does rather than running under the words.
   */
  const shadowSpec = node.appearance?.shadow;
  const markerInk = (cap: typeof startCap, key: 'start' | 'end') => {
    const rough = cap && sketch ? sketchedCap(cap, key, capSize, sketch) : null;
    if (!rough) return capSilhouette(cap, width);
    const path = new Path2D(rough);
    return { fills: cap!.filled ? [{ path }] : [], strokes: [{ path, width, cap: 'round' as const, join: 'round' as const }] };
  };
  const dropShadow = castsShadow(shadowSpec) ? (
    <DropShadow
      shadow={shadowSpec}
      box={pointsBox([...points, ...capExtentPoints(startCap), ...capExtentPoints(endCap)], width * 2 + capSize + 8)}
      silhouette={mergeSilhouettes(
        {
          strokes: [{
            path: new Path2D(data),
            width,
            cap: sketched ? 'round' : (dash.lineCap ?? 'butt'),
            join: 'round',
            dash: dash.dash,
          }],
        },
        markerInk(startCap, 'start'),
        markerInk(endCap, 'end')
      )}
      knockout={colorHasAlpha(stroke)}
    />
  ) : null;

  return (
    <Group>
      <Group clipFunc={clipGaps}>
      {dropShadow}
      <Path
        data={data}
        stroke={stroke}
        strokeWidth={width}
        dash={dash.dash}
        lineCap={sketched ? 'round' : dash.lineCap}
        lineJoin="round"
        hitStrokeWidth={Math.max(18, width * 4)}
        perfectDrawEnabled={false}
        onDblClick={addLabelAt}
        onDblTap={addLabelAt as never}
      />
      </Group>
      {marker(startCap, 'start')}
      {marker(endCap, 'end')}

      {placed.map(({ label, editing, x, y, w, h }) => {
        if (editing) {
          return (
            <LabelInput
              key={label.id}
              x={x}
              y={y}
              fontSize={fontSize}
              initial={label.text}
              onDone={(text) => commitLabel(node, drafting!, text)}
            />
          );
        }
        if (!label.text.trim()) return null;
        return (
          // The line is clipped around the word; the plate under it, in the
          // board's colour, also hides any other line that crosses here, so
          // the word reads the same wherever it lands.
          <Group
            key={label.id}
            x={x}
            y={y}
            onDblClick={(e) => {
              if (!editable) return;
              e.cancelBubble = true;
              labelEditStore.set({ connectorId: node.id, labelId: label.id, t: label.t ?? 0.5, isNew: false });
            }}
          >
            <Rect x={-w / 2} y={-h / 2} width={w} height={h} cornerRadius={3} fill={plate} />
            <Text
              x={-w / 2}
              y={-h / 2}
              width={w}
              height={h}
              align="center"
              verticalAlign="middle"
              text={label.text}
              fontSize={fontSize}
              fontStyle="500"
              fontFamily="Inter, system-ui, sans-serif"
              padding={PAD}
              fill={ink}
              wrap="none"
            />
          </Group>
        );
      })}
    </Group>
  );
});

ConnectorRenderer.displayName = 'ConnectorRenderer';

function estimateWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.56 + 6;
}

function commitLabel(node: ConnectorNode, draft: { labelId: string; t: number; isNew: boolean }, text: string): void {
  labelEditStore.set(null);
  // Against the labels the document holds now, so an edit made elsewhere
  // while this one was typed is kept.
  const current = useStore.getState().objects[node.id];
  if (current?.type !== 'connector') return;
  const labels = labelsOf(current as ConnectorNode);
  const clean = sentenceCase(text);
  let next: ConnectorLabel[];
  if (draft.isNew) {
    if (!clean) return;
    next = [...labels, { id: draft.labelId, text: clean, t: draft.t }];
  } else {
    next = clean
      ? labels.map((l) => (l.id === draft.labelId ? { ...l, text: clean } : l))
      : labels.filter((l) => l.id !== draft.labelId);
  }
  updateNode(node.id, { labels: next, label: next[0]?.text } as Partial<ConnectorNode>);
}

/** A text field over the label being typed, at the label's own scale. */
const LabelInput: React.FC<{
  x: number;
  y: number;
  fontSize: number;
  initial: string;
  onDone: (text: string) => void;
}> = ({ x, y, fontSize, initial, onDone }) => {
  const [value, setValue] = React.useState(initial);
  const done = React.useRef(false);
  const finish = (text: string) => {
    if (done.current) return;
    done.current = true;
    onDone(text);
  };
  const width = Math.max(60, estimateWidth(value || 'Label', fontSize) + 12);
  return (
    <Html
      groupProps={{ x: x - width / 2, y: y - (fontSize + 10) / 2 }}
      divProps={{ style: { zIndex: '1000' } }}
    >
      <input
        className="connector-label-input"
        aria-label="Connector label"
        autoFocus
        value={value}
        placeholder="Label"
        style={{ width: `${width}px`, fontSize: `${fontSize}px` }}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') finish(value);
          if (e.key === 'Escape') {
            done.current = true;
            labelEditStore.set(null);
          }
        }}
        onBlur={() => finish(value)}
      />
    </Html>
  );
};

/**
 * Whether a collaborator's viewport (plus the culler's overscan) covers a box.
 * Viewport units are in `ViewportState`: world top-left, screen size, zoom.
 */
function viewportShows(
  v: { x: number; y: number; width: number; height: number; zoom: number },
  box: Box
): boolean {
  const zoom = v.zoom || 1;
  const overscan = 300;
  const minX = v.x - overscan;
  const minY = v.y - overscan;
  const maxX = v.x + (v.width || 0) / zoom + overscan;
  const maxY = v.y + (v.height || 0) / zoom + overscan;
  return box.x <= maxX && box.x + box.width >= minX && box.y <= maxY && box.y + box.height >= minY;
}
