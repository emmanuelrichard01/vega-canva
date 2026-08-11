/**
 * Snapping to other objects, and the guides that explain it.
 *
 * The audit calls this the single most-missed item in the whole specification,
 * and it is: a grid tells you where the grid is, but almost nothing you place
 * on a canvas is aligned to a grid — it is aligned to the thing next to it.
 *
 * ## Why the guides matter as much as the snap
 *
 * A snap with no guide is an object that jumps for no visible reason. The line
 * is not decoration, it is the explanation, and it has to span both the moving
 * object and whatever it matched so the relationship is readable at a glance.
 * That is why a match carries its own extent rather than being drawn edge to
 * edge of the screen.
 *
 * ## Orientation and axis are deliberately different words
 *
 * A guide has an **orientation**: how the line is drawn. A snap has an
 * **axis**: which coordinate it corrects. They are not the same, and the first
 * draft of this module used one word for both — which was fine for alignment,
 * where a horizontal correction draws a vertical line, and actively misleading
 * for spacing, where a horizontal gap is marked by a *horizontal* line. Two
 * words, so a reader never has to work out which is meant.
 *
 * ## Everything here is pure
 *
 * No store, no camera, no Konva. The caller converts a screen-pixel tolerance
 * into world units (so the snap feels identical at every zoom) and decides
 * which objects are candidates. This module does the arithmetic, which is the
 * part worth testing and the part that is wrong in most implementations.
 */

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A line to draw, in world coordinates.
 *
 * A `vertical` guide is fixed at `position` on x and runs from `from` to `to`
 * on y; a `horizontal` one is the other way round.
 */
export interface Guide {
  orientation: 'vertical' | 'horizontal';
  position: number;
  from: number;
  to: number;
  kind: 'edge' | 'centre' | 'spacing';
  /** Only for `spacing`: the gap being matched, so it can be labelled. */
  gap?: number;
}

export interface SnapResult {
  dx: number;
  dy: number;
  guides: Guide[];
}

export const NO_SNAP: SnapResult = { dx: 0, dy: 0, guides: [] };

/** One axis' worth of answer: how far to move, and why. */
interface AxisSnap {
  delta: number;
  guides: Guide[];
}

type Axis = 'x' | 'y';

/** Accessors for whichever axis is being considered, and its cross axis. */
function on(axis: Axis) {
  const isX = axis === 'x';
  return {
    pos: (b: Box) => (isX ? b.x : b.y),
    size: (b: Box) => (isX ? b.width : b.height),
    crossPos: (b: Box) => (isX ? b.y : b.x),
    crossSize: (b: Box) => (isX ? b.height : b.width),
    /** A correction along x is explained by a line drawn vertically. */
    alignOrientation: (isX ? 'vertical' : 'horizontal') as Guide['orientation'],
    /** A gap along x is marked by a line drawn horizontally, along the gap. */
    spacingOrientation: (isX ? 'horizontal' : 'vertical') as Guide['orientation'],
  };
}

/** The three positions on each axis that people align things by. */
const ANCHORS = ['start', 'centre', 'end'] as const;
type AnchorKind = (typeof ANCHORS)[number];

function anchorAt(box: Box, axis: Axis, kind: AnchorKind): number {
  const { pos, size } = on(axis);
  if (kind === 'start') return pos(box);
  if (kind === 'end') return pos(box) + size(box);
  return pos(box) + size(box) / 2;
}

/**
 * Deltas closer together than this are the same snap.
 *
 * Two candidates that agree to within a fraction of a world unit are aligned
 * with each other, and both of their guides should be drawn — showing only the
 * first would hide the fact that you have just lined up with three things at
 * once, which is exactly when the feedback is most useful.
 */
const SAME = 0.01;

/**
 * How far the guide line has to reach on the cross axis.
 *
 * From the near edge of whichever object is furthest one way to the far edge
 * of whichever is furthest the other, so a line between two objects at
 * opposite ends of the board spans the distance and is visibly *about* those
 * two — rather than being a full-screen rule that could mean anything.
 */
function extentOf(boxes: Box[], axis: Axis): { from: number; to: number } {
  const { crossPos, crossSize } = on(axis);
  let from = Infinity;
  let to = -Infinity;
  for (const b of boxes) {
    from = Math.min(from, crossPos(b));
    to = Math.max(to, crossPos(b) + crossSize(b));
  }
  return { from, to };
}

/**
 * The best alignment on one axis, or null.
 *
 * "Best" is the smallest movement, not the first match found: dragging past a
 * cluster should snap to whichever object you are nearest, and taking the
 * first candidate in array order snaps to whatever happens to be earliest in
 * the document instead.
 *
 * A like-for-like match — edge to edge, centre to centre — beats a mixed one
 * at the same distance, because an edge landing on a centre is a coincidence
 * rather than a relationship anyone was aiming for.
 */
function alignOnAxis(moving: Box, candidates: Box[], tolerance: number, axis: Axis): AxisSnap | null {
  let best: { delta: number; position: number; kind: Guide['kind']; alike: boolean; matched: Box[] } | null = null;

  for (const movingKind of ANCHORS) {
    const from = anchorAt(moving, axis, movingKind);
    for (const candidate of candidates) {
      for (const candidateKind of ANCHORS) {
        const to = anchorAt(candidate, axis, candidateKind);
        const delta = to - from;
        if (Math.abs(delta) > tolerance) continue;

        const alike = movingKind === candidateKind;
        const kind: Guide['kind'] = candidateKind === 'centre' ? 'centre' : 'edge';

        if (!best) {
          best = { delta, position: to, kind, alike, matched: [candidate] };
          continue;
        }

        const closer = Math.abs(delta) < Math.abs(best.delta) - SAME;
        const equal = Math.abs(Math.abs(delta) - Math.abs(best.delta)) <= SAME;

        if (equal && Math.abs(to - best.position) <= SAME) {
          // Same line, another object on it. Both guides get drawn.
          if (!best.matched.includes(candidate)) best.matched.push(candidate);
          // A like-for-like reading of the same line is the better label.
          if (alike && !best.alike) {
            best.kind = kind;
            best.alike = true;
          }
          continue;
        }
        if (closer || (equal && alike && !best.alike)) {
          best = { delta, position: to, kind, alike, matched: [candidate] };
        }
      }
    }
  }

  if (!best) return null;

  const { pos } = on(axis);
  const moved: Box = axis === 'x' ? { ...moving, x: pos(moving) + best.delta } : { ...moving, y: pos(moving) + best.delta };

  return {
    delta: best.delta,
    guides: [
      {
        orientation: on(axis).alignOrientation,
        position: best.position,
        kind: best.kind,
        ...extentOf([moved, ...best.matched], axis),
      },
    ],
  };
}

/**
 * Snap so the gaps either side of the moving box are equal.
 *
 * The other half of what people mean by "aligned": three things in a row want
 * to be *evenly spaced*, and no amount of edge alignment expresses that.
 *
 * Only the nearest neighbour on each side is considered, because that is the
 * relationship you can see — equalising against a distant pair produces a
 * correct number and no legible reason for the jump. Candidates are restricted
 * to those overlapping the moving box on the cross axis, since two objects on
 * different rows have no meaningful horizontal gap between them.
 */
function spaceOnAxis(moving: Box, candidates: Box[], tolerance: number, axis: Axis): AxisSnap | null {
  const { pos, size, crossPos, crossSize, spacingOrientation } = on(axis);

  const inLine = candidates.filter(
    (c) => crossPos(c) < crossPos(moving) + crossSize(moving) && crossPos(c) + crossSize(c) > crossPos(moving)
  );
  if (inLine.length < 2) return null;

  const before = inLine
    .filter((c) => pos(c) + size(c) <= pos(moving))
    .sort((a, b) => pos(b) + size(b) - (pos(a) + size(a)))[0];
  const after = inLine.filter((c) => pos(c) >= pos(moving) + size(moving)).sort((a, b) => pos(a) - pos(b))[0];
  if (!before || !after) return null;

  const free = pos(after) - (pos(before) + size(before)) - size(moving);
  if (free < 0) return null; // No room for the object between them at all.

  const gap = free / 2;
  const target = pos(before) + size(before) + gap;
  const delta = target - pos(moving);
  if (Math.abs(delta) > tolerance) return null;

  // Drawn down the middle of the moving object, which is where the eye checks
  // that the two distances match.
  const position = crossPos(moving) + crossSize(moving) / 2;
  const mark = (from: number, to: number): Guide => ({
    orientation: spacingOrientation,
    position,
    from,
    to,
    kind: 'spacing',
    gap,
  });

  return {
    delta,
    guides: [mark(pos(before) + size(before), target), mark(target + size(moving), pos(after))],
  };
}

function combine(x: AxisSnap | null, y: AxisSnap | null): SnapResult {
  return {
    dx: x?.delta ?? 0,
    dy: y?.delta ?? 0,
    guides: [...(x?.guides ?? []), ...(y?.guides ?? [])],
  };
}

/** Snap the moving box to the edges and centres of the candidates. */
export function alignmentSnap(moving: Box, candidates: Box[], tolerance: number): SnapResult {
  if (candidates.length === 0 || tolerance <= 0) return NO_SNAP;
  return combine(
    alignOnAxis(moving, candidates, tolerance, 'x'),
    alignOnAxis(moving, candidates, tolerance, 'y')
  );
}

/** Snap so the moving box sits evenly between its nearest neighbours. */
export function spacingSnap(moving: Box, candidates: Box[], tolerance: number): SnapResult {
  if (candidates.length < 2 || tolerance <= 0) return NO_SNAP;
  return combine(
    spaceOnAxis(moving, candidates, tolerance, 'x'),
    spaceOnAxis(moving, candidates, tolerance, 'y')
  );
}

/**
 * The snap to apply while dragging: alignment where there is one, even spacing
 * where there is not.
 *
 * Alignment wins because it is the stronger statement — an object that could
 * either line up with a neighbour's edge or sit evenly between two others
 * should line up. Decided per axis, so an object can align horizontally and
 * space itself evenly in the vertical at the same time.
 */
export function snapToObjects(moving: Box, candidates: Box[], tolerance: number): SnapResult {
  if (candidates.length === 0 || tolerance <= 0) return NO_SNAP;

  const x = alignOnAxis(moving, candidates, tolerance, 'x') ?? spaceOnAxis(moving, candidates, tolerance, 'x');
  const y = alignOnAxis(moving, candidates, tolerance, 'y') ?? spaceOnAxis(moving, candidates, tolerance, 'y');
  return combine(x, y);
}
