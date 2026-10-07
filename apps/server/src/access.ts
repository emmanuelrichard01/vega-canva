import { explainFailure, verifyShareToken, type ShareRole } from './shareToken';

/**
 * What a REST caller may do in a room.
 *
 * The same rule as the WebSocket: a signed invite decides the role, and
 * without one the room id is a full editor capability unless
 * `ENFORCE_SHARE_TOKENS` is on, in which case it is nothing. A REST caller
 * presents its invite in the `X-Invite-Token` header.
 */

export const ROLE_RANK: Record<ShareRole, number> = { viewer: 0, commenter: 1, editor: 2 };

export interface RoomAccess {
  role: ShareRole | null;
  via: 'invite' | 'room-id' | 'none';
  /** Epoch seconds the presented invite expires, 0 if it does not. */
  expiresAt: number;
}

export type AccessResult =
  | { ok: true; access: RoomAccess }
  | { ok: false; status: number; error: string };

export interface AccessPolicy {
  shareSecret: string | null;
  enforceShareTokens: boolean;
}

export const INVITE_HEADER = 'x-invite-token';

export function resolveRoomAccess(
  headers: Record<string, unknown>,
  roomId: string,
  policy: AccessPolicy,
  now = Date.now()
): AccessResult {
  const raw = headers[INVITE_HEADER];
  const token = typeof raw === 'string' && raw ? raw : null;

  if (token) {
    const verified = verifyShareToken(token, policy.shareSecret, now);
    if (!verified.ok) return { ok: false, status: 401, error: explainFailure(verified.reason) };
    if (verified.payload.r !== roomId) {
      return { ok: false, status: 403, error: 'This invite link is for a different board.' };
    }
    return { ok: true, access: { role: verified.payload.o, via: 'invite', expiresAt: verified.payload.e } };
  }

  if (policy.enforceShareTokens) {
    return { ok: true, access: { role: null, via: 'none', expiresAt: 0 } };
  }
  return { ok: true, access: { role: 'editor', via: 'room-id', expiresAt: 0 } };
}

export function hasRole(access: RoomAccess, minimum: ShareRole): boolean {
  return access.role !== null && ROLE_RANK[access.role] >= ROLE_RANK[minimum];
}

/**
 * Express middleware: refuse unless the caller holds at least `minimum` in
 * `req.params.roomId`. The resolved access is left on `req.roomAccess`.
 */
export function requireRole(policy: AccessPolicy, minimum: ShareRole) {
  return (req: any, res: any, next: any) => {
    const result = resolveRoomAccess(req.headers ?? {}, String(req.params.roomId), policy);
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    if (!hasRole(result.access, minimum)) {
      return res.status(403).json({
        error: result.access.role
          ? 'Your link does not allow this.'
          : 'A signed invite link is required to access this board.',
      });
    }
    req.roomAccess = result.access;
    next();
  };
}
