import { useSyncExternalStore } from 'react';

/**
 * Which grid is being edited cell by cell, and which modules are picked.
 *
 * Transient, per client: nobody else needs to see that this person has a grid
 * open for editing, and it must never reach the document or the undo stack.
 * The selection is a rectangle of track positions, which is what Merge needs.
 */
export interface CellBlock {
  row: number;
  col: number;
  rows: number;
  cols: number;
}

export interface GridEditState {
  gridId: string | null;
  block: CellBlock | null;
}

let state: GridEditState = { gridId: null, block: null };
const listeners = new Set<() => void>();

function set(next: GridEditState): void {
  state = next;
  listeners.forEach((fn) => fn());
}

export const gridEditMode = {
  get: (): GridEditState => state,
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  enter(gridId: string): void {
    if (state.gridId === gridId) return;
    set({ gridId, block: null });
  },
  exit(): void {
    if (state.gridId === null) return;
    set({ gridId: null, block: null });
  },
  select(block: CellBlock | null): void {
    if (!state.gridId) return;
    set({ ...state, block });
  },
};

export function useGridEditMode(): GridEditState {
  return useSyncExternalStore(gridEditMode.subscribe, gridEditMode.get, gridEditMode.get);
}

/** The smallest block holding both corners, for shift-click extension. */
export function blockBetween(
  a: { row: number; col: number; rows?: number; cols?: number },
  b: { row: number; col: number; rows?: number; cols?: number }
): CellBlock {
  const top = Math.min(a.row, b.row);
  const left = Math.min(a.col, b.col);
  const bottom = Math.max(a.row + (a.rows ?? 1), b.row + (b.rows ?? 1));
  const right = Math.max(a.col + (a.cols ?? 1), b.col + (b.cols ?? 1));
  return { row: top, col: left, rows: bottom - top, cols: right - left };
}
