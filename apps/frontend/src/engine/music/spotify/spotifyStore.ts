/**
 * The player's view of Spotify: connection, library, and what is playing.
 */
import { useSyncExternalStore } from 'react';
import { readTokens, subscribeSpotifyAuth, disconnectSpotify, takeSignInNotice, grantedScopes, beginSpotifySignIn } from './auth';
import {
  SpotifyError,
  embedUrl,
  fetchDevices,
  fetchPlayer,
  fetchPlaylists,
  fetchProfile,
  fetchQueue,
  isTrackSaved,
  pausePlayback,
  resumePlayback,
  seekTo,
  setDeviceVolume,
  setRepeatState,
  setShuffleState,
  setTrackSaved,
  skipNext,
  skipPrevious,
  startPlayback,
  transferPlayback,
  type SpotifyDevice,
  type SpotifyPlaylist,
  type SpotifyProfile,
} from './api';
import {
  ensureSdkDevice,
  hasSdkPlayer,
  onSdkState,
  pauseSdk,
  planPlayback,
  resumeSdk,
  seekSdk,
  setSdkVolume,
  skipSdk,
  teardownSdk,
  type PlaybackRoute,
  type SdkFailure,
} from './playback';
import { nextRepeat, overlay, pollDelay, reconcile, snapshotFromSdk, type Controls, type Pending, type PlayerSnapshot, type SpotifyTrack } from './playerSync';
import { extrapolate } from '../playerMath';
import { clearMedia, publishMedia } from '../mediaSession';
import type { RepeatMode } from '../library/queue';
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
  /** The track Spotify is on; null until it reports one (and always for the embed). */
  track: SpotifyTrack | null;
  /** The playhead when `positionAt` was stamped; the clock runs on from there while playing. */
  positionMs: number;
  positionAt: number;
  durationMs: number;
  shuffle: boolean;
  repeat: RepeatMode;
  /** Whether the track is in Liked Songs; null while unknown. */
  liked: boolean | null;
  upNext: SpotifyTrack[];
  /** Spotify asked us to slow down; controls say so instead of failing. */
  busy: boolean;
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
  track: null,
  positionMs: 0,
  positionAt: 0,
  durationMs: 0,
  shuffle: false,
  repeat: 'off',
  liked: null,
  upNext: [],
  busy: false,
} satisfies Partial<SpotifyState>;

let state: SpotifyState = { ...signedOut, connected: readTokens() !== null };

const listeners = new Set<() => void>();
function set(patch: Partial<SpotifyState>) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
}

subscribeSpotifyAuth(() => {
  const connected = readTokens() !== null;
  if (connected !== state.connected) {
    if (!connected) resetPlayerTracking();
    set(connected ? { connected } : { ...signedOut, connected });
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
  knownVolume = volume;
  resetPlayerTracking();
  set({ error: null, current: playlist, embed: null, notice: null, track: null, positionMs: 0, durationMs: 0, liked: null, upNext: [] });
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
    set({ route, notice: playbackNotice({ premium, hasStreamingScope, route, sdkFailure, liked }) });
    expectPlaying(true);
    if (route.kind === 'device') void setDeviceVolumeNow(volume);
    syncPolling();
  } catch (e) {
    set({ error: message(e), playing: false });
  }
}

const routeDevice = () => {
  const r = state.route;
  return r?.kind === 'device' ? r.deviceId : null;
};

export async function pauseSpotify(): Promise<void> {
  expectPlaying(false);
  try {
    // The in-tab player is paused through the SDK: it answers even when Spotify thinks another device is active.
    if (state.route?.kind === 'sdk' && (await pauseSdk())) {
      // Paused.
    } else {
      await pausePlayback(routeDevice());
    }
  } catch {
    // Paused elsewhere already; the state above is what matters.
  }
}

/**
 * Plays again from where it stopped. Starts the playlist over only when
 * there is nothing to continue: the route is gone, or Spotify refuses.
 */
export async function resumeSpotify(volume: number): Promise<void> {
  const playlist = state.current;
  if (!playlist) return;
  const route = state.route;
  if (route?.kind === 'sdk' && hasSdkPlayer()) {
    expectPlaying(true);
    if (await resumeSdk()) return;
  }
  if (route?.kind === 'device') {
    try {
      expectPlaying(true);
      await resumePlayback(route.deviceId);
      syncPolling();
      return;
    } catch {
      // The device went away or has nothing queued: start the playlist again below.
    }
  }
  await playPlaylist(playlist, volume);
}

async function skip(direction: 1 | -1): Promise<void> {
  if (isBusy()) return reportBusy();
  try {
    if (!(state.route?.kind === 'sdk' && (await skipSdk(direction)))) {
      await (direction === 1 ? skipNext(routeDevice()) : skipPrevious(routeDevice()));
    }
    // The in-tab player announces the new track itself; a device is asked.
    if (state.route?.kind === 'device') setTimeout(() => void pollOnce(), 500);
  } catch (e) {
    fail(e);
  }
}

export const nextSpotifyTrack = (): Promise<void> => skip(1);
export const previousSpotifyTrack = (): Promise<void> => skip(-1);

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
  knownVolume = volume;
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
    syncPolling();
  } catch (e) {
    set({ error: message(e) });
  }
}

export function signOutOfSpotify(): void {
  resetPlayerTracking();
  clearMedia();
  teardownSdk();
  disconnectSpotify();
}

export const dismissSpotifyError = () => set({ error: null });

// ---------------------------------------------------------------- player state
//
// Spotify's answers (the in-tab player's events, or polling a device) land in
// `applySnapshot`. The controls write an expectation into `pending` first, so
// a press shows at once and the next answer confirms or corrects it.

let knownVolume = 0.6;
let serverControls: Controls = { shuffle: false, repeat: 'off', playing: false, liked: null };
let pending: Pending = {};
let busyUntil = 0;
let busyTimer: ReturnType<typeof setTimeout> | null = null;
let pollTimer: ReturnType<typeof setTimeout> | null = null;

// The in-tab player pushes every change; events that arrive before its route is set belong to the play in progress.
onSdkState((raw) => {
  if (state.route === null || state.route.kind === 'sdk') applySnapshot(snapshotFromSdk(raw));
});

const isBusy = () => Date.now() < busyUntil;
const reportBusy = () => set({ error: apiErrorMessage(429, '', null) });

/** Shows what is expected until Spotify says otherwise. */
function refreshControls() {
  const c = overlay(serverControls, pending, Date.now());
  const patch: Partial<SpotifyState> = {};
  if (c.shuffle !== state.shuffle) patch.shuffle = c.shuffle;
  if (c.repeat !== state.repeat) patch.repeat = c.repeat;
  if (c.playing !== state.playing) patch.playing = c.playing;
  if (c.liked !== state.liked) patch.liked = c.liked;
  if (Object.keys(patch).length) set(patch);
}

/** The playhead now, in milliseconds. */
export function spotifyPositionMs(s: SpotifyState = state, now = Date.now()): number {
  return extrapolate(s.positionMs, s.positionAt, now, s.playing, s.durationMs);
}

function expectPlaying(value: boolean) {
  const now = Date.now();
  // Stamp the clock so the bar stops where it was, or runs on from there.
  set({ positionMs: spotifyPositionMs(state, now), positionAt: now });
  pending = { ...pending, playing: { value, at: now } };
  refreshControls();
  publishSpotifyMedia();
}

function resetPlayerTracking() {
  serverControls = { shuffle: false, repeat: 'off', playing: false, liked: null };
  pending = {};
  stopPolling();
}

/** A failed call. A 429 holds the controls and polling for as long as Spotify asked. */
function fail(e: unknown) {
  if (e instanceof SpotifyError && e.status === 429) {
    busyUntil = Date.now() + (e.retryAfter || 5000);
    set({ busy: true, error: message(e) });
    if (busyTimer) clearTimeout(busyTimer);
    busyTimer = setTimeout(() => {
      busyTimer = null;
      set({ busy: false });
    }, busyUntil - Date.now());
    return;
  }
  set({ error: message(e) });
}

function applySnapshot(snap: PlayerSnapshot | null) {
  if (!snap || !snap.track) return;
  const now = Date.now();
  const changed = snap.track.uri !== state.track?.uri;
  serverControls = { ...serverControls, shuffle: snap.shuffle, repeat: snap.repeat, playing: snap.playing, liked: changed ? null : serverControls.liked };
  pending = reconcile(pending, { shuffle: snap.shuffle, repeat: snap.repeat, playing: snap.playing }, now);
  set({
    track: snap.track,
    positionMs: snap.positionMs,
    positionAt: now,
    durationMs: snap.durationMs,
    upNext: snap.upNext.length ? snap.upNext : changed ? [] : state.upNext,
  });
  refreshControls();
  if (changed && snap.track.id && canLikeTracks()) void refreshLiked(snap.track.id);
  publishSpotifyMedia();
}

async function pollOnce(): Promise<void> {
  if (state.route?.kind !== 'device' || !readTokens() || isBusy()) return;
  try {
    applySnapshot(await fetchPlayer());
  } catch (e) {
    if (e instanceof SpotifyError && e.status === 429) fail(e);
    // Anything else is a missed poll; the next one tries again.
  }
}

function stopPolling() {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
}

/** Follows a device route by polling while there is a playlist; the in-tab player pushes its own state. */
function syncPolling() {
  if (state.route?.kind !== 'device' || !state.current) return stopPolling();
  if (pollTimer) return;
  const schedule = () => {
    pollTimer = setTimeout(() => void tick(), pollDelay(state.playing, Math.max(0, busyUntil - Date.now())));
  };
  const tick = async () => {
    pollTimer = null;
    if (state.route?.kind !== 'device' || !state.current || !readTokens()) return;
    if (!document.hidden) await pollOnce();
    if (state.route?.kind === 'device' && !pollTimer) schedule();
  };
  pollTimer = setTimeout(() => void tick(), 0);
}

/** Whether the grant allows liking. Sign-ins from before the heart lack it until they reconnect. */
export const canLikeTracks = (): boolean => grantedScopes(readTokens()).includes('user-library-modify');

async function refreshLiked(id: string) {
  try {
    const liked = await isTrackSaved(id);
    if (state.track?.id !== id) return;
    serverControls = { ...serverControls, liked };
    refreshControls();
  } catch {
    // Unknown stays unknown; the heart says so.
  }
}

/** Runs `send` with `field` shown as `value` at once. A failure takes the expectation back. */
async function optimistic<K extends 'shuffle' | 'repeat' | 'liked'>(field: K, value: NonNullable<Controls[K]>, send: () => Promise<void>) {
  if (isBusy()) return reportBusy();
  pending = { ...pending, [field]: { value, at: Date.now() } } as Pending;
  refreshControls();
  try {
    await send();
    // Accepted: it stands until Spotify's next answer, which may still carry the old value.
    serverControls = { ...serverControls, [field]: value };
  } catch (e) {
    pending = { ...pending };
    delete pending[field];
    fail(e);
  }
  refreshControls();
}

export const toggleSpotifyShuffle = (): Promise<void> => {
  const on = !state.shuffle;
  return optimistic('shuffle', on, () => setShuffleState(on, routeDevice()));
};

export const cycleSpotifyRepeat = (): Promise<void> => {
  const mode = nextRepeat(state.repeat);
  return optimistic('repeat', mode, () => setRepeatState(mode, routeDevice()));
};

export const toggleSpotifyLike = async (): Promise<void> => {
  const id = state.track?.id;
  if (!id || state.liked === null || !canLikeTracks()) return;
  const on = !state.liked;
  await optimistic('liked', on, () => setTrackSaved(id, on));
};

/** Moves the playhead; the bar jumps at once. */
export async function seekSpotify(seconds: number): Promise<void> {
  if (isBusy()) return reportBusy();
  const ms = Math.max(0, Math.round(seconds * 1000));
  set({ positionMs: ms, positionAt: Date.now() });
  try {
    if (!(state.route?.kind === 'sdk' && (await seekSdk(ms)))) await seekTo(ms, routeDevice());
  } catch (e) {
    fail(e);
    void pollOnce();
  }
}

/** The tracks after this one. The API's queue is longer than the in-tab player's window. */
export async function loadUpNext(): Promise<void> {
  if (!state.route || state.route.kind === 'embed' || isBusy()) return;
  try {
    const queue = await fetchQueue();
    if (queue.length) set({ upNext: queue.slice(0, 8) });
  } catch (e) {
    if (e instanceof SpotifyError && e.status === 429) fail(e);
  }
}

function publishSpotifyMedia() {
  const t = state.track;
  if (!t || state.route?.kind === 'embed') return;
  publishMedia(
    { title: t.title, artist: t.artist, album: t.album, artwork: t.image },
    {
      play: () => void resumeSpotify(knownVolume),
      pause: () => void pauseSpotify(),
      next: () => void nextSpotifyTrack(),
      previous: () => void previousSpotifyTrack(),
      seekTo: (s) => void seekSpotify(s),
    },
    state.playing,
    state.durationMs > 0 ? { position: spotifyPositionMs() / 1000, duration: state.durationMs / 1000 } : undefined
  );
}

/** Reloads the person's open Spotify devices for the picker. */
export async function refreshSpotifyDevices(): Promise<void> {
  if (isBusy()) return;
  try {
    set({ devices: await fetchDevices() });
  } catch (e) {
    if (e instanceof SpotifyError && e.status === 429) fail(e);
  }
}
