import { describe, expect, it } from 'vitest';
import {
  expiryDate,
  linkNeedsToken,
  linkToShow,
  mintRecovery,
  presentLink,
  readEnforcement,
  readMintResponse,
  roleBlockedReason,
  roleBlurb,
  securityNote,
  wasShortened,
} from './shareModel';

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

describe('enforcement', () => {
  it('reads the status route answer, and says unknown when it did not answer', () => {
    expect(readEnforcement(200, { restricted: true, rooms: [] })).toBe('on');
    expect(readEnforcement(200, { restricted: false, rooms: [] })).toBe('off');
    expect(readEnforcement(500, { restricted: true })).toBe('unknown');
    expect(readEnforcement(200, null)).toBe('unknown');
  });

  it('signs an edit link only when the server refuses bare addresses', () => {
    expect(linkNeedsToken('editor', 'off')).toBe(false);
    expect(linkNeedsToken('editor', 'unknown')).toBe(false);
    expect(linkNeedsToken('editor', 'on')).toBe(true);
    expect(linkNeedsToken('viewer', 'off')).toBe(true);
  });

  it('never says a view link locks anyone out when the server does not enforce it', () => {
    const note = securityNote('viewer', 'off', true);
    expect(note).toMatch(/still opens with full access/);
    expect(securityNote('viewer', 'on', true)).not.toMatch(/still opens/);
    expect(roleBlurb('viewer', 'off')).not.toMatch(/server holds|refuses/i);
    expect(roleBlurb('viewer', 'on')).toMatch(/server refuses/);
  });

  it('is straight about a missing signing key', () => {
    expect(securityNote('viewer', 'off', false)).toMatch(/SHARE_SECRET/);
  });

  it('adds the follow parameter only when asked and only with an id', () => {
    expect(presentLink('https://x/room/a', 'me', true)).toBe('https://x/room/a?follow=me');
    expect(presentLink('https://x/room/a', 'me', false)).toBe('https://x/room/a');
    expect(presentLink('https://x/room/a', undefined, true)).toBe('https://x/room/a');
    expect(presentLink(null, 'me', true)).toBeNull();
  });

  it('shows a signed edit link, never the bare address, when the server enforces signing', () => {
    expect(linkToShow('editor', 'https://x/room/a', { kind: 'working' }, true)).toBeNull();
    expect(linkToShow('editor', 'https://x/room/a', { kind: 'ready', url: 'https://x/i/t', ttlSeconds: 0, role: 'editor' }, true)).toBe('https://x/i/t');
  });
});
