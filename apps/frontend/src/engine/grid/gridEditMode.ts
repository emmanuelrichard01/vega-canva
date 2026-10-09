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

/**
 * A border drag in flight: the grid as it will be when the pointer lets go.
 *
 * The drag never writes the document until release (so the whole drag is one
 * undo step and collaborators see one change), but the person dragging needs
 * to see the modules move under the pointer, not a hairline guessing where
 * they will end up. The grid renderer draws from this while it is set.
 * Transient and per client, like the rest of this file.
 */
export interface TrackPreview {
  gridId: string;
  grid: import('./gridBuild').GridRecipe;
  width: number;
  height: number;
}

let preview: TrackPreview | null = null;
const previewListeners = new Set<() => void>();

export const trackPreview = {
  get: (): TrackPreview | null => preview,
  set(next: TrackPreview | null): void {
    if (next === preview) return;
    preview = next;
    previewListeners.forEach((fn) => fn());
  },
  subscribe(fn: () => void): () => void {
    previewListeners.add(fn);
    return () => previewListeners.delete(fn);
  },
};

/** The in-flight preview for one grid, or null. */
export function useTrackPreview(gridId: string): TrackPreview | null {
  const p = useSyncExternalStore(trackPreview.subscribe, trackPreview.get, trackPreview.get);
  return p && p.gridId === gridId ? p : null;
}

/**
 * The board's current selection, mirrored for the grid renderer.
 *
 * Selection lives in Room's React state; the grid only needs to know whether
 * something sitting in one of its modules is selected, to outline that module
 * ("this text lives in this cell"). Room writes it, nothing else does.
 */
let selection: readonly string[] = [];
const selectionListeners = new Set<() => void>();

export const selectionMirror = {
  get: (): readonly string[] => selection,
  set(ids: readonly string[]): void {
    if (ids === selection) return;
    selection = ids;
    selectionListeners.forEach((fn) => fn());
  },
  subscribe(fn: () => void): () => void {
    selectionListeners.add(fn);
    return () => selectionListeners.delete(fn);
  },
};

export function useSelectionMirror(): readonly string[] {
  return useSyncExternalStore(selectionMirror.subscribe, selectionMirror.get, selectionMirror.get);
}
