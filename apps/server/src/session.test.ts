import { describe, it, expect } from 'vitest';
import {
  mintSessionToken,
  verifySessionToken,
  parseCookies,
  serializeSessionCookie,
  readSessionFromRequest,
  SESSION_COOKIE_NAME,
} from './session';

describe('session tokens', () => {
  const secret = 'super-secret-session-key-12345';

  it('mints and verifies a valid anonymous session token', () => {
    const token = mintSessionToken(secret);
    expect(token).toContain('.');

    const result = verifySessionToken(token, secret);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.session.uid).toMatch(/^anon_/);
      expect(result.session.anon).toBe(true);
      expect(result.session.exp).toBeGreaterThan(result.session.iat);
    }
  });

  it('preserves an explicit uid when provided', () => {
    const token = mintSessionToken(secret, { uid: 'user_custom_42', isAnonymous: false });
    const result = verifySessionToken(token, secret);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.session.uid).toBe('user_custom_42');
      expect(result.session.anon).toBe(false);
    }
  });

  it('rejects a tampered signature', () => {
    const token = mintSessionToken(secret);
    const [payload, sig] = token.split('.');
    const tamperedSig = sig.slice(0, -2) + (sig.endsWith('a') ? 'b' : 'a');
    const tampered = `${payload}.${tamperedSig}`;

    const result = verifySessionToken(tampered, secret);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('tampered');
    }
  });

  it('rejects a token verified with the wrong secret', () => {
    const token = mintSessionToken(secret);
    const result = verifySessionToken(token, 'different-secret-wrong-key');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('tampered');
    }
  });

  it('rejects an expired token', () => {
    const past = 1_000_000;
    const token = mintSessionToken(secret, {
      ttlSeconds: 60,
      now: past * 1000,
    });

    const nowAfterExpiry = (past + 120) * 1000;
    const result = verifySessionToken(token, secret, nowAfterExpiry);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('expired');
    }
  });

  it('rejects malformed tokens', () => {
    expect(verifySessionToken('', secret).ok).toBe(false);
    expect(verifySessionToken('no-dot-here', secret).ok).toBe(false);
    expect(verifySessionToken('.onlydot', secret).ok).toBe(false);
    expect(verifySessionToken('dotatend.', secret).ok).toBe(false);
  });
});

describe('cookie parsing & serialization', () => {
  it('parses empty and undefined cookies', () => {
    expect(parseCookies('')).toEqual({});
    expect(parseCookies(null)).toEqual({});
    expect(parseCookies(undefined)).toEqual({});
  });

  it('parses multiple cookies correctly', () => {
    const header = 'vega_theme=dark; vega_session=xyz.123; other=hello%20world';
    const parsed = parseCookies(header);
    expect(parsed).toEqual({
      vega_theme: 'dark',
      vega_session: 'xyz.123',
      other: 'hello world',
    });
  });

  it('serializes a session cookie with standard security flags', () => {
    const cookie = serializeSessionCookie('token123');
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=token123`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('Max-Age=');
    expect(cookie).not.toContain('Secure');
  });

  it('serializes a session cookie with Secure flag when requested', () => {
    const cookie = serializeSessionCookie('token123', { isSecure: true });
    expect(cookie).toContain('Secure');
  });
});

describe('readSessionFromRequest', () => {
  const secret = 'request-secret-test';

  it('extracts and verifies session from Cookie header', () => {
    const token = mintSessionToken(secret, { uid: 'cookie_user' });
    const req = {
      headers: {
        cookie: `unrelated=1; ${SESSION_COOKIE_NAME}=${token}; test=2`,
      },
    };
    const res = readSessionFromRequest(req, secret);
    expect(res.session).not.toBeNull();
    expect(res.session?.uid).toBe('cookie_user');
    expect(res.token).toBe(token);
  });

  it('extracts and verifies session from X-Session-Token header', () => {
    const token = mintSessionToken(secret, { uid: 'header_user' });
    const req = {
      headers: {
        'x-session-token': token,
      },
    };
    const res = readSessionFromRequest(req, secret);
    expect(res.session).not.toBeNull();
    expect(res.session?.uid).toBe('header_user');
    expect(res.token).toBe(token);
  });

  it('extracts and verifies session from Authorization Bearer header', () => {
    const token = mintSessionToken(secret, { uid: 'bearer_user' });
    const req = {
      headers: {
        authorization: `Bearer ${token}`,
      },
    };
    const res = readSessionFromRequest(req, secret);
    expect(res.session).not.toBeNull();
    expect(res.session?.uid).toBe('bearer_user');
    expect(res.token).toBe(token);
  });

  it('returns null when no valid credentials are present', () => {
    const req = {
      headers: {
        authorization: 'Bearer not-a-session-token',
        cookie: 'foo=bar',
      },
    };
    const res = readSessionFromRequest(req, secret);
    expect(res.session).toBeNull();
    expect(res.token).toBeNull();
  });
});
