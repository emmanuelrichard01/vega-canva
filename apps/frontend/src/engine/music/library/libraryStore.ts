/**
 * The Library source: recorded tracks from a manifest, streamed on demand.
 *
 * Configured by `VITE_MUSIC_BASE_URL` (the folder holding `manifest.json` and
 * the audio), or `VITE_MUSIC_MANIFEST_URL` to point at the manifest
 * directly. Unconfigured, the Library does not appear and the generated
 * stations remain the default.
 */
import { useSyncExternalStore } from 'react';
import { storageGetJson, storageSet } from '../../../utils/safeStorage';
import { parseManifest, type LibraryTrack } from './manifest';
import { advance, createQueue, currentId, cycleRepeat, jumpTo, peekNext, previous, setShuffle, type Queue, type RepeatMode } from './queue';
import { LibraryPlayer } from './libraryPlayer';
import { clearMedia, publishMedia } from '../mediaSession';
import { categoryLabel } from './manifest';

export type LibraryStatus = 'unconfigured' | 'idle' | 'loading' | 'ready' | 'error';

export interface LibraryState {
  status: LibraryStatus;
  error: string | null;
  tracks: LibraryTrack[];
  categories: string[];
  /** The category being browsed and played; null is everything. */
  category: string | null;
  queue: Queue | null;
  current: LibraryTrack | null;
  playing: boolean;
  buffering: boolean;
  position: number;
  duration: number;
  shuffle: boolean;
  repeat: RepeatMode;
  /** A track that failed to load, so the list can mark it. */
  failed: string | null;
}

interface Persisted {
  category: string | null;
  shuffle: boolean;
  repeat: RepeatMode;
  lastTrack: string | null;
}

const KEY = 'vega.music.library';

export function manifestUrl(): string | null {
  const direct = (import.meta.env.VITE_MUSIC_MANIFEST_URL as string | undefined)?.trim();
  if (direct) return direct;
  const base = (import.meta.env.VITE_MUSIC_BASE_URL as string | undefined)?.trim();
  if (!base) return null;
  return `${base.replace(/\/+$/, '')}/manifest.json`;
}

export const libraryConfigured = (): boolean => manifestUrl() !== null;

const saved = storageGetJson<Partial<Persisted>>(KEY, {});
let state: LibraryState = {
  status: libraryConfigured() ? 'idle' : 'unconfigured',
  error: null,
  tracks: [],
  categories: [],
  category: typeof saved.category === 'string' ? saved.category : null,
  queue: null,
  current: null,
  playing: false,
  buffering: false,
  position: 0,
  duration: 0,
  shuffle: saved.shuffle === true,
  repeat: saved.repeat === 'one' || saved.repeat === 'off' ? saved.repeat : 'all',
  failed: null,
};

const listeners = new Set<() => void>();
function set(patch: Partial<LibraryState>) {
  state = { ...state, ...patch };
  storageSet(
    KEY,
    JSON.stringify({ category: state.category, shuffle: state.shuffle, repeat: state.repeat, lastTrack: state.current?.id ?? saved.lastTrack ?? null } satisfies Persisted)
  );
  listeners.forEach((fn) => fn());
}

export const getLibraryState = () => state;
export const subscribeLibrary = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
export function useLibrary(): LibraryState {
  return useSyncExternalStore(subscribeLibrary, getLibraryState, getLibraryState);
}

/** Tracks in the category being played or browsed. */
export const tracksIn = (s: LibraryState, category: string | null = s.category) =>
  category ? s.tracks.filter((t) => t.category === category) : s.tracks;

const byId = (id: string | null) => (id ? state.tracks.find((t) => t.id === id) ?? null : null);
let seed = (Date.now() & 0xffff) || 1;
const nextSeed = () => (seed = (seed * 48271) % 0x7fffffff);

let player: LibraryPlayer | null = null;
let volume = 0.6;

function syncFromPlayer() {
  if (!player) return;
  const snap = player.snapshot();
  const patch: Partial<LibraryState> = {};
  if (snap.playing !== state.playing) patch.playing = snap.playing;
  if (snap.buffering !== state.buffering) patch.buffering = snap.buffering;
  if (Math.abs(snap.position - state.position) >= 0.25 || snap.position < state.position) patch.position = snap.position;
  if (Math.abs(snap.duration - state.duration) > 0.01) patch.duration = snap.duration;
  if (Object.keys(patch).length > 0) set(patch);
  publish();
}

function ensurePlayer(): LibraryPlayer {
  player ??= new LibraryPlayer({
    nextTrack: () => (state.queue ? byId(peekNext(state.queue)) : null),
    onAdvance: (track) => {
      if (!state.queue) return;
      const q = advance(state.queue, true);
      set({ queue: q ? jumpTo(q, track.id) : state.queue, current: track, failed: null, position: 0 });
      player?.preload(state.queue ? byId(peekNext(state.queue)) : null);
      publish();
    },
    onChange: syncFromPlayer,
    onError: (track, message) => set({ failed: track.id, error: `${track.title}: ${message}` }),
  });
  player.setVolume(volume);
  return player;
}

// Position updates while playing; the audio element's own timeupdate is too coarse for a smooth bar.
let ticker: ReturnType<typeof setInterval> | null = null;
function watchPosition(on: boolean) {
  if (on && !ticker) ticker = setInterval(syncFromPlayer, 250);
  if (!on && ticker) {
    clearInterval(ticker);
    ticker = null;
  }
}
subscribeLibrary(() => watchPosition(state.playing));

function publish() {
  const t = state.current;
  if (!t) return;
  publishMedia(
    { title: t.title, artist: t.artist, album: categoryLabel(t.category), artwork: t.artwork },
    { play: () => void resumeLibrary(), pause: pauseLibrary, next: () => void skipLibrary(1), previous: () => void skipLibrary(-1) },
    state.playing
  );
}

/** Loads the manifest once; later calls return the same result. */
let loading: Promise<void> | null = null;
export function loadLibrary(fetchImpl: typeof fetch = fetch): Promise<void> {
  const url = manifestUrl();
  if (!url) return Promise.resolve();
  if (state.status === 'ready') return Promise.resolve();
  loading ??= (async () => {
    set({ status: 'loading', error: null });
    try {
      const res = await fetchImpl(url, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`The music library could not be loaded (${res.status}).`);
      const parsed = parseManifest(await res.json(), url);
      if (parsed.problems.length > 0) console.warn('[music] manifest problems:\n' + parsed.problems.join('\n'));
      const category = state.category && parsed.categories.includes(state.category) ? state.category : null;
      const last = parsed.tracks.find((t) => t.id === saved.lastTrack) ?? null;
      set({ status: 'ready', tracks: parsed.tracks, categories: parsed.categories, category, current: state.current ?? last });
    } catch (e) {
      set({ status: 'error', error: e instanceof Error ? e.message : 'The music library could not be loaded.' });
    } finally {
      loading = null;
    }
  })();
  return loading;
}

function buildQueue(startId: string | null, category: string | null = state.category): Queue {
  return createQueue(
    tracksIn(state, category).map((t) => t.id),
    { shuffle: state.shuffle, repeat: state.repeat, seed: nextSeed(), startId }
  );
}

/** Plays a track, queueing the rest of its category behind it. Call from a user gesture. */
export async function playTrack(id: string): Promise<void> {
  const track = byId(id);
  if (!track) return;
  const inView = tracksIn(state).some((t) => t.id === id);
  const queue = buildQueue(id, inView ? state.category : track.category);
  set({ queue, current: track, failed: null, error: null, position: 0 });
  const p = ensurePlayer();
  await p.play(track);
  p.preload(byId(peekNext(queue)));
  publish();
}

export async function resumeLibrary(): Promise<void> {
  if (state.playing) return;
  const p = ensurePlayer();
  if (state.current && p.snapshot().trackId === state.current.id) {
    await p.resume();
    return;
  }
  const first = state.current ?? tracksIn(state)[0];
  if (first) await playTrack(first.id);
}

export function pauseLibrary(): void {
  player?.pause();
  publish();
}

export function toggleLibrary(): Promise<void> {
  if (state.playing) {
    pauseLibrary();
    return Promise.resolve();
  }
  return resumeLibrary();
}

/** Next (+1) or previous (-1). Previous restarts a track that has played a few seconds. */
export async function skipLibrary(direction: 1 | -1): Promise<void> {
  const queue = state.queue ?? (state.current ? buildQueue(state.current.id) : null);
  if (!queue) return;
  if (direction === 1) {
    const q = advance(queue, false);
    const id = q ? currentId(q) : null;
    if (!q || !id) return;
    set({ queue: q });
    const track = byId(id)!;
    set({ current: track, position: 0, failed: null });
    const p = ensurePlayer();
    await p.play(track);
    p.preload(byId(peekNext(q)));
  } else {
    const { queue: q, restart } = previous(queue, state.position);
    const id = currentId(q);
    if (!id) return;
    set({ queue: q });
    if (restart) {
      ensurePlayer().seek(0);
      if (!state.playing) await resumeLibrary();
      return;
    }
    const track = byId(id)!;
    set({ current: track, position: 0, failed: null });
    await ensurePlayer().play(track);
  }
  publish();
}

export function seekLibrary(seconds: number): void {
  player?.seek(seconds);
  set({ position: seconds });
}

export function setLibraryCategory(category: string | null): void {
  set({ category });
}

export function toggleLibraryShuffle(): void {
  const shuffle = !state.shuffle;
  const ids = tracksIn(state, state.current?.category ?? state.category).map((t) => t.id);
  set({ shuffle, queue: state.queue ? setShuffle(state.queue, shuffle, ids, nextSeed()) : null });
  player?.preload(state.queue ? byId(peekNext(state.queue)) : null);
}

export function cycleLibraryRepeat(): void {
  const repeat = cycleRepeat(state.repeat);
  set({ repeat, queue: state.queue ? { ...state.queue, repeat } : null });
  player?.preload(state.queue ? byId(peekNext(state.queue)) : null);
}

export function setLibraryVolume(v: number): void {
  volume = v;
  player?.setVolume(v);
}

/** Stops library audio entirely (another source took over). */
export function stopLibrary(): void {
  if (!player) return;
  player.pause();
  clearMedia();
}

export const dismissLibraryError = () => set({ error: null });
