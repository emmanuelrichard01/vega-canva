import { createHmac, timingSafeEqual } from 'crypto';
import { nanoid } from 'nanoid';

/**
 * Durable anonymous identity: a stable user ID without requiring sign-up.
 *
 * ## Why this exists (GOING-LIVE.md Stage 2.1)
 *
 * Issuing every visitor a signed token in an httpOnly cookie carrying a stable
 * `userId` provides four benefits immediately:
 *
 * 1. **Presence you can trust**: In `onAuthenticate`, the server binds the
 *    connection user id to a verified cryptographic claim rather than minting
 *    and discarding an ephemeral id.
 * 2. **Fair rate-limiting and quotas**: Associates upload limits with the
 *    user's session rather than their raw IP address, preventing corporate
 *    NAT or shared Wi-Fi networks from starving multiple users.
 * 3. **Abuse traceability**: Enables banning or throttling a specific user
 *    session if abuse occurs.
 * 4. **Graceful account migration**: When an anonymous user eventually signs
 *    up with OAuth or magic link, their existing boards and authored nodes
 *    can be claimed by linking their anonymous id to the new account.
 *
 * ## Token format
 *
 * `<base64url(payload)>.<base64url(hmac-sha256)>`
 */

export interface SessionPayload {
  /** Durable user identifier (e.g. `anon_...`). */
  uid: string;
  /** Whether this identity is anonymous (true) or an upgraded account (false). */
  anon: boolean;
  /** Epoch seconds when this token was minted. */
  iat: number;
  /** Epoch seconds when this token expires. 0 means it does not expire. */
  exp: number;
}

export interface MintSessionOptions {
  /** Optional pre-existing user id. If omitted, a fresh `anon_` nanoid is minted. */
  uid?: string;
  /** Whether this identity is anonymous. Defaults to true. */
  isAnonymous?: boolean;
  /** Time to live in seconds. Defaults to 1 year. */
  ttlSeconds?: number;
  /** Current epoch milliseconds for deterministic testing. */
  now?: number;
}

/** 1 year in seconds. */
export const DEFAULT_SESSION_TTL_SECONDS = 365 * 24 * 60 * 60;

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function signPayload(payloadB64: string, secret: string): string {
  return createHmac('sha256', secret).update(payloadB64).digest('base64url');
}

/**
 * Mint a signed session token.
 */
export function mintSessionToken(secret: string, options: MintSessionOptions = {}): string {
  if (!secret) throw new Error('mintSessionToken: signing secret is required');

  const nowSec = Math.floor((options.now ?? Date.now()) / 1000);
  const ttl = options.ttlSeconds ?? DEFAULT_SESSION_TTL_SECONDS;
  const uid = options.uid || `anon_${nanoid()}`;

  const payload: SessionPayload = {
    uid,
    anon: options.isAnonymous ?? true,
    iat: nowSec,
    exp: ttl > 0 ? nowSec + ttl : 0,
  };

  const payloadB64 = b64url(JSON.stringify(payload));
  const sigB64 = signPayload(payloadB64, secret);
  return `${payloadB64}.${sigB64}`;
}

export type VerifySessionResult =
  | { ok: true; session: SessionPayload }
  | { ok: false; reason: 'malformed' | 'tampered' | 'expired' };

/**
 * Verify a signed session token.
 */
export function verifySessionToken(
  token: string,
  secret: string,
  nowMs = Date.now()
): VerifySessionResult {
  if (!token || typeof token !== 'string') return { ok: false, reason: 'malformed' };
  if (!secret) return { ok: false, reason: 'tampered' };

  const dot = token.indexOf('.');
  if (dot === -1 || dot === 0 || dot === token.length - 1) {
    return { ok: false, reason: 'malformed' };
  }

  const payloadB64 = token.slice(0, dot);
  const signatureB64 = token.slice(dot + 1);

  const expectedSig = signPayload(payloadB64, secret);
  const sigBuf = Buffer.from(signatureB64, 'base64url');
  const expBuf = Buffer.from(expectedSig, 'base64url');

  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return { ok: false, reason: 'tampered' };
  }

  let payload: SessionPayload;
  try {
    const json = Buffer.from(payloadB64, 'base64url').toString('utf8');
    payload = JSON.parse(json);
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  if (!payload || typeof payload.uid !== 'string' || !payload.uid) {
    return { ok: false, reason: 'malformed' };
  }

  if (payload.exp > 0) {
    const nowSec = Math.floor(nowMs / 1000);
    if (nowSec > payload.exp) {
      return { ok: false, reason: 'expired' };
    }
  }

  return { ok: true, session: payload };
}

/**
 * Safely parse a cookie string into an object.
 */
export function parseCookies(cookieHeader?: string | null): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader || typeof cookieHeader !== 'string') return result;

  const pairs = cookieHeader.split(';');
  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i].trim();
    if (!pair) continue;
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    const key = pair.slice(0, eq).trim();
    let val = pair.slice(eq + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) {
      val = val.slice(1, -1);
    }
    try {
      result[key] = decodeURIComponent(val);
    } catch {
      result[key] = val;
    }
  }
  return result;
}

export const SESSION_COOKIE_NAME = 'vega_session';

/**
 * Serialize a session token into a Set-Cookie header value.
 */
export function serializeSessionCookie(
  token: string,
  options: { isSecure?: boolean; maxAgeSeconds?: number } = {}
): string {
  const maxAge = options.maxAgeSeconds ?? DEFAULT_SESSION_TTL_SECONDS;
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ];
  if (options.isSecure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

/**
 * Extract and verify a session token from request headers.
 * Looks in:
 * 1. Cookie `vega_session`
 * 2. Header `x-session-token`
 * 3. Header `authorization: Bearer <token>`
 */
export function readSessionFromRequest(
  req: { headers: Record<string, any> },
  secret: string,
  nowMs = Date.now()
): { session: SessionPayload | null; token: string | null } {
  const headers = req.headers || {};

  // 1. Try Cookie
  const cookieHeader = headers.cookie || headers.Cookie;
  if (cookieHeader) {
    const cookies = parseCookies(cookieHeader);
    const token = cookies[SESSION_COOKIE_NAME];
    if (token) {
      const verified = verifySessionToken(token, secret, nowMs);
      if (verified.ok) {
        return { session: verified.session, token };
      }
    }
  }

  // 2. Try X-Session-Token header
  const customHeader = headers['x-session-token'] || headers['X-Session-Token'];
  if (typeof customHeader === 'string' && customHeader) {
    const verified = verifySessionToken(customHeader, secret, nowMs);
    if (verified.ok) {
      return { session: verified.session, token: customHeader };
    }
  }

  // 3. Try Authorization: Bearer
  const authHeader = headers.authorization || headers.Authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const candidate = authHeader.slice(7).trim();
    if (candidate.includes('.')) {
      const verified = verifySessionToken(candidate, secret, nowMs);
      if (verified.ok) {
        return { session: verified.session, token: candidate };
      }
    }
  }

  return { session: null, token: null };
}
