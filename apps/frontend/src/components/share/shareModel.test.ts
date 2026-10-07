import { describe, expect, it } from 'vitest';
import { expiryDate, linkToShow, mintRecovery, readMintResponse, roleBlockedReason, wasShortened } from './shareModel';

const ctx = { origin: 'https://vega.test', role: 'viewer' as const, requestedTtl: 7 * 86400 };

describe('share decisions', () => {
  it('blocks roles above the tab’s own, and says why', () => {
    expect(roleBlockedReason('editor', 'editor')).toBeUndefined();
    expect(roleBlockedReason('viewer', 'commenter')).toBeUndefined();
    expect(roleBlockedReason('editor', 'commenter')).toMatch(/comment link.*edit access/);
    expect(roleBlockedReason('commenter', 'viewer')).toMatch(/view link.*comment access/);
  });

  it('reads a minted link, with the server’s own expiry', () => {
    const state = readMintResponse(200, { token: 'abc', ttlSeconds: 3600 }, ctx);
    expect(state).toEqual({ kind: 'ready', url: 'https://vega.test/i/abc', ttlSeconds: 3600, role: 'viewer' });
  });

  it('falls back to the asked-for expiry when the server names none', () => {
    const state = readMintResponse(200, { token: 'abc' }, ctx);
    expect(state.kind === 'ready' && state.ttlSeconds).toBe(ctx.requestedTtl);
  });

  it('treats 501 as a missing signing key, not a failure', () => {
    expect(readMintResponse(501, { error: 'x' }, ctx)).toEqual({ kind: 'unavailable' });
  });

  it('shows the server’s error body, with a way forward', () => {
    const state = readMintResponse(403, { error: 'You can only share this board with the access you have.' }, ctx);
    expect(state).toMatchObject({ kind: 'error', status: 403, message: 'You can only share this board with the access you have.' });
    expect(mintRecovery(state)).toMatch(/someone who can edit/);
    expect(readMintResponse(500, null, ctx)).toMatchObject({ kind: 'error', message: 'The link could not be created.' });
    expect(mintRecovery({ kind: 'error', message: 'offline' })).toMatch(/connection/);
  });

  it('never shows the full-access link for a restricted role', () => {
    const full = 'https://vega.test/room/r1';
    expect(linkToShow('editor', full, { kind: 'idle' })).toBe(full);
    expect(linkToShow('viewer', full, { kind: 'working' })).toBeNull();
    expect(linkToShow('viewer', full, { kind: 'error', message: 'no' })).toBeNull();
    expect(linkToShow('viewer', full, { kind: 'unavailable' })).toBeNull();
    // A link minted for another role is not this role's link.
    expect(linkToShow('viewer', full, { kind: 'ready', url: 'u', ttlSeconds: 0, role: 'commenter' })).toBeNull();
    expect(linkToShow('viewer', full, { kind: 'ready', url: 'u', ttlSeconds: 0, role: 'viewer' })).toBe('u');
  });

  it('notices when the server shortened a link', () => {
    expect(wasShortened(0, 3600)).toBe(true);
    expect(wasShortened(7200, 3600)).toBe(true);
    expect(wasShortened(3600, 3600)).toBe(false);
    expect(wasShortened(0, 0)).toBe(false);
  });

  it('writes an expiry as a date', () => {
    expect(expiryDate(0)).toBeNull();
    const now = new Date(2026, 9, 7, 12).getTime();
    expect(expiryDate(86400, now)).toMatch(/8/);
  });
});
