import { describe, it, expect } from 'vitest';
import {
  inviteTokenFromPath,
  readUnverifiedInvite,
  inviteHasExpired,
  type Invite,
} from './invite';

/** Build a token the way the server does, minus the real signature. */
function token(payload: Record<string, unknown>, sig = 'a-signature'): string {
  const body = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${body}.${sig}`;
}

describe('inviteTokenFromPath', () => {
  it('reads a token off /i/<token>', () => {
    expect(inviteTokenFromPath('/i/abc.def')).toBe('abc.def');
    expect(inviteTokenFromPath('/i/abc.def/')).toBe('abc.def');
  });

  it('ignores every other route', () => {
    for (const path of ['/', '/room/abcdefgh12', '/i', '/i/', '/invite/abc', '/i/a/b']) {
      expect(inviteTokenFromPath(path), path).toBeNull();
    }
  });
});

describe('readUnverifiedInvite', () => {
  it('reads the room and role a link names', () => {
    const invite = readUnverifiedInvite(token({ r: 'abcdefgh12', o: 'viewer', e: 0 }));

    expect(invite?.roomId).toBe('abcdefgh12');
    expect(invite?.role).toBe('viewer');
    expect(invite?.expiresAt).toBeNull();
  });

  it('converts the expiry to milliseconds', () => {
    const invite = readUnverifiedInvite(token({ r: 'r', o: 'viewer', e: 1_700_000_000 }));
    expect(invite?.expiresAt).toBe(1_700_000_000_000);
  });

  it('refuses a role it does not know', () => {
    /**
     * Not security -- the server decides that. This stops the *interface*
     * acting on a word it has no mode for, which would otherwise fall through
     * to "editor" and offer tools whose edits the connection refuses.
     */
    expect(readUnverifiedInvite(token({ r: 'r', o: 'admin', e: 0 }))).toBeNull();
    expect(readUnverifiedInvite(token({ r: 'r', o: 'owner', e: 0 }))).toBeNull();
  });

  it('refuses a token that names no room', () => {
    expect(readUnverifiedInvite(token({ o: 'viewer', e: 0 }))).toBeNull();
    expect(readUnverifiedInvite(token({ r: '', o: 'viewer', e: 0 }))).toBeNull();
  });

  it('returns null for junk rather than throwing', () => {
    for (const bad of ['', '.', 'a.', '.b', 'no-dot', 'not-base64.sig', null]) {
      expect(() => readUnverifiedInvite(bad)).not.toThrow();
      expect(readUnverifiedInvite(bad), String(bad)).toBeNull();
    }
  });

  it('keeps the whole token, signature included', () => {
    // The signature is the half that matters, and it is the server's to check
    // -- so the client has to forward it untouched rather than the payload.
    const t = token({ r: 'r', o: 'viewer', e: 0 }, 'the-real-signature');
    expect(readUnverifiedInvite(t)?.token).toBe(t);
  });
});

describe('inviteHasExpired', () => {
  const at = (expiresAt: number | null): Invite => ({
    token: 't.s', roomId: 'r', role: 'viewer', expiresAt,
  });

  it('never expires a link with no expiry', () => {
    expect(inviteHasExpired(at(null), 10_000_000_000_000)).toBe(false);
  });

  it('expires on the instant, not after it', () => {
    expect(inviteHasExpired(at(1000), 999)).toBe(false);
    expect(inviteHasExpired(at(1000), 1000)).toBe(true);
  });
});
