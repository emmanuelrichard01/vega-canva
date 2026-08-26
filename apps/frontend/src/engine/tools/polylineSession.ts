/**
 * Drawing a line by clicking once per corner.
 *
 * ## Two gestures, one tool
 *
 * The line tool has always been press-drag-release: press where it starts, let
 * go where it ends. That is the right gesture for a two-point line and it is
 * the only gesture the tool had, so a line with a corner in it was not
 * something you could draw — you drew two lines and lined them up by eye.
 *
 * Excalidraw, Figma and Illustrator all resolve this the same way, and it is
 * worth being precise about *why* it works rather than copying it: the two
 * gestures do not overlap. A drag is a press and a move; a click is a press and
 * a release in the same place. So the tool can offer both without a mode
 * switch, without a modifier, and without asking anyone which one they meant —
 * the pointer has already said. Drag gives you the line you were going to get
 * anyway; click starts a run and every further click adds a corner.
 *
 * ## Why this is a session object and not component state
 *
 * The same reason `penSession` is. What is being placed lives across a dozen
 * pointer events, has an undo of its own (Backspace), a constraint (Shift), and
 * three ways to end — and every one of those rules is a decision that can be
 * wrong. Held in a component they are only checkable by clicking; held here
 * they are arithmetic, and the tool becomes the part that turns pointer events
 * into calls.
 */

import type { Point } from '../model/schema';
import { constrainToAngle } from '../model/lineEnds';

/**
 * How near the last-placed vertex a click has to land to finish the run.
 *
 * In **screen pixels**, then converted by the zoom at the point of comparison —
 * invariant 9. A world-unit threshold makes the same gesture finish the line at
 * one zoom and place a duplicate vertex at another, which is the bug this
 * codebase has already fixed twice.
 */
export const CLOSE_ENOUGH_SCREEN = 8;

/** A run of two identical points is not a line; a run of two is the minimum. */
export const MIN_COMMITTABLE = 2;

export interface PolylineSession {
  /** Vertices placed so far, in world coordinates. */
  points: Point[];
}

export function beginSession(at: Point): PolylineSession {
  return { points: [{ x: at.x, y: at.y }] };
}

/**
 * Where the next vertex would go, given the modifiers in force.
 *
 * Shift constrains to fifteen degrees **from the last placed vertex**, not from
 * the origin of the run — which is what makes a constrained polyline draw as a
 * series of clean angles rather than a fan radiating from where you started.
 * `constrainToAngle` is the line editor's own, so a constrained segment drawn
 * here and one dragged there land on the same angles.
 */
export function nextVertex(
  session: PolylineSession,
  pointer: Point,
  constrain: boolean
): Point {
  const last = session.points[session.points.length - 1];
  if (!constrain || !last) return { x: pointer.x, y: pointer.y };
  return constrainToAngle(last, pointer);
}

/**
 * Whether a click at this point should finish the run rather than extend it.
 *
 * Clicking the last vertex again is how every one of these tools ends a run,
 * and it has to be a *near* test rather than an exact one: a click that moves
 * two pixels between press and release is still a click, and demanding an exact
 * hit makes the gesture fail for anyone without a steady hand.
 */
export function endsRun(session: PolylineSession, at: Point, zoom: number): boolean {
  const last = session.points[session.points.length - 1];
  if (!last) return false;
  const reach = CLOSE_ENOUGH_SCREEN / Math.max(zoom, 1e-6);
  return Math.hypot(at.x - last.x, at.y - last.y) <= reach;
}

/** Add a vertex. Returns a new session; the old one is left alone. */
export function addVertex(session: PolylineSession, at: Point): PolylineSession {
  return { points: [...session.points, { x: at.x, y: at.y }] };
}

/**
 * Take the last vertex back.
 *
 * Backspace during a run, because a misplaced corner is the single most likely
 * thing to happen while drawing one and the alternative — abandon the line and
 * start again — is a punishment for a two-pixel slip. Never removes the first
 * vertex: a run with nothing in it is not a state the tool has a drawing for,
 * and `Escape` is how you mean that.
 */
export function undoVertex(session: PolylineSession): PolylineSession {
  if (session.points.length <= 1) return session;
  return { points: session.points.slice(0, -1) };
}

/**
 * The run as it should be drawn right now, pointer included.
 *
 * One derivation: the preview the user sees and the geometry the commit stores
 * come from the same list, so the line cannot land somewhere other than where
 * it was drawn. The pointer is appended rather than merged, because it is not a
 * vertex yet — it becomes one on the next click, and only then.
 */
export function previewPoints(session: PolylineSession, pointer: Point | null): Point[] {
  return pointer ? [...session.points, pointer] : [...session.points];
}

/**
 * The vertices to commit, or `null` if there is no line here.
 *
 * Trailing duplicates are dropped first. They are produced by the ordinary way
 * of finishing — a click on the last vertex — and a run ending in two identical
 * points has a final segment with no direction, which is what makes an end cap
 * point at nothing and a bend divide by zero.
 */
export function commitPoints(session: PolylineSession, zoom: number): Point[] | null {
  const reach = CLOSE_ENOUGH_SCREEN / Math.max(zoom, 1e-6);
  const out: Point[] = [];
  for (const p of session.points) {
    const last = out[out.length - 1];
    if (last && Math.hypot(p.x - last.x, p.y - last.y) <= reach) continue;
    out.push({ x: p.x, y: p.y });
  }
  return out.length >= MIN_COMMITTABLE ? out : null;
}
