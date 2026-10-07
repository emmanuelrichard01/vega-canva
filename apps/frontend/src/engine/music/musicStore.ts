/**
 * The music player's state: what is selected, whether it plays, the volume,
 * and where the music comes from.
 *
 * Personal by design. Nothing here goes into the shared document. The one
 * thing other people can see is an opt-in "listening to" line in presence,
 * which is awareness, not document state.
 */
import { useSyncExternalStore } from 'react';
import { storageGetJson, storageSet } from '../../utils/safeStorage';
import { musicEngine } from './engine';
import { newSeed, variationTitle } from './describe';
import { stationById, type StationId } from './stations';
import { keyName } from './describe';
import { publishMedia } from './mediaSession';
import { getLibraryState, setLibraryVolume, stopLibrary, subscribeLibrary } from './library/libraryStore';
import { categoryLabel } from './library/manifest';
import { pauseSpotify, getSpotifyState, setSpotifyVolume } from './spotify/spotifyStore';

export type MusicSource = 'stations' | 'library' | 'spotify';
export type MusicStatus = 'idle' | 'playing' | 'paused';

export interface MusicState {
  status: MusicStatus;
  station: StationId;
  seed: number;
  volume: number;
  source: MusicSource;
  /** Show "listening to …" to people in the board. Off by default. */
  shareListening: boolean;
  /** Set when the engine stopped itself after the tab was hidden a long time. */
  autoPaused: boolean;
}

interface Persisted {
  station: StationId;
  seed: number;
  volume: number;
  source: MusicSource;
  shareListening: boolean;
}

const KEY = 'vega.music';

const saved = storageGetJson<Partial<Persisted>>(KEY, {});
let state: MusicState = {
  status: 'idle',
  station: stationById(saved.station ?? 'lofi').id,
  seed: typeof saved.seed === 'number' ? saved.seed >>> 0 : newSeed(),
  volume: typeof saved.volume === 'number' ? Math.min(1, Math.max(0, saved.volume)) : 0.6,
  source: saved.source === 'spotify' || saved.source === 'library' ? saved.source : 'stations',
  shareListening: saved.shareListening === true,
  autoPaused: false,
};

const listeners = new Set<() => void>();

function set(patch: Partial<MusicState>) {
  state = { ...state, ...patch };
  storageSet(
    KEY,
    JSON.stringify({
      station: state.station,
      seed: state.seed,
      volume: state.volume,
      source: state.source,
      shareListening: state.shareListening,
    } satisfies Persisted)
  );
  listeners.forEach((fn) => fn());
  publishListening();
}

export const getMusicState = () => state;

export function subscribeMusic(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useMusic(): MusicState {
  return useSyncExternalStore(subscribeMusic, getMusicState, getMusicState);
}

/** What other people see when sharing is on; null when nothing should show. */
export function listeningLine(s: MusicState = state, library = getLibraryState()): string | null {
  if (!s.shareListening) return null;
  if (s.source === 'stations' && s.status === 'playing') return `Listening to ${stationById(s.station).name}`;
  // The category, never the track: a shared line says what kind of music, not exactly what.
  if (s.source === 'library' && library.playing && library.current) return `Listening to ${categoryLabel(library.current.category)}`;
  return null;
}

let lastPublished: string | null | undefined;
function publishListening() {
  const line = listeningLine();
  if (line === lastPublished) return;
  lastPublished = line;
  // Loaded lazily so the player never pulls the document into the dashboard bundle.
  void import('../document')
    .then(({ provider }) => provider.awareness?.setLocalStateField('listening', line))
    .catch(() => {});
}

subscribeLibrary(() => publishListening());

const engine = musicEngine();
engine.setVolume(state.volume);
setLibraryVolume(state.volume);
engine.onAutoPause = () => set({ status: 'paused', autoPaused: true });

function publishStation() {
  const now = engine.nowPlaying;
  publishMedia(
    {
      title: variationTitle(state.station, state.seed),
      artist: stationById(state.station).name,
      album: now ? `${keyName(now.key)} · ${now.bpm} BPM` : 'Vega focus music',
    },
    { play: () => void playStation(), pause: () => void pauseMusic(), next: () => void nextVariation() },
    state.status === 'playing'
  );
}

/** Play the selected station, or switch to another. Call from a user gesture. */
export async function playStation(station: StationId = state.station, seed = state.seed): Promise<void> {
  if (state.source !== 'stations') leaveSource(state.source);
  set({ station, seed, status: 'playing', source: 'stations', autoPaused: false });
  try {
    await engine.play(station, seed);
    publishStation();
  } catch {
    set({ status: 'idle' });
  }
}

export async function pauseMusic(): Promise<void> {
  if (state.status !== 'playing') return;
  set({ status: 'paused' });
  publishStation();
  await engine.pause();
}

export function togglePlay(): Promise<void> {
  return state.status === 'playing' && state.source === 'stations' ? pauseMusic() : playStation();
}

/** A new variation of the current station: new progression choices, key and tempo. */
export function nextVariation(): Promise<void> {
  return playStation(state.station, newSeed());
}

export function selectStation(station: StationId): Promise<void> {
  // Picking the station that is already playing leaves it alone.
  if (station === state.station && state.status === 'playing' && state.source === 'stations') return Promise.resolve();
  return playStation(station, station === state.station ? state.seed : newSeed());
}

export function setMusicVolume(v: number): void {
  const volume = Math.min(1, Math.max(0, v));
  engine.setVolume(volume);
  setLibraryVolume(volume);
  if (state.source === 'spotify') setSpotifyVolume(volume);
  set({ volume });
}

export function setShareListening(on: boolean): void {
  set({ shareListening: on });
}

/** Silences a source that is being left, so two never play at once. */
function leaveSource(source: MusicSource) {
  if (source === 'stations' && state.status === 'playing') {
    set({ status: 'paused' });
    void engine.pause();
  }
  if (source === 'library') stopLibrary();
  if (source === 'spotify' && getSpotifyState().playing) void pauseSpotify();
}

/** Switches what the player shows and plays from. The old source fades out. */
export function switchSource(source: MusicSource): void {
  if (source === state.source) return;
  leaveSource(state.source);
  set({ source, status: state.status === 'playing' ? 'paused' : state.status });
}

export const currentTitle = (s: MusicState = state) => variationTitle(s.station, s.seed);
