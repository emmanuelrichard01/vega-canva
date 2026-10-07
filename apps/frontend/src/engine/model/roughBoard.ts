/**
 * The board's sketch mode, live.
 *
 * Stored in the document's metadata map, so it is shared by the room, survives
 * a reload and reaches every export. One observer for the whole app, however
 * many renderers ask: a board of two thousand shapes holds two thousand
 * listeners in a `Set`, not two thousand Yjs observers, and a change to any
 * other metadata key wakes none of them.
 */

import { useSyncExternalStore } from 'react';
import type * as Y from 'yjs';
import { metadataMap, setBoardMetadata } from '../document';
import type { SketchLevel } from './rough';
import { BOARD_SKETCH_KEY, DEFAULT_BOARD_SKETCH, parseBoardSketch, resolveSketch, type SketchChoice } from './roughMode';

let current: SketchLevel | null = null;
let installed = false;
/** The level the board had when sketch mode was last switched off, for the toggle. */
let lastOn: SketchLevel = DEFAULT_BOARD_SKETCH;
const listeners = new Set<() => void>();

function install(): void {
  if (installed) return;
  installed = true;
  current = parseBoardSketch(metadataMap.get(BOARD_SKETCH_KEY));
  metadataMap.observe((event: Y.YMapEvent<string>) => {
    if (!event.keysChanged.has(BOARD_SKETCH_KEY)) return;
    const next = parseBoardSketch(metadataMap.get(BOARD_SKETCH_KEY));
    if (next === current) return;
    if (current) lastOn = current;
    current = next;
    listeners.forEach((fn) => fn());
  });
}

function subscribe(onChange: () => void): () => void {
  install();
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

/** The board's sketch level, or null when the board is drawn crisp. */
export function readBoardSketch(): SketchLevel | null {
  install();
  return current;
}

/** The board's sketch level, re-rendering only when it changes. */
export function useBoardSketch(): SketchLevel | null {
  return useSyncExternalStore(subscribe, readBoardSketch, readBoardSketch);
}

/** The level one object is drawn at, given the board: undefined for crisp. */
export function useSketchLevel(appearance: SketchChoice | undefined): SketchLevel | undefined {
  return resolveSketch(appearance, useBoardSketch());
}

/**
 * Set the board's sketch mode: a level, or null for a crisp board.
 *
 * A document write, so it goes through the role gate in `setBoardMetadata`
 * and does nothing for a viewer. Callers offer the control to editors only.
 */
export function setBoardSketch(level: SketchLevel | null): void {
  setBoardMetadata(BOARD_SKETCH_KEY, level ?? '');
}

/** Switch sketch mode on (at the level it last had) or off. */
export function toggleBoardSketch(): void {
  const now = readBoardSketch();
  setBoardSketch(now ? null : lastOn);
}
