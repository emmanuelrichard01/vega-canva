import { gridCellsOf } from '../../../engine/grid/gridNode';
import { isSlottable } from '../../../engine/grid/gridReflow';
import type { AnyNode, GridNode } from '../../../engine/model/schema';

/**
 * How many of a grid's members have no module in its current arrangement,
 * without a layout and a filtered board scan on every store update.
 *
 * Two memos. The slot index (grid id to the cells its members claim) is built
 * once per objects map, however many subscribers ask, so a board edit costs
 * one light pass rather than one per rail render. The grid's module indices are
 * kept per grid node, so the layout only runs again when the grid itself
 * changes. Same answer as `gridContent(...).parked`.
 */

type SlotIndex = Map<string, number[]>;

const slotIndexes = new WeakMap<Record<string, AnyNode>, SlotIndex>();
const moduleIndexes = new WeakMap<GridNode, Set<number>>();

function slotIndexOf(objects: Record<string, AnyNode>): SlotIndex {
  let index = slotIndexes.get(objects);
  if (index) return index;
  index = new Map();
  for (const id in objects) {
    const node = objects[id];
    if (!isSlottable(node)) continue;
    const slot = node.gridSlot;
    if (!slot) continue;
    const cells = index.get(slot.gridId);
    if (cells) cells.push(slot.cell);
    else index.set(slot.gridId, [slot.cell]);
  }
  slotIndexes.set(objects, index);
  return index;
}

function modulesOf(grid: GridNode): Set<number> {
  let modules = moduleIndexes.get(grid);
  if (!modules) {
    modules = new Set(gridCellsOf(grid).map((c) => c.index));
    moduleIndexes.set(grid, modules);
  }
  return modules;
}

export function parkedCount(objects: Record<string, AnyNode>, gridId: string): number {
  const grid = objects[gridId];
  if (!grid || grid.type !== 'grid') return 0;
  const cells = slotIndexOf(objects).get(gridId);
  if (!cells || cells.length === 0) return 0;
  const modules = modulesOf(grid);
  let parked = 0;
  for (const cell of cells) if (!modules.has(cell)) parked += 1;
  return parked;
}
