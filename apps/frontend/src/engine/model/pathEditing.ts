import type { Point } from './schema';
import {
  fromAnchors,
  moveHandle,
  setAnchorMode,
  subpathsOf,
  toAnchors,
  type Anchor,
  type ContourGeometry,
} from './pathGeometry';

/**
 * Editing several anchors at once, across every contour of a path.
 *
 * ## What this adds to `pathGeometry`
 *
 * That module can move *an* anchor and *a* handle, one at a time, on a single
 * bezier contour. Everything the direct-selection tool needs beyond that lives
 * here, and the gap was not a detail:
 *
 *  - **One anchor at a time.** Reshaping the top edge of a box means moving two
 *    corners together. Doing it one at a time is not slower, it is *a different
 *    result* — the intermediate state is a shape you did not want, and any
 *    snapping or constraint applies to the wrong thing.
 *  - **One contour.** A compound path — anything a boolean produced, any glyph
 *    with a hole — has several, and `moveAnchor(geo, 3)` cannot say which `3`.
 *  - **No selection model at all.** Marquee, shift-extend, and "what is
 *    selected after I delete these" are the substance of a direct-selection
 *    tool, and none of them are geometry questions.
 *
 * ## Coordinates
 *
 * Everything here is in **node-local** space, the same as the stored geometry.
 * The tool converts once, at the pointer, rather than each function taking a
 * transform it would have to be trusted to apply consistently.
 */

/** One anchor, addressed across contours. */
export interface AnchorRef {
  /** Which contour. Always 0 for a plain bezier path. */
  sub: number;
  index: number;
}

/** One handle of one anchor. */
export interface HandleRef extends AnchorRef {
  side: 'in' | 'out';
}

/** Stable string form, for use as a Set key. */
export const anchorKey = (ref: AnchorRef): string => `${ref.sub}:${ref.index}`;
export const handleKey = (ref: HandleRef): string => `${ref.sub}:${ref.index}:${ref.side}`;

export interface Contour {
  sub: number;
  anchors: Anchor[];
  closed: boolean;
}

/** Every contour's anchors, ready to draw or hit-test. */
export function contours(geo: ContourGeometry): Contour[] {
  return subpathsOf(geo).map((sub, i) => ({
    sub: i,
    anchors: toAnchors(sub),
    closed: sub.closed,
  }));
}

/** The point one ref names, or `null` when it names nothing. */
export function anchorAt(geo: ContourGeometry, ref: AnchorRef): Point | null {
  const a = contours(geo)[ref.sub]?.anchors[ref.index];
  return a ? { x: a.x, y: a.y } : null;
}

export function handleAt(geo: ContourGeometry, ref: HandleRef): Point | null {
  const a = contours(geo)[ref.sub]?.anchors[ref.index];
  if (!a) return null;
  const x = ref.side === 'in' ? a.inX : a.outX;
  const y = ref.side === 'in' ? a.inY : a.outY;
  return x === undefined || y === undefined ? null : { x, y };
}

/**
 * Put edited contours back into whatever shape the path was.
 *
 * A compound path stays compound even when it has one contour left, because
 * collapsing it would change what the fill rule means: `evenodd` over one ring
 * is the same picture, but the next boolean result appended to it would then
 * land in a plain bezier that cannot hold it.
 */
function rebuild(geo: ContourGeometry, subs: Contour[]): ContourGeometry {
  const built = subs.map((c) => fromAnchors(c.anchors, c.closed));
  if (geo.kind === 'compound') return { kind: 'compound', subpaths: built };
  return built[0] ?? geo;
}

/**
 * Move every named anchor by the same delta, carrying its handles.
 *
 * A delta rather than a destination, which is the whole difference from
 * `moveAnchor`: several anchors dragged together each keep their offset from
 * the others, and a single destination cannot express that. Handles travel
 * with their anchor because they are stored absolutely — an anchor that moved
 * without them would turn its own curve inside out.
 *
 * A handle whose *other* end is also selected moves once, not twice. Dragging
 * two adjacent anchors of a smooth curve would otherwise displace the control
 * between them by 2·delta and flatten the segment they were trying to keep.
 */
export function moveAnchors(
  geo: ContourGeometry,
  refs: readonly AnchorRef[],
  dx: number,
  dy: number
): ContourGeometry {
  if (refs.length === 0 || (dx === 0 && dy === 0)) return geo;
  const chosen = new Set(refs.map(anchorKey));

  const subs = contours(geo).map((c) => ({
    ...c,
    anchors: c.anchors.map((a, index) => {
      if (!chosen.has(anchorKey({ sub: c.sub, index }))) return { ...a };
      const next: Anchor = { ...a, x: a.x + dx, y: a.y + dy };
      if (next.inX !== undefined && next.inY !== undefined) {
        next.inX += dx;
        next.inY += dy;
      }
      if (next.outX !== undefined && next.outY !== undefined) {
        next.outX += dx;
        next.outY += dy;
      }
      return next;
    }),
  }));

  return rebuild(geo, subs);
}

/**
 * Drag one handle, on whichever contour holds it.
 *
 * The pair behaviour is `pathGeometry.moveHandle`'s and deliberately so: smooth
 * keeps direction and its own length, mirrored keeps both, and `break` forces a
 * corner. Reimplementing that here would be a second opinion about what a
 * smooth anchor is.
 */
export function dragHandle(
  geo: ContourGeometry,
  ref: HandleRef,
  to: Point,
  opts: { break?: boolean } = {}
): ContourGeometry {
  const subs = subpathsOf(geo);
  const target = subs[ref.sub];
  if (!target) return geo;

  const edited = moveHandle(target, ref.index, ref.side, to, opts);
  if (geo.kind !== 'compound') return edited;
  return { kind: 'compound', subpaths: subs.map((s, i) => (i === ref.sub ? edited : s)) };
}

/** Straighten or round every named anchor, in one pass. */
export function setAnchorsMode(
  geo: ContourGeometry,
  refs: readonly AnchorRef[],
  mode: 'corner' | 'smooth'
): ContourGeometry {
  const subs = subpathsOf(geo).map((s) => s);
  for (const ref of refs) {
    const target = subs[ref.sub];
    if (!target) continue;
    subs[ref.sub] = setAnchorMode(target, ref.index, mode);
  }
  if (geo.kind !== 'compound') return subs[0] ?? geo;
  return { kind: 'compound', subpaths: subs };
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Every anchor inside a marquee, across all contours. */
export function anchorsInRect(geo: ContourGeometry, rect: Rect): AnchorRef[] {
  const x1 = Math.min(rect.x, rect.x + rect.width);
  const x2 = Math.max(rect.x, rect.x + rect.width);
  const y1 = Math.min(rect.y, rect.y + rect.height);
  const y2 = Math.max(rect.y, rect.y + rect.height);

  const found: AnchorRef[] = [];
  for (const c of contours(geo)) {
    c.anchors.forEach((a, index) => {
      if (a.x >= x1 && a.x <= x2 && a.y >= y1 && a.y <= y2) found.push({ sub: c.sub, index });
    });
  }
  return found;
}

/**
 * The nearest anchor to a point, within a radius.
 *
 * Radius in the same units as the geometry, so the caller divides its screen
 * tolerance by the zoom once rather than this function taking a scale it would
 * have to apply the same way every time.
 */
export function anchorNear(geo: ContourGeometry, p: Point, radius: number): AnchorRef | null {
  let best: AnchorRef | null = null;
  let bestDist = radius;
  for (const c of contours(geo)) {
    c.anchors.forEach((a, index) => {
      const d = Math.hypot(a.x - p.x, a.y - p.y);
      if (d <= bestDist) {
        bestDist = d;
        best = { sub: c.sub, index };
      }
    });
  }
  return best;
}

/** The nearest *handle* to a point, searching only the anchors given. */
export function handleNear(
  geo: ContourGeometry,
  p: Point,
  radius: number,
  visible: readonly AnchorRef[]
): HandleRef | null {
  let best: HandleRef | null = null;
  let bestDist = radius;
  for (const ref of visible) {
    for (const side of ['in', 'out'] as const) {
      const h = handleAt(geo, { ...ref, side });
      if (!h) continue;
      const d = Math.hypot(h.x - p.x, h.y - p.y);
      if (d <= bestDist) {
        bestDist = d;
        best = { ...ref, side };
      }
    }
  }
  return best;
}

/**
 * Add, remove or replace, from one click.
 *
 * The three-way rule every list selection uses: plain click replaces, modified
 * click toggles. Written here rather than in the tool so the marquee and the
 * click cannot disagree about what "extend" means.
 */
export function toggleAnchor(
  selected: readonly AnchorRef[],
  ref: AnchorRef,
  additive: boolean
): AnchorRef[] {
  const key = anchorKey(ref);
  if (!additive) return [ref];
  const without = selected.filter((r) => anchorKey(r) !== key);
  return without.length === selected.length ? [...selected, ref] : without;
}

/**
 * Remove anchors, and say what is left.
 *
 * A contour that drops below two anchors is not a shorter path, it is not a
 * path — so it is dropped, and when the last one goes the whole geometry does,
 * which the caller reads as "delete the node". Returning a two-anchor stub
 * instead would leave an invisible object selected on the board.
 *
 * The remaining selection is returned with it, re-indexed: every anchor after a
 * deleted one has shifted down, and a selection carried across unchanged would
 * silently point at its neighbours.
 */
export function deleteAnchors(
  geo: ContourGeometry,
  refs: readonly AnchorRef[]
): { geometry: ContourGeometry | null; selection: AnchorRef[] } {
  const doomed = new Set(refs.map(anchorKey));
  if (doomed.size === 0) return { geometry: geo, selection: [...refs] };

  const kept: Contour[] = [];
  const selection: AnchorRef[] = [];

  for (const c of contours(geo)) {
    const anchors: Anchor[] = [];
    for (let index = 0; index < c.anchors.length; index += 1) {
      if (doomed.has(anchorKey({ sub: c.sub, index }))) continue;
      anchors.push(c.anchors[index]);
    }
    if (anchors.length < 2) continue;
    const sub = kept.length;
    kept.push({ sub, anchors, closed: c.closed });
  }

  if (kept.length === 0) return { geometry: null, selection: [] };

  /**
   * What stays selected: the anchor that took the place of the first deletion.
   *
   * Clearing the selection entirely is the obvious alternative and it is worse
   * for the thing people actually do, which is deleting several anchors in a
   * row — every press would need a fresh click to re-aim.
   */
  const first = [...refs].sort((a, b) => a.sub - b.sub || a.index - b.index)[0];
  const landing = kept.find((c) => c.sub === Math.min(first.sub, kept.length - 1));
  if (landing) {
    const index = Math.min(first.index, landing.anchors.length - 1);
    selection.push({ sub: landing.sub, index });
  }

  return { geometry: rebuild(geo, kept), selection };
}

export type AlignEdge = 'left' | 'centerX' | 'right' | 'top' | 'middleY' | 'bottom';

/**
 * Line selected anchors up.
 *
 * Illustrator has this and it is the fastest way to fix the thing that goes
 * wrong most often with a hand-drawn path: an edge that is *almost* straight.
 * Aligning three anchors to their own average is one gesture; dragging each one
 * onto a guide is three, and lands within a pixel rather than on it.
 *
 * Handles travel with their anchors, so a curve being straightened keeps its
 * shape rather than kinking at every anchor that moved.
 */
export function alignAnchors(
  geo: ContourGeometry,
  refs: readonly AnchorRef[],
  edge: AlignEdge
): ContourGeometry {
  if (refs.length < 2) return geo;
  const points = refs.map((r) => anchorAt(geo, r)).filter((p): p is Point => p !== null);
  if (points.length < 2) return geo;

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const target = {
    left: Math.min(...xs),
    right: Math.max(...xs),
    centerX: (Math.min(...xs) + Math.max(...xs)) / 2,
    top: Math.min(...ys),
    bottom: Math.max(...ys),
    middleY: (Math.min(...ys) + Math.max(...ys)) / 2,
  }[edge];

  const horizontal = edge === 'left' || edge === 'right' || edge === 'centerX';

  let next = geo;
  for (const ref of refs) {
    const at = anchorAt(next, ref);
    if (!at) continue;
    const dx = horizontal ? target - at.x : 0;
    const dy = horizontal ? 0 : target - at.y;
    if (dx !== 0 || dy !== 0) next = moveAnchors(next, [ref], dx, dy);
  }
  return next;
}

/**
 * The box the selected anchors occupy.
 *
 * What a direct-selection transform would scale, and what the tool draws its
 * readout from. Handles are excluded deliberately: a box that grew to contain a
 * control point would jump about as curves were adjusted, while describing an
 * area no part of the drawing occupies.
 */
export function anchorBounds(geo: ContourGeometry, refs: readonly AnchorRef[]): Rect | null {
  const points = refs.map((r) => anchorAt(geo, r)).filter((p): p is Point => p !== null);
  if (points.length === 0) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

/**
 * Scale selected anchors about a fixed point.
 *
 * The other half of "reshape part of a path": the transformer scales the whole
 * node, and there was no way at all to scale *four of its anchors* — which is
 * what widening one end of a shape means. Handles scale with their anchors, so
 * the curvature scales too rather than the anchors sliding out from under it.
 */
export function scaleAnchors(
  geo: ContourGeometry,
  refs: readonly AnchorRef[],
  origin: Point,
  sx: number,
  sy: number
): ContourGeometry {
  if (refs.length === 0) return geo;
  const chosen = new Set(refs.map(anchorKey));
  const at = (v: number, o: number, s: number) => o + (v - o) * s;

  const subs = contours(geo).map((c) => ({
    ...c,
    anchors: c.anchors.map((a, index) => {
      if (!chosen.has(anchorKey({ sub: c.sub, index }))) return { ...a };
      const next: Anchor = { ...a, x: at(a.x, origin.x, sx), y: at(a.y, origin.y, sy) };
      if (next.inX !== undefined && next.inY !== undefined) {
        next.inX = at(next.inX, origin.x, sx);
        next.inY = at(next.inY, origin.y, sy);
      }
      if (next.outX !== undefined && next.outY !== undefined) {
        next.outX = at(next.outX, origin.x, sx);
        next.outY = at(next.outY, origin.y, sy);
      }
      return next;
    }),
  }));

  return rebuild(geo, subs);
}
