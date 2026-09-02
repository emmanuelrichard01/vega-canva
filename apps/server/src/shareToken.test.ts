import { describe, it, expect } from 'vitest';
import {
  mintShareToken,
  verifyShareToken,
  explainFailure,
  MAX_TTL_SECONDS,
  type ShareRole,
} from './shareToken';

const SECRET = 'a-signing-secret-for-tests';
const OTHER = 'a-different-signing-secret';
const ROOM = 'abcdefgh12';

describe('mintShareToken', () => {
  it('carries the room and the role', () => {
    const token = mintShareToken(SECRET, { roomId: ROOM, role: 'viewer' });
    const result = verifyShareToken(token, SECRET);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.r).toBe(ROOM);
    expect(result.payload.o).toBe('viewer');
  });

  it('mints a distinct token every time', () => {
    // Two view links to the same room, made in the same second, must still be
    // two links -- otherwise they cannot ever be told apart or revoked apart.
    const a = mintShareToken(SECRET, { roomId: ROOM, role: 'viewer', now: 1_700_000_000_000 });
    const b = mintShareToken(SECRET, { roomId: ROOM, role: 'viewer', now: 1_700_000_000_000 });
    expect(a).not.toBe(b);
  });

  it('refuses a role it does not know', () => {
    expect(() => mintShareToken(SECRET, { roomId: ROOM, role: 'admin' as ShareRole })).toThrow(
      /unknown role/
    );
  });

  it('refuses to sign with nothing', () => {
    expect(() => mintShareToken('', { roomId: ROOM, role: 'viewer' })).toThrow(/signing secret/);
  });

  it('caps how long a link may live', () => {
    // A link cannot be revoked, so "forever" should be a deliberate choice
    // rather than something a caller reaches by passing a large number.
    const token = mintShareToken(SECRET, {
      roomId: ROOM,
      role: 'viewer',
      ttlSeconds: MAX_TTL_SECONDS * 10,
      now: 0,
    });
    const result = verifyShareToken(token, SECRET, 0);
    expect(result.ok && result.payload.e).toBe(MAX_TTL_SECONDS);
  });

  it('treats no ttl as no expiry', () => {
    const token = mintShareToken(SECRET, { roomId: ROOM, role: 'editor' });
    const result = verifyShareToken(token, SECRET);
    expect(result.ok && result.payload.e).toBe(0);
  });
});

describe('verifyShareToken', () => {
  it('rejects a token signed with a different secret', () => {
    const token = mintShareToken(OTHER, { roomId: ROOM, role: 'editor' });
    expect(verifyShareToken(token, SECRET)).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('rejects a role edited after signing', () => {
    /**
     * The whole point. The previous implementation read `role` out of an
     * unverified JWT payload, so upgrading a view link to an edit link was a
     * base64 round trip anybody could do in a console.
     */
    const token = mintShareToken(SECRET, { roomId: ROOM, role: 'viewer' });
    const [body, sig] = token.split('.');
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    payload.o = 'editor';
    const forged = `${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${sig}`;

    expect(verifyShareToken(forged, SECRET)).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('rejects a room edited after signing', () => {
    const token = mintShareToken(SECRET, { roomId: ROOM, role: 'viewer' });
    const [body, sig] = token.split('.');
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    payload.r = 'someone-elses-room';
    const forged = `${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${sig}`;

    expect(verifyShareToken(forged, SECRET)).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('checks the signature before the expiry', () => {
    /**
     * Order matters: `e` inside an unverified payload is a number the holder
     * chose. Reading it first and trusting it is exactly the mistake the
     * unverified-JWT branch was making -- it enforced an expiry an attacker
     * could edit.
     */
    const token = mintShareToken(OTHER, { roomId: ROOM, role: 'viewer', ttlSeconds: 60, now: 0 });
    const wellPastExpiry = 10_000_000_000;

    // Wrong secret *and* expired: the signature is what it must complain about.
    expect(verifyShareToken(token, SECRET, wellPastExpiry)).toEqual({
      ok: false,
      reason: 'bad-signature',
    });
  });

  it('rejects an expired link', () => {
    const token = mintShareToken(SECRET, { roomId: ROOM, role: 'viewer', ttlSeconds: 60, now: 0 });

    expect(verifyShareToken(token, SECRET, 59_000).ok).toBe(true);
    expect(verifyShareToken(token, SECRET, 60_000)).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects junk without throwing', () => {
    for (const bad of ['', '.', 'a.', '.b', 'no-dot', 'YQ.YQ', null, undefined, 42, {}]) {
      const result = verifyShareToken(bad, SECRET);
      expect(result.ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it('says so when the deployment cannot verify at all', () => {
    // Distinct from a bad signature: nothing is wrong with the link, the
    // server simply has no key. The operator needs to know which it is.
    expect(verifyShareToken('anything.atall', null)).toEqual({ ok: false, reason: 'no-secret' });
  });

  it('never leaks internals in the message a person sees', () => {
    for (const reason of ['malformed', 'bad-signature', 'unknown-role'] as const) {
      const message = explainFailure(reason);
      expect(message).not.toMatch(/signature|hmac|secret|payload/i);
    }
    expect(explainFailure('expired')).toMatch(/expired/i);
  });
});
