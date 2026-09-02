import type { RoomRole } from '../model/permissions';

/**
 * Arriving by an invite link.
 *
 * ## The two halves, and which one is load-bearing
 *
 * An invite is `<base64url(payload)>.<signature>` at `/i/<token>`. This module
 * reads the payload so the app knows **which board to open and which mode to
 * present**. It does not, and cannot, check the signature -- the key is on the
 * server.
 *
 * That is not a gap. The payload is readable on purpose: it names a room the
 * holder is being given access to, so there is nothing in it to hide, and
 * making it opaque would imply a confidentiality the scheme does not provide.
 * What the signature protects is *integrity*, and integrity is checked where
 * it is enforced -- `onAuthenticate` verifies the token, binds it to the room
 * it names, and sets `readOnly` from the role inside it.
 *
 * So editing the role in your own URL changes what this file believes and
 * nothing about what the server allows. The tools would come back and the
 * edits would not sync, which is a strictly worse experience than the mode you
 * were given, and the reason the interface follows the payload rather than
 * fighting it.
 */

export interface Invite {
  /** The whole token, forwarded to the server on the socket. */
  token: string;
  roomId: string;
  role: RoomRole;
  /** Epoch ms, or null when the link does not expire. */
  expiresAt: number | null;
}

const ROLES: ReadonlySet<string> = new Set(['editor', 'commenter', 'viewer']);

/** `/i/<token>` — the only shape an invite arrives in. */
export function inviteTokenFromPath(pathname: string): string | null {
  const match = /^\/i\/([A-Za-z0-9_.-]+)\/?$/.exec(pathname);
  return match ? match[1] : null;
}

/**
 * Read an invite without verifying it.
 *
 * Named for what it does. A `parseInvite` that sounded like validation would
 * be borrowed one day by something that needed the real thing.
 */
export function readUnverifiedInvite(token: string | null): Invite | null {
  if (!token) return null;

  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return null;

  try {
    const json = atob(token.slice(0, dot).replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(json) as { r?: unknown; o?: unknown; e?: unknown };

    if (typeof payload.r !== 'string' || !payload.r) return null;
    if (typeof payload.o !== 'string' || !ROLES.has(payload.o)) return null;

    const exp = typeof payload.e === 'number' && payload.e > 0 ? payload.e * 1000 : null;
    return { token, roomId: payload.r, role: payload.o as RoomRole, expiresAt: exp };
  } catch {
    return null;
  }
}

/** The invite this tab arrived on, if any. */
export function currentInvite(pathname?: string): Invite | null {
  const path =
    pathname ?? (typeof window !== 'undefined' && window.location ? window.location.pathname : '');
  return readUnverifiedInvite(inviteTokenFromPath(path));
}

/**
 * Whether a link has already lapsed, as far as the browser can tell.
 *
 * Only ever used to say so *before* connecting -- the server checks the real
 * expiry against its own clock, which is the one that counts. A machine with a
 * slow clock should still be told why it was refused rather than shown a
 * generic failure.
 */
export function inviteHasExpired(invite: Invite, now = Date.now()): boolean {
  return invite.expiresAt !== null && now >= invite.expiresAt;
}
