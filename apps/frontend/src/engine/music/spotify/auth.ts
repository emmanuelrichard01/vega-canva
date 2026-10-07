/**
 * Spotify sign-in: Authorization Code with PKCE, tokens in sessionStorage.
 *
 * - Configured by `VITE_SPOTIFY_CLIENT_ID`. Without it, `spotifyConfigured()`
 *   is false and the player explains rather than offering a dead button.
 * - Spotify redirects to `/spotify-callback`, a path no room or invite uses.
 *   `finishSpotifyCallback()` exchanges the code there, leaves a one-line
 *   notice for the player, and returns the person to the page they left.
 * - The redirect URI is this origin's `/spotify-callback`
 *   (`https://vscanva.vercel.app/spotify-callback` in production). Spotify
 *   refuses `localhost`, so a dev server opened at localhost signs in through
 *   `http://127.0.0.1:<port>/spotify-callback`. The verifier and state live in
 *   the origin's sessionStorage, so sign-in must start where it finishes:
 *   from a loopback alias, Connect hops to the same page on 127.0.0.1 with an
 *   intent flag (`?spotify=connect`), and `resumeSpotifyIntent` there starts
 *   the sign-in and strips the flag. Nobody is asked to retype an address.
 * - Tokens live in sessionStorage: they end with the tab, and never reach the
 *   shared document or the server.
 */
import { challengeFor, createState, createVerifier } from './pkce';
import { signInErrorMessage } from './messages';

export const SPOTIFY_SCOPES = [
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-library-read',
  'user-library-modify',
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
  /** The redirect URI the consent request named; the exchange must repeat it exactly. */
  redirectUri?: string;
}


export const spotifyClientId = (): string | null => (import.meta.env.VITE_SPOTIFY_CLIENT_ID as string | undefined)?.trim() || null;
export const spotifyConfigured = (): boolean => spotifyClientId() !== null;
/** Whether the player offers Spotify at all: where it is set up, and in development, where it says what is missing. */
export const spotifyAvailable = (): boolean => spotifyConfigured() || import.meta.env.DEV === true;

/** The parts of `window.location` sign-in reads; a parameter so tests can name any address. */
export type LocationLike = Pick<Location, 'protocol' | 'hostname' | 'port' | 'origin' | 'pathname' | 'search' | 'hash'>;

const LOOPBACK_NAMES = new Set(['localhost', '[::1]', '::1']);

/**
 * The redirect URI registered with Spotify: `VITE_SPOTIFY_REDIRECT_URI`, or
 * this origin's `/spotify-callback`. A loopback name becomes `127.0.0.1`,
 * the only loopback address Spotify accepts. Never a trailing slash.
 */
export function redirectUri(loc: LocationLike = window.location): string {
  const configured = (import.meta.env.VITE_SPOTIFY_REDIRECT_URI as string | undefined)?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  const host = LOOPBACK_NAMES.has(loc.hostname) ? '127.0.0.1' : loc.hostname;
  return `${loc.protocol}//${host}${loc.port ? `:${loc.port}` : ''}${CALLBACK_PATH}`;
}

/** The origin sign-in has to start from when it is not this page's own; null when this page is fine. */
export function signInOrigin(loc: LocationLike = window.location): string | null {
  let target: string;
  try {
    target = new URL(redirectUri(loc)).origin;
  } catch {
    return null;
  }
  return target === loc.origin ? null : target;
}

/** A sign-in that cannot start from this page. The message is for people; it names no address. */
export class SpotifySignInError extends Error {}

/** The query flag that carries "start sign-in" across the hop to the sign-in origin. */
export const INTENT_PARAM = 'spotify';
export const INTENT_VALUE = 'connect';

/**
 * Whether Connect can reach the sign-in origin by itself: this page is on a
 * loopback alias (`localhost`, `[::1]`) and sign-in lives on 127.0.0.1.
 */
export function canHop(loc: LocationLike, target: string): boolean {
  try {
    return LOOPBACK_NAMES.has(loc.hostname) && new URL(target).hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

/** This page's path on `origin`, carrying the intent flag. */
export function hopUrl(origin: string, loc: LocationLike): string {
  const params = new URLSearchParams(loc.search);
  params.set(INTENT_PARAM, INTENT_VALUE);
  return `${origin}${loc.pathname}?${params.toString()}${loc.hash}`;
}

/**
 * Reads and removes the intent flag. Returns the page's address without it
 * (what the person should see, and where sign-in returns to), or null when
 * the flag is absent.
 */
export function takeSpotifyIntent(loc: LocationLike, replace: (path: string) => void): LocationLike | null {
  const params = new URLSearchParams(loc.search);
  if (params.get(INTENT_PARAM) !== INTENT_VALUE) return null;
  params.delete(INTENT_PARAM);
  const qs = params.toString();
  const search = qs ? `?${qs}` : '';
  replace(loc.pathname + search + loc.hash);
  return { ...loc, search };
}

/**
 * Runs on page load at the sign-in origin: if a hop left the intent flag,
 * strips it and starts sign-in. Returns whether it did. A person who is
 * already connected is left alone; one who cannot sign in finds the reason in
 * the player.
 */
export async function resumeSpotifyIntent(
  loc: LocationLike = window.location,
  replace: (path: string) => void = (path) => window.history.replaceState(window.history.state, '', path),
  navigate: (url: string) => void = (url) => window.location.assign(url)
): Promise<boolean> {
  const clean = takeSpotifyIntent(loc, replace);
  if (!clean) return false;
  if (readTokens()) return true;
  try {
    await beginSpotifySignIn(clean, navigate);
  } catch (e) {
    write(NOTICE_KEY, { status: 'error', error: e instanceof Error ? e.message : signInErrorMessage('unknown') } satisfies SignInResult);
  }
  return true;
}

/**
 * A same-origin path to return to after sign-in, or `/`. Rejects anything a
 * browser could read as another site: a scheme, `//host`, a backslash (which
 * browsers treat as a slash), or a path that resolves to another origin.
 */
export function safeReturnTo(raw: unknown, origin: string = window.location.origin): string {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.includes('\\')) return '/';
  try {
    return new URL(raw, origin).origin === origin ? raw : '/';
  } catch {
    return '/';
  }
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

/** The scopes a grant actually carries. */
export const grantedScopes = (tokens: SpotifyTokens | null): string[] => (tokens?.scope ?? '').split(/\s+/).filter(Boolean);

/**
 * Sends the browser to Spotify's consent page.
 *
 * Throws `SpotifySignInError` when sign-in cannot start from this page. From a
 * loopback alias it navigates to the sign-in origin instead and returns
 * `'hopped'`; `resumeSpotifyIntent` finishes the job there.
 */
export async function beginSpotifySignIn(
  loc: LocationLike = window.location,
  navigate: (url: string) => void = (url) => window.location.assign(url)
): Promise<'redirected' | 'hopped'> {
  const clientId = spotifyClientId();
  if (!clientId) throw new SpotifySignInError(signInErrorMessage('not_configured'));
  const returnTo = loc.pathname + loc.search + loc.hash;
  const origin = signInOrigin(loc);
  if (origin) {
    if (!canHop(loc, origin)) throw new SpotifySignInError(signInErrorMessage('unavailable_here'));
    if (import.meta.env.DEV) console.info(`[spotify] continuing sign-in at ${origin}`);
    navigate(hopUrl(origin, loc));
    return 'hopped';
  }
  const verifier = createVerifier();
  const state = createState();
  const redirect = redirectUri(loc);
  write(PENDING_KEY, { verifier, state, returnTo, redirectUri: redirect } satisfies Pending);
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirect,
    code_challenge_method: 'S256',
    code_challenge: await challengeFor(verifier),
    scope: SPOTIFY_SCOPES.join(' '),
    state,
  });
  navigate(`${AUTHORIZE_URL}?${params.toString()}`);
  return 'redirected';
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

/** The token endpoint said no (`status`, Spotify's `code`), as opposed to not being reachable. */
export class TokenRequestError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(code: string, status: number) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

/** Spotify refused the grant itself: the refresh token is no good, so the person has to sign in again. */
const grantRefused = (e: unknown): boolean =>
  e instanceof TokenRequestError && (e.code === 'invalid_grant' || e.status === 400 || e.status === 401);

async function postToken(form: Record<string, string>, fetchImpl: typeof fetch): Promise<TokenResponse> {
  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || typeof body?.access_token !== 'string') {
    throw new TokenRequestError(typeof body?.error === 'string' ? body.error : `http_${res.status}`, res.status);
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
  const returnTo = safeReturnTo(pending?.returnTo);
  const code = params.get('code');
  const state = params.get('state');
  const denied = params.get('error');
  const fail = (error: string) => ({ result: { status: 'error' as const, error }, returnTo });

  if (denied) return fail(signInErrorMessage(denied));
  if (!pending || !code || state !== pending.state) return fail(signInErrorMessage('state_mismatch'));
  const clientId = spotifyClientId();
  if (!clientId) return fail(signInErrorMessage('not_configured'));
  try {
    const body = await postToken(
      {
        grant_type: 'authorization_code',
        code,
        redirect_uri: pending.redirectUri ?? redirectUri(),
        client_id: clientId,
        code_verifier: pending.verifier,
      },
      fetchImpl
    );
    storeTokens(tokensFromResponse(body, null));
    return { result: { status: 'connected' }, returnTo };
  } catch (e) {
    return fail(signInErrorMessage(e instanceof Error ? e.message : 'unknown'));
  }
}

/** Runs on `/spotify-callback`: finish the exchange, then go back. */
export async function finishSpotifyCallback(): Promise<void> {
  const { result, returnTo } = await completeSpotifySignIn(window.location.search);
  write(NOTICE_KEY, result);
  window.location.replace(returnTo);
}

/** Whether a sign-in just came back with something to show. */
export const hasSignInNotice = (): boolean => read<SignInResult>(NOTICE_KEY) !== null;

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
 * Concurrent callers share one refresh. A refresh Spotify refuses
 * (`invalid_grant`, or a 400/401 from the token endpoint) signs the tab out,
 * since the refresh token is then no good. A refresh that fails any other way
 * (offline, a 5xx) keeps the tokens: a token that has not expired yet is still
 * used, and the next call tries again. `force` refreshes even an unexpired
 * token: Spotify answered 401 to it.
 */
export async function accessToken(fetchImpl: typeof fetch = fetch, now = Date.now(), force = false): Promise<string | null> {
  const tokens = readTokens();
  if (!tokens) return null;
  if (!force && tokens.expiresAt - REFRESH_MARGIN_MS > now) return tokens.accessToken;
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
    } catch (e) {
      if (grantRefused(e)) {
        storeTokens(null);
        return null;
      }
      return !force && tokens.expiresAt > now ? tokens : null;
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
