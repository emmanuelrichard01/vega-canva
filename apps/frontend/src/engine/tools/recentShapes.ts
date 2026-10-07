/**
 * The shapes this person placed most recently, newest first.
 *
 * Recorded by the Shape tool when a shape is committed, not when a tile is
 * clicked: a tile opened and abandoned is not a shape anyone used. Kept per
 * browser, because it describes a habit rather than a board.
 */

import { storageGetJson, storageSet } from '../../utils/safeStorage';

const KEY = 'vega.recentShapes';
const LIMIT = 8;

type Listener = () => void;
const listeners = new Set<Listener>();

let recent: readonly string[] = (() => {
  const stored = storageGetJson<unknown>(KEY, []);
  return Array.isArray(stored) ? stored.filter((v): v is string => typeof v === 'string').slice(0, LIMIT) : [];
})();

export function getRecentShapes(): readonly string[] {
  return recent;
}

export function recordRecentShape(preset: string): void {
  if (recent[0] === preset) return;
  recent = [preset, ...recent.filter((p) => p !== preset)].slice(0, LIMIT);
  storageSet(KEY, JSON.stringify(recent));
  listeners.forEach((fn) => fn());
}

export function subscribeRecentShapes(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
