import type { Express, RequestHandler } from 'express';
import type { Pool } from 'pg';
import { mintShareToken, MAX_TTL_SECONDS, type ShareRole } from '../shareToken';
import { ROLE_RANK, resolveRoomAccess, requireRole, type AccessPolicy } from '../access';
import { MAX_UPDATES_PER_ROOM } from '../retention';
import { captureError, logger } from '../observability';

export interface RoomRouteDeps {
  pool: Pick<Pool, 'query'>;
  access: AccessPolicy;
  requireRoom: RequestHandler;
  limiter: RequestHandler;
  /** True when the request carries the admin credential. */
  isAdmin: (req: any) => boolean;
}

/**
 * The role and lifetime an invite may be minted with, or why it may not.
 *
 * A caller can hand on at most what it holds: its own role, and no longer
 * than its own invite lives. Without an invite the caller holds what the room
 * id grants, which is editor unless `ENFORCE_SHARE_TOKENS` makes it nothing.
 * The admin credential may mint anything.
 */
export function decideMint(
  holder: { role: ShareRole | null; expiresAt: number },
  requested: ShareRole,
  requestedTtl: number,
  admin: boolean,
  now = Date.now()
): { ok: true; ttlSeconds: number } | { ok: false; status: number; error: string } {
  if (admin) return { ok: true, ttlSeconds: requestedTtl };
  if (holder.role === null) {
    return { ok: false, status: 403, error: 'A signed invite link is required to share this board.' };
  }
  if (ROLE_RANK[requested] > ROLE_RANK[holder.role]) {
    return { ok: false, status: 403, error: 'You can only share this board with the access you have.' };
  }
  if (holder.expiresAt > 0) {
    const remaining = holder.expiresAt - Math.floor(now / 1000);
    if (remaining <= 0) return { ok: false, status: 401, error: 'Your invite link has expired.' };
    return { ok: true, ttlSeconds: requestedTtl > 0 ? Math.min(requestedTtl, remaining) : remaining };
  }
  return { ok: true, ttlSeconds: requestedTtl };
}

export function registerRoomRoutes(app: Express, deps: RoomRouteDeps): void {
  const { pool } = deps;

  app.post('/rooms/:roomId/invite', deps.requireRoom, deps.limiter, (req: any, res: any) => {
    if (!deps.access.shareSecret) {
      return res.status(501).json({
        error: 'This deployment cannot issue invite links. Set SHARE_SECRET to enable them.',
      });
    }

    const role = String(req.body?.role ?? '');
    if (role !== 'viewer' && role !== 'commenter' && role !== 'editor') {
      return res.status(400).json({ error: 'Unknown role.' });
    }

    const requested = Number(req.body?.ttlSeconds ?? 0);
    const requestedTtl = Number.isFinite(requested)
      ? Math.min(Math.max(0, Math.floor(requested)), MAX_TTL_SECONDS)
      : 0;

    const admin = deps.isAdmin(req);
    let holder: { role: ShareRole | null; expiresAt: number } = { role: null, expiresAt: 0 };
    if (!admin) {
      const access = resolveRoomAccess(req.headers ?? {}, req.params.roomId, deps.access);
      if (!access.ok) return res.status(access.status).json({ error: access.error });
      holder = access.access;
    }

    const decision = decideMint(holder, role, requestedTtl, admin);
    if (!decision.ok) return res.status(decision.status).json({ error: decision.error });

    const token = mintShareToken(deps.access.shareSecret, {
      roomId: req.params.roomId,
      role,
      ttlSeconds: decision.ttlSeconds,
    });

    logger.info('Invite link issued', { room: req.params.roomId, role, ttlSeconds: decision.ttlSeconds });
    res.json({ token, role, ttlSeconds: decision.ttlSeconds });
  });

  /**
   * Time Travel history, bounded by the query: the newest
   * `MAX_UPDATES_PER_ROOM` rows, re-sorted ascending, plus the replay
   * baseline that stands in for everything retention has folded away.
   */
  app.get('/rooms/:roomId/history', deps.requireRoom, requireRole(deps.access, 'viewer'), deps.limiter, async (req: any, res: any) => {
    const roomId = req.params.roomId;
    try {
      const result = await pool.query(
        `SELECT update_data, created_at FROM (
           SELECT id, update_data, created_at
             FROM room_updates
            WHERE room_id = $1
            ORDER BY id DESC
            LIMIT $2
         ) AS recent
         ORDER BY id ASC`,
        [roomId, MAX_UPDATES_PER_ROOM]
      );
      const updates = result.rows.map((row: any) => ({
        createdAt: row.created_at,
        update: row.update_data.toString('base64'),
      }));

      const trimmedResult = await pool.query<{
        updates_trimmed: string;
        total: string;
        replay_base: Buffer | null;
      }>(
        `SELECT COALESCE(r.updates_trimmed, 0) AS updates_trimmed,
                r.replay_base,
                (SELECT COUNT(*) FROM room_updates WHERE room_id = $1) AS total
           FROM rooms r WHERE r.id = $1`,
        [roomId]
      );
      const trimmedCount = Number(trimmedResult.rows[0]?.updates_trimmed ?? 0);
      const total = Number(trimmedResult.rows[0]?.total ?? updates.length);
      const replayBase = trimmedResult.rows[0]?.replay_base ?? null;
      // Rows the sweep has not reached are as absent from this response as
      // rows it deleted, so both count toward "this does not reach the start".
      const withheld = Math.max(0, total - updates.length);

      res.json({
        roomId,
        updates,
        baseline: replayBase ? replayBase.toString('base64') : null,
        trimmed: trimmedCount > 0 || withheld > 0,
        trimmedCount: trimmedCount + withheld,
        retentionLimit: MAX_UPDATES_PER_ROOM,
      });
    } catch (err) {
      captureError('Error fetching room history', err, { roomId });
      res.status(500).json({ error: 'Failed to fetch room history' });
    }
  });
}
