/**
 * Where each connector's label sits, decided for all of them at once.
 *
 * ## Why a connector cannot place its own label
 *
 * Every label was drawn at the same fraction along its own run, which is the
 * right answer for one connector and a guaranteed collision for several. Two
 * arrows between the same pair of boxes put their words on top of each other;
 * a fan out of a decision node stacks three of them in the same few pixels.
 * The result is unreadable in exactly the diagrams that need reading, and no
 * amount of cleverness inside one connector can fix it, because the thing it
 * needs to know -- where the *other* labels went -- is not available to it.
 *
 * So placement is a pass over the whole set. It is the same shape of problem
 * as map labelling, and the same solution: offer each label a short list of
 * positions it would accept, in descending order of how much it likes them,
 * and hand them out first-come-first-served.
 *
 * ## Why greedy, and why in a fixed order
 *
 * Optimal label placement is NP-hard and the optimum is not worth having here:
 * a diagram has tens of labels, they are all small, and the difference between
 * "no overlaps" and "provably the fewest overlaps" is invisible. Greedy gets
 * the first in practice.
 *
 * The order is by **id**, not by position or by document order. Placement has
 * to be stable: if it depended on which connector happened to be drawn first,
 * a label would jump to a different spot when an unrelated object was added,
 * and dragging one box would rearrange the words on arrows that did not move.
 * Sorting by a value that never changes makes the arrangement a function of
 * the diagram rather than of its history.
 *
 * ## Why the sizes are estimated
 *
 * Measuring text means a canvas context, which means this could not be pure
 * and could not be tested. The label is a short uppercase word at a known size
 * in a known face, and it is drawn on an opaque plate -- so an estimate that
 * is a few pixels generous costs a little extra clearance and nothing else. An
 * estimate that is too *small* would let plates touch, so `CHAR_WIDTH` is
 * deliberately rounded up.
 */

export interface Point {
  x: number;
  y: number;
}

export interface LabelRequest {
  id: string;
  text: string;
  /** The route in world space, flat `[x, y, x, y, …]`. */
  points: readonly number[];
}

export interface Placed extends Point {
  /** Which candidate was taken, so a caller can tell "moved" from "preferred". */
  slot: number;
}

/**
 * Wide enough for the widest letter at this size, not the average.
 *
 * The plate must not be narrower than the word it carries: too generous costs
 * a couple of pixels of clearance, too tight lets two plates touch, which is
 * the thing this module exists to prevent.
 */
const CHAR_WIDTH = 7.4;
const LABEL_HEIGHT = 17;
const PLATE_PADDING = 6;

/** The plate a label will occupy, before it is placed anywhere. */
export function estimateLabelSize(text: string): { w: number; h: number } {
  return {
    w: Math.max(14, text.trim().length * CHAR_WIDTH + PLATE_PADDING * 2),
    h: LABEL_HEIGHT,
  };
}

/**
 * The point a given fraction of the way along a polyline, by **arc length**.
 *
 * By length rather than by vertex index, because an orthogonal route's
 * segments are wildly uneven -- a two-unit stub off a box's edge is one vertex
 * step and one two-hundredth of the run. Stepping by index would cluster every
 * label near whichever end had the most elbows.
 */
export function pointAlong(points: readonly number[], t: number): Point {
  const n = Math.floor(points.length / 2);
  if (n === 0) return { x: 0, y: 0 };
  if (n === 1) return { x: points[0], y: points[1] };

  const at = (i: number): Point => ({ x: points[i * 2], y: points[i * 2 + 1] });

  let total = 0;
  const lengths: number[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    const a = at(i);
    const b = at(i + 1);
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    lengths.push(d);
    total += d;
  }
  // A route whose ends coincide has no length to walk along.
  if (total === 0) return at(0);

  const target = Math.min(1, Math.max(0, t)) * total;
  let walked = 0;
  for (let i = 0; i < lengths.length; i += 1) {
    if (walked + lengths[i] >= target) {
      const a = at(i);
      const b = at(i + 1);
      const f = lengths[i] === 0 ? 0 : (target - walked) / lengths[i];
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    }
    walked += lengths[i];
  }
  return at(n - 1);
}

/** The direction the run is heading at a fraction along it. */
function tangentAt(points: readonly number[], t: number): Point {
  const eps = 0.01;
  const a = pointAlong(points, Math.max(0, t - eps));
  const b = pointAlong(points, Math.min(1, t + eps));
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  return len === 0 ? { x: 1, y: 0 } : { x: dx / len, y: dy / len };
}

/**
 * The positions a label will accept, best first.
 *
 * The middle of the run is the preferred spot and the first six alternatives
 * stay *on* the line, sliding towards one end or the other -- a label that has
 * moved along its own arrow still obviously belongs to it. Only when the run
 * is crowded end to end does it step **off** the line, perpendicular, where
 * the connection to its arrow is weaker but still legible.
 *
 * Sliding is tried before stepping aside for that reason, and both are tried
 * before giving up.
 */
function candidatesFor(points: readonly number[], size: { w: number; h: number }): Point[] {
  const along = [0.5, 0.38, 0.62, 0.27, 0.73, 0.17, 0.83];
  const out: Point[] = along.map((t) => pointAlong(points, t));

  // Perpendicular to the run, so the offset clears the line rather than
  // sliding along it -- on a vertical run "up" is what moves a label aside.
  for (const t of [0.5, 0.38, 0.62]) {
    const p = pointAlong(points, t);
    const tan = tangentAt(points, t);
    const nx = -tan.y;
    const ny = tan.x;
    const reach = size.h + 6;
    out.push({ x: p.x + nx * reach, y: p.y + ny * reach });
    out.push({ x: p.x - nx * reach, y: p.y - ny * reach });
  }
  return out;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The plate hangs down and to the right of its point.
 *
 * Konva's `Label` anchors at its top-left corner, so that is what the box has
 * to be. Modelling it as centred would put every rectangle half a plate away
 * from where the plate really is, which is enough to let two of them touch
 * while this function reports them clear -- a collision test that is wrong in
 * the same direction as the bug it is preventing.
 */
function rectAt(p: Point, size: { w: number; h: number }): Rect {
  return { x: p.x, y: p.y, w: size.w, h: size.h };
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * A position for every label, avoiding the ones already placed.
 *
 * Every request gets an answer. A label with nowhere free falls back to the
 * middle of its own run -- the position it would have had before any of this
 * existed -- because a word in the wrong place is still better than a word
 * flung to the far side of the board to escape a collision, and better than no
 * word at all.
 */
export function placeConnectorLabels(requests: readonly LabelRequest[]): Map<string, Placed> {
  const out = new Map<string, Placed>();
  const taken: Rect[] = [];

  // Stable across renders and across unrelated edits: see the header.
  const ordered = [...requests].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  for (const req of ordered) {
    if (req.points.length < 4) continue;
    const size = estimateLabelSize(req.text);
    const options = candidatesFor(req.points, size);

    let chosen: Point | null = null;
    let slot = 0;
    for (let i = 0; i < options.length; i += 1) {
      const rect = rectAt(options[i], size);
      if (!taken.some((t) => overlaps(rect, t))) {
        chosen = options[i];
        slot = i;
        break;
      }
    }

    const point = chosen ?? options[0];
    taken.push(rectAt(point, size));
    out.set(req.id, { x: point.x, y: point.y, slot: chosen ? slot : -1 });
  }

  return out;
}
