import { tidyUp } from '../model/align';
import { nodeBounds, selectionBounds, type NodePatch } from '../model/selection';
import type { AnyNode } from '../model/schema';

/**
 * Tidy up: the selection laid into the rows it was already trying to be.
 * Pure; `arrange/plans` runs it over a selection's units so a group tidies as
 * one object.
 */

const DEFAULT_GAP = 24;
const MIN_GAP = 8;
const MAX_GAP = 96;
/** An object this much taller than the row it starts in spans rows rather than belonging to one. */
const SPAN_RATIO = 1.5;

/** Things a tidy moves: not connectors, which follow their ends, and not locked objects. */
export function tidyable(nodes: readonly AnyNode[]): AnyNode[] {
  return nodes.filter((n) => n.type !== 'connector' && n.type !== 'comment' && !n.locked);
}

type Box = { x: number; y: number; width: number; height: number };
type Item = { node: AnyNode; box: Box };

/** The rows of a selection, and the objects that stand beside several of them. */
export interface RowLayout {
  rows: Item[][];
  /** Each row's band: the extent of its ordinary members, never stretched by a spanning one. */
  bands: { top: number; bottom: number }[];
  /** Objects taller than the row they start in, each kept with the row it starts in. */
  spanners: { item: Item; row: number }[];
}

/**
 * Rows, read the way the selection already sits.
 *
 * Bands are made from the ordinary objects first, shortest first, and an
 * object joins a band when its vertical centre falls inside it. An object much
 * taller than the bands it crosses (a tall card beside a 2×2 block) is not a
 * row of its own and does not widen one: it joins the row it starts in, and
 * the rows below it keep their own bands.
 */
export function layoutRows(nodes: readonly AnyNode[]): RowLayout {
  const items: Item[] = nodes.map((node) => ({ node, box: nodeBounds(node) }));
  const byHeight = [...items].sort((a, b) => a.box.height - b.box.height);
  const bands: { top: number; bottom: number; items: Item[] }[] = [];
  const tall: Item[] = [];

  for (const item of byHeight) {
    const centre = item.box.y + item.box.height / 2;
    const band = bands.find((b) => centre >= b.top && centre <= b.bottom);
    const bandHeight = band ? band.bottom - band.top : 0;
    // Taller than the band it would join, and reaching past it: it spans.
    if (band && item.box.height > bandHeight * SPAN_RATIO) {
      tall.push(item);
      continue;
    }
    // Reaching across more than one existing band: it spans those too.
    const crossed = bands.filter((b) => item.box.y < b.bottom && item.box.y + item.box.height > b.top);
    if (!band && crossed.length > 1) {
      tall.push(item);
      continue;
    }
    if (band) {
      band.items.push(item);
      band.top = Math.min(band.top, item.box.y);
      band.bottom = Math.max(band.bottom, item.box.y + item.box.height);
    } else {
      bands.push({ top: item.box.y, bottom: item.box.y + item.box.height, items: [item] });
    }
  }

  bands.sort((a, b) => a.top + a.bottom - (b.top + b.bottom));
  const spanners = tall.map((item) => {
    // The row it starts in: the first band its top edge reaches, else the nearest.
    let row = bands.findIndex((b) => item.box.y < b.bottom);
    if (row < 0) row = bands.length - 1;
    return { item, row };
  });
  const rows = bands.map((b, i) =>
    [...b.items, ...spanners.filter((s) => s.row === i).map((s) => s.item)].sort((p, q) => p.box.x - q.box.x)
  );
  return { rows, bands: bands.map(({ top, bottom }) => ({ top, bottom })), spanners };
}

/** Rows only, for callers that do not care about spanning objects. */
export function inferRows(nodes: readonly AnyNode[]): Item[][] {
  return layoutRows(nodes).rows;
}

const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

const sensible = (gap: number) => Math.round(Math.min(MAX_GAP, Math.max(MIN_GAP, gap)));

/** The across gap people were already using: the median space between neighbours in a row. */
export function inferGap(rows: Item[][]): number {
  const gaps: number[] = [];
  for (const row of rows) {
    for (let i = 1; i < row.length; i++) {
      const g = row[i].box.x - (row[i - 1].box.x + row[i - 1].box.width);
      if (g > 0) gaps.push(g);
    }
  }
  const m = median(gaps);
  return m === null ? DEFAULT_GAP : sensible(m);
}

/** The down gap people were already using: the median space between one row's band and the next. */
export function inferRowGap(bands: readonly { top: number; bottom: number }[]): number | null {
  const gaps: number[] = [];
  for (let i = 1; i < bands.length; i++) {
    const g = bands[i].top - bands[i - 1].bottom;
    if (g > 0) gaps.push(g);
  }
  const m = median(gaps);
  return m === null ? null : sensible(m);
}

/**
 * Tidy up: the mess, made into the rows it was already trying to be.
 *
 * One row packs left to right at the gap between its neighbours; one column
 * packs top to bottom at the gap between its rows. Anything else keeps its
 * rows, packs each at the across gap from the selection's left edge, centres
 * each object in its row's band, and stacks the bands at the down gap. An
 * object spanning rows sits at the top of the row it starts in and keeps its
 * column clear in the rows it reaches into. All of it is measured on the
 * rendered box, so rotated objects line up by what is seen. Returns patches, so
 * the whole tidy is one undo step.
 */
export function tidySelection(nodes: readonly AnyNode[]): NodePatch[] {
  const movable = tidyable(nodes);
  if (movable.length < 2) return [];
  const { rows, bands, spanners } = layoutRows(movable);
  const hasAcross = rows.some((r) => r.length > 1);
  const rowGap = inferRowGap(bands);
  const across = hasAcross ? inferGap(rows) : (rowGap ?? DEFAULT_GAP);
  const down = rowGap ?? across;

  if (rows.length === 1 && spanners.length === 0) return tidyUp(movable, 'horizontal', across);
  if (!hasAcross && spanners.length === 0) return tidyUp(movable, 'vertical', down);

  const box = selectionBounds(movable);
  if (!box) return [];
  const spanning = new Set(spanners.map((s) => s.item.node.id));
  /** Columns a spanning object holds in the rows below the one it starts in. */
  const reserved: { left: number; right: number; bottom: number }[] = [];
  const patches: NodePatch[] = [];
  const move = (item: Item, x: number, y: number) => {
    const changes: Record<string, unknown> = {};
    const dx = x - item.box.x;
    const dy = y - item.box.y;
    if (Math.abs(dx) > 1e-6) changes.x = item.node.x + dx;
    if (Math.abs(dy) > 1e-6) changes.y = item.node.y + dy;
    if (Object.keys(changes).length > 0) patches.push({ id: item.node.id, changes });
  };

  let top = box.y;
  rows.forEach((row) => {
    const ordinary = row.filter((i) => !spanning.has(i.node.id));
    const height = Math.max(...(ordinary.length > 0 ? ordinary : row).map((i) => i.box.height));
    let x = box.x;
    for (const item of row) {
      // Step past any column a spanning object above still holds at this height.
      for (const r of [...reserved].sort((p, q) => p.left - q.left)) {
        if (r.bottom > top && x < r.right && x + item.box.width > r.left) x = r.right + across;
      }
      if (spanning.has(item.node.id)) {
        move(item, x, top);
        reserved.push({ left: x, right: x + item.box.width, bottom: top + item.box.height });
      } else {
        move(item, x, top + (height - item.box.height) / 2);
      }
      x += item.box.width + across;
    }
    top += height + down;
  });
  return patches;
}
