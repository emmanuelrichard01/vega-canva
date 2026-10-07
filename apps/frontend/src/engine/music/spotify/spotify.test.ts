// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { base64Url, challengeFor, createVerifier } from './pkce';
import {
  REFRESH_MARGIN_MS,
  TOKEN_URL,
  accessToken,
  completeSpotifySignIn,
  isSpotifyCallback,
  readTokens,
  storeTokens,
  tokensFromResponse,
} from './auth';
import { planPlayback } from './playback';

describe('pkce', () => {
  it('matches the RFC 7636 example', async () => {
    expect(await challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('makes verifiers of unreserved characters within the allowed length', () => {
    for (const len of [10, 43, 64, 200]) {
      const v = createVerifier(len);
      expect(v.length).toBeGreaterThanOrEqual(43);
      expect(v.length).toBeLessThanOrEqual(128);
      expect(v).toMatch(/^[A-Za-z0-9\-._~]+$/);
    }
  });

  it('rejects biased bytes rather than wrapping them', () => {
    // 255 is above the largest multiple of 66, so it must be skipped.
    let calls = 0;
    const v = createVerifier(43, (n) => {
      calls++;
      return new Uint8Array(n).fill(calls === 1 ? 255 : 0);
    });
    expect(v).toBe('A'.repeat(43));
  });

  it('encodes base64url without padding', () => {
    expect(base64Url(new Uint8Array([251, 255]))).toBe('-_8');
  });
});

const json = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

describe('tokens', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_SPOTIFY_CLIENT_ID', 'client-123');
    sessionStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('keeps the old refresh token when Spotify omits a new one', () => {
    const prev = { accessToken: 'a', refreshToken: 'r1', expiresAt: 0, scope: 's' };
    const next = tokensFromResponse({ access_token: 'b', expires_in: 3600 }, prev, 1000);
    expect(next).toEqual({ accessToken: 'b', refreshToken: 'r1', expiresAt: 1000 + 3_600_000, scope: 's' });
  });

  it('returns a fresh token without calling Spotify', async () => {
    storeTokens({ accessToken: 'live', refreshToken: 'r', expiresAt: Date.now() + 10 * 60_000, scope: '' });
    const fetchImpl = vi.fn();
    expect(await accessToken(fetchImpl as unknown as typeof fetch)).toBe('live');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refreshes near expiry, once for concurrent callers', async () => {
    const now = Date.now();
    storeTokens({ accessToken: 'old', refreshToken: 'r1', expiresAt: now + REFRESH_MARGIN_MS - 1, scope: 'x' });
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe(TOKEN_URL);
      const form = new URLSearchParams(String(init.body));
      expect(form.get('grant_type')).toBe('refresh_token');
      expect(form.get('refresh_token')).toBe('r1');
      expect(form.get('client_id')).toBe('client-123');
      return json(200, { access_token: 'new', refresh_token: 'r2', expires_in: 3600 });
    });
    const [a, b] = await Promise.all([
      accessToken(fetchImpl as unknown as typeof fetch, now),
      accessToken(fetchImpl as unknown as typeof fetch, now),
    ]);
    expect(a).toBe('new');
    expect(b).toBe('new');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(readTokens()?.refreshToken).toBe('r2');
  });

  it('signs out when a refresh is refused', async () => {
    storeTokens({ accessToken: 'old', refreshToken: 'bad', expiresAt: 0, scope: '' });
    const fetchImpl = vi.fn(async () => json(400, { error: 'invalid_grant' }));
    expect(await accessToken(fetchImpl as unknown as typeof fetch)).toBeNull();
    expect(readTokens()).toBeNull();
  });
});

describe('sign-in callback', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_SPOTIFY_CLIENT_ID', 'client-123');
    sessionStorage.clear();
  });
  afterEach(() => vi.unstubAllEnvs());

  const pending = (state: string, returnTo = '/room/abc123def4') =>
    sessionStorage.setItem('vega.spotify.pending', JSON.stringify({ verifier: 'v'.repeat(64), state, returnTo }));

  it('recognises the callback path', () => {
    expect(isSpotifyCallback('/spotify-callback')).toBe(true);
    expect(isSpotifyCallback('/spotify-callback/')).toBe(true);
    expect(isSpotifyCallback('/room/spotify-callback')).toBe(false);
  });

  it('exchanges the code and returns to where the person started', async () => {
    pending('st8');
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const form = new URLSearchParams(String(init.body));
      expect(form.get('grant_type')).toBe('authorization_code');
      expect(form.get('code')).toBe('the-code');
      expect(form.get('code_verifier')).toBe('v'.repeat(64));
      return json(200, { access_token: 'tok', refresh_token: 'ref', expires_in: 3600, scope: 'streaming' });
    });
    const out = await completeSpotifySignIn('?code=the-code&state=st8', fetchImpl as unknown as typeof fetch);
    expect(out).toEqual({ result: { status: 'connected' }, returnTo: '/room/abc123def4' });
    expect(readTokens()?.accessToken).toBe('tok');
    // A code works once: the pending request is gone.
    expect(sessionStorage.getItem('vega.spotify.pending')).toBeNull();
  });

  it('refuses a mismatched state', async () => {
    pending('expected');
    const fetchImpl = vi.fn();
    const out = await completeSpotifySignIn('?code=c&state=forged', fetchImpl as unknown as typeof fetch);
    expect(out.result.status).toBe('error');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(readTokens()).toBeNull();
  });

  it('reports a declined consent', async () => {
    pending('s');
    const out = await completeSpotifySignIn('?error=access_denied&state=s');
    expect(out.result).toEqual({ status: 'error', error: 'Spotify access was not granted.' });
  });

  it('never returns to another origin', async () => {
    pending('s', '//evil.example/');
    const out = await completeSpotifySignIn('?error=access_denied&state=s');
    expect(out.returnTo).toBe('/');
  });
});

describe('planPlayback', () => {
  it('prefers this tab with Premium', () => {
    expect(planPlayback({ premium: true, sdkDeviceId: 'tab', devices: [] })).toEqual({ kind: 'sdk' });
  });

  it('falls back to an active device, then any device', () => {
    const devices = [
      { id: 'a', name: 'Phone', isActive: false },
      { id: 'b', name: 'Laptop', isActive: true },
    ];
    expect(planPlayback({ premium: false, sdkDeviceId: null, devices })).toEqual({ kind: 'device', deviceId: 'b', name: 'Laptop' });
    expect(planPlayback({ premium: false, sdkDeviceId: null, devices: [devices[0]] })).toEqual({ kind: 'device', deviceId: 'a', name: 'Phone' });
  });

  it('uses the embed player when nothing else can play', () => {
    expect(planPlayback({ premium: true, sdkDeviceId: null, devices: [] })).toEqual({ kind: 'embed' });
  });
});
