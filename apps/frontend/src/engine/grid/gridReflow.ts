import { isOpenShape, type AnyNode, type GridNode, type ImageNode, type TextNode } from '../model/schema';
import { coverCrop, parkedCell, slotBox, type GridSlot } from './gridSlot';
import { gridCellsOf } from './gridNode';
import { paddingOf, type CellAlign, type CellAlignAxis } from './gridLayout';
import { cornerRadiiOf } from '../model/cornerRadii';
import { layoutText } from '../text/layout';
import { measurerFor } from '../text/measure';
import { SLOTTABLE_TYPES } from './slottable';

/**
 * Keeping content on its modules.
 *
 * A grid's modules are derived from its box, so anything sitting in one has to
 * move whenever that box changes: a drag, the transformer, a nudge, a panel
 * edit, an undo, or a collaborator doing any of those. Undo and remote edits
 * have no local call site, so this is a planner run by an observer
 * (`startGridSlotSync`) rather than something every writer remembers to call.
 *
 * Everything here is pure: hand it a grid and its content, and it returns the
 * writes. Only differences are written, so every client computes the same
 * answer, the client whose change it was writes it, and a second pass over its
 * own write produces nothing.
 */

export { SLOTTABLE_TYPES } from './slottable';

export type SlottableNode = AnyNode & { gridSlot?: GridSlot };

export const isSlottable = (n: AnyNode | undefined): n is SlottableNode => {
  if (!n || !SLOTTABLE_TYPES.has(n.type)) return false;
  if (n.type === 'shape' && isOpenShape(n.geometry.kind)) return false;
  return true;
};

/** One node, and what has to change about it. Mirrors `applyNodePatches`. */
export interface ReflowPatch {
  id: string;
  changes: Record<string, unknown>;
}

/**
 * How far a number may drift before it is worth a write.
 *
 * Positions come out of trigonometry when the grid is rotated, so an
 * unchanged value can differ in its last bits. A hundredth of a unit is far
 * below anything a screen can show at any zoom.
 */
const EPSILON = 0.01;

const differs = (a: number | undefined, b: number): boolean =>
  typeof a !== 'number' || Math.abs(a - b) > EPSILON;

function cropDiffers(
  current: ImageNode['crop'],
  next: { x: number; y: number; width: number; height: number } | null
): boolean {
  if (next === null) return false; // Nothing to say; leave whatever is stored.
  if (!current) return true;
  return (
    differs(current.x, next.x) ||
    differs(current.y, next.y) ||
    differs(current.width, next.width) ||
    differs(current.height, next.height)
  );
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const STRETCH: CellAlign = { x: 'stretch', y: 'stretch' };

/** One axis of a fit: where content of size `own` sits in a run of `extent`. */
function fitAxis(extent: number, own: number, align: CellAlignAxis): { at: number; size: number } {
  if (align === 'stretch') return { at: 0, size: extent };
  const size = Math.max(1, Math.min(extent, own));
  if (align === 'start') return { at: 0, size };
  if (align === 'end') return { at: extent - size, size };
  return { at: (extent - size) / 2, size };
}

/**
 * The box a node takes inside its module, in the grid's own coordinates.
 *
 * - Pictures cover the module and text fills it, whatever the alignment: the
 *   crop and the text box are how they adapt, so there is nothing to align.
 * - A sticky stays square. It is the one object whose shape is its identity.
 * - Audio keeps its own height: the player is a fixed-height control.
 * - Everything else fills the module on a stretched axis, and keeps its own
 *   size (clamped to the module) on an aligned one.
 *
 * Exported for the panel and the drop preview, which show where content will
 * land before it does.
 */
export function fitInCell(node: SlottableNode, cell: Box, align: CellAlign = STRETCH): Box {
  if (node.type === 'image' || node.type === 'text') return { ...cell };

  if (node.type === 'sticky') {
    const side = Math.max(1, Math.min(cell.width, cell.height));
    const ax = align.x === 'stretch' ? 'center' : align.x;
    const ay = align.y === 'stretch' ? 'center' : align.y;
    const x = fitAxis(cell.width, side, ax);
    const y = fitAxis(cell.height, side, ay);
    return { x: cell.x + x.at, y: cell.y + y.at, width: side, height: side };
  }

  const ay = node.type === 'audio' && align.y === 'stretch' ? 'center' : align.y;
  const x = fitAxis(cell.width, node.width, align.x);
  const y = fitAxis(cell.height, node.height, ay);
  return { x: cell.x + x.at, y: cell.y + y.at, width: x.size, height: y.size };
}

/** The changes that put one node on one box (grid-local), or none if it is there already. */
function placeChanges(
  grid: GridNode,
  node: SlottableNode,
  local: Box,
  module: { radius: number; outline?: unknown } | null,
  slot: GridSlot
): Record<string, unknown> {
  const box = slotBox(grid, local);
  const changes: Record<string, unknown> = {};
  if (differs(node.x, box.x)) changes.x = box.x;
  if (differs(node.y, box.y)) changes.y = box.y;
  if (differs(node.width, box.width)) changes.width = box.width;
  if (differs(node.height, box.height)) changes.height = box.height;
  if (differs(node.rotation, box.rotation)) changes.rotation = box.rotation;

  if (node.type === 'image') {
    // Re-covered, not merely resized: a module that changed proportions would
    // otherwise stretch the picture. `coverCrop` returns null until the
    // bitmap's natural size is known, which leaves the stored crop alone.
    const natural = { width: node.naturalWidth ?? 0, height: node.naturalHeight ?? 0 };
    const crop = coverCrop(local, natural, slot);
    if (cropDiffers(node.crop, crop)) changes.crop = crop ?? undefined;
    // A rounded module rounds the picture in it; a parked one keeps its own.
    const radius = module ? (module.outline ? 0 : module.radius) : null;
    if (radius !== null && differs(cornerRadiiOf(node.appearance?.cornerRadius)[0], radius)) {
      changes.appearance = { ...(node.appearance ?? {}), cornerRadius: radius };
    }
  } else if (node.type === 'text') {
    // The module decides a caption's box, so the box must not follow the text.
    if (node.resize !== 'fixed') changes.resize = 'fixed';
  }
  return changes;
}

/**
 * What has to change for everything in one grid.
 *
 * Content whose module no longer exists (the grid was given fewer modules, or
 * a kind with a different count) is parked in a strip below the grid rather
 * than released, so cycling through arrangements never costs anyone their
 * content. Parked order follows the module each one came from, so restoring
 * the old arrangement restores the old order.
 */
export function planGridReflow(grid: GridNode, contents: readonly SlottableNode[]): ReflowPatch[] {
  const cells = gridCellsOf(grid);
  const byIndex = new Map(cells.map((c) => [c.index, c]));
  const align = grid.grid.spec.contentAlign ?? STRETCH;
  const patches: ReflowPatch[] = [];

  const mine = contents.filter((n) => n.gridSlot?.gridId === grid.id);
  const parked = mine
    .filter((n) => !byIndex.has(n.gridSlot!.cell))
    .sort((a, b) => a.gridSlot!.cell - b.gridSlot!.cell || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const parkedOrdinal = new Map(parked.map((n, i) => [n.id, i]));

  for (const node of mine) {
    const slot = node.gridSlot!;
    const cell = byIndex.get(slot.cell);
    const changes = cell
      ? placeChanges(grid, node, fitInCell(node, cell, align), cell, slot)
      : placeChanges(
          grid,
          node,
          parkedCell(parkedOrdinal.get(node.id) ?? 0, grid),
          null,
          slot
        );
    if (Object.keys(changes).length > 0) patches.push({ id: node.id, changes });
  }

  return patches;
}

// ---------------------------------------------------------------------------
// Hug rows
// ---------------------------------------------------------------------------

/** The height a row is given when nothing in it has a height of its own. */
export const HUG_EMPTY_ROW = 48;

/** A text node's height when its lines are laid out at `width`. */
export function textHeightAt(node: TextNode, width: number): number {
  const t = node.typography;
  const layout = layoutText({
    text: node.text ?? '',
    wrap: 'word',
    width: Math.max(1, width),
    fontSize: t.fontSize,
    lineHeight: t.lineHeight,
    letterSpacing: t.letterSpacing,
    align: t.align,
    measure: measurerFor(t),
  });
  return Math.max(t.fontSize * t.lineHeight, layout.height);
}

/**
 * How tall a node wants to be in a module `width` wide, or nothing when it
 * has no height of its own there.
 *
 * Only content with an intrinsic height can push a row: text (its laid-out
 * lines), a sticky (it is square), a table (its rows). Anything stretched on
 * the vertical axis takes the row's height rather than setting it.
 */
export function intrinsicHeight(
  node: SlottableNode,
  width: number,
  align: CellAlign,
  measureText: (node: TextNode, width: number) => number = textHeightAt
): number | null {
  switch (node.type) {
    case 'text':
      return measureText(node, width);
    case 'sticky':
      return width;
    case 'table':
      return node.height;
    case 'image':
      return null;
    default:
      return align.y === 'stretch' ? null : node.height;
  }
}

/**
 * For a grid that hugs its content, the row sizes and the grid height that fit
 * it. Returns the updated grid (for the content pass to lay out against) and
 * the patch that writes it, or `null` for both when nothing changes.
 *
 * Only `columns` and `modular` hug: they are the kinds with real rows. The
 * measured heights are written into `tracks.rows` as fixed sizes, so every
 * reader (renderer, exporter, hit-test) lays out the same grid without
 * measuring anything.
 */
export function planHugRows(
  grid: GridNode,
  contents: readonly SlottableNode[],
  measureText?: (node: TextNode, width: number) => number
): { grid: GridNode; patch: ReflowPatch } | null {
  const spec = grid.grid.spec;
  if (spec.sizing !== 'hug' || (spec.kind !== 'columns' && spec.kind !== 'modular')) return null;

  const nRows = spec.kind === 'columns' ? 1 : Math.max(1, Math.floor(spec.rows));
  const align = spec.contentAlign ?? STRETCH;
  const cells = gridCellsOf(grid);
  const byIndex = new Map(cells.map((c) => [c.index, c]));

  // The rows' current sizes, so an empty row keeps the height it has.
  const current: number[] = new Array(nRows).fill(HUG_EMPTY_ROW);
  for (const c of cells) {
    const span = spec.spans?.[`${c.row}:${c.col}`];
    if ((span?.rows ?? 1) === 1) current[c.row] = c.height;
  }

  const wanted: (number | null)[] = new Array(nRows).fill(null);
  for (const node of contents) {
    if (node.gridSlot?.gridId !== grid.id) continue;
    const cell = byIndex.get(node.gridSlot.cell);
    if (!cell) continue;
    const span = spec.spans?.[`${cell.row}:${cell.col}`];
    if ((span?.rows ?? 1) !== 1) continue; // A tall module does not size one row.
    const h = intrinsicHeight(node, cell.width, align, measureText);
    if (h === null || !Number.isFinite(h)) continue;
    wanted[cell.row] = Math.max(wanted[cell.row] ?? 0, h);
  }

  const rows = wanted.map((h, i) => Math.max(1, Math.ceil(h ?? current[i] ?? HUG_EMPTY_ROW)));
  const pad = paddingOf(spec);
  const height = pad.top + pad.bottom + rows.reduce((a, b) => a + b, 0) + spec.gutterY * (nRows - 1);

  const previous = spec.tracks?.rows ?? [];
  const sameRows =
    previous.length === nRows &&
    previous.every((t, i) => typeof t === 'object' && 'px' in t && !differs(t.px, rows[i]));
  if (sameRows && !differs(grid.height, height)) return null;

  const nextSpec = {
    ...spec,
    height,
    tracks: { ...(spec.tracks ?? {}), rows: rows.map((px) => ({ px })) },
  };
  const nextGrid: GridNode = { ...grid, height, grid: { ...grid.grid, spec: nextSpec } };
  return {
    grid: nextGrid,
    patch: { id: grid.id, changes: { height, grid: nextGrid.grid } },
  };
}

/**
 * Everything one grid needs: the hug pass (which may change the grid), then
 * the content pass against the grid as it will be.
 */
export function planGridUpdate(
  grid: GridNode,
  contents: readonly SlottableNode[],
  measureText?: (node: TextNode, width: number) => number
): ReflowPatch[] {
  const hug = planHugRows(grid, contents, measureText);
  const target = hug?.grid ?? grid;
  const content = planGridReflow(target, contents);
  return hug ? [hug.patch, ...content] : content;
}

/**
 * Content whose grid is gone.
 *
 * Only ever called with a grid id the caller **watched being deleted**, never
 * one it merely failed to find: on a document that is still syncing, content
 * can load before its grid, and releasing it then would dismantle every grid
 * on the board during the first second of every session.
 */
export function planSlotRelease(
  gridIds: ReadonlySet<string>,
  nodes: readonly SlottableNode[]
): ReflowPatch[] {
  if (gridIds.size === 0) return [];
  return nodes
    .filter((node) => node.gridSlot && gridIds.has(node.gridSlot.gridId))
    .map((node) => ({ id: node.id, changes: { gridSlot: undefined } }));
}
