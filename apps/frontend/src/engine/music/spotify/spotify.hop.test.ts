// @vitest-environment jsdom
/**
 * The hop from a loopback alias to the sign-in address, the capability
 * messages per account type, the return-path check, token refresh failures,
 * resuming in place, and the cross-tab claim.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  accessToken,
  beginSpotifySignIn,
  readTokens,
  resumeSpotifyIntent,
  safeReturnTo,
  storeTokens,
  takeSpotifyIntent,
  TOKEN_URL,
  type LocationLike,
} from './auth';
import { DEV_MODE_MESSAGE, playbackNotice } from './messages';
import { getSpotifyState, pauseSpotify, playPlaylist, resumeSpotify, signOutOfSpotify, loadLibrary } from './spotifyStore';
import { ensureSdkDevice, hasSdkPlayer, pauseSdk, resumeSdk } from './playback';
import { claimPlayback, onOtherTabClaim, resetCrossTab } from '../crossTab';

vi.mock('./playback', async (original) => ({
  ...(await original<typeof import('./playback')>()),
  ensureSdkDevice: vi.fn(),
  teardownSdk: vi.fn(),
  setSdkVolume: vi.fn(),
  hasSdkPlayer: vi.fn(() => true),
  pauseSdk: vi.fn(async () => true),
  resumeSdk: vi.fn(async () => true),
}));

const at = (href: string): LocationLike => {
  const u = new URL(href);
  return { protocol: u.protocol, hostname: u.hostname, port: u.port, origin: u.origin, pathname: u.pathname, search: u.search, hash: u.hash };
};
const json = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

beforeEach(() => {
  vi.stubEnv('VITE_SPOTIFY_CLIENT_ID', 'client-123');
  sessionStorage.clear();
  signOutOfSpotify();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.mocked(ensureSdkDevice).mockReset();
});

describe('the loopback hop', () => {
  it('connect from localhost navigates to 127.0.0.1 with the intent flag, keeping the page', async () => {
    const navigate = vi.fn();
    await beginSpotifySignIn(at('http://localhost:5173/room/abc?x=1'), navigate);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('http://127.0.0.1:5173/room/abc?x=1&spotify=connect');
  });

  it('on arrival the flag starts sign-in and is stripped from the address', async () => {
    const replace = vi.fn();
    const navigate = vi.fn();
    const handled = await resumeSpotifyIntent(at('http://127.0.0.1:5173/room/abc?x=1&spotify=connect#h'), replace, navigate);
    expect(handled).toBe(true);
    expect(replace).toHaveBeenCalledWith('/room/abc?x=1#h');
    const url = new URL(navigate.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe('https://accounts.spotify.com/authorize');
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:5173/spotify-callback');
    // The return address is the page without the flag.
    expect(JSON.parse(sessionStorage.getItem('vega.spotify.pending')!).returnTo).toBe('/room/abc?x=1#h');
  });

  it('does nothing without the flag, or when already connected', async () => {
    const replace = vi.fn();
    const navigate = vi.fn();
    expect(await resumeSpotifyIntent(at('http://127.0.0.1:5173/room/abc'), replace, navigate)).toBe(false);
    expect(replace).not.toHaveBeenCalled();
    storeTokens({ accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 3_600_000, scope: '' });
    expect(await resumeSpotifyIntent(at('http://127.0.0.1:5173/?spotify=connect'), replace, navigate)).toBe(true);
    expect(replace).toHaveBeenCalledWith('/');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('leaves other query parameters alone and ignores other values', () => {
    const replace = vi.fn();
    expect(takeSpotifyIntent(at('http://127.0.0.1:5173/?spotify=other'), replace)).toBeNull();
    expect(takeSpotifyIntent(at('http://127.0.0.1:5173/p?a=1&spotify=connect&b=2'), replace)?.search).toBe('?a=1&b=2');
    expect(replace).toHaveBeenCalledWith('/p?a=1&b=2');
  });

  it('leaves a notice instead of navigating when sign-in is not set up', async () => {
    vi.stubEnv('VITE_SPOTIFY_CLIENT_ID', '');
    const navigate = vi.fn();
    await resumeSpotifyIntent(at('http://127.0.0.1:5173/?spotify=connect'), vi.fn(), navigate);
    expect(navigate).not.toHaveBeenCalled();
    expect(JSON.parse(sessionStorage.getItem('vega.spotify.notice')!).status).toBe('error');
  });
});

describe('what the player says about how it plays', () => {
  const sdk = { kind: 'sdk' } as const;
  const embed = { kind: 'embed' } as const;
  const base = { hasStreamingScope: true, sdkFailure: null, liked: false };

  it('says nothing for Premium playing in the board', () => {
    expect(playbackNotice({ ...base, premium: true, route: sdk })).toBeNull();
  });

  it('tells a free account about previews at the moment of play, with a way to the full track', () => {
    expect(playbackNotice({ ...base, premium: false, route: embed })).toEqual({
      text: 'Free accounts play 30-second previews here. Open Spotify on any device to play full tracks there.',
      reconnect: false,
      action: 'open',
    });
  });

  it('keeps device names and developer details out of the quiet lines', () => {
    const lines = [
      playbackNotice({ ...base, premium: true, route: { kind: 'device', deviceId: 'd', name: 'Phone' } }),
      playbackNotice({ ...base, premium: true, route: embed }),
      playbackNotice({ ...base, premium: false, route: embed, liked: true }),
    ].map((n) => n?.text ?? '');
    for (const line of lines) expect(line).not.toMatch(/PKCE|redirect|origin|loopback|127\.0\.0\.1|localhost/i);
  });

  it('explains an account missing from a limited-access app, without owner details', () => {
    expect(DEV_MODE_MESSAGE).toBe('This Spotify app is in limited access. Ask the board owner to add your Spotify account.');
  });
});

describe('return path after sign-in', () => {
  const origin = 'https://vscanva.vercel.app';
  it('keeps same-site paths', () => {
    expect(safeReturnTo('/room/abc?x=1#h', origin)).toBe('/room/abc?x=1#h');
    expect(safeReturnTo('/', origin)).toBe('/');
  });
  it('rejects anything another site could answer to', () => {
    for (const bad of ['/\\evil.com', '//evil.com', '/\\/evil.com', 'https://evil.com', 'evil.com', '/\t/evil.com', '/\n/evil.com', '', null, 42]) {
      expect(safeReturnTo(bad, origin)).toBe('/');
    }
  });
});

describe('a refresh that fails', () => {
  const expired = () => storeTokens({ accessToken: 'old', refreshToken: 'r1', expiresAt: Date.now() - 1, scope: 'streaming' });

  it('keeps the tokens when Spotify cannot be reached', async () => {
    expired();
    const offline = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await accessToken(offline as unknown as typeof fetch)).toBeNull();
    expect(readTokens()?.refreshToken).toBe('r1');
  });

  it('keeps the tokens on a 5xx, and uses a token that has not expired yet', async () => {
    storeTokens({ accessToken: 'still-good', refreshToken: 'r1', expiresAt: Date.now() + 30_000, scope: '' });
    const down = vi.fn(async () => json(503, {}));
    expect(await accessToken(down as unknown as typeof fetch)).toBe('still-good');
    expect(readTokens()).not.toBeNull();
  });

  it('signs out on invalid_grant, and on a 400 or 401 from the token endpoint', async () => {
    for (const [status, body] of [
      [400, { error: 'invalid_grant' }],
      [400, {}],
      [401, {}],
    ] as const) {
      expired();
      const refused = vi.fn(async (url: string) => (url === TOKEN_URL ? json(status, body) : json(404, {})));
      expect(await accessToken(refused as unknown as typeof fetch)).toBeNull();
      expect(readTokens()).toBeNull();
    }
  });

  it('does not report a sign-out to the player when the library cannot load offline', async () => {
    expired();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      })
    );
    await loadLibrary();
    expect(getSpotifyState().connected).toBe(true);
    expect(getSpotifyState().error).toMatch(/isn't responding/);
  });
});

describe('pause and resume', () => {
  const playlist = { id: 'p1', name: 'Deep Focus', uri: 'spotify:playlist:p1', owner: 'Spotify', tracks: 1, image: null, kind: 'playlist' as const };

  async function playingInTab() {
    storeTokens({ accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 3_600_000, scope: 'streaming user-modify-playback-state' });
    const calls: { path: string; method?: string; body?: unknown }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init: RequestInit = {}) => {
        const u = new URL(input);
        calls.push({ path: u.pathname, method: init.method, body: init.body });
        if (u.pathname === '/v1/me') return json(200, { id: 'a', product: 'premium' });
        if (u.pathname === '/v1/me/tracks') return json(200, { total: 0 });
        if (u.pathname === '/v1/me/playlists') return json(200, { items: [], next: null });
        if (u.pathname === '/v1/me/player/devices') return json(200, { devices: [] });
        return json(204, null);
      })
    );
    await loadLibrary();
    vi.mocked(ensureSdkDevice).mockResolvedValue({ deviceId: 'tab-1', failure: null });
    await playPlaylist(playlist, 0.5);
    calls.length = 0;
    return calls;
  }

  it('Space after pause resumes the in-tab player in place, without restarting the playlist', async () => {
    const calls = await playingInTab();
    await pauseSpotify();
    expect(pauseSdk).toHaveBeenCalled();
    expect(getSpotifyState().playing).toBe(false);
    await resumeSpotify(0.5);
    expect(resumeSdk).toHaveBeenCalled();
    expect(getSpotifyState().playing).toBe(true);
    expect(calls.filter((c) => c.path === '/v1/me/player/play')).toHaveLength(0);
  });

  it('on a device it sends an empty play request; the playlist starts over only if that fails', async () => {
    storeTokens({ accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 3_600_000, scope: 'user-modify-playback-state' });
    const calls: { path: string; body?: unknown }[] = [];
    let refuse = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init: RequestInit = {}) => {
        const u = new URL(input);
        calls.push({ path: u.pathname, body: init.body });
        if (u.pathname === '/v1/me') return json(200, { id: 'a', product: 'premium' });
        if (u.pathname === '/v1/me/tracks') return json(200, { total: 0 });
        if (u.pathname === '/v1/me/playlists') return json(200, { items: [], next: null });
        if (u.pathname === '/v1/me/player/devices') return json(200, { devices: [{ id: 'd1', name: 'Phone', type: 'Smartphone', is_active: true }] });
        if (u.pathname === '/v1/me/player/play' && refuse && init.body === undefined) return json(404, { error: { message: 'gone', reason: 'NO_ACTIVE_DEVICE' } });
        return json(204, null);
      })
    );
    await loadLibrary();
    await playPlaylist(playlist, 0.5);
    await pauseSpotify();
    calls.length = 0;
    await resumeSpotify(0.5);
    expect(calls).toEqual([{ path: '/v1/me/player/play', body: undefined }]);

    await pauseSpotify();
    refuse = true;
    calls.length = 0;
    await resumeSpotify(0.5);
    const plays = calls.filter((c) => c.path === '/v1/me/player/play');
    expect(plays).toHaveLength(2);
    expect(JSON.parse(String(plays[1].body))).toEqual({ context_uri: 'spotify:playlist:p1' });
  });
});

describe('one tab plays at a time', () => {
  afterEach(() => {
    resetCrossTab();
    vi.unstubAllGlobals();
  });

  it('a claim reaches other tabs through BroadcastChannel, never its own', () => {
    const channels: FakeChannel[] = [];
    class FakeChannel {
      listeners = new Set<(e: MessageEvent) => void>();
      constructor() {
        channels.push(this);
      }
      postMessage(data: unknown) {
        // Another tab's channel: a distinct listener set. Deliver to every other instance.
        for (const c of channels) if (c !== this) c.listeners.forEach((fn) => fn({ data } as MessageEvent));
      }
      addEventListener(_: string, fn: (e: MessageEvent) => void) {
        this.listeners.add(fn);
      }
      removeEventListener(_: string, fn: (e: MessageEvent) => void) {
        this.listeners.delete(fn);
      }
      close() {}
    }
    vi.stubGlobal('BroadcastChannel', FakeChannel);
    resetCrossTab();
    const heard = vi.fn();
    onOtherTabClaim(heard);
    claimPlayback();
    // The only other instance would be another tab; this one hears nothing from itself.
    expect(heard).not.toHaveBeenCalled();
    channels[0].listeners.forEach((fn) => fn({ data: { tab: 'someone-else', at: 1 } } as MessageEvent));
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('falls back to storage events without BroadcastChannel', () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    resetCrossTab();
    const heard = vi.fn();
    const off = onOtherTabClaim(heard);
    window.dispatchEvent(new StorageEvent('storage', { key: 'vega.music.claim', newValue: JSON.stringify({ tab: 'other', at: 1 }) }));
    expect(heard).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated', newValue: '{}' }));
    expect(heard).toHaveBeenCalledTimes(1);
    off();
    window.dispatchEvent(new StorageEvent('storage', { key: 'vega.music.claim', newValue: JSON.stringify({ tab: 'other', at: 2 }) }));
    expect(heard).toHaveBeenCalledTimes(1);
    expect(hasSdkPlayer).toBeDefined();
  });
});
