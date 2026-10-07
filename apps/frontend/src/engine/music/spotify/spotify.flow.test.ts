// @vitest-environment jsdom
/**
 * The whole Spotify journey with the network mocked: connect, consent,
 * token exchange, profile and library, refresh, playback routing, the errors
 * people actually hit, and disconnecting.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SPOTIFY_SCOPES,
  SpotifySignInError,
  TOKEN_URL,
  beginSpotifySignIn,
  completeSpotifySignIn,
  readTokens,
  redirectUri,
  signInOrigin,
  spotifyConfigured,
  storeTokens,
  type LocationLike,
} from './auth';
import { challengeFor } from './pkce';
import { getSpotifyState, loadLibrary, playPlaylist, signOutOfSpotify } from './spotifyStore';
import { ensureSdkDevice } from './playback';
import { DEV_MODE_MESSAGE } from './messages';

vi.mock('./playback', async (original) => ({
  ...(await original<typeof import('./playback')>()),
  ensureSdkDevice: vi.fn(),
  teardownSdk: vi.fn(),
  setSdkVolume: vi.fn(),
}));

const at = (href: string): LocationLike => {
  const u = new URL(href);
  return { protocol: u.protocol, hostname: u.hostname, port: u.port, origin: u.origin, pathname: u.pathname, search: u.search, hash: u.hash };
};

const json = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

type Route = (url: URL, init: RequestInit) => Response | undefined;

/** A fake Spotify: routes by path, records every call. */
function fakeSpotify(routes: Route) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = vi.fn(async (input: string, init: RequestInit = {}) => {
    calls.push({ url: input, init });
    const res = routes(new URL(input), init);
    if (!res) throw new Error(`Unexpected request ${input}`);
    return res;
  });
  vi.stubGlobal('fetch', impl);
  return { impl: impl as unknown as typeof fetch, calls };
}

const bearer = (init: RequestInit) => (init.headers as Record<string, string>).Authorization;

const PROFILE = { id: 'ana', display_name: 'Ana', product: 'premium', country: 'GB' };
const PLAYLISTS = {
  items: [{ id: 'p1', name: 'Deep Focus', uri: 'spotify:playlist:p1', owner: { display_name: 'Spotify' }, tracks: { total: 120 }, images: [{ url: 'https://i.scdn.co/x' }] }],
  next: null,
};

beforeEach(() => {
  vi.stubEnv('VITE_SPOTIFY_CLIENT_ID', 'client-123');
  sessionStorage.clear();
  signOutOfSpotify();
  vi.mocked(ensureSdkDevice).mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('redirect URI', () => {
  it('is exactly the registered production and local addresses', () => {
    expect(redirectUri(at('https://vscanva.vercel.app/room/abc?x=1#y'))).toBe('https://vscanva.vercel.app/spotify-callback');
    expect(redirectUri(at('http://127.0.0.1:5173/'))).toBe('http://127.0.0.1:5173/spotify-callback');
    expect(signInOrigin(at('https://vscanva.vercel.app/room/abc'))).toBeNull();
    expect(signInOrigin(at('http://127.0.0.1:5173/'))).toBeNull();
  });

  it('uses 127.0.0.1 for a dev server opened at localhost, and hops there by itself', async () => {
    expect(redirectUri(at('http://localhost:5173/room/abc'))).toBe('http://127.0.0.1:5173/spotify-callback');
    expect(signInOrigin(at('http://localhost:5173/room/abc'))).toBe('http://127.0.0.1:5173');
    const navigate = vi.fn();
    await expect(beginSpotifySignIn(at('http://localhost:5173/room/abc?x=1#h'), navigate)).resolves.toBe('hopped');
    expect(navigate).toHaveBeenCalledWith('http://127.0.0.1:5173/room/abc?x=1&spotify=connect#h');
    // Nothing is stored at the wrong origin.
    expect(sessionStorage.getItem('vega.spotify.pending')).toBeNull();
  });

  it('never shows an address when sign-in cannot start from a page', async () => {
    vi.stubEnv('VITE_SPOTIFY_REDIRECT_URI', 'https://vscanva.vercel.app/spotify-callback');
    const error = await beginSpotifySignIn(at('https://preview-123.vercel.app/'), vi.fn()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SpotifySignInError);
    expect((error as Error).message).not.toMatch(/vercel|127\.0\.0\.1|localhost|http|origin|redirect/i);
  });

  it('honours a configured URI without a trailing slash', () => {
    vi.stubEnv('VITE_SPOTIFY_REDIRECT_URI', 'https://vscanva.vercel.app/spotify-callback/');
    expect(redirectUri(at('https://preview-123.vercel.app/'))).toBe('https://vscanva.vercel.app/spotify-callback');
    expect(signInOrigin(at('https://preview-123.vercel.app/'))).toBe('https://vscanva.vercel.app');
  });

  it('says Spotify is not configured without a client ID', async () => {
    vi.stubEnv('VITE_SPOTIFY_CLIENT_ID', '');
    expect(spotifyConfigured()).toBe(false);
    await expect(beginSpotifySignIn(at('http://127.0.0.1:5173/'), vi.fn())).rejects.toThrow(/isn't available/);
  });
});

describe('connecting and listening', () => {
  async function signIn(scope = SPOTIFY_SCOPES.join(' ')) {
    let authorize = '';
    await beginSpotifySignIn(at('http://127.0.0.1:5173/room/abc?x=1'), (url) => (authorize = url));
    const q = new URL(authorize).searchParams;
    const tokenEndpoint = vi.fn(async (_u: string, init: RequestInit) => {
      const form = new URLSearchParams(String(init.body));
      expect(form.get('grant_type')).toBe('authorization_code');
      expect(form.get('redirect_uri')).toBe('http://127.0.0.1:5173/spotify-callback');
      return json(200, { access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600, scope });
    });
    const done = await completeSpotifySignIn(`?code=the-code&state=${q.get('state')}`, tokenEndpoint as unknown as typeof fetch);
    return { authorize: new URL(authorize), done, tokenEndpoint };
  }

  it('builds the consent URL with PKCE, state and every scope', async () => {
    const { authorize } = await signIn();
    const q = authorize.searchParams;
    expect(authorize.origin + authorize.pathname).toBe('https://accounts.spotify.com/authorize');
    expect(q.get('client_id')).toBe('client-123');
    expect(q.get('response_type')).toBe('code');
    expect(q.get('redirect_uri')).toBe('http://127.0.0.1:5173/spotify-callback');
    expect(q.get('code_challenge_method')).toBe('S256');
    expect(q.get('state')).toMatch(/^[A-Za-z0-9_-]{16,}$/);
    expect(q.get('scope')!.split(' ')).toEqual([...SPOTIFY_SCOPES]);
    expect(q.get('scope')).toContain('streaming');
  });

  it('sends the verifier matching the challenge, then loads the profile, playlists and Liked Songs', async () => {
    let authorize = '';
    await beginSpotifySignIn(at('http://127.0.0.1:5173/room/abc'), (url) => (authorize = url));
    const q = new URL(authorize).searchParams;
    const token = vi.fn(async (_u: string, init: RequestInit) => {
      const verifier = new URLSearchParams(String(init.body)).get('code_verifier')!;
      expect(await challengeFor(verifier)).toBe(q.get('code_challenge'));
      return json(200, { access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600, scope: 'streaming' });
    });
    const done = await completeSpotifySignIn(`?code=c&state=${q.get('state')}`, token as unknown as typeof fetch);
    expect(done).toEqual({ result: { status: 'connected' }, returnTo: '/room/abc' });
    expect(token).toHaveBeenCalledTimes(1);

    const api = fakeSpotify((url, init) => {
      expect(bearer(init)).toBe('Bearer access-1');
      if (url.pathname === '/v1/me') return json(200, PROFILE);
      if (url.pathname === '/v1/me/tracks') return json(200, { total: 42 });
      if (url.pathname === '/v1/me/playlists') return json(200, PLAYLISTS);
    });
    await loadLibrary();
    const s = getSpotifyState();
    expect(s.error).toBeNull();
    expect(s.connected).toBe(true);
    expect(s.profile).toEqual({ name: 'Ana', product: 'premium', country: 'GB', image: null });
    expect(s.playlists.map((p) => [p.kind, p.name, p.tracks])).toEqual([
      ['liked', 'Liked Songs', 42],
      ['playlist', 'Deep Focus', 120],
    ]);
    expect(api.calls).toHaveLength(3);
  });

  it('refreshes and retries once when Spotify answers 401', async () => {
    await signIn();
    let first = true;
    fakeSpotify((url, init) => {
      if (url.href === TOKEN_URL) {
        expect(new URLSearchParams(String(init.body)).get('grant_type')).toBe('refresh_token');
        return json(200, { access_token: 'access-2', expires_in: 3600 });
      }
      if (url.pathname === '/v1/me') {
        if (first) {
          first = false;
          return json(401, { error: { status: 401, message: 'The access token expired' } });
        }
        expect(bearer(init)).toBe('Bearer access-2');
        return json(200, PROFILE);
      }
      if (url.pathname === '/v1/me/tracks') return json(200, { total: 0 });
      if (url.pathname === '/v1/me/playlists') return json(200, { items: [], next: null });
    });
    await loadLibrary();
    expect(getSpotifyState().profile?.name).toBe('Ana');
    expect(readTokens()).toMatchObject({ accessToken: 'access-2', refreshToken: 'refresh-1' });
  });

  it('refreshes an expired token before calling at all', async () => {
    storeTokens({ accessToken: 'stale', refreshToken: 'refresh-1', expiresAt: Date.now() - 1, scope: 'streaming' });
    const api = fakeSpotify((url, init) => {
      if (url.href === TOKEN_URL) return json(200, { access_token: 'fresh', expires_in: 3600 });
      expect(bearer(init)).toBe('Bearer fresh');
      if (url.pathname === '/v1/me') return json(200, PROFILE);
      if (url.pathname === '/v1/me/tracks') return json(200, { total: 0 });
      if (url.pathname === '/v1/me/playlists') return json(200, { items: [], next: null });
    });
    await loadLibrary();
    expect(api.calls[0].url).toBe(TOKEN_URL);
    expect(getSpotifyState().profile?.name).toBe('Ana');
  });

  it('signs out when the refresh is refused, and offers to connect again', async () => {
    await signIn();
    fakeSpotify((url) => {
      if (url.href === TOKEN_URL) return json(400, { error: 'invalid_grant' });
      return json(401, { error: { status: 401, message: 'Invalid access token' } });
    });
    await loadLibrary();
    const s = getSpotifyState();
    expect(readTokens()).toBeNull();
    expect(s.connected).toBe(false);
    expect(s.error).toMatch(/Connect again/);
  });

  it('explains an allowlist refusal without signing out', async () => {
    await signIn();
    fakeSpotify((url) => {
      if (url.pathname === '/v1/me') return json(403, { error: { status: 403, message: 'Check settings on developer.spotify.com/dashboard, the user may not be registered.' } });
    });
    await loadLibrary();
    expect(DEV_MODE_MESSAGE).toBe('This Spotify app is in limited access. Ask the board owner to add your Spotify account.');
    expect(getSpotifyState()).toMatchObject({ limited: true, error: null, connected: true, loading: false });
  });

  it('explains a cancelled consent and a mismatched state', async () => {
    sessionStorage.setItem('vega.spotify.pending', JSON.stringify({ verifier: 'v'.repeat(64), state: 's1', returnTo: '/' }));
    const cancelled = await completeSpotifySignIn('?error=access_denied&state=s1');
    expect(cancelled.result).toEqual({ status: 'error', error: expect.stringMatching(/You cancelled the Spotify sign-in/) });
    sessionStorage.setItem('vega.spotify.pending', JSON.stringify({ verifier: 'v'.repeat(64), state: 's1', returnTo: '/' }));
    const forged = await completeSpotifySignIn('?code=c&state=other', vi.fn() as unknown as typeof fetch);
    expect(forged.result).toEqual({ status: 'error', error: expect.stringMatching(/couldn't be verified.*Connect again/) });
  });

  it('disconnects', async () => {
    await signIn();
    signOutOfSpotify();
    expect(readTokens()).toBeNull();
    expect(getSpotifyState().connected).toBe(false);
    expect(sessionStorage.getItem('vega.spotify.pending')).toBeNull();
  });
});

describe('playback routes', () => {
  const playlist = { id: 'p1', name: 'Deep Focus', uri: 'spotify:playlist:p1', owner: 'Spotify', tracks: 120, image: null, kind: 'playlist' as const };

  async function connectAs(product: string, scope: string) {
    storeTokens({ accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 3_600_000, scope });
    fakeSpotify((url) => {
      if (url.pathname === '/v1/me') return json(200, { ...PROFILE, product });
      if (url.pathname === '/v1/me/tracks') return json(200, { total: 0 });
      if (url.pathname === '/v1/me/playlists') return json(200, { items: [], next: null });
    });
    await loadLibrary();
  }

  it('plays in this tab with Premium', async () => {
    await connectAs('premium', SPOTIFY_SCOPES.join(' '));
    vi.mocked(ensureSdkDevice).mockResolvedValue({ deviceId: 'tab-1', failure: null });
    const api = fakeSpotify((url, init) => {
      if (url.pathname === '/v1/me/player/play') {
        expect(url.searchParams.get('device_id')).toBe('tab-1');
        expect(JSON.parse(String(init.body))).toEqual({ context_uri: 'spotify:playlist:p1' });
        return json(204, null);
      }
    });
    await playPlaylist(playlist, 0.6);
    expect(getSpotifyState()).toMatchObject({ route: { kind: 'sdk' }, playing: true, notice: null, error: null });
    expect(api.calls).toHaveLength(1);
  });

  it('plays on an open device when the grant lacks streaming, and offers to reconnect', async () => {
    await connectAs('premium', 'user-read-private user-modify-playback-state');
    fakeSpotify((url) => {
      if (url.pathname === '/v1/me/player/devices') return json(200, { devices: [{ id: 'd1', name: 'Phone', type: 'Smartphone', is_active: true }] });
      if (url.pathname === '/v1/me/player/play') return json(204, null);
    });
    await playPlaylist(playlist, 0.6);
    expect(ensureSdkDevice).not.toHaveBeenCalled();
    const s = getSpotifyState();
    expect(s.route).toEqual({ kind: 'device', deviceId: 'd1', name: 'Phone' });
    expect(s.notice).toEqual({ text: expect.stringMatching(/Playing on Phone\. Reconnect Spotify/), reconnect: true });
  });

  it('plays previews for a free account and says why', async () => {
    await connectAs('free', SPOTIFY_SCOPES.join(' '));
    const api = fakeSpotify(() => undefined);
    await playPlaylist(playlist, 0.6);
    const s = getSpotifyState();
    expect(s.route).toEqual({ kind: 'embed' });
    expect(s.embed).toMatch(/^https:\/\/open\.spotify\.com\/embed\/playlist\/p1/);
    expect(s.notice?.text).toMatch(/Free accounts play 30-second previews here\. Open Spotify on any device/);
    expect(api.calls).toHaveLength(0);
  });

  it('falls back to previews when Spotify refuses the account in the browser and nothing else is open', async () => {
    await connectAs('premium', SPOTIFY_SCOPES.join(' '));
    vi.mocked(ensureSdkDevice).mockResolvedValue({ deviceId: null, failure: 'account' });
    fakeSpotify((url) => {
      if (url.pathname === '/v1/me/player/devices') return json(200, { devices: [] });
    });
    await playPlaylist(playlist, 0.6);
    expect(getSpotifyState()).toMatchObject({ route: { kind: 'embed' }, playing: false, error: null });
    expect(getSpotifyState().notice?.text).toMatch(/previews play here/);
  });

  it('turns a Premium-required refusal into previews with a reason', async () => {
    await connectAs('premium', SPOTIFY_SCOPES.join(' '));
    vi.mocked(ensureSdkDevice).mockResolvedValue({ deviceId: 'tab-1', failure: null });
    fakeSpotify((url) => {
      if (url.pathname === '/v1/me/player/play') return json(403, { error: { status: 403, message: 'Player command failed: Premium required', reason: 'PREMIUM_REQUIRED' } });
    });
    await playPlaylist(playlist, 0.6);
    const s = getSpotifyState();
    expect(s.embed).toBeTruthy();
    expect(s.error).toBeNull();
    expect(s.notice?.text).toMatch(/Full tracks need Spotify Premium/);
  });
});
