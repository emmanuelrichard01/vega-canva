/**
 * Spotify sign-in: Authorization Code with PKCE, tokens in sessionStorage.
 *
 * - Configured by `VITE_SPOTIFY_CLIENT_ID`. Without it, `spotifyConfigured()`
 *   is false and the player explains rather than offering a dead button.
 * - Spotify redirects to `/spotify-callback`, a path no room or invite uses.
 *   `finishSpotifyCallback()` exchanges the code there, leaves a one-line
 *   notice for the player, and returns the person to the page they left.
 * - Tokens live in sessionStorage: they end with the tab, and never reach the
 *   shared document or the server.
 */
import { challengeFor, createState, createVerifier } from './pkce';

export const SPOTIFY_SCOPES = [
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-library-read',
  'user-read-playback-state',
  'user-modify-playback-state',
  'streaming',
  'user-read-email',
  'user-read-private',
] as const;

const AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
export const TOKEN_URL = 'https://accounts.spotify.com/api/token';
export const CALLBACK_PATH = '/spotify-callback';

const TOKENS_KEY = 'vega.spotify.tokens';
const PENDING_KEY = 'vega.spotify.pending';
const NOTICE_KEY = 'vega.spotify.notice';
/** Refresh this long before expiry, so a request never races the deadline. */
export const REFRESH_MARGIN_MS = 60_000;

export interface SpotifyTokens {
  accessToken: string;
  refreshToken: string | null;
  /** Epoch milliseconds. */
  expiresAt: number;
  scope: string;
}

interface Pending {
  verifier: string;
  state: string;
  /** Where to send the person back to after the exchange. */
  returnTo: string;
}


export const spotifyClientId = (): string | null => (import.meta.env.VITE_SPOTIFY_CLIENT_ID as string | undefined)?.trim() || null;
export const spotifyConfigured = (): boolean => spotifyClientId() !== null;

/** The registered redirect URI: the configured one, or this origin's root. */
export function redirectUri(): string {
  const configured = (import.meta.env.VITE_SPOTIFY_REDIRECT_URI as string | undefined)?.trim();
  if (configured) return configured;
  return `${window.location.origin}${CALLBACK_PATH}`;
}

function session(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function read<T>(key: string): T | null {
  try {
    const raw = session()?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    if (value == null) session()?.removeItem(key);
    else session()?.setItem(key, JSON.stringify(value));
  } catch {
    // A tab that cannot store tokens simply stays signed out.
  }
}

const listeners = new Set<() => void>();
export function subscribeSpotifyAuth(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const emit = () => listeners.forEach((fn) => fn());

export const readTokens = (): SpotifyTokens | null => read<SpotifyTokens>(TOKENS_KEY);

export function storeTokens(tokens: SpotifyTokens | null): void {
  write(TOKENS_KEY, tokens);
  emit();
}

/** Sends the browser to Spotify's consent page. */
export async function beginSpotifySignIn(): Promise<void> {
  const clientId = spotifyClientId();
  if (!clientId) throw new Error('Spotify is not configured on this deployment.');
  const verifier = createVerifier();
  const state = createState();
  const returnTo = window.location.pathname + window.location.search + window.location.hash;
  write(PENDING_KEY, { verifier, state, returnTo } satisfies Pending);
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri(),
    code_challenge_method: 'S256',
    code_challenge: await challengeFor(verifier),
    scope: SPOTIFY_SCOPES.join(' '),
    state,
  });
  window.location.assign(`${AUTHORIZE_URL}?${params.toString()}`);
}

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
};

export function tokensFromResponse(body: TokenResponse, previous: SpotifyTokens | null, now = Date.now()): SpotifyTokens {
  return {
    accessToken: body.access_token,
    // Spotify may omit a new refresh token on refresh; the old one stays valid then.
    refreshToken: body.refresh_token ?? previous?.refreshToken ?? null,
    expiresAt: now + body.expires_in * 1000,
    scope: body.scope ?? previous?.scope ?? '',
  };
}

async function postToken(form: Record<string, string>, fetchImpl: typeof fetch): Promise<TokenResponse> {
  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || typeof body?.access_token !== 'string') {
    throw new Error(body?.error_description || body?.error || `Spotify refused the request (${res.status}).`);
  }
  return body as TokenResponse;
}

export type SignInResult = { status: 'connected' } | { status: 'error'; error: string };

/** True on the page load Spotify redirected back to. */
export const isSpotifyCallback = (pathname = window.location.pathname) => pathname.replace(/\/+$/, '') === CALLBACK_PATH;

/**
 * Exchanges the authorization code in `search` for tokens.
 *
 * Returns the outcome and where the person started, so the caller can send
 * them back. The pending request is consumed either way: a code works once.
 */
export async function completeSpotifySignIn(
  search: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ result: SignInResult; returnTo: string }> {
  const params = new URLSearchParams(search);
  const pending = read<Pending>(PENDING_KEY);
  write(PENDING_KEY, null);
  const returnTo = pending?.returnTo && pending.returnTo.startsWith('/') && !pending.returnTo.startsWith('//') ? pending.returnTo : '/';
  const code = params.get('code');
  const state = params.get('state');
  const denied = params.get('error');
  const fail = (error: string) => ({ result: { status: 'error' as const, error }, returnTo });

  if (denied) return fail(denied === 'access_denied' ? 'Spotify access was not granted.' : `Spotify sign-in failed: ${denied}.`);
  if (!pending || !code || state !== pending.state) return fail('The Spotify sign-in could not be verified. Try connecting again.');
  const clientId = spotifyClientId();
  if (!clientId) return fail('Spotify is not configured on this deployment.');
  try {
    const body = await postToken(
      {
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri(),
        client_id: clientId,
        code_verifier: pending.verifier,
      },
      fetchImpl
    );
    storeTokens(tokensFromResponse(body, null));
    return { result: { status: 'connected' }, returnTo };
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Spotify sign-in failed.');
  }
}

/** Runs on `/spotify-callback`: finish the exchange, then go back. */
export async function finishSpotifyCallback(): Promise<void> {
  const { result, returnTo } = await completeSpotifySignIn(window.location.search);
  write(NOTICE_KEY, result);
  window.location.replace(returnTo);
}

/** The outcome of the last sign-in, once; the player shows it when it opens. */
export function takeSignInNotice(): SignInResult | null {
  const notice = read<SignInResult>(NOTICE_KEY);
  if (notice) write(NOTICE_KEY, null);
  return notice;
}

let refreshing: Promise<SpotifyTokens | null> | null = null;

/**
 * A usable access token, refreshing first when it is close to expiry.
 *
 * Concurrent callers share one refresh. A refresh Spotify rejects signs the
 * tab out, since the refresh token is then no good either.
 */
export async function accessToken(fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<string | null> {
  const tokens = readTokens();
  if (!tokens) return null;
  if (tokens.expiresAt - REFRESH_MARGIN_MS > now) return tokens.accessToken;
  if (!tokens.refreshToken) {
    storeTokens(null);
    return null;
  }
  refreshing ??= (async () => {
    try {
      const clientId = spotifyClientId();
      if (!clientId) throw new Error('not configured');
      const body = await postToken(
        { grant_type: 'refresh_token', refresh_token: tokens.refreshToken!, client_id: clientId },
        fetchImpl
      );
      const next = tokensFromResponse(body, tokens);
      storeTokens(next);
      return next;
    } catch {
      storeTokens(null);
      return null;
    } finally {
      refreshing = null;
    }
  })();
  const next = await refreshing;
  return next?.accessToken ?? null;
}

/**
 * Signs out of Spotify in this tab.
 *
 * Spotify has no token-revocation endpoint for PKCE clients; access is
 * withdrawn by forgetting the tokens here, and fully at
 * spotify.com/account/apps, which the player links to.
 */
export function disconnectSpotify(): void {
  write(PENDING_KEY, null);
  storeTokens(null);
}
