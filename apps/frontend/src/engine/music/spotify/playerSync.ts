/**
 * Spotify's player state in the app's terms, and the optimistic layer that
 * keeps controls instant while Spotify catches up. Pure.
 *
 * A control writes its expected value into `pending`. Snapshots from Spotify
 * (the in-tab player's events, or polling) are merged through `reconcile`:
 * a snapshot that already shows the expected value settles it, one that still
 * shows the old value is ignored while the request is in flight, and an
 * expectation that outlives its window is dropped, so Spotify has the last say.
 */
import type { RepeatMode } from '../library/queue';

/** Spotify's repeat vocabulary. */
export type SpotifyRepeat = 'off' | 'context' | 'track';

export const repeatFromSpotify = (mode: SpotifyRepeat | number | string | undefined): RepeatMode => {
  // The in-tab player reports 0, 1, 2; the Web API reports names.
  if (mode === 'context' || mode === 1) return 'all';
  if (mode === 'track' || mode === 2) return 'one';
  return 'off';
};

export const repeatToSpotify = (mode: RepeatMode): SpotifyRepeat => (mode === 'all' ? 'context' : mode === 'one' ? 'track' : 'off');

/** Spotify's own order: off, then the whole playlist, then one track. */
export const nextRepeat = (mode: RepeatMode): RepeatMode => (mode === 'off' ? 'all' : mode === 'all' ? 'one' : 'off');

export interface SpotifyTrack {
  id: string | null;
  uri: string;
  title: string;
  artist: string;
  album: string;
  image: string | null;
}

export interface PlayerSnapshot {
  track: SpotifyTrack | null;
  playing: boolean;
  positionMs: number;
  durationMs: number;
  shuffle: boolean;
  repeat: RepeatMode;
  /** What plays after this track, when Spotify says. */
  upNext: SpotifyTrack[];
  /** Volume 0 to 1 when the source reports it. */
  volume: number | null;
}

interface RawTrack {
  id?: string | null;
  uri?: string;
  name?: string;
  artists?: { name?: string }[];
  album?: { name?: string; images?: { url?: string }[] };
}

const trackFrom = (t: RawTrack | null | undefined): SpotifyTrack | null => {
  if (!t || !t.uri) return null;
  return {
    id: t.id ?? null,
    uri: t.uri,
    title: t.name ?? '',
    artist: (t.artists ?? [])
      .map((a) => a.name)
      .filter(Boolean)
      .join(', '),
    album: t.album?.name ?? '',
    image: t.album?.images?.[0]?.url ?? null,
  };
};

/** The in-tab player's `player_state_changed` payload. Null when nothing is loaded. */
export function snapshotFromSdk(state: unknown): PlayerSnapshot | null {
  const s = state as {
    paused?: boolean;
    position?: number;
    duration?: number;
    shuffle?: boolean;
    repeat_mode?: number;
    track_window?: { current_track?: RawTrack; next_tracks?: RawTrack[] };
  } | null;
  const track = trackFrom(s?.track_window?.current_track);
  if (!s || !track) return null;
  return {
    track,
    playing: s.paused === false,
    positionMs: Math.max(0, s.position ?? 0),
    durationMs: Math.max(0, s.duration ?? 0),
    shuffle: s.shuffle === true,
    repeat: repeatFromSpotify(s.repeat_mode),
    upNext: (s.track_window?.next_tracks ?? []).map(trackFrom).filter((t): t is SpotifyTrack => t !== null),
    volume: null,
  };
}

/** `GET /me/player`. Null when nothing is playing or the item is not a track (an episode or an ad). */
export function snapshotFromApi(body: unknown): PlayerSnapshot | null {
  const b = body as {
    is_playing?: boolean;
    progress_ms?: number | null;
    shuffle_state?: boolean;
    repeat_state?: string;
    device?: { volume_percent?: number | null };
    item?: (RawTrack & { duration_ms?: number; type?: string }) | null;
  } | null;
  const item = b?.item;
  const track = item && item.type !== 'episode' ? trackFrom(item) : null;
  if (!b || !track || !item) return null;
  return {
    track,
    playing: b.is_playing === true,
    positionMs: Math.max(0, b.progress_ms ?? 0),
    durationMs: Math.max(0, item.duration_ms ?? 0),
    shuffle: b.shuffle_state === true,
    repeat: repeatFromSpotify(b.repeat_state),
    upNext: [],
    volume: typeof b.device?.volume_percent === 'number' ? b.device.volume_percent / 100 : null,
  };
}

export interface Controls {
  shuffle: boolean;
  repeat: RepeatMode;
  playing: boolean;
  liked: boolean | null;
}

type Expect<T> = { value: T; at: number };
export type Pending = { [K in keyof Controls]?: Expect<NonNullable<Controls[K]>> };

/** How long an expectation may stand in for Spotify's answer. */
export const PENDING_MS = 4000;

const live = <T>(p: Expect<T> | undefined, now: number): p is Expect<T> => p !== undefined && now - p.at < PENDING_MS;

/** The controls as shown: Spotify's last answer with unsettled expectations laid over it. */
export function overlay(server: Controls, pending: Pending, now: number): Controls {
  return {
    shuffle: live(pending.shuffle, now) ? pending.shuffle.value : server.shuffle,
    repeat: live(pending.repeat, now) ? pending.repeat.value : server.repeat,
    playing: live(pending.playing, now) ? pending.playing.value : server.playing,
    liked: live(pending.liked, now) ? pending.liked.value : server.liked,
  };
}

/** Settles every expectation the snapshot confirms and drops the ones that have expired. */
export function reconcile(pending: Pending, snapshot: Partial<Controls>, now: number): Pending {
  const out: Pending = {};
  if (live(pending.shuffle, now) && snapshot.shuffle !== pending.shuffle.value) out.shuffle = pending.shuffle;
  if (live(pending.repeat, now) && snapshot.repeat !== pending.repeat.value) out.repeat = pending.repeat;
  if (live(pending.playing, now) && snapshot.playing !== pending.playing.value) out.playing = pending.playing;
  if (live(pending.liked, now) && snapshot.liked !== pending.liked.value) out.liked = pending.liked;
  return out;
}

/** How long to wait before the next poll: slower when paused, and never before Spotify's Retry-After. */
export function pollDelay(playing: boolean, retryAfter: number): number {
  return Math.max(playing ? 4000 : 15000, retryAfter);
}

/** Milliseconds from a Retry-After header in seconds; a missing or odd one backs off a modest default. */
export function retryAfterMs(header: string | null | undefined): number {
  const n = Number(header);
  return Number.isFinite(n) && n > 0 ? Math.min(60, n) * 1000 : 5000;
}
