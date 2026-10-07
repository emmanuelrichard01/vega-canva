/**
 * The player's view of Spotify: connection, library, and what is playing.
 */
import { useSyncExternalStore } from 'react';
import { readTokens, subscribeSpotifyAuth, disconnectSpotify, takeSignInNotice } from './auth';
import {
  embedUrl,
  fetchDevices,
  fetchPlaylists,
  fetchProfile,
  pausePlayback,
  skipNext,
  skipPrevious,
  startPlayback,
  type SpotifyPlaylist,
  type SpotifyProfile,
} from './api';
import { ensureSdkDevice, planPlayback, setSdkVolume, teardownSdk, type PlaybackRoute } from './playback';

export interface SpotifyState {
  connected: boolean;
  loading: boolean;
  error: string | null;
  profile: SpotifyProfile | null;
  playlists: SpotifyPlaylist[];
  current: SpotifyPlaylist | null;
  playing: boolean;
  route: PlaybackRoute | null;
  /** Set when playback falls back to the embed player. */
  embed: string | null;
}

let state: SpotifyState = {
  connected: readTokens() !== null,
  loading: false,
  error: null,
  profile: null,
  playlists: [],
  current: null,
  playing: false,
  route: null,
  embed: null,
};

const listeners = new Set<() => void>();
function set(patch: Partial<SpotifyState>) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
}

subscribeSpotifyAuth(() => {
  const connected = readTokens() !== null;
  if (connected !== state.connected) {
    set(
      connected
        ? { connected }
        : { connected, profile: null, playlists: [], current: null, playing: false, route: null, embed: null }
    );
  }
});

export const getSpotifyState = () => state;
export const subscribeSpotify = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
export function useSpotify(): SpotifyState {
  return useSyncExternalStore(subscribeSpotify, getSpotifyState, getSpotifyState);
}

const message = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong with Spotify.');

/** Shows the outcome of a sign-in that just returned, and loads the library. */
export async function settleSpotifyNotice(): Promise<void> {
  const notice = takeSignInNotice();
  if (notice?.status === 'error') set({ error: notice.error });
  if (readTokens() && !state.profile && !state.loading) await loadLibrary();
}

export async function loadLibrary(): Promise<void> {
  if (!readTokens()) return;
  set({ loading: true, error: null });
  try {
    const [profile, playlists] = await Promise.all([fetchProfile(), fetchPlaylists()]);
    set({ profile, playlists, loading: false });
  } catch (e) {
    set({ loading: false, error: message(e) });
  }
}

export async function playPlaylist(playlist: SpotifyPlaylist, volume: number): Promise<void> {
  set({ error: null, current: playlist, embed: null });
  try {
    const premium = state.profile?.product === 'premium';
    const sdkDeviceId = premium ? await ensureSdkDevice(volume) : null;
    const devices = sdkDeviceId ? [] : await fetchDevices().catch(() => []);
    const route = planPlayback({ premium, sdkDeviceId, devices });
    if (route.kind === 'embed') {
      const url = embedUrl(playlist);
      set({
        route,
        embed: url,
        playing: false,
        error: url ? null : 'Liked Songs needs Spotify Premium, or Spotify open on one of your devices.',
      });
      return;
    }
    await startPlayback(playlist, route.kind === 'sdk' ? sdkDeviceId : route.deviceId);
    set({ route, playing: true });
  } catch (e) {
    set({ error: message(e), playing: false });
  }
}

const routeDevice = () => {
  const r = state.route;
  return r?.kind === 'device' ? r.deviceId : null;
};

export async function pauseSpotify(): Promise<void> {
  try {
    await pausePlayback(routeDevice());
  } catch {
    // Paused elsewhere already; the state below is what matters.
  }
  set({ playing: false });
}

export async function resumeSpotify(volume: number): Promise<void> {
  if (state.current) await playPlaylist(state.current, volume);
}

export async function nextSpotifyTrack(): Promise<void> {
  try {
    await skipNext(routeDevice());
  } catch (e) {
    set({ error: message(e) });
  }
}

export async function previousSpotifyTrack(): Promise<void> {
  try {
    await skipPrevious(routeDevice());
  } catch (e) {
    set({ error: message(e) });
  }
}

export function setSpotifyVolume(volume: number): void {
  void setSdkVolume(volume);
}

export function signOutOfSpotify(): void {
  teardownSdk();
  disconnectSpotify();
}

export const dismissSpotifyError = () => set({ error: null });
