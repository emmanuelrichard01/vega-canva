import { tidyUp } from '../../../engine/model/align';
import { nodeBounds, selectionBounds, type NodePatch } from '../../../engine/model/selection';
import type { AnyNode } from '../../../engine/model/schema';

const DEFAULT_GAP = 24;
const MIN_GAP = 8;
const MAX_GAP = 96;

/** Things a tidy moves: not connectors, which follow their ends, and not locked objects. */
export function tidyable(nodes: readonly AnyNode[]): AnyNode[] {
  return nodes.filter((n) => n.type !== 'connector' && n.type !== 'comment' && !n.locked);
}

type Item = { node: AnyNode; box: { x: number; y: number; width: number; height: number } };

/**
 * Rows, read the way the selection already sits: an object joins a row when
 * its vertical centre falls inside the row's band.
 */
export function inferRows(nodes: readonly AnyNode[]): Item[][] {
  const items: Item[] = nodes
    .map((node) => ({ node, box: nodeBounds(node) }))
    .sort((a, b) => a.box.y + a.box.height / 2 - (b.box.y + b.box.height / 2));
  const rows: { top: number; bottom: number; items: Item[] }[] = [];
  for (const item of items) {
    const centre = item.box.y + item.box.height / 2;
    const row = rows.find((r) => centre >= r.top && centre <= r.bottom);
    if (row) {
      row.items.push(item);
      row.top = Math.min(row.top, item.box.y);
      row.bottom = Math.max(row.bottom, item.box.y + item.box.height);
    } else {
      rows.push({ top: item.box.y, bottom: item.box.y + item.box.height, items: [item] });
    }
  }
  return rows.map((r) => r.items.sort((a, b) => a.box.x - b.box.x));
}

/** The gap people were already using: the median space between neighbours in a row, kept sensible. */
export function inferGap(rows: Item[][]): number {
  const gaps: number[] = [];
  for (const row of rows) {
    for (let i = 1; i < row.length; i++) {
      const g = row[i].box.x - (row[i - 1].box.x + row[i - 1].box.width);
      if (g > 0) gaps.push(g);
    }
  }
  if (gaps.length === 0) return DEFAULT_GAP;
  gaps.sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];
  return Math.round(Math.min(MAX_GAP, Math.max(MIN_GAP, median)));
}

/**
 * Tidy up: the mess, made into the rows it was already trying to be.
 *
 * One row packs left to right; one column packs top to bottom. Anything else
 * keeps its rows, packs each one at one gap from the selection's left edge,
 * centres each object in its row, and stacks the rows at the same gap. All of
 * it is measured on the rendered box, so rotated objects line up by what is
 * seen. Returns patches, so the whole tidy is one undo step.
 */
export function tidySelection(nodes: readonly AnyNode[]): NodePatch[] {
  const movable = tidyable(nodes);
  if (movable.length < 2) return [];
  const rows = inferRows(movable);
  const gap = inferGap(rows);
  if (rows.length === 1) return tidyUp(movable, 'horizontal', gap);
  if (rows.every((r) => r.length === 1)) return tidyUp(movable, 'vertical', gap);

  const box = selectionBounds(movable);
  if (!box) return [];
  const patches: NodePatch[] = [];
  let top = box.y;
  for (const row of rows) {
    const height = Math.max(...row.map((i) => i.box.height));
    let x = box.x;
    for (const item of row) {
      const targetY = top + (height - item.box.height) / 2;
      const dx = x - item.box.x;
      const dy = targetY - item.box.y;
      const changes: Record<string, unknown> = {};
      if (Math.abs(dx) > 1e-6) changes.x = item.node.x + dx;
      if (Math.abs(dy) > 1e-6) changes.y = item.node.y + dy;
      if (Object.keys(changes).length > 0) patches.push({ id: item.node.id, changes });
      x += item.box.width + gap;
    }
    top += height + gap;
  }
  return patches;
}
