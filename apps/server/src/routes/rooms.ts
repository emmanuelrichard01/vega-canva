import type { Express, RequestHandler } from 'express';
import type { Pool } from 'pg';
import { mintShareToken, MAX_TTL_SECONDS, type ShareRole } from '../shareToken';
import { ROLE_RANK, resolveRoomAccess, requireRole, type AccessPolicy } from '../access';
import { MAX_UPDATES_PER_ROOM } from '../retention';
import { captureError, logger } from '../observability';
import {
  MAX_HISTORY_PAGE,
  SESSION_GAP_MS,
  readPositiveInt,
  toSessionSummary,
  type SessionRow,
} from '../historyVersions';
import { registerVersionRoutes } from './versions';

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
   * Time Travel's update log, oldest first, one page at a time.
   *
   * `after` is the last row id the client already holds; without it the page
   * starts at the oldest retained row and also carries what only the first
   * page needs: the replay baseline that stands in for everything retention
   * folded away, and a summary of the working sessions in the whole log, so
   * the timeline can be laid out before the remaining pages arrive.
   *
   * Starting from the oldest *present* row rather than the newest window is
   * what keeps the baseline and the rows contiguous: rows the sweep has not
   * reached yet are still deltas on top of the baseline, and skipping them
   * would orphan everything after.
   */
  app.get('/rooms/:roomId/history', deps.requireRoom, requireRole(deps.access, 'viewer'), deps.limiter, async (req: any, res: any) => {
    const roomId = req.params.roomId;
    const after = readPositiveInt(req.query?.after);
    const askedLimit = readPositiveInt(req.query?.limit);
    if ((req.query?.after !== undefined && after === null) || (req.query?.limit !== undefined && !askedLimit)) {
      return res.status(400).json({ error: 'after and limit must be positive whole numbers.' });
    }
    const limit = askedLimit ? Math.min(askedLimit, MAX_HISTORY_PAGE) : MAX_UPDATES_PER_ROOM;
    const firstPage = after === null;

    try {
      const result = await pool.query<{ id: string; update_data: Buffer; created_at: Date | string }>(
        `SELECT id, update_data, created_at
           FROM room_updates
          WHERE room_id = $1 AND id > $2
          ORDER BY id ASC
          LIMIT $3`,
        [roomId, after ?? 0, limit + 1]
      );
      const more = result.rows.length > limit;
      const rows = more ? result.rows.slice(0, limit) : result.rows;
      const updates = rows.map((row) => ({
        id: Number(row.id),
        createdAt: row.created_at,
        update: row.update_data.toString('base64'),
      }));
      const nextAfter = more && updates.length > 0 ? updates[updates.length - 1].id : null;

      if (!firstPage) {
        // The trim counter rides on every page: if retention folded rows away
        // between two pages, the client's log has a gap and must start over.
        const trim = await pool.query<{ updates_trimmed: string }>(
          `SELECT COALESCE(updates_trimmed, 0) AS updates_trimmed FROM rooms WHERE id = $1`,
          [roomId]
        );
        return res.json({
          roomId,
          updates,
          nextAfter,
          trimmedCount: Number(trim.rows[0]?.updates_trimmed ?? 0),
        });
      }

      const meta = await pool.query<{
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
      const trimmedCount = Number(meta.rows[0]?.updates_trimmed ?? 0);
      const total = Number(meta.rows[0]?.total ?? updates.length);
      const replayBase = meta.rows[0]?.replay_base ?? null;

      // Sessions over the whole retained log: a new one starts wherever two
      // consecutive rows are further apart than the session gap. Index-scoped
      // to this room and bounded by retention, so it never scans the table.
      const sessions = await pool.query<SessionRow>(
        `SELECT MIN(id) AS start_id, MAX(id) AS end_id,
                MIN(created_at) AS started_at, MAX(created_at) AS ended_at,
                COUNT(*) AS count
           FROM (
             SELECT id, created_at,
                    SUM(brk) OVER (ORDER BY id) AS session
               FROM (
                 SELECT id, created_at,
                        CASE WHEN created_at - LAG(created_at) OVER (ORDER BY id)
                                  > make_interval(secs => $2::double precision)
                             THEN 1 ELSE 0 END AS brk
                   FROM room_updates
                  WHERE room_id = $1
               ) marked
           ) grouped
          GROUP BY session
          ORDER BY MIN(id) ASC`,
        [roomId, SESSION_GAP_MS / 1000]
      );

      res.json({
        roomId,
        updates,
        nextAfter,
        total,
        baseline: replayBase ? replayBase.toString('base64') : null,
        trimmed: trimmedCount > 0,
        trimmedCount,
        retentionLimit: MAX_UPDATES_PER_ROOM,
        sessionGapMs: SESSION_GAP_MS,
        sessions: sessions.rows.map(toSessionSummary),
      });
    } catch (err) {
      captureError('Error fetching room history', err, { roomId });
      res.status(500).json({ error: 'Failed to fetch room history' });
    }
  });

  registerVersionRoutes(app, deps);
}
