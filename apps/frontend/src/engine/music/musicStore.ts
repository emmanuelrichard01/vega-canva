/**
 * The music player's state: which station is chosen, the volume, and where
 * the music comes from.
 *
 * Stations are the six library categories; every one plays recorded tracks
 * from the manifest (see `library/libraryStore.ts`). Nothing is synthesised.
 *
 * Personal by design. Nothing here goes into the shared document. The one
 * thing other people can see is an opt-in "listening to" line in presence,
 * which is awareness, not document state.
 */
import { useSyncExternalStore } from 'react';
import { storageGetJson, storageSet } from '../../utils/safeStorage';
import {
  getLibraryState,
  pauseLibrary,
  playCategory,
  primeLibraryAudio,
  setLibraryVolume,
  stopLibrary,
  subscribeLibrary,
  toggleLibrary,
} from './library/libraryStore';
import { KNOWN_CATEGORY_IDS, categoryLabel } from './library/manifest';
import { spotifyAvailable } from './spotify/auth';
import { pauseSpotify, getSpotifyState, setSpotifyVolume, subscribeSpotify } from './spotify/spotifyStore';
import { claimPlayback, onOtherTabClaim } from './crossTab';

export type MusicSource = 'stations' | 'spotify';

export interface MusicState {
  /** The chosen station: a library category slug. */
  station: string;
  volume: number;
  source: MusicSource;
  /** Show "listening to …" to people in the board. Off by default. */
  shareListening: boolean;
}

type Persisted = MusicState;

const KEY = 'vega.music';

const saved = storageGetJson<Partial<Persisted>>(KEY, {});
let state: MusicState = {
  station: typeof saved.station === 'string' && saved.station ? saved.station : 'lofi',
  volume: typeof saved.volume === 'number' ? Math.min(1, Math.max(0, saved.volume)) : 0.6,
  // Anything but Spotify (including the old "library" tab) is the stations.
  source: saved.source === 'spotify' && spotifyAvailable() ? 'spotify' : 'stations',
  shareListening: saved.shareListening === true,
};

const listeners = new Set<() => void>();

function set(patch: Partial<MusicState>) {
  state = { ...state, ...patch };
  storageSet(KEY, JSON.stringify(state satisfies Persisted));
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
  // The station, never the track: a shared line says what kind of music, not exactly what.
  if (s.source === 'stations' && library.playing && library.current) return `Listening to ${categoryLabel(library.current.category)}`;
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
setLibraryVolume(state.volume);

// One tab plays at a time: starting music claims playback, and a claim from another tab pauses this one.
let wasPlaying = false;
function claimOnStart() {
  const playing = getLibraryState().playing || getSpotifyState().playing;
  if (playing && !wasPlaying) claimPlayback();
  wasPlaying = playing;
}
subscribeLibrary(claimOnStart);
subscribeSpotify(claimOnStart);
onOtherTabClaim(() => {
  if (getLibraryState().playing) pauseLibrary();
  if (getSpotifyState().playing) void pauseSpotify();
});

/** Plays a station's tracks. Picking the station already playing leaves it alone. Call from a user gesture. */
export async function selectStation(station: string): Promise<void> {
  // Inside the click's user activation, before anything is awaited.
  primeLibraryAudio();
  if (state.source !== 'stations') leaveSource(state.source);
  set({ station, source: 'stations' });
  await playCategory(station);
}

/** Play or pause the chosen station. */
export function togglePlay(): Promise<void> {
  const lib = getLibraryState();
  if (lib.playing || lib.current) return toggleLibrary();
  return selectStation(state.station);
}

export function setMusicVolume(v: number): void {
  const volume = Math.min(1, Math.max(0, v));
  setLibraryVolume(volume);
  if (state.source === 'spotify') setSpotifyVolume(volume);
  set({ volume });
}

export function setShareListening(on: boolean): void {
  set({ shareListening: on });
}

/** Silences a source that is being left, so two never play at once. */
function leaveSource(source: MusicSource) {
  if (source === 'stations') stopLibrary();
  if (source === 'spotify' && getSpotifyState().playing) void pauseSpotify();
}

/** Switches what the player shows and plays from. The old source fades out. */
export function switchSource(source: MusicSource): void {
  if (source === state.source) return;
  leaveSource(state.source);
  set({ source });
}

/** The known stations, then any extra categories the manifest adds. */
export function stationIds(categories: readonly string[] = getLibraryState().categories): string[] {
  return [...KNOWN_CATEGORY_IDS, ...categories.filter((c) => !KNOWN_CATEGORY_IDS.includes(c))];
}
