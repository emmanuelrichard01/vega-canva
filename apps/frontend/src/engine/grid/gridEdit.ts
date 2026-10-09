import { applyNodePatches, doc, updateNode } from '../document';
import { useStore } from '../../hooks/useStore';
import type { AnyNode, GridNode } from '../model/schema';
import { gridCellsOf } from './gridNode';
import { isSlottable, type ReflowPatch } from './gridReflow';
import type { GridRecipe } from './gridBuild';
import type { GridSpec, GridTrack } from './gridLayout';
import { mergeSpans, spansFromModules, splitSpan, MAX_TRACKS } from './gridTracks';
import type { CellBlock } from './gridEditMode';
import { MIN_TRACK, recipeWithTrackSizes, resolveBorderDrag, trackRuns } from './gridTrackDrag';

/**
 * Editing a grid's modules and tracks directly.
 *
 * Only the regular kinds have rows and columns to edit. A bento grid is
 * pinned first: its seeded compartments become explicit spans on a modular
 * grid, which draws the same picture, so the first edit changes one module
 * instead of reshuffling them all.
 */

export const EDITABLE_KINDS: ReadonlySet<GridSpec['kind']> = new Set(['columns', 'modular', 'bento']);

export const canEditCells = (kind: GridSpec['kind']): boolean => EDITABLE_KINDS.has(kind);

type Axis = 'cols' | 'rows';

const isGrid = (n: AnyNode | undefined): n is GridNode => n?.type === 'grid';

function trackCount(spec: GridSpec, axis: Axis): number {
  if (axis === 'cols') return Math.max(1, Math.floor(spec.columns));
  return spec.kind === 'columns' ? 1 : Math.max(1, Math.floor(spec.rows));
}

/**
 * The current track sizes on one axis.
 *
 * Read from the layout's own track arithmetic (`trackRuns`), not off modules:
 * a merged module spans several tracks and says nothing about any one of them,
 * and reading modules gave a track covered only by merged modules a made-up
 * average size, which then moved the border handles to the wrong place.
 */
export function currentTrackSizes(node: GridNode, axis: Axis): number[] {
  return trackRuns(node, axis).map((t) => t.size);
}

/**
 * The recipe with one track changed. Every other track on the axis is pinned
 * to its current size as a share, so changing one track never redistributes
 * the others (which a jittered axis would otherwise do).
 */
export function withTrack(node: GridNode, axis: Axis, index: number, track: GridTrack): GridRecipe {
  const spec = node.grid.spec;
  const n = trackCount(spec, axis);
  if (index < 0 || index >= n) return node.grid;
  const existing = spec.tracks?.[axis];
  const sizes = currentTrackSizes(node, axis);
  const tracks: GridTrack[] = Array.from({ length: n }, (_, i) => existing?.[i] ?? { fr: Math.max(1, Math.round(sizes[i])) });
  tracks[index] = track;
  return { ...node.grid, spec: { ...spec, tracks: { ...(spec.tracks ?? {}), [axis]: tracks } } };
}

/**
 * Two neighbouring tracks after dragging the border between them by `delta`.
 *
 * The pair keeps its combined size, so nothing else moves: the border slides
 * and the tracks either side trade space. Each side keeps a minimum of `min`.
 * The maths, and the Shift and Alt variants, live in `gridTrackDrag.ts`.
 */
export function withBorderMoved(node: GridNode, axis: Axis, index: number, delta: number, min = MIN_TRACK): GridRecipe {
  const n = trackCount(node.grid.spec, axis);
  if (index < 0 || index + 1 >= n) return node.grid;
  // A non-finite delta (a pointer that left the window) moves nothing.
  if (!Number.isFinite(delta)) return node.grid;
  const { sizes } = resolveBorderDrag({ sizes: currentTrackSizes(node, axis), index, delta, min });
  return recipeWithTrackSizes(node.grid, axis, sizes);
}

/** Back to even tracks on one axis. */
export function withEvenTracks(node: GridNode, axis: Axis): GridRecipe {
  const spec = node.grid.spec;
  const tracks = { ...(spec.tracks ?? {}) };
  delete tracks[axis];
  const next: GridSpec = { ...spec, tracks: tracks.cols || tracks.rows ? tracks : undefined };
  if (!next.tracks) delete next.tracks;
  return { ...node.grid, spec: next };
}

/**
 * For each piece of content, the module it should name after the grid is
 * re-laid as `nextCells`, matched by the anchor's row and column. Content
 * whose module has no counterpart keeps its number (and waits below the grid).
 */
export function remapSlots(
  before: readonly { index: number; row: number; col: number }[],
  after: readonly { index: number; row: number; col: number }[],
  content: readonly { id: string; cell: number }[]
): ReflowPatch[] {
  const byPosition = new Map(after.map((c) => [`${c.row}:${c.col}`, c.index]));
  const oldById = new Map(before.map((c) => [c.index, c]));
  const out: ReflowPatch[] = [];
  for (const item of content) {
    const old = oldById.get(item.cell);
    if (!old) continue;
    const next = byPosition.get(`${old.row}:${old.col}`);
    if (next !== undefined && next !== item.cell) out.push({ id: item.id, changes: { cell: next } });
  }
  return out;
}

/** A bento grid as an equivalent modular grid with explicit spans. */
export function pinnedRecipe(node: GridNode): GridRecipe {
  const spec = node.grid.spec;
  if (spec.kind !== 'bento') return node.grid;
  const cells = gridCellsOf(node);
  const nCols = Math.max(1, Math.floor(spec.columns));
  const nRows = Math.max(1, Math.floor(spec.rows));
  const colStep = cells.length > 0 ? cells.reduce((min, c) => Math.min(min, c.width), Infinity) : 1;
  const rowStep = cells.length > 0 ? cells.reduce((min, c) => Math.min(min, c.height), Infinity) : 1;
  const modules = cells.map((c) => ({
    row: c.row,
    col: c.col,
    cols: Math.max(1, Math.min(nCols - c.col, Math.round((c.width + spec.gutterX) / (colStep + spec.gutterX)))),
    rows: Math.max(1, Math.min(nRows - c.row, Math.round((c.height + spec.gutterY) / (rowStep + spec.gutterY)))),
  }));
  return {
    ...node.grid,
    spec: { ...spec, kind: 'modular', variation: 0, spans: spansFromModules(modules) },
  };
}

function contentIn(objects: Record<string, AnyNode>, gridId: string): { id: string; cell: number }[] {
  const out: { id: string; cell: number }[] = [];
  for (const node of Object.values(objects)) {
    if (isSlottable(node) && node.gridSlot?.gridId === gridId) out.push({ id: node.id, cell: node.gridSlot.cell });
  }
  return out;
}

/**
 * Write a new recipe and renumber the content so everything stays in the
 * module it was in. One transaction, so one undo step.
 */
function commitRecipe(
  node: GridNode,
  recipe: GridRecipe,
  box?: { x: number; y: number; width: number; height: number }
): void {
  const objects = useStore.getState().objects;
  const before = gridCellsOf(node).map((c) => ({ index: c.index, row: c.row, col: c.col }));
  const width = box?.width ?? node.width;
  const height = box?.height ?? node.height;
  const nextNode: GridNode = { ...node, width, height, grid: recipe };
  const after = gridCellsOf(nextNode).map((c) => ({ index: c.index, row: c.row, col: c.col }));
  const moves = remapSlots(before, after, contentIn(objects, node.id)).map((m) => {
    const current = objects[m.id] as AnyNode & { gridSlot?: { gridId: string; cell: number } };
    return { id: m.id, changes: { gridSlot: { ...current.gridSlot!, cell: m.changes.cell as number } } };
  });
  doc.transact(() => {
    updateNode(node.id, {
      ...(box ? { x: box.x, y: box.y, width, height } : null),
      grid: { ...recipe, spec: { ...recipe.spec, x: 0, y: 0, width, height } },
    });
    if (moves.length > 0) applyNodePatches(moves);
  });
}

function gridOf(gridId: string): GridNode | null {
  const node = useStore.getState().objects[gridId];
  return isGrid(node) && !node.locked ? node : null;
}

/** Turn a bento grid into its pinned equivalent before an edit. Returns the node to edit. */
function editable(gridId: string): GridNode | null {
  const node = gridOf(gridId);
  if (!node || !canEditCells(node.grid.spec.kind)) return null;
  if (node.grid.spec.kind !== 'bento') return node;
  const recipe = pinnedRecipe(node);
  commitRecipe(node, recipe);
  return { ...node, grid: recipe };
}

/** Merge a block of modules into one. */
export function mergeCells(gridId: string, block: CellBlock): void {
  if (block.rows <= 1 && block.cols <= 1) return;
  // Pinning a bento grid and the edit are one transaction, so one undo step.
  doc.transact(() => {
    const node = editable(gridId);
    if (!node) return;
    const spans = mergeSpans(node.grid.spec.spans, block);
    commitRecipe(node, { ...node.grid, spec: { ...node.grid.spec, spans } });
  });
}

/** Split whatever module is anchored at the block's corner back into single modules. */
export function splitCells(gridId: string, block: CellBlock): void {
  doc.transact(() => splitIn(gridId, block));
}

function splitIn(gridId: string, block: CellBlock): void {
  const node = editable(gridId);
  if (!node) return;
  let spans = node.grid.spec.spans;
  // Every span anchored inside the block goes.
  for (const key of Object.keys(spans ?? {})) {
    const [r, c] = key.split(':').map(Number);
    if (r >= block.row && r < block.row + block.rows && c >= block.col && c < block.col + block.cols) {
      spans = splitSpan(spans, r, c);
    }
  }
  commitRecipe(node, { ...node.grid, spec: { ...node.grid.spec, spans } });
}

/** Set one track's sizing. */
export function setTrack(gridId: string, axis: Axis, index: number, track: GridTrack): void {
  doc.transact(() => {
    const node = editable(gridId);
    if (node) commitRecipe(node, withTrack(node, axis, index, track));
  });
}

/** Slide the border between track `index` and `index + 1`. */
export function moveTrackBorder(gridId: string, axis: Axis, index: number, delta: number): void {
  doc.transact(() => {
    const node = editable(gridId);
    if (node) commitRecipe(node, withBorderMoved(node, axis, index, delta));
  });
}

/**
 * Write one axis's track sizes, as a border drag resolved them. One
 * transaction (bento pinning included), so the whole drag is one undo step.
 *
 * `growth` is how much the grid grows along the axis (an Alt drag). The grid
 * grows from its leading edge outward: the corner before the axis stays where
 * it is on the board, turned or not, so the grid never appears to move.
 */
export function commitTrackSizes(gridId: string, axis: Axis, sizes: readonly number[], growth = 0): void {
  doc.transact(() => {
    const node = editable(gridId);
    if (!node) return;
    const recipe = recipeWithTrackSizes(node.grid, axis, sizes);
    const box = Number.isFinite(growth) && Math.abs(growth) > 0.01 ? grownBox(node, axis, growth) : undefined;
    commitRecipe(node, recipe, box);
  });
}

/** The grid's box after growing `growth` along one axis, top-left corner pinned on the board. */
export function grownBox(
  node: Pick<GridNode, 'x' | 'y' | 'width' | 'height' | 'rotation'>,
  axis: Axis,
  growth: number
): { x: number; y: number; width: number; height: number } {
  const width = Math.max(1, node.width + (axis === 'cols' ? growth : 0));
  const height = Math.max(1, node.height + (axis === 'rows' ? growth : 0));
  const r = ((node.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  // Rotation is about the centre. The board position of the top-left corner:
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  const hx = -node.width / 2;
  const hy = -node.height / 2;
  const corner = { x: cx + hx * cos - hy * sin, y: cy + hx * sin + hy * cos };
  // The new centre puts the new top-left corner on the same point.
  const nx = width / 2;
  const ny = height / 2;
  const ncx = corner.x + nx * cos - ny * sin;
  const ncy = corner.y + nx * sin + ny * cos;
  return { x: ncx - width / 2, y: ncy - height / 2, width, height };
}

/** Make every track on an axis even again. */
export function resetTracks(gridId: string, axis: Axis): void {
  const node = gridOf(gridId);
  if (node) commitRecipe(node, withEvenTracks(node, axis));
}

/**
 * Add or remove a track at the end of an axis.
 *
 * Track counts change the identity of every module after the first row
 * (identity is row-major), so content is renumbered by position like any
 * other edit, and spans that no longer fit are clamped by the layout.
 */
export function setTrackCount(gridId: string, axis: Axis, count: number): void {
  const node = gridOf(gridId);
  if (!node) return;
  const n = Math.max(1, Math.min(MAX_TRACKS, Math.round(count)));
  const spec = node.grid.spec;
  const tracks = spec.tracks?.[axis];
  const nextTracks = tracks
    ? Array.from({ length: n }, (_, i): GridTrack => tracks[i] ?? { fr: 1 })
    : undefined;
  const nextSpec: GridSpec = {
    ...spec,
    ...(axis === 'cols' ? { columns: n } : { rows: n }),
    ...(nextTracks ? { tracks: { ...(spec.tracks ?? {}), [axis]: nextTracks } } : null),
  };
  commitRecipe(node, { ...node.grid, spec: nextSpec });
}
