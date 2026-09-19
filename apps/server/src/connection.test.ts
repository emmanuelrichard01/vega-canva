import { describe, it, expect } from 'vitest';
import { readConnectionClaim } from './connection';

/**
 * These replace two tests that re-implemented their own JWT decoding inline
 * and asserted against it -- which is to say they tested `Buffer.from` and a
 * `checkScope` helper defined three lines above the assertion, and would have
 * passed no matter what the server did.
 */

describe('readConnectionClaim', () => {
  it('reads the role and the secret this app sends together', () => {
    const claim = readConnectionClaim(JSON.stringify({ role: 'viewer', secret: 's3cret' }));

    expect(claim.role).toBe('viewer');
    expect(claim.secret).toBe('s3cret');
  });

  it('treats a bare string as the shared secret', () => {
    // How a script or a curl-equivalent would send it, with no role to state.
    const claim = readConnectionClaim('s3cret');

    expect(claim.role).toBe('editor');
    expect(claim.secret).toBe('s3cret');
  });

  it('does not offer a JSON envelope up as the secret', () => {
    /**
     * The bug this prevents: comparing `{"role":"viewer"}` against
     * AUTH_SECRET. It would never match, so every client of a deployment that
     * had set AUTH_SECRET would be refused with a generic "Unauthorized room
     * connection" -- the failure looking like a wrong secret rather than an
     * envelope nobody unwrapped.
     */
    const claim = readConnectionClaim(JSON.stringify({ role: 'viewer' }));

    expect(claim.secret).toBeUndefined();
  });

  it('defaults to editor when there is no token at all', () => {
    for (const token of [undefined, null, '', 0, {}]) {
      expect(readConnectionClaim(token).role, String(token)).toBe('editor');
    }
  });

  it('lets an explicit ?role= win over the token', () => {
    const token = JSON.stringify({ role: 'editor', secret: 's3cret' });

    const claim = readConnectionClaim(token, 'viewer');

    expect(claim.role).toBe('viewer');
    // ...without disturbing the half that is actually checked.
    expect(claim.secret).toBe('s3cret');
  });

  it('accepts the spellings a person or the share dialog might produce', () => {
    for (const word of ['viewer', 'view', 'readonly', 'VIEWER']) {
      expect(readConnectionClaim(null, word).role, word).toBe('viewer');
    }
    for (const word of ['commenter', 'comment']) {
      expect(readConnectionClaim(null, word).role, word).toBe('commenter');
    }
  });

  it('falls back to editor for a role it does not recognise', () => {
    // Notably including 'admin': the old code assigned `role = jwt.role`
    // unchecked, so any string a client invented became the role.
    for (const word of ['admin', 'owner', 'root', '', 'true']) {
      expect(readConnectionClaim(null, word).role, word).toBe('editor');
    }
    expect(readConnectionClaim(JSON.stringify({ role: 'admin' })).role).toBe('editor');
  });

  it('survives malformed JSON without throwing', () => {
    for (const token of ['{', '{"role":', 'null', '[]', '"just-a-string"']) {
      expect(() => readConnectionClaim(token)).not.toThrow();
    }
  });

  it('ignores a non-string secret rather than passing it on', () => {
    const claim = readConnectionClaim(JSON.stringify({ role: 'editor', secret: { a: 1 } }));

    expect(claim.secret).toBeUndefined();
  });
});

describe('readConnectionClaim: invite tokens', () => {
  it('passes a signed invite through without inspecting it', () => {
    /**
     * This module parses; it does not decide. Reading a role out of the token
     * here would be the unverified-JWT mistake wearing a new name --
     * `verifyShareToken` is the only thing allowed to.
     */
    const claim = readConnectionClaim(
      JSON.stringify({ role: 'editor', invite: 'body.signature' })
    );

    expect(claim.invite).toBe('body.signature');
    // The self-declared role survives parsing; the caller overrides it with
    // the verified one.
    expect(claim.role).toBe('editor');
  });

  it('has no invite when none was sent', () => {
    expect(readConnectionClaim(JSON.stringify({ role: 'viewer' })).invite).toBeUndefined();
    expect(readConnectionClaim('a-bare-secret').invite).toBeUndefined();
    expect(readConnectionClaim(undefined).invite).toBeUndefined();
  });

  it('ignores a non-string invite', () => {
    expect(readConnectionClaim(JSON.stringify({ invite: { a: 1 } })).invite).toBeUndefined();
    expect(readConnectionClaim(JSON.stringify({ invite: '' })).invite).toBeUndefined();
  });
});

describe('readConnectionClaim: session tokens', () => {
  it('passes a session token through without deciding', () => {
    const claim = readConnectionClaim(
      JSON.stringify({ role: 'editor', sessionToken: 'payload.sig' })
    );
    expect(claim.sessionToken).toBe('payload.sig');
  });

  it('has no sessionToken when none was sent', () => {
    expect(readConnectionClaim(JSON.stringify({ role: 'viewer' })).sessionToken).toBeUndefined();
    expect(readConnectionClaim('bare-token').sessionToken).toBeUndefined();
  });

  it('ignores non-string session tokens', () => {
    expect(readConnectionClaim(JSON.stringify({ sessionToken: 12345 })).sessionToken).toBeUndefined();
    expect(readConnectionClaim(JSON.stringify({ sessionToken: '' })).sessionToken).toBeUndefined();
  });
});
