/**
 * The line tool's gesture, as a state machine with no pointer events in it.
 *
 * ## One gesture model
 *
 * - **Drag** draws one segment, committed on release.
 * - **Click** starts a run; every further click places a corner.
 * - **Double-click, Enter or Escape** finishes the run. A double-click needs no
 *   handling of its own: its second click lands on the vertex the first one
 *   placed, and a click on the last vertex is what ends a run.
 * - **Backspace** takes the last corner back.
 *
 * The press decides which gesture it was by whether it travelled, measured in
 * screen pixels so the same hand movement means the same thing at every zoom.
 * Once a run has started, moving is aiming, never dragging.
 *
 * Held here rather than in the tool so every rule is arithmetic a test can
 * reach. The tool turns pointer events into `LineEvent`s and acts on the
 * `LineEffect` that comes back; it holds no gesture state of its own.
 */

import type { Point } from '../model/schema';
import { constrainToAngle } from '../model/lineEnds';
import {
  addVertex,
  beginSession,
  commitPoints,
  endsRun,
  undoVertex,
  type PolylineSession,
} from './polylineSession';

/** How far a press must travel, in screen pixels, before it is a drag. */
export const DRAG_SCREEN = 5;

export type LinePhase =
  | { kind: 'idle' }
  /** A press that has not yet said whether it is a click or a drag. */
  | { kind: 'pressed'; press: Point }
  /** A press that travelled: one segment from `anchor`, following the pointer. */
  | { kind: 'dragging'; anchor: Point }
  /** A run of corners. `pressed` is a click in progress on top of it. */
  | { kind: 'run'; session: PolylineSession; pressed: boolean };

export type LineEvent =
  | { type: 'down'; at: Point }
  | { type: 'move'; at: Point }
  | { type: 'up'; at: Point }
  /** Enter, or Escape during a run: keep what was drawn. */
  | { type: 'finish' }
  /** Escape outside a run: throw the gesture away. */
  | { type: 'cancel' }
  /** Backspace: take back the last corner. */
  | { type: 'undo' };

export type LineEffect =
  | { type: 'none' }
  /** Two raw points: the tool applies modifiers, snapping and binding. */
  | { type: 'segment'; from: Point; to: Point }
  /** Placed vertices, already snapped as they were placed. */
  | { type: 'run'; points: Point[] }
  /** The gesture ended with nothing worth storing. */
  | { type: 'discard' };

export interface GestureConfig {
  /** Board zoom, so the drag and finish thresholds are screen distances. */
  zoom: number;
  /**
   * Where a click places its vertex: the tool's grid snap and Shift
   * constraint, applied to the raw pointer. Identity when absent.
   */
  place?: (raw: Point, session: PolylineSession | null) => Point;
}

export const IDLE: LinePhase = { kind: 'idle' };

const none = { type: 'none' } as const;

/** The next phase, and what the tool should do about it. */
export function lineGesture(
  phase: LinePhase,
  event: LineEvent,
  config: GestureConfig
): { phase: LinePhase; effect: LineEffect } {
  const place = config.place ?? ((p: Point) => ({ x: p.x, y: p.y }));
  const zoom = Math.max(config.zoom, 1e-6);

  switch (phase.kind) {
    case 'idle':
      if (event.type === 'down') return { phase: { kind: 'pressed', press: { ...event.at } }, effect: none };
      return { phase, effect: none };

    case 'pressed':
      if (event.type === 'move') {
        const travelled = Math.hypot(event.at.x - phase.press.x, event.at.y - phase.press.y) * zoom;
        return travelled > DRAG_SCREEN
          ? { phase: { kind: 'dragging', anchor: phase.press }, effect: none }
          : { phase, effect: none };
      }
      if (event.type === 'up') {
        // A click: the first corner of a run.
        return {
          phase: { kind: 'run', session: beginSession(place(phase.press, null)), pressed: false },
          effect: none,
        };
      }
      if (event.type === 'cancel') return { phase: IDLE, effect: { type: 'discard' } };
      return { phase, effect: none };

    case 'dragging':
      if (event.type === 'up') return { phase: IDLE, effect: { type: 'segment', from: phase.anchor, to: { ...event.at } } };
      if (event.type === 'cancel') return { phase: IDLE, effect: { type: 'discard' } };
      return { phase, effect: none };

    case 'run': {
      const { session } = phase;
      switch (event.type) {
        case 'down':
          return { phase: { ...phase, pressed: true }, effect: none };
        case 'up': {
          // A release with no press of ours is the tail of the click that armed
          // the tool, or of a pan; it places nothing.
          if (!phase.pressed) return { phase, effect: none };
          if (endsRun(session, event.at, zoom)) return finish(session, zoom);
          return {
            phase: { kind: 'run', session: addVertex(session, place(event.at, session)), pressed: false },
            effect: none,
          };
        }
        case 'finish':
        case 'cancel':
          // Escape keeps a run: every click that made it was deliberate, and
          // the key people press to mean "done" should not throw it away.
          return finish(session, zoom);
        case 'undo': {
          const undone = undoVertex(session);
          if (undone === session) return { phase: IDLE, effect: { type: 'discard' } };
          return { phase: { ...phase, session: undone }, effect: none };
        }
        default:
          return { phase, effect: none };
      }
    }
  }
}

function finish(session: PolylineSession, zoom: number): { phase: LinePhase; effect: LineEffect } {
  const points = commitPoints(session, zoom);
  return { phase: IDLE, effect: points ? { type: 'run', points } : { type: 'discard' } };
}

/** Whether a gesture is under way, so the tool knows to keep drawing its preview. */
export function isLive(phase: LinePhase): boolean {
  return phase.kind !== 'idle';
}

// ---------------------------------------------------------------- modifiers

/**
 * A segment's two ends with Shift and Alt applied.
 *
 * **Shift** steps the direction to fifteen degrees, keeping the length — the
 * same `constrainToAngle` the endpoint handles use, so drawing a line and
 * editing one agree about the key. **Alt** draws from the centre: the press
 * becomes the middle and the line grows both ways at once.
 */
export function segmentEnds(
  anchor: Point,
  pointer: Point,
  mods: { shift: boolean; alt: boolean }
): { a: Point; b: Point } {
  const b = mods.shift ? constrainToAngle(anchor, pointer) : { x: pointer.x, y: pointer.y };
  const a = mods.alt ? { x: anchor.x * 2 - b.x, y: anchor.y * 2 - b.y } : { x: anchor.x, y: anchor.y };
  return { a, b };
}

// ---------------------------------------------------------------- readout

/**
 * Length and direction, as a person reads them off a ruler.
 *
 * The angle is measured the way Figma and every drafting tool state it:
 * counter-clockwise from the positive x-axis, with up as positive — so a line
 * drawn up and to the right reads 45°, not the −45° screen coordinates give.
 * Normalised to (−180, 180].
 */
export function measureRun(a: Point, b: Point): { length: number; angle: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-9) return { length: 0, angle: 0 };
  let angle = (Math.atan2(-dy, dx) * 180) / Math.PI;
  if (angle <= -180) angle += 360;
  // −0 reads as "-0°".
  return { length, angle: Object.is(angle, -0) ? 0 : angle };
}

/** "240 · 45°": whole units, whole degrees. */
export function formatMeasure(m: { length: number; angle: number }): string {
  const deg = Math.round(m.angle);
  return `${Math.round(m.length)} · ${deg === -180 ? 180 : deg}°`;
}
