import type { GridNode, TextNode } from '../model/schema';
import type { GridRecipe } from './gridBuild';
import { regularTrackRuns, type GridTrack } from './gridLayout';
import { gridCellsOf, gridSpecFor } from './gridNode';
import { textHeightAt, type SlottableNode } from './gridReflow';
import { layoutText } from '../text/layout';
import { measurerFor } from '../text/measure';

/**
 * Resizing a grid's tracks by dragging the border between two of them.
 *
 * The maths of the Edit cells border drag, kept pure so it can be tested
 * without a board. The overlay (`GridEditOverlay`) turns pointer movement into
 * a `delta` and a mode; this answers "what are the track sizes now", and
 * `gridEdit.commitTrackSizes` writes the answer in one transaction.
 *
 * ## The three modes
 *
 * Every spreadsheet and layout tool settled on the same small grammar, and it
 * is the one people already have in their hands:
 *
 * - **Drag**: the two tracks either side of the border trade space. Nothing
 *   else moves and the grid keeps its size, which is what a border *is*.
 * - **Shift-drag**: the track before the border takes the new size and every
 *   other track on the axis shares what is left equally. "One sidebar, the
 *   rest even" is the commonest uneven grid there is, and it was three drags.
 * - **Alt-drag**: only the track before the border changes, and the grid grows
 *   or shrinks by the difference. The tracks after it keep their size, the way
 *   a column in Excel pushes the sheet rather than squeezing its neighbour.
 *
 * Snapping, while not holding Ctrl or ⌘: to the size of another track on the
 * axis (equal tracks are the most common intent), then to round numbers.
 */

export type TrackAxis = 'cols' | 'rows';
export type BorderDragMode = 'trade' | 'equalize' | 'grow';

/** No track gets smaller than this from a drag. Board units. */
export const MIN_TRACK = 12;

/** Round sizes snap to multiples of this. Board units. */
export const ROUND_STEP = 10;

export interface TrackRun {
  /** Where the track starts, in the grid's own coordinates. */
  start: number;
  size: number;
}

/**
 * The tracks of a grid on one axis, in the grid's own coordinates.
 *
 * Read from the layout's own track arithmetic rather than off modules, so a
 * merged module (which spans several tracks) cannot hide a track's real size.
 * A bento grid is measured as the modular grid it is pinned to on its first
 * edit, which draws the same picture.
 */
export function trackRuns(node: Pick<GridNode, 'width' | 'height' | 'grid'>, axis: TrackAxis): TrackRun[] {
  const spec = gridSpecFor(node);
  if (spec.kind !== 'columns' && spec.kind !== 'modular') {
    // Bento: the pinned equivalent is regular tracks under explicit spans, so
    // the smallest module on each axis is one track and the rest are steps of it.
    return pinnedRuns(node, axis);
  }
  const runs = regularTrackRuns(spec);
  const list = axis === 'cols' ? runs.cols : runs.rows;
  const origin = axis === 'cols' ? runs.origin.x : runs.origin.y;
  return list.map((t) => ({ start: origin + t.offset, size: t.size }));
}

function pinnedRuns(node: Pick<GridNode, 'width' | 'height' | 'grid'>, axis: TrackAxis): TrackRun[] {
  const spec = node.grid.spec;
  const n = Math.max(1, Math.floor(axis === 'cols' ? spec.columns : spec.rows));
  const cells = gridCellsOf(node);
  const gutter = axis === 'cols' ? spec.gutterX : spec.gutterY;
  const sizes = cells.map((c) => (axis === 'cols' ? c.width : c.height));
  const starts = cells.map((c) => (axis === 'cols' ? c.x : c.y));
  const step = sizes.length > 0 ? Math.min(...sizes) : 1;
  const origin = starts.length > 0 ? Math.min(...starts) : 0;
  return Array.from({ length: n }, (_, i) => ({ start: origin + i * (step + gutter), size: step }));
}

export interface BorderDragInput {
  /** Current track sizes on the axis. */
  sizes: readonly number[];
  /** The border after track `index` (between `index` and `index + 1`). */
  index: number;
  /** How far the border has been dragged, board units, along the axis. */
  delta: number;
  mode?: BorderDragMode;
  min?: number;
  /** Snap distance in board units; 0 or absent switches snapping off. */
  snap?: number;
  step?: number;
}

export interface BorderDragResult {
  sizes: number[];
  /** How much the grid grows along the axis (Alt only; 0 otherwise). */
  growth: number;
  /** What the dragged track's size snapped to, if anything. */
  snapped: 'equal' | 'round' | null;
}

/**
 * The track sizes after dragging one border.
 *
 * Never returns a non-finite or sub-minimum size, and in `trade` and
 * `equalize` the sizes always add up to what they did before, so the grid's
 * box never changes and the grid never moves.
 */
export function resolveBorderDrag(input: BorderDragInput): BorderDragResult {
  const sizes = input.sizes.map((s) => (Number.isFinite(s) && s > 0 ? s : 1));
  const { index } = input;
  const n = sizes.length;
  const unchanged: BorderDragResult = { sizes, growth: 0, snapped: null };
  if (index < 0 || index >= n || !Number.isFinite(input.delta)) return unchanged;
  const mode: BorderDragMode = input.mode ?? 'trade';
  // A border needs a track after it, except when growing: Alt on the last
  // track would simply grow the grid, which is a resize of the grid itself.
  if (index + 1 >= n) return unchanged;
  const min = input.min ?? MIN_TRACK;
  const step = input.step ?? ROUND_STEP;
  const total = sizes.reduce((a, b) => a + b, 0);
  const want = sizes[index] + input.delta;

  /** Snap `v` to the nearest candidate within `snap`, equal sizes first. */
  const snapTo = (v: number, equal: readonly number[]): { v: number; snapped: BorderDragResult['snapped'] } => {
    const radius = input.snap ?? 0;
    if (!(radius > 0)) return { v, snapped: null };
    let best: { v: number; d: number } | null = null;
    for (const c of equal) {
      const d = Math.abs(c - v);
      if (d <= radius && (!best || d < best.d)) best = { v: c, d };
    }
    if (best) return { v: best.v, snapped: 'equal' };
    const round = Math.round(v / step) * step;
    if (Math.abs(round - v) <= radius) return { v: round, snapped: 'round' };
    return { v, snapped: null };
  };

  if (mode === 'grow') {
    const others = sizes.filter((_, i) => i !== index);
    const snapped = snapTo(want, others);
    const size = Math.max(min, snapped.v);
    const next = sizes.slice();
    next[index] = size;
    return { sizes: next, growth: size - sizes[index], snapped: size === snapped.v ? snapped.snapped : null };
  }

  if (mode === 'equalize' && n > 2) {
    const floor = Math.min(min, total / n);
    const snapped = snapTo(want, [total / n]);
    const size = Math.min(total - floor * (n - 1), Math.max(floor, snapped.v));
    const rest = (total - size) / (n - 1);
    const next = sizes.map((_, i) => (i === index ? size : rest));
    return { sizes: next, growth: 0, snapped: size === snapped.v ? snapped.snapped : null };
  }

  // Trade (and Shift on a two-track axis, where it is the same thing).
  const pair = sizes[index] + sizes[index + 1];
  const floor = Math.min(min, pair / 2);
  const equal = [pair / 2, ...sizes.filter((_, i) => i !== index && i !== index + 1)];
  const snapped = snapTo(want, equal);
  const size = Math.min(pair - floor, Math.max(floor, snapped.v));
  const next = sizes.slice();
  next[index] = size;
  next[index + 1] = pair - size;
  return { sizes: next, growth: 0, snapped: size === snapped.v ? snapped.snapped : null };
}

/**
 * The recipe with an axis's tracks set to these sizes.
 *
 * Written as shares rather than pixels so the run still fills the box when the
 * grid is resized later. Normalised to a thousand across the axis, because the
 * wire format caps a single share at 1000: writing raw pixels as shares (the
 * previous approach) silently clamped any track over 1000px wide on reload.
 */
export function recipeWithTrackSizes(recipe: GridRecipe, axis: TrackAxis, sizes: readonly number[]): GridRecipe {
  const sum = sizes.reduce((a, b) => a + Math.max(0, b), 0);
  if (!(sum > 0)) return recipe;
  const tracks: GridTrack[] = sizes.map((s) => ({ fr: Math.max(0.01, Math.round((Math.max(0, s) / sum) * 1000 * 100) / 100) }));
  const spec = recipe.spec;
  return { ...recipe, spec: { ...spec, tracks: { ...(spec.tracks ?? {}), [axis]: tracks } } };
}

/** A text node's natural single-line width, the widest of its paragraphs. */
function textWidth(node: TextNode): number {
  const t = node.typography;
  const layout = layoutText({
    text: node.text ?? '',
    wrap: 'none',
    width: 100_000,
    fontSize: t.fontSize,
    lineHeight: t.lineHeight,
    letterSpacing: t.letterSpacing,
    align: 'left',
    measure: measurerFor(t),
  });
  return layout.width;
}

export interface AutoFitMeasure {
  textWidth?: (node: TextNode) => number;
  textHeight?: (node: TextNode, width: number) => number;
}

/**
 * The size a track wants for what is in it, or null when nothing in it has a
 * size of its own (an empty track, or one holding only stretched pictures).
 *
 * What double-clicking a border fits, the way a spreadsheet fits a column to
 * its widest entry. Only content sitting in a single-track module of this
 * track counts: a merged module's content belongs to several tracks at once.
 */
export function autoFitTrackSize(
  node: Pick<GridNode, 'id' | 'width' | 'height' | 'grid'>,
  axis: TrackAxis,
  index: number,
  contents: readonly SlottableNode[],
  measure: AutoFitMeasure = {}
): number | null {
  const spans = node.grid.spec.spans ?? {};
  const cells = new Map(gridCellsOf(node).map((c) => [c.index, c]));
  const measureW = measure.textWidth ?? textWidth;
  const measureH = measure.textHeight ?? textHeightAt;
  let want: number | null = null;
  for (const item of contents) {
    if (item.gridSlot?.gridId !== node.id) continue;
    const cell = cells.get(item.gridSlot.cell);
    if (!cell) continue;
    const span = spans[`${cell.row}:${cell.col}`];
    const onTrack = axis === 'cols' ? cell.col === index && (span?.cols ?? 1) === 1 : cell.row === index && (span?.rows ?? 1) === 1;
    if (!onTrack) continue;
    let size: number | null = null;
    if (item.type === 'text') {
      size = axis === 'cols' ? measureW(item) : measureH(item, cell.width);
    } else if (item.type === 'image') {
      const nw = item.naturalWidth ?? 0;
      const nh = item.naturalHeight ?? 0;
      if (nw > 0 && nh > 0) size = axis === 'cols' ? cell.height * (nw / nh) : cell.width * (nh / nw);
    } else if (item.type === 'sticky') {
      size = axis === 'cols' ? cell.height : cell.width;
    }
    if (size !== null && Number.isFinite(size) && size > 0) want = Math.max(want ?? 0, size);
  }
  return want === null ? null : Math.ceil(want);
}
