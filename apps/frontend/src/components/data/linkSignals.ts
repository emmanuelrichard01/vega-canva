import type { TableRange } from '../../engine/chart/chartFromTable';

/**
 * This client's transient data-link state, shared between the panel, the
 * charts and the board overlay. None of it is the document's: what one
 * person points at, or which bars just changed on their screen, is nobody
 * else's business and never belongs in undo.
 *
 * - `rangeFocus`: a range the panel is pointing at, outlined on the board.
 * - `flashes`: readings a source edit just changed, briefly marked on the chart.
 * - `pendingRange`: a range to select when its table's editor next opens.
 */

type Listener = () => void;

function signal<T>(initial: T) {
  let value = initial;
  const listeners = new Set<Listener>();
  return {
    get: () => value,
    set(next: T) {
      if (Object.is(next, value)) return;
      value = next;
      listeners.forEach((fn) => fn());
    },
    subscribe(fn: Listener) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

export interface RangeFocus {
  tableId: string;
  range: TableRange;
  /** Who is asking: the panel's range field, or a click on a link line. */
  from: 'panel' | 'board';
}

export const rangeFocus = signal<RangeFocus | null>(null);

const sameRange = (a: TableRange, b: TableRange) => a.r0 === b.r0 && a.c0 === b.c0 && a.r1 === b.r1 && a.c1 === b.c1;

/** Point at a range on the board, or stop. Repeating the same range is not a change. */
export function focusRange(next: RangeFocus | null): void {
  const now = rangeFocus.get();
  if (next && now && now.tableId === next.tableId && now.from === next.from && sameRange(now.range, next.range)) return;
  rangeFocus.set(next);
}

export interface Flash {
  /** [series, category] pairs whose values changed. */
  cells: Array<[number, number]>;
  at: number;
}

const flashes = new Map<string, Flash>();
export const flashVersion = signal(0);

/** How long a changed reading stays marked. */
export const FLASH_MS = 1200;

export function publishFlash(chartId: string, cells: Array<[number, number]>): void {
  if (cells.length === 0) return;
  flashes.set(chartId, { cells, at: performance.now() });
  flashVersion.set(flashVersion.get() + 1);
}

/** Flashes still showing, by chart id; drops the ones that have run out. */
export function liveFlashes(now = performance.now()): Map<string, Flash> {
  for (const [id, f] of flashes) if (now - f.at > FLASH_MS) flashes.delete(id);
  return flashes;
}

const pending = new Map<string, TableRange>();

/** Ask the table editor to select `range` when it next opens on `tableId`. */
export function requestRangeSelection(tableId: string, range: TableRange): void {
  pending.set(tableId, range);
}

/** The range waiting for this table's editor, taken once. */
export function takeRangeSelection(tableId: string): TableRange | null {
  const range = pending.get(tableId) ?? null;
  pending.delete(tableId);
  return range;
}
