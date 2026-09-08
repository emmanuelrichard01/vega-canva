/**
 * The adapter between a drag and `smartGuides`.
 *
 * `smartGuides` is arithmetic with no idea what a document or a camera is.
 * This is the part that knows both: which objects are worth comparing against,
 * how big the tolerance should be at the current zoom, and where to publish
 * the guides so the overlay can draw them.
 */

import { cameraSystem } from '../CameraSystem';
import { readGuides } from '../document/guides';
import { useStore } from '../../hooks/useStore';
import { gridSnap } from './gridSnap';
import { guideState } from './guideState';
import { snapToObjects, type Box } from './smartGuides';
import { guideEdges } from '../model/layoutGuide';
import { gridCellsOf } from '../grid/gridNode';
import type { GridNode } from '../model/schema';

/**
 * Snap distance, in **screen** pixels.
 *
 * Screen rather than world, converted through the zoom at the moment of the
 * drag, so the pull feels identical whether you are zoomed to 10% or 800%. A
 * world-unit tolerance would be unusable at both ends: an unreachable
 * hair's-breadth when zoomed out, and a magnet spanning half the viewport when
 * zoomed in.
 */
const SNAP_PX = 6;

/**
 * The most objects worth comparing against in one drag.
 *
 * Candidates are already limited to the viewport, so this only matters on a
 * board where hundreds of objects are visible at once — at which point the
 * nearest few are the only ones anybody can see a guide against anyway, and
 * comparing all of them is a per-frame cost with no per-frame benefit.
 */
const MAX_CANDIDATES = 200;

/**
 * How close counts as "this is the position we just returned".
 *
 * A world-unit fraction, well below anything a pointer can express and well
 * above the floating-point residue a snap leaves behind.
 */
const SETTLED = 0.01;

/** The last position this returned, for the re-entrancy guard above. */
let lastSnap: { x: number; y: number } | null = null;

function boxOf(node: { x: number; y: number; width: number; height: number; scaleX?: number; scaleY?: number }): Box {
  // Scale is folded in, because a flipped or scaled object's *visible* box is
  // what the user is lining things up against.
  const sx = Math.abs(node.scaleX ?? 1);
  const sy = Math.abs(node.scaleY ?? 1);
  return { x: node.x, y: node.y, width: node.width * sx, height: node.height * sy };
}

/**
 * Everything the moving object could sensibly line up with.
 *
 * Restricted to the viewport, which is a correctness decision before it is a
 * performance one: snapping to an object you cannot see produces a jump with
 * an explanation drawn somewhere off-screen, which is worse than not snapping.
 *
 * Hidden and filtered-out objects are excluded for the same reason, and so are
 * the other members of a multi-object drag — an object cannot align to
 * something that is moving with it.
 */
function candidatesFor(excluded: Set<string>): Box[] {
  const objects = useStore.getState().objects;
  // No overscan margin: the culling buffer exists so objects do not pop in at
  // the edge, but an object one pixel off-screen is one you cannot see a guide
  // against, which is the whole reason for restricting the set.
  const view = cameraSystem.getViewportBounds(0);

  const boxes: Box[] = [];
  for (const node of Object.values(objects)) {
    if (excluded.has(node.id)) continue;
    if (node.hidden) continue;
    // A comment pin is a 32px marker anchored to a point, not a shape anyone
    // aligns to; snapping to one is noise.
    if (node.type === 'comment') continue;

    const box = boxOf(node);
    const outside =
      box.x > view.maxX || box.x + box.width < view.minX || box.y > view.maxY || box.y + box.height < view.minY;
    if (outside) continue;

    boxes.push(box);
    if (boxes.length >= MAX_CANDIDATES) break;
  }
  return boxes;
}

/**
 * Every module boundary of a grid, in world coordinates.
 *
 * A grid is a set of places to put things, so its own edges are the most
 * useful measure on the board -- lining a card up with a column is the entire
 * point of having drawn the column.
 *
 * ## Cached on the node object
 *
 * This runs inside a drag, once per pointer move, for every grid in view --
 * and `gridCellsOf` is a full layout pass plus a styling pass. The renderer
 * memoises it for exactly this reason: the answer does not change while
 * something *else* is being dragged, and recomputing a hundred and forty-four
 * modules forty times a second to get the same numbers back is most of a
 * frame.
 *
 * A `WeakMap` keyed on the node gives the right invalidation for nothing:
 * the CRDT boundary produces a fresh node object whenever a grid changes, so
 * a changed grid misses the cache and an unchanged one hits it, with no key
 * to compose and nothing to remember to bump. Entries die with the node.
 */
const gridEdgeCache = new WeakMap<GridNode, { x: number[]; y: number[] }>();

function gridGuideEdges(node: GridNode): { x: number[]; y: number[] } {
  const cached = gridEdgeCache.get(node);
  if (cached) return cached;

  // The box itself, then every module inside it. Sets rather than arrays:
  // adjacent modules share an edge, and a regular grid would otherwise offer
  // the same number once per track.
  const xSet = new Set<number>([node.x, node.x + node.width]);
  const ySet = new Set<number>([node.y, node.y + node.height]);

  // No `try` around this. `layoutGrid` is total by construction -- every spec
  // produces some grid, including degenerate ones -- and `normalizeRecipe`
  // guarantees the recipe is complete before a node reaches here. Catching
  // would only hide the day one of those two stops being true.
  for (const cell of gridCellsOf(node)) {
    xSet.add(node.x + cell.x);
    xSet.add(node.x + cell.x + cell.width);
    ySet.add(node.y + cell.y);
    ySet.add(node.y + cell.y + cell.height);
  }

  const edges = { x: Array.from(xSet), y: Array.from(ySet) };
  gridEdgeCache.set(node, edges);
  return edges;
}

/**
 * Every measure edge on screen, from the frames and grids that carry one.
 *
 * Objects being dragged are skipped: an object cannot align to a measure that
 * is moving with it, which is the same rule the object candidates follow.
 */
function visibleGuideEdges(excluded: Set<string>): { x: number[]; y: number[] } {
  const objects = useStore.getState().objects;
  const view = cameraSystem.getViewportBounds(0);
  const x: number[] = [];
  const y: number[] = [];

  for (const node of Object.values(objects)) {
    if (node.hidden || excluded.has(node.id)) continue;
    if (node.x > view.maxX || node.x + node.width < view.minX) continue;
    if (node.y > view.maxY || node.y + node.height < view.minY) continue;

    if (node.type === 'frame' && node.layoutGuide) {
      const edges = guideEdges(node, node.layoutGuide);
      x.push(...edges.x);
      y.push(...edges.y);
    } else if (node.type === 'grid') {
      const edges = gridGuideEdges(node);
      x.push(...edges.x);
      y.push(...edges.y);
    }
  }
  return { x, y };
}

/**
 * Snap a dragged object's world-space top-left, publishing the guides.
 *
 * Returns the corrected position. Suppressed while the grid-snap modifier is
 * held, which is the established way in this app — and in every other — to say
 * "let me put it exactly where I am pointing".
 */
export function snapDraggedBox(
  nodeId: string,
  box: Box,
  alsoMoving?: readonly string[]
): { x: number; y: number } {
  if (gridSnap.isModifierHeld) {
    guideState.clear();
    lastSnap = null;
    return { x: box.x, y: box.y };
  }

  // Konva may call `dragBoundFunc` again with the position this function just
  // returned. Snapping is *usually* idempotent — once aligned, the correction
  // is zero — but not always: landing on one candidate can bring a different
  // one into range, and the two can then trade the object back and forth
  // forever inside a single frame. Recognising our own output and returning it
  // unchanged breaks that without weakening the snap itself.
  if (lastSnap && Math.abs(box.x - lastSnap.x) < SETTLED && Math.abs(box.y - lastSnap.y) < SETTLED) {
    return { x: lastSnap.x, y: lastSnap.y };
  }

  const excluded = new Set<string>([nodeId, ...(alsoMoving ?? [])]);
  const candidates = candidatesFor(excluded);
  // A guide is the most deliberate alignment target on the board — somebody
  // put it there on purpose — so it snaps like any other edge. Expressed as a
  // zero-width box on its own axis, which is exactly what a guide is, rather
  // than as a special case threaded through the arithmetic.
  const xCandidates = [...candidates];
  const yCandidates = [...candidates];

  for (const guide of readGuides()) {
    if (guide.axis === 'x') {
      xCandidates.push({ x: guide.position, y: box.y, width: 0, height: box.height });
    } else {
      yCandidates.push({ x: box.x, y: guide.position, width: box.width, height: 0 });
    }
  }

  /**
   * A frame's column measure and a grid's modules, as more of the same.
   *
   * A layout guide exists to be lined up against -- that is the entire
   * difference between it and the safe area, which is drawn and deliberately
   * snaps to nothing. So its edges join the candidate list as zero-width
   * boxes, exactly as a ruler guide does, and the arithmetic downstream never
   * learns that layout guides exist.
   *
   * Restricted to what is in view for the reason the object candidates are:
   * snapping to something you cannot see produces a jump with its explanation
   * drawn off-screen.
   *
   * The moving object's own frame is included, which is the case that matters
   * most -- placing a block on the measure of the frame it already sits in is
   * what a column guide is *for*.
   *
   * A column edge is an `x` and a row edge is a `y`, and the two candidate
   * lists are what keep them apart: a single list let a block's left side
   * snap to a horizontal band, which reads as a bug in the snapper rather
   * than in the guide.
   */
  const measure = visibleGuideEdges(excluded);
  for (const edge of measure.x) {
    xCandidates.push({ x: edge, y: box.y, width: 0, height: box.height });
  }
  for (const edge of measure.y) {
    yCandidates.push({ x: box.x, y: edge, width: box.width, height: 0 });
  }

  const tol = SNAP_PX / (cameraSystem.zoom || 1);
  const snapX = snapToObjects(box, xCandidates, tol);
  const snapY = snapToObjects(box, yCandidates, tol);

  const result = {
    dx: snapX.dx,
    dy: snapY.dy,
    guides: [
      ...snapX.guides.filter((g) => g.orientation === 'vertical'),
      ...snapY.guides.filter((g) => g.orientation === 'horizontal'),
    ],
  };

  guideState.set(result.guides);
  lastSnap = { x: box.x + result.dx, y: box.y + result.dy };
  return lastSnap;
}

/** End of drag: the guides explained a gesture that is over. */
export function clearSnapGuides(): void {
  guideState.clear();
  lastSnap = null;
}
