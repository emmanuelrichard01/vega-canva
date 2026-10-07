/**
 * The player's view of Spotify: connection, library, and what is playing.
 */
import { useSyncExternalStore } from 'react';
import { readTokens, subscribeSpotifyAuth, disconnectSpotify, takeSignInNotice, grantedScopes, beginSpotifySignIn } from './auth';
import {
  SpotifyError,
  embedUrl,
  fetchDevices,
  fetchPlaylists,
  fetchProfile,
  pausePlayback,
  resumePlayback,
  setDeviceVolume,
  skipNext,
  skipPrevious,
  startPlayback,
  transferPlayback,
  type SpotifyDevice,
  type SpotifyPlaylist,
  type SpotifyProfile,
} from './api';
import { ensureSdkDevice, hasSdkPlayer, pauseSdk, planPlayback, resumeSdk, setSdkVolume, teardownSdk, type PlaybackRoute, type SdkFailure } from './playback';
import { apiErrorMessage, playbackNotice, type PlaybackNotice } from './messages';

export interface SpotifyState {
  connected: boolean;
  loading: boolean;
  error: string | null;
  /** The account is not on the allowlist of an app in limited access; nothing will load for it. */
  limited: boolean;
  profile: SpotifyProfile | null;
  playlists: SpotifyPlaylist[];
  /** The person's open Spotify devices (Premium only), for "Play on". */
  devices: SpotifyDevice[];
  /** A device the person picked; used while it stays open. */
  preferredDeviceId: string | null;
  current: SpotifyPlaylist | null;
  playing: boolean;
  route: PlaybackRoute | null;
  /** Set when playback falls back to the embed player. */
  embed: string | null;
  /** Where the music plays when it is not simply this tab in full, and what would change that. */
  notice: PlaybackNotice | null;
}

const signedOut = {
  loading: false,
  error: null,
  limited: false,
  profile: null,
  playlists: [],
  devices: [],
  preferredDeviceId: null,
  current: null,
  playing: false,
  route: null,
  embed: null,
  notice: null,
} satisfies Partial<SpotifyState>;

let state: SpotifyState = { ...signedOut, connected: readTokens() !== null };

const listeners = new Set<() => void>();
function set(patch: Partial<SpotifyState>) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
}

subscribeSpotifyAuth(() => {
  const connected = readTokens() !== null;
  if (connected !== state.connected) set(connected ? { connected } : { ...signedOut, connected });
});

export const getSpotifyState = () => state;
export const subscribeSpotify = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
export function useSpotify(): SpotifyState {
  return useSyncExternalStore(subscribeSpotify, getSpotifyState, getSpotifyState);
}

const message = (e: unknown, onProfile = false) =>
  e instanceof SpotifyError
    ? apiErrorMessage(e.status, e.message, e.reason, onProfile)
    : e instanceof Error
      ? e.message
      : 'Something went wrong with Spotify. Try again in a moment.';

/** Starts sign-in. From a loopback address it moves to the sign-in address itself; see `beginSpotifySignIn`. */
export async function connectSpotify(): Promise<void> {
  set({ error: null });
  try {
    await beginSpotifySignIn();
  } catch (e) {
    set({ error: message(e) });
  }
}

/** Shows the outcome of a sign-in that just returned, and loads the library. */
export async function settleSpotifyNotice(): Promise<void> {
  const notice = takeSignInNotice();
  if (notice?.status === 'error') set({ error: notice.error });
  if (readTokens() && !state.profile && !state.loading) await loadLibrary();
}

export async function loadLibrary(): Promise<void> {
  if (!readTokens()) return;
  set({ loading: true, error: null, limited: false });
  let profile: SpotifyProfile;
  try {
    profile = await fetchProfile();
  } catch (e) {
    // A 403 here is an account missing from a limited-access app's allowlist: these tokens will never work.
    if (e instanceof SpotifyError && e.status === 403) {
      set({ loading: false, limited: true });
      return;
    }
    const error = message(e, true);
    if (e instanceof SpotifyError && e.status === 401) signOutOfSpotify();
    set({ loading: false, error });
    return;
  }
  set({ profile });
  try {
    const playlists = await fetchPlaylists();
    set({ playlists, loading: false });
  } catch (e) {
    set({ loading: false, error: message(e) });
  }
}

export async function playPlaylist(playlist: SpotifyPlaylist, volume: number): Promise<void> {
  set({ error: null, current: playlist, embed: null, notice: null });
  const premium = state.profile?.product === 'premium';
  const hasStreamingScope = grantedScopes(readTokens()).includes('streaming');
  const liked = playlist.kind === 'liked';
  const fallBackToEmbed = (sdkFailure: SdkFailure | null, route: PlaybackRoute = { kind: 'embed' }) => {
    const url = embedUrl(playlist);
    set({
      route,
      embed: url,
      playing: false,
      notice: playbackNotice({ premium, hasStreamingScope, route, sdkFailure, liked }),
    });
  };
  try {
    let sdkDeviceId: string | null = null;
    let sdkFailure: SdkFailure | null = null;
    if (premium && hasStreamingScope) {
      const sdk = await ensureSdkDevice(volume);
      sdkDeviceId = sdk.deviceId;
      sdkFailure = sdk.failure;
    }
    const needDevices = premium && (!sdkDeviceId || state.preferredDeviceId !== null);
    const devices = needDevices ? await fetchDevices().catch(() => []) : state.devices;
    if (needDevices) set({ devices });
    const route = planPlayback({ premium, sdkDeviceId, devices, preferredDeviceId: state.preferredDeviceId });
    if (route.kind === 'embed') return fallBackToEmbed(sdkFailure, route);
    try {
      await startPlayback(playlist, route.kind === 'sdk' ? sdkDeviceId : route.deviceId);
    } catch (e) {
      // Spotify can still refuse: Premium lapsed, or the device went away. Previews keep the music going.
      if (e instanceof SpotifyError && (e.status === 403 || e.status === 404)) {
        fallBackToEmbed(sdkFailure);
        if (e.status === 403) set({ notice: { text: apiErrorMessage(403, e.message, e.reason), reconnect: false } });
        return;
      }
      throw e;
    }
    set({ route, playing: true, notice: playbackNotice({ premium, hasStreamingScope, route, sdkFailure, liked }) });
    if (route.kind === 'device') void setDeviceVolumeNow(volume);
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
    // The in-tab player is paused through the SDK: it answers even when Spotify thinks another device is active.
    if (state.route?.kind === 'sdk' && (await pauseSdk())) {
      // Paused.
    } else {
      await pausePlayback(routeDevice());
    }
  } catch {
    // Paused elsewhere already; the state below is what matters.
  }
  set({ playing: false });
}

/**
 * Plays again from where it stopped. Starts the playlist over only when
 * there is nothing to continue: the route is gone, or Spotify refuses.
 */
export async function resumeSpotify(volume: number): Promise<void> {
  const playlist = state.current;
  if (!playlist) return;
  const route = state.route;
  if (route?.kind === 'sdk' && hasSdkPlayer() && (await resumeSdk())) {
    set({ playing: true });
    return;
  }
  if (route?.kind === 'device') {
    try {
      await resumePlayback(route.deviceId);
      set({ playing: true });
      return;
    } catch {
      // The device went away or has nothing queued: start the playlist again below.
    }
  }
  await playPlaylist(playlist, volume);
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

let volumeTimer: ReturnType<typeof setTimeout> | null = null;
let pendingVolume = 0;
const VOLUME_THROTTLE_MS = 250;

async function setDeviceVolumeNow(volume: number): Promise<void> {
  const device = routeDevice();
  if (!device) return;
  try {
    await setDeviceVolume(volume * 100, device);
  } catch {
    // Volume is best effort; the device keeps its own.
  }
}

/**
 * Applies the slider to the route: the in-tab player directly, a device
 * through Spotify's volume call (throttled while dragging). The embed has
 * its own volume, which the player says.
 */
export function setSpotifyVolume(volume: number): void {
  const route = state.route;
  if (route?.kind === 'sdk') void setSdkVolume(volume);
  if (route?.kind !== 'device') return;
  pendingVolume = volume;
  volumeTimer ??= setTimeout(() => {
    volumeTimer = null;
    void setDeviceVolumeNow(pendingVolume);
  }, VOLUME_THROTTLE_MS);
}

/** Plays on one of the person's devices: moves what plays there, or remembers it for the next play. */
export async function chooseDevice(device: SpotifyDevice, volume: number): Promise<void> {
  const route: PlaybackRoute = { kind: 'device', deviceId: device.id, name: device.name };
  set({ preferredDeviceId: device.id });
  if (!state.current) return;
  if (!state.playing) {
    set({ route, embed: null, notice: playbackNotice({ premium: true, hasStreamingScope: true, route, sdkFailure: null, liked: false }) });
    return;
  }
  try {
    await transferPlayback(device.id);
    set({ route, embed: null, notice: playbackNotice({ premium: true, hasStreamingScope: true, route, sdkFailure: null, liked: false }) });
    void setDeviceVolumeNow(volume);
  } catch (e) {
    set({ error: message(e) });
  }
}

export function signOutOfSpotify(): void {
  teardownSdk();
  disconnectSpotify();
}

export const dismissSpotifyError = () => set({ error: null });
