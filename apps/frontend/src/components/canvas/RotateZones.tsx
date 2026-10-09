import React, { useEffect, useRef, useState } from 'react';
import Konva from 'konva';
import { Arc, Circle, Group, Line, Rect } from 'react-konva';
import { cameraSystem } from '../../engine/CameraSystem';
import { engineEvents } from '../../engine/EventBus';
import { EXPORT_CHROME } from '../../engine/export/chrome';
import { claimCursor } from '../../engine/cursor/cursorOverride';
import { rotateCursorCss } from '../../engine/cursor/rotateCursor';
import {
  angleDelta,
  angleOf,
  centreOf,
  reachAt,
  CORNER_SIGNS,
  corners,
  inCornerRing,
  intoFrame,
  radialAngle,
  rotateZones,
  rotationFor,
  type Box,
} from '../../engine/interaction/rotateHandle';

/**
 * Rotation from outside the corners, and shear from outside the edges.
 *
 * Konva's `Transformer` draws a ninth control on a stalk above the top edge.
 * That is off (`rotateEnabled={false}`) and these zones are what turns a
 * selection — corner handles only, transforms outside them, which is what
 * Figma and Illustrator both do. Shear joins on the edges, because `skewX` and
 * `skewY` have always been on the node and had no gesture at all.
 *
 * The zones have no fill and no stroke: they are hit regions, not marks. What
 * makes them findable is the **pointer**, which becomes a curved arrow or a
 * pair of sliding arrows the instant it enters one. That is the whole bargain
 * of removing a visible handle. `fill="transparent"` rather than no fill,
 * because Konva takes a shape's hit area from what it fills — an unfilled rect
 * is a rect nothing can click.
 *
 * ## Three things had to be right, and the first three attempts got one each
 *
 * **1. The box is a prop, in the right space.** It was read off the proxy, and
 * `fitProxy` positions the proxy *by its centre* with an offset, so `proxy.x()`
 * is not the corner. Every zone landed half a box from where it belonged.
 *
 * **2. This must not unmount during its own gesture.** `onStart` sets the
 * parent's `transforming`, which is the very flag that used to hide these — so
 * pressing a zone unmounted it, and the cleanup below ended the gesture on the
 * frame it began. A gesture cannot be gated on a flag it sets itself. `busy` is
 * checked *before* that flag and is set *before* `onStart` is called, so the
 * render that flag triggers finds a gesture already in progress and stays.
 *
 * **3. The window listeners are registered once.** `onMove` and `onEnd` are
 * plain functions in the parent's body, so they are new objects on every
 * render — an effect depending on them re-runs constantly, and this one ends
 * the gesture in its cleanup. Everything the listeners need is read through a
 * ref when they fire, and the effect has no dependencies at all.
 *
 * All three are one mistake in three costumes: **a gesture that lives across
 * frames cannot be built out of values that are replaced every frame.**
 *
 * ## Coordinates
 *
 * Angles and travel are computed entirely in **world** space, through
 * `cameraSystem.screenToWorld`. An angle between two world points is the same
 * angle at any zoom or pan, so this never touches stage or window space and
 * cannot pick up the ruler-inset error that made the contextual rail wrong for
 * the life of that component. The one screen-space quantity is a zone's size,
 * divided by the zoom — invariant 9.
 */

interface Props {
  /** The selection's unrotated bounds in world space, from the parent's store read. */
  box: Box;
  /** The selection's rotation in degrees. Zero for a mixed selection. */
  rotation: number;
  proxyRef: React.RefObject<Konva.Rect | null>;
  onStart: (kind: 'rotate' | 'shear') => void;
  onMove: () => void;
  onEnd: () => void;
  /**
   * Escape: the turn was abandoned and the object is back where it began, so
   * nothing is to be written. Absent, a cancelled turn ends through `onEnd`.
   */
  onCancel?: () => void;
  /** True while the parent's own transformer is running a resize. */
  transforming: boolean;
}

/** The same blue every other selection mark on this canvas uses. */
const ACCENT = '#3B82F6';

/** The radial ticks of the 15° snap grid, as line points about the pivot. */
export function snapTicks(gridOffset: number, radius: number, px: number): number[][] {
  const out: number[][] = [];
  for (let k = 0; k < 360 / SNAP; k += 1) {
    const rad = ((gridOffset + k * SNAP) * Math.PI) / 180;
    const inner = radius - (k % 3 === 0 ? 7 : 4) * px;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    out.push([cos * inner, sin * inner, cos * radius, sin * radius]);
  }
  return out;
}

/** Shift squares the result to the world, not to wherever the object already was. */
const SNAP = 15;

/**
 * A gesture is *armed* on press and *begins* on the first movement.
 *
 * ## The bug this shape exists to prevent
 *
 * These zones sit **outside** the object — which is also exactly where you
 * click to deselect, or to select a neighbouring object. A plain click there
 * used to call `onStart` immediately, which snapshots the current selection's
 * box; the click then changed the selection, the proxy refitted to the *new*
 * box, and `pointerup` committed a transform from the old box to the new one.
 * Everything selected was scaled by the ratio between two unrelated
 * rectangles and thrown off screen — which looks exactly like objects
 * disappearing when you select them.
 *
 * Deferring the start until the pointer has actually moved removes the whole
 * class: a click that never becomes a drag begins nothing, so there is nothing
 * to commit and nothing to reconcile against a selection that changed
 * underneath it. It is also just the correct shape for a drag gesture, which
 * is why every other drag in this codebase has a threshold.
 */
interface Gesture {
  kind: 'rotate';
  /**
   * Where the Konva stage begins in the window, captured once at the press.
   *
   * ## The jump this removes
   *
   * `cameraSystem.screenToWorld` takes a **stage-relative** coordinate — it
   * subtracts the camera offset, which lives inside the stage. The press
   * handler fed it `stage.getPointerPosition()`, which is stage-relative and
   * correct. The move handler fed it `e.clientX/clientY`, which is
   * **viewport-relative** and is out by wherever the stage starts — here about
   * 52px down, because the header and the rulers sit above it.
   *
   * So the angle at the press and the angle on the first move were measured
   * from points fifty pixels apart, and the gesture opened by applying that
   * difference in one step: about +13° at the bottom-right corner and −15° at
   * the bottom-left, because the same vertical offset subtends opposite
   * angles on opposite sides of the centre. Exactly the reported symptom, and
   * exactly invariant 10 — a coordinate used in a space it was not in.
   *
   * Captured once rather than read per move: the stage does not move during a
   * drag, and `getBoundingClientRect` in a pointer handler is a forced layout
   * on every frame of the gesture.
   */
  origin: { x: number; y: number };
  /** False until the first move; nothing is committed before it. */
  begun: boolean;
  /** The angle last seen, so each step is measured the short way round. */
  prevAngle: number;
  /** Everything travelled so far, which is what makes a full turn possible. */
  travelled: number;
  startRotation: number;
}

export const RotateZones: React.FC<Props> = ({
  box,
  rotation,
  proxyRef,
  onStart,
  onMove,
  onEnd,
  onCancel,
  transforming,
}) => {
  const gesture = useRef<Gesture | null>(null);

  /**
   * The rotation HUD's pose, while a rotation is running.
   *
   * ## Why this one piece of state is allowed to change per frame
   *
   * Everything else in this component deliberately avoids re-rendering during
   * a gesture — the pointer handlers write through refs for exactly that
   * reason. The HUD is the exception because it is *geometry that must follow
   * the hand*, and there is no way to express a swept wedge as a static shape.
   *
   * It is bounded: it exists only between the first move of a rotation and the
   * release, it is four small shapes, and the alternative — writing Konva
   * nodes imperatively from the pointer handler — is the more complex half of
   * the presence layer's design for a surface that lives for two seconds.
   *
   * ## Why it carries no number
   *
   * The angle readout already exists: `handleTransform` puts it in the
   * selection's own badge, below the box, where every other transform reports
   * itself. A second degree label here would be the same fact in two places,
   * four inches apart, and the one that is wrong is the one nobody updates.
   * So the HUD draws only what the badge *cannot* say: where the rotation
   * began, where it is now, and the angle between them as a shape.
   */
  const [hud, setHud] = useState<{
    from: number;
    to: number;
    reach: number;
    /** While Shift snaps: the ray angle of an object rotation of 0°, so the 15° grid can be drawn. */
    grid: number | null;
  } | null>(null);

  /**
   * Everything the window listeners need, refreshed every render and read when
   * they fire. This is what lets the effect below have no dependencies.
   */
  const live = useRef({ box, centre: centreOf(box), proxyRef, onStart, onMove, onEnd, onCancel });
  live.current = { box, centre: centreOf(box), proxyRef, onStart, onMove, onEnd, onCancel };

  /**
   * The zoom, so a zone keeps a constant size on screen.
   *
   * Subscribed to rather than read once: a zoom changes a zone's world size
   * without changing anything the parent re-renders for. One number, and the
   * only state here.
   */
  const [zoom, setZoom] = useState(cameraSystem.zoom);
  useEffect(() => {
    const sync = () => setZoom((z) => (z === cameraSystem.zoom ? z : cameraSystem.zoom));
    sync();
    return engineEvents.on('CameraChanged', sync);
  }, []);

  useEffect(() => {
    const finish = (cancelled = false) => {
      const g = gesture.current;
      if (!g) return;
      gesture.current = null;
      setHud(null);
      claimCursor(g.kind, null);
      // A press that never moved began nothing, so there is nothing to end.
      // Calling `onEnd` here is what committed a transform between two
      // different selections — see the note on `Gesture`.
      if (!g.begun) return;
      if (cancelled && live.current.onCancel) live.current.onCancel();
      else live.current.onEnd();
    };

    const move = (e: PointerEvent) => {
      const g = gesture.current;
      if (!g) return;
      const { centre, proxyRef: pr, onMove: notify } = live.current;
      // Into the stage's own space first — see `Gesture.origin`.
      const world = cameraSystem.screenToWorld(e.clientX - g.origin.x, e.clientY - g.origin.y);

      // The gesture begins here, on the first movement, not on the press.
      if (!g.begun) {
        g.begun = true;
        live.current.onStart(g.kind);
      }

      const proxy = pr.current;
      if (!proxy) return;
      /**
       * Each step measured the short way round, and accumulated.
       *
       * `angleOf` wraps at ±180, so reading the difference from the *start*
       * angle makes the object flip most of a turn whenever the pointer
       * crosses the far side — and caps a gesture at half a revolution even
       * when it does not. Summing short steps has neither problem.
       */
      const now = angleOf(centre, world);
      g.travelled += angleDelta(g.prevAngle, now);
      g.prevAngle = now;
      proxy.rotation(rotationFor(g.startRotation, g.travelled, e.shiftKey ? SNAP : 0));
      notify();
      // The arrows keep facing the hand as it circles the centre.
      claimCursor('rotate', rotateCursorCss(radialAngle(centre, world)));

      // The ray the hand is on, and the ray it started from. Both in world
      // degrees, so the HUD needs no knowledge of the object's own angle.
      // Snapping, the live ray shows where the object *is* (the snapped
      // angle), not where the hand is, so the wedge and the result agree.
      const from = now - g.travelled;
      const snapping = e.shiftKey;
      setHud({
        from,
        to: snapping ? from + (proxy.rotation() - g.startRotation) : now,
        reach: Math.max(Math.hypot(world.x - centre.x, world.y - centre.y), 1),
        grid: snapping ? from - g.startRotation : null,
      });
    };

    // Escape puts the object back where the turn began, then ends it.
    const key = (e: KeyboardEvent) => {
      const g = gesture.current;
      if (e.key !== 'Escape' || !g) return;
      if (g.begun) {
        live.current.proxyRef.current?.rotation(g.startRotation);
        live.current.onMove();
      }
      finish(true);
    };

    const done = () => finish();
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', done);
    window.addEventListener('pointercancel', done);
    window.addEventListener('blur', done);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointercancel', done);
      window.removeEventListener('keydown', key);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', done);
      window.removeEventListener('blur', done);
      // A gesture interrupted by this unmounting — a selection change
      // mid-rotation — is committed rather than abandoned half-applied, and
      // the pointer is given back.
      finish();
    };
  }, []);

  /**
   * Hidden during somebody else's transform, and never during our own.
   *
   * See point 2 above: `transforming` is set by `onStart`, which these zones
   * call, so gating on it alone unmounts them on the press that starts the
   * gesture.
   */
  const busy = gesture.current !== null;
  if (!busy && (transforming || box.width <= 0 || box.height <= 0)) return null;

  const reach = reachAt(zoom);
  const zones = rotateZones(box, reach);
  const centre = centreOf(box);

  /**
   * The proxy is drawn rotated about its own centre, so the zones have to be
   * too — they are children of a group carrying the same transform, which is
   * what keeps a corner zone on its corner once the object is turned.
   */
  const px = 1 / zoom;
  const cornerPts = corners(box);
  const screenMin = Math.min(box.width, box.height) * zoom;
  /** The pointer in world space if it is inside corner `i`'s quarter ring, else null. */
  const ringHit = (e: Konva.KonvaEventObject<MouseEvent>, i: number) => {
    const p = e.target.getStage()?.getPointerPosition();
    if (!p) return null;
    const world = cameraSystem.screenToWorld(p.x, p.y);
    const local = intoFrame(centre, world, rotation);
    return inCornerRing(cornerPts[i], CORNER_SIGNS[i], local, zoom, screenMin) ? world : null;
  };

  /**
   * The rotation HUD.
   *
   * A sibling of the zones rather than a child, because the zone group carries
   * the object's own rotation and this is measured in **world** terms: the ray
   * you started on does not turn with the thing you are turning.
   *
   * Four marks, and each answers something the number below the box cannot:
   *
   * - the **pivot**, so it is obvious the turn is about the centre and not the
   *   corner under the hand — which is the single most common wrong guess
   *   about a rotation gesture;
   * - the **start ray**, dashed, which is the only record of where the gesture
   *   began once the object has moved;
   * - the **live ray**, solid, joining the pivot to the hand;
   * - the **wedge** between them, which turns "how far" from a number you read
   *   into a shape you see — and is what makes overshooting a snap obvious
   *   before you let go.
   *
   * Everything is sized in screen pixels over the zoom, so the HUD is the same
   * weight at 10% and 500%. It never listens: it is a readout, and a readout
   * that can be clicked is a control.
   */
  const rotationHud = hud ? (
    <Group x={centre.x} y={centre.y} listening={false} name={EXPORT_CHROME}>
      <Arc
        innerRadius={0}
        outerRadius={Math.min(hud.reach, 78 * px)}
        angle={hud.to - hud.from}
        rotation={hud.from}
        fill={ACCENT}
        opacity={0.14}
      />
      <Line
        points={[0, 0, Math.cos((hud.from * Math.PI) / 180) * hud.reach, Math.sin((hud.from * Math.PI) / 180) * hud.reach]}
        stroke={ACCENT}
        strokeWidth={1 * px}
        dash={[4 * px, 4 * px]}
        opacity={0.7}
      />
      <Line
        points={[0, 0, Math.cos((hud.to * Math.PI) / 180) * hud.reach, Math.sin((hud.to * Math.PI) / 180) * hud.reach]}
        stroke={ACCENT}
        strokeWidth={1.4 * px}
      />
      <Circle radius={3.5 * px} fill="#FFFFFF" stroke={ACCENT} strokeWidth={1.4 * px} />
      {/* The 15° grid Shift snaps to, as protractor ticks round the wedge's
          rim: longer every 45°, so the snap targets are visible before the
          hand reaches them. */}
      {hud.grid !== null &&
        snapTicks(hud.grid, Math.min(hud.reach, 78 * px), px).map((points, i) => (
          <Line key={i} points={points} stroke={ACCENT} strokeWidth={1 * px} opacity={i % 3 === 0 ? 0.75 : 0.4} />
        ))}
    </Group>
  ) : null;

  return (
    <>
      {rotationHud}
    <Group
      x={centre.x}
      y={centre.y}
      rotation={rotation}
      offsetX={centre.x}
      offsetY={centre.y}
      name={EXPORT_CHROME}
    >
      {zones.map((zone, i) => (
        <Rect
          key={`rotate-${i}`}
          {...zone}
          fill="transparent"
          perfectDrawEnabled={false}
          onMouseMove={(e) => {
            if (gesture.current) return;
            const world = ringHit(e, i);
            if (world) claimCursor('rotate', rotateCursorCss(radialAngle(centre, world)));
            else claimCursor('rotate', null);
          }}
          onMouseLeave={() => {
            // Not while dragging: the cursor must not revert mid-turn.
            if (!gesture.current) claimCursor('rotate', null);
          }}
          onMouseDown={(e) => {
            const stage = e.target.getStage();
            const pointer = stage?.getPointerPosition();
            const proxy = proxyRef.current;
            if (!pointer || !stage || !proxy) return;
            // Off the ring (over a handle, or past the outer edge): not ours.
            if (!ringHit(e, i)) return;
            // Konva's own drag must not also start: a rotation is not a move.
            e.cancelBubble = true;
            // `getPointerPosition` is already stage-relative, so this one needs
            // no origin — but the *move* handler does, and both have to end up
            // in the same space or the gesture opens with a jump.
            const world = cameraSystem.screenToWorld(pointer.x, pointer.y);
            const rect = stage.container().getBoundingClientRect();
            // Set *before* `onStart`, which is what keeps this mounted through
            // the render that call triggers.
            gesture.current = {
              kind: 'rotate',
              begun: false,
              prevAngle: angleOf(centre, world),
              travelled: 0,
              /**
               * From the **document**, not from the proxy.
               *
               * The proxy is a scratch node the transformer drives, and it is
               * left in whatever state the last gesture put it in until
               * `fitProxy` runs again. Reading a starting angle off it means
               * reading a value that is briefly stale after every commit — so
               * a second rotation began from zero and threw the object back to
               * square before turning it.
               *
               * `rotation` is the same value `fitProxy` fits the proxy *to*,
               * so this is that number one step earlier and cannot be behind
               * it.
               */
              startRotation: rotation,
              origin: { x: rect.left, y: rect.top },
            };
          }}
        />
      ))}

    </Group>
    </>
  );
};
