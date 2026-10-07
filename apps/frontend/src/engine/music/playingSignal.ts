/**
 * Whether music is playing, and what, for the header's record button.
 *
 * Deliberately tiny and dependency-free: the button sits beside your avatar
 * on every board, and must not pull the engine, the stations or Spotify into
 * the board's first load. The player writes here once it has loaded (see
 * `signalBridge.ts`); until then nothing can be playing.
 */
import { useSyncExternalStore } from 'react';

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
