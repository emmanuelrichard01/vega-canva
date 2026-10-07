/**
 * Whether music is playing, and what, for the header's record button.
 *
 * Deliberately tiny and dependency-free: the button sits beside your avatar
 * on every board, and must not pull the engine, the stations or Spotify into
 * the board's first load. The player writes here once it has loaded (see
 * `signalBridge.ts`); until then nothing can be playing.
 */
import { useSyncExternalStore } from 'react';
import { storageGet, storageSet } from '../../utils/safeStorage';

export interface PlayingSignal {
  playing: boolean;
  /** "Lo-fi · Late Rain", "Innovating Care by Aylex"; null when idle. */
  line: string | null;
}

let snapshot: PlayingSignal = { playing: false, line: null };
const listeners = new Set<() => void>();

export function setPlayingSignal(next: PlayingSignal): void {
  if (next.playing === snapshot.playing && next.line === snapshot.line) return;
  snapshot = next;
  listeners.forEach((fn) => fn());
}

export const getPlayingSignal = (): PlayingSignal => snapshot;

export function subscribePlayingSignal(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function usePlayingSignal(): PlayingSignal {
  return useSyncExternalStore(subscribePlayingSignal, getPlayingSignal, getPlayingSignal);
}

// The compact player: a one-row now-playing bar in the popover, and the title beside the record in the header.
const MINI_KEY = 'vega.music.mini';
let mini = storageGet(MINI_KEY) === '1';
const miniListeners = new Set<() => void>();

export function setMiniMode(on: boolean): void {
  if (on === mini) return;
  mini = on;
  storageSet(MINI_KEY, on ? '1' : '0');
  miniListeners.forEach((fn) => fn());
}

export function useMiniMode(): boolean {
  return useSyncExternalStore(
    (fn) => {
      miniListeners.add(fn);
      return () => {
        miniListeners.delete(fn);
      };
    },
    () => mini,
    () => false
  );
}
