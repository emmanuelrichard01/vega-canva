import { createHmac, timingSafeEqual, randomBytes } from 'crypto';

/**
 * Signed invite links: a room's capability, handed over with less of it.
 *
 * ## The model this sits inside, and the one thing it can and cannot do
 *
 * There are no accounts. **The room id is the capability** -- whoever holds it
 * can open the board and edit it (`rooms.ts`, `docs/DEPLOYMENT.md` §1). A role
 * chosen by the client is therefore worth nothing, which is what the previous
 * implementation was: `?role=viewer` on the URL, read back by the same client
 * that wrote it, honoured by a server with no way to check.
 *
 * A signed token fixes the half that is fixable. The role travels inside a
 * payload this server signed, so a person holding a view link **cannot turn it
 * into an edit link** -- there is no forging the signature, and the role is not
 * a separate field anybody can edit.
 *
 * What it does *not* do, and what the share dialog must therefore not claim:
 * a token carries the room id, because the client needs it to open the
 * document at all. Someone who reads it out of their own URL can connect the
 * ordinary way and get an editor session, because a bare room id still opens a
 * board. **Closing that is a product decision, not a cryptographic one** -- it
 * means refusing unsigned connections, which breaks every link already shared
 * and the room-code join box with it. `docs/DEPLOYMENT.md` §1 carries the
 * choice.
 *
 * So: this raises the floor from "the client decides" to "the server decides,
 * for anyone who arrives by the link they were given". That is a real change
 * in what the feature is, and it is the whole of what it is.
 *
 * ## Shape
 *
 * `<base64url(payload)>.<base64url(hmac-sha256)>`
 *
 * The payload is readable on purpose. It is not a secret -- it names a room
 * the holder is being given access to -- and making it opaque would suggest a
 * confidentiality this cannot provide. What the signature protects is
 * *integrity*: the role, the room and the expiry cannot be changed.
 */

export type ShareRole = 'editor' | 'commenter' | 'viewer';

export interface SharePayload {
  /** Room id. */
  r: string;
  /** Role. */
  o: ShareRole;
  /** Expiry, epoch seconds. `0` means it does not expire. */
  e: number;
  /** Issued at, epoch seconds -- lets a room revoke everything older. */
  i: number;
  /** Nonce, so two links minted in the same second are still distinguishable. */
  n: string;
}

export interface MintOptions {
  roomId: string;
  role: ShareRole;
  /** Seconds from now. `0` or absent means it does not expire. */
  ttlSeconds?: number;
  now?: number;
}

const ROLES: ReadonlySet<string> = new Set(['editor', 'commenter', 'viewer']);

/** Longest a link may live. A year is already generous for something unrevokable. */
export const MAX_TTL_SECONDS = 365 * 24 * 60 * 60;

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function sign(payloadB64: string, secret: string): string {
  return createHmac('sha256', secret).update(payloadB64).digest('base64url');
}

/**
 * Mint a link for a role.
 *
 * Minting needs no authority beyond already holding the room id, and that is
 * correct rather than an oversight: a token is strictly *less* than the room
 * id it is derived from, so anyone who could mint one could already do
 * everything it permits. Attenuation never needs a permission check.
 */
export function mintShareToken(secret: string, options: MintOptions): string {
  const { roomId, role } = options;
  if (!secret) throw new Error('mintShareToken: no signing secret');
  if (!roomId) throw new Error('mintShareToken: no room');
  if (!ROLES.has(role)) throw new Error(`mintShareToken: unknown role ${role}`);

  const now = Math.floor((options.now ?? Date.now()) / 1000);
  const ttl = Math.min(Math.max(0, Math.floor(options.ttlSeconds ?? 0)), MAX_TTL_SECONDS);

  const payload: SharePayload = {
    r: roomId,
    o: role,
    e: ttl > 0 ? now + ttl : 0,
    i: now,
    n: randomBytes(6).toString('base64url'),
  };

  const body = b64url(JSON.stringify(payload));
  return `${body}.${sign(body, secret)}`;
}

export type VerifyFailure =
  | 'malformed'
  | 'bad-signature'
  | 'expired'
  | 'unknown-role'
  | 'no-secret';

export type VerifyResult =
  | { ok: true; payload: SharePayload }
  | { ok: false; reason: VerifyFailure };

/**
 * Check a token and read the role out of it.
 *
 * Order matters. The signature is checked **before** the expiry, because
 * `exp` inside an unverified payload is a number the holder chose -- reading
 * it first and trusting it is precisely the mistake the JWT branch this
 * replaced was making.
 */
export function verifyShareToken(
  token: unknown,
  secret: string | null,
  now = Date.now()
): VerifyResult {
  if (!secret) return { ok: false, reason: 'no-secret' };
  if (typeof token !== 'string' || !token) return { ok: false, reason: 'malformed' };

  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return { ok: false, reason: 'malformed' };

  const body = token.slice(0, dot);
  const supplied = token.slice(dot + 1);
  const expected = sign(body, secret);

  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  // `timingSafeEqual` throws on a length mismatch, which is itself an oracle,
  // so the lengths are compared after a fixed-cost call rather than before.
  if (a.length !== b.length) {
    timingSafeEqual(b, b);
    return { ok: false, reason: 'bad-signature' };
  }
  if (!timingSafeEqual(a, b)) return { ok: false, reason: 'bad-signature' };

  let payload: SharePayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  if (!payload || typeof payload.r !== 'string' || !payload.r) {
    return { ok: false, reason: 'malformed' };
  }
  if (!ROLES.has(payload.o)) return { ok: false, reason: 'unknown-role' };
  if (payload.e && Math.floor(now / 1000) >= payload.e) {
    return { ok: false, reason: 'expired' };
  }

  return { ok: true, payload };
}

/** What to tell a person whose link did not work, without naming internals. */
export function explainFailure(reason: VerifyFailure): string {
  switch (reason) {
    case 'expired':
      return 'This invite link has expired. Ask whoever shared it for a new one.';
    case 'no-secret':
      return 'This deployment cannot verify invite links.';
    default:
      return 'This invite link is not valid.';
  }
}
