/**
 * The few Spotify Web API calls the player makes.
 */
import { accessToken, readTokens } from './auth';
import { repeatToSpotify, retryAfterMs, snapshotFromApi, type PlayerSnapshot } from './playerSync';
import type { RepeatMode } from '../library/queue';

const API = 'https://api.spotify.com/v1';

export interface SpotifyPlaylist {
  id: string;
  name: string;
  /** `spotify:playlist:…`, or `spotify:collection` style URIs for Liked Songs. */
  uri: string;
  owner: string;
  tracks: number;
  image: string | null;
  kind: 'playlist' | 'liked';
}

export interface SpotifyProfile {
  name: string;
  /** 'premium' unlocks in-browser playback through the Web Playback SDK. */
  product: string;
  country: string;
  image: string | null;
}

export interface SpotifyDevice {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
}

export class SpotifyError extends Error {
  readonly status: number;
  /** Spotify's machine-readable reason, such as `PREMIUM_REQUIRED` or `NO_ACTIVE_DEVICE`. */
  readonly reason: string | null;
  /** Milliseconds Spotify asked us to wait (a 429's Retry-After); 0 otherwise. */
  readonly retryAfter: number;
  constructor(message: string, status: number, reason: string | null = null, retryAfter = 0) {
    super(message);
    this.status = status;
    this.reason = reason;
    this.retryAfter = retryAfter;
  }
}

/** One Web API call. A 401 refreshes the token and tries once more; a second 401 is an error. */
async function call<T>(path: string, init: RequestInit = {}, fetchImpl: typeof fetch = (...a) => fetch(...a)): Promise<T | null> {
  const send = async (force: boolean) => {
    const token = await accessToken(fetchImpl, Date.now(), force);
    // Tokens that survived a failed refresh mean Spotify could not be reached, not that the person signed out.
    if (!token) throw new SpotifyError(readTokens() ? "Spotify isn't responding." : 'Not connected to Spotify.', readTokens() ? 503 : 401);
    return fetchImpl(`${API}${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
  };
  let res = await send(false);
  if (res.status === 401) res = await send(true);
  if (res.status === 204) return null;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message = body?.error?.message ?? `Spotify responded ${res.status}.`;
    throw new SpotifyError(
      message,
      res.status,
      typeof body?.error?.reason === 'string' ? body.error.reason : null,
      res.status === 429 ? retryAfterMs(res.headers?.get?.('Retry-After')) : 0
    );
  }
  return body as T;
}

export async function fetchProfile(fetchImpl?: typeof fetch): Promise<SpotifyProfile> {
  const me = await call<{ display_name?: string; id: string; product?: string; country?: string; images?: { url: string }[] | null }>('/me', {}, fetchImpl);
  return {
    name: me?.display_name || me?.id || 'Spotify',
    product: me?.product ?? 'free',
    country: me?.country ?? '',
    image: me?.images?.[0]?.url ?? null,
  };
}

/** The person's playlists, with Liked Songs first. Capped at 100 playlists. */
export async function fetchPlaylists(fetchImpl?: typeof fetch): Promise<SpotifyPlaylist[]> {
  const out: SpotifyPlaylist[] = [];
  const liked = await call<{ total: number }>('/me/tracks?limit=1', {}, fetchImpl);
  if (liked && liked.total > 0) {
    out.push({ id: 'liked', name: 'Liked Songs', uri: 'liked', owner: 'You', tracks: liked.total, image: null, kind: 'liked' });
  }
  let next: string | null = '/me/playlists?limit=50';
  while (next && out.length < 101) {
    type Page = {
      items: { id: string; name: string; uri: string; owner?: { display_name?: string }; tracks?: { total: number }; images?: { url: string }[] | null }[];
      next: string | null;
    };
    const page: Page | null = await call<Page>(next, {}, fetchImpl);
    if (!page) break;
    for (const p of page.items) {
      if (!p) continue;
      out.push({
        id: p.id,
        name: p.name,
        uri: p.uri,
        owner: p.owner?.display_name ?? '',
        tracks: p.tracks?.total ?? 0,
        image: p.images?.[0]?.url ?? null,
        kind: 'playlist',
      });
    }
    next = page.next ? page.next.replace(API, '') : null;
  }
  return out;
}

export async function fetchDevices(fetchImpl?: typeof fetch): Promise<SpotifyDevice[]> {
  const body = await call<{ devices: { id: string; name: string; type: string; is_active: boolean }[] }>('/me/player/devices', {}, fetchImpl);
  return (body?.devices ?? []).map((d) => ({ id: d.id, name: d.name, type: d.type, isActive: d.is_active }));
}

/** Liked Songs has no context URI; it is played as a list of its first tracks. */
async function likedUris(fetchImpl?: typeof fetch): Promise<string[]> {
  const body = await call<{ items: { track: { uri: string } | null }[] }>('/me/tracks?limit=50', {}, fetchImpl);
  return (body?.items ?? []).map((i) => i.track?.uri).filter((u): u is string => Boolean(u));
}

/** Starts a playlist (or Liked Songs) on a device. */
export async function startPlayback(playlist: SpotifyPlaylist, deviceId: string | null, fetchImpl?: typeof fetch): Promise<void> {
  const query = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : '';
  const body = playlist.kind === 'liked' ? { uris: await likedUris(fetchImpl) } : { context_uri: playlist.uri };
  await call(`/me/player/play${query}`, { method: 'PUT', body: JSON.stringify(body) }, fetchImpl);
}

/** Continues what the device was playing, where it stopped. An empty body means "resume". */
export async function resumePlayback(deviceId: string | null, fetchImpl?: typeof fetch): Promise<void> {
  const query = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : '';
  await call(`/me/player/play${query}`, { method: 'PUT' }, fetchImpl);
}

/** Moves playback to a device and keeps it playing. */
export async function transferPlayback(deviceId: string, fetchImpl?: typeof fetch): Promise<void> {
  await call('/me/player', { method: 'PUT', body: JSON.stringify({ device_ids: [deviceId], play: true }) }, fetchImpl);
}

/** Volume of a device, 0 to 100. */
export async function setDeviceVolume(percent: number, deviceId: string | null, fetchImpl?: typeof fetch): Promise<void> {
  const params = new URLSearchParams({ volume_percent: String(Math.round(Math.min(100, Math.max(0, percent)))) });
  if (deviceId) params.set('device_id', deviceId);
  await call(`/me/player/volume?${params.toString()}`, { method: 'PUT' }, fetchImpl);
}

export async function pausePlayback(deviceId: string | null, fetchImpl?: typeof fetch): Promise<void> {
  const query = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : '';
  await call(`/me/player/pause${query}`, { method: 'PUT' }, fetchImpl);
}

export async function skipNext(deviceId: string | null, fetchImpl?: typeof fetch): Promise<void> {
  const query = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : '';
  await call(`/me/player/next${query}`, { method: 'POST' }, fetchImpl);
}

/** The playlist in Spotify's own web player, where full tracks play. */
export function openInSpotifyUrl(playlist: SpotifyPlaylist): string {
  return playlist.kind === 'playlist' ? `https://open.spotify.com/playlist/${encodeURIComponent(playlist.id)}` : 'https://open.spotify.com/collection/tracks';
}

/** The embed URL for the final fallback: Spotify's own player in an iframe. */
export function embedUrl(playlist: SpotifyPlaylist): string | null {
  if (playlist.kind !== 'playlist') return null;
  return `https://open.spotify.com/embed/playlist/${encodeURIComponent(playlist.id)}?utm_source=generator&theme=0`;
}

export async function skipPrevious(deviceId: string | null, fetchImpl?: typeof fetch): Promise<void> {
  const query = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : '';
  await call(`/me/player/previous${query}`, { method: 'POST' }, fetchImpl);
}

const deviceQuery = (deviceId: string | null) => (deviceId ? `device_id=${encodeURIComponent(deviceId)}` : '');
const withDevice = (path: string, deviceId: string | null, extra = '') => {
  const q = [extra, deviceQuery(deviceId)].filter(Boolean).join('&');
  return q ? `${path}?${q}` : path;
};

/** Moves the playhead of the current track. */
export async function seekTo(positionMs: number, deviceId: string | null, fetchImpl?: typeof fetch): Promise<void> {
  await call(withDevice('/me/player/seek', deviceId, `position_ms=${Math.max(0, Math.round(positionMs))}`), { method: 'PUT' }, fetchImpl);
}

export async function setShuffleState(on: boolean, deviceId: string | null, fetchImpl?: typeof fetch): Promise<void> {
  await call(withDevice('/me/player/shuffle', deviceId, `state=${on}`), { method: 'PUT' }, fetchImpl);
}

export async function setRepeatState(mode: RepeatMode, deviceId: string | null, fetchImpl?: typeof fetch): Promise<void> {
  await call(withDevice('/me/player/repeat', deviceId, `state=${repeatToSpotify(mode)}`), { method: 'PUT' }, fetchImpl);
}

/** What is playing and how, or null when nothing is. */
export async function fetchPlayer(fetchImpl?: typeof fetch): Promise<PlayerSnapshot | null> {
  return snapshotFromApi(await call<unknown>('/me/player', {}, fetchImpl));
}

/** The next few tracks Spotify will play. */
export async function fetchQueue(fetchImpl?: typeof fetch): Promise<PlayerSnapshot['upNext']> {
  const body = await call<{ queue?: unknown[] }>('/me/player/queue', {}, fetchImpl);
  const items = (body?.queue ?? []).filter((i) => (i as { type?: string } | null)?.type !== 'episode');
  return items
    .map((item) => snapshotFromApi({ is_playing: false, item })?.track ?? null)
    .filter((t): t is NonNullable<typeof t> => t !== null);
}

/** Whether the track is in the person's Liked Songs. */
export async function isTrackSaved(id: string, fetchImpl?: typeof fetch): Promise<boolean> {
  const body = await call<boolean[]>(`/me/tracks/contains?ids=${encodeURIComponent(id)}`, {}, fetchImpl);
  return body?.[0] === true;
}

export async function setTrackSaved(id: string, saved: boolean, fetchImpl?: typeof fetch): Promise<void> {
  await call(`/me/tracks?ids=${encodeURIComponent(id)}`, { method: saved ? 'PUT' : 'DELETE' }, fetchImpl);
}
