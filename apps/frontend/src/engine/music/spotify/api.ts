/**
 * The few Spotify Web API calls the player makes.
 */
import { accessToken } from './auth';

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
}

export interface SpotifyDevice {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
}

export class SpotifyError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function call<T>(path: string, init: RequestInit = {}, fetchImpl: typeof fetch = fetch): Promise<T | null> {
  const token = await accessToken(fetchImpl);
  if (!token) throw new SpotifyError('Not connected to Spotify.', 401);
  const res = await fetchImpl(`${API}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  if (res.status === 204) return null;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message = body?.error?.message ?? `Spotify responded ${res.status}.`;
    throw new SpotifyError(message, res.status);
  }
  return body as T;
}

export async function fetchProfile(fetchImpl?: typeof fetch): Promise<SpotifyProfile> {
  const me = await call<{ display_name?: string; id: string; product?: string; country?: string }>('/me', {}, fetchImpl);
  return { name: me?.display_name || me?.id || 'Spotify', product: me?.product ?? 'free', country: me?.country ?? '' };
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

export async function pausePlayback(deviceId: string | null, fetchImpl?: typeof fetch): Promise<void> {
  const query = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : '';
  await call(`/me/player/pause${query}`, { method: 'PUT' }, fetchImpl);
}

export async function skipNext(deviceId: string | null, fetchImpl?: typeof fetch): Promise<void> {
  const query = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : '';
  await call(`/me/player/next${query}`, { method: 'POST' }, fetchImpl);
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
