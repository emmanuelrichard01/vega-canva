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

/**
 * The shapes this person has pinned in the shape library, in the order they
 * pinned them.
 *
 * Kept beside the recents because they answer the same question for a
 * different horizon: recents are what you used lately, pins are what you
 * decided to keep. Per browser for the same reason, and capped so the row a
 * pin lands in stays a row rather than a second library.
 */
const PIN_KEY = 'vega.pinnedShapes';
const PIN_LIMIT = 16;
const pinListeners = new Set<Listener>();

let pinned: readonly string[] = (() => {
  const stored = storageGetJson<unknown>(PIN_KEY, []);
  return Array.isArray(stored)
    ? Array.from(new Set(stored.filter((v): v is string => typeof v === 'string'))).slice(0, PIN_LIMIT)
    : [];
})();

export function getPinnedShapes(): readonly string[] {
  return pinned;
}

/** Pin a shape, or unpin it if it is pinned. Returns whether it is pinned now. */
export function togglePinnedShape(preset: string): boolean {
  const on = !pinned.includes(preset);
  pinned = on ? [...pinned, preset].slice(-PIN_LIMIT) : pinned.filter((p) => p !== preset);
  storageSet(PIN_KEY, JSON.stringify(pinned));
  pinListeners.forEach((fn) => fn());
  return on;
}

export function subscribePinnedShapes(fn: Listener): () => void {
  pinListeners.add(fn);
  return () => {
    pinListeners.delete(fn);
  };
}
