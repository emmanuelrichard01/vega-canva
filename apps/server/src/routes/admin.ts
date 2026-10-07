import { timingSafeEqual } from 'crypto';
import type { Express, RequestHandler } from 'express';
import type { Pool } from 'pg';
import type { ReapOptions, ReapResult } from '../reaper';
import { captureError, logger } from '../observability';

/**
 * Compare a supplied token against the configured one in constant time, so
 * neither its length nor its contents leak through how long a refusal takes.
 */
export function secretMatches(supplied: unknown, expected: string): boolean {
  if (typeof supplied !== 'string') return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

/**
 * Whether a request carries `Authorization: Bearer <ADMIN_SECRET>`.
 *
 * Closed when ADMIN_SECRET is unset. Never AUTH_SECRET, which the browser
 * bundle carries. Header only: a token in a query string ends up in logs.
 */
export function adminCheck(adminSecret: string | null): (req: any) => boolean {
  return (req: any) => {
    if (!adminSecret) return false;
    const header = String(req.headers?.authorization || '');
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    return secretMatches(token, adminSecret);
  };
}

export interface AdminDeps {
  pool: Pick<Pool, 'query'>;
  limiter: RequestHandler;
  isAdmin: (req: any) => boolean;
  roomTtlDays: number;
  reap: (options: ReapOptions) => Promise<ReapResult>;
}

export function registerAdminRoutes(app: Express, deps: AdminDeps): void {
  const requireAdmin: RequestHandler = (req, res, next) => {
    if (!deps.isAdmin(req)) {
      res.status(401).json({ error: 'Unauthorized.' });
      return;
    }
    next();
  };

  /**
   * Reap inactive rooms and their media. The scheduled reap runs
   * `npm run reap` against the database directly; this is the manual route.
   */
  app.post('/admin/reap', deps.limiter, requireAdmin, async (req: any, res: any) => {
    const daysRequested = Number(req.body?.days ?? req.query?.days);
    const maxAgeDays = Number.isFinite(daysRequested) && daysRequested > 0 ? daysRequested : deps.roomTtlDays;
    const dryRun = req.body?.dryRun === true || req.query?.dryRun === 'true';

    try {
      const result = await deps.reap({ maxAgeDays, dryRun });
      logger.info('Admin reap executed', { ...result, roomIds: undefined, roomCount: result.roomIds.length });
      res.json(result);
    } catch (err: any) {
      captureError('Admin reap failed', err);
      res.status(500).json({ error: err?.message || 'Reap failed' });
    }
  });

  /** Storage totals. Behind the admin credential: they are not a health signal. */
  app.get('/admin/stats', deps.limiter, requireAdmin, async (_req: any, res: any) => {
    try {
      const stats = await deps.pool.query<{ media_count: string; total_bytes: string }>(
        `SELECT COUNT(*)::text AS media_count, COALESCE(SUM(size_bytes), 0)::text AS total_bytes FROM media_refs`
      );
      res.json({
        mediaCount: Number(stats.rows[0]?.media_count ?? 0),
        totalBytes: Number(stats.rows[0]?.total_bytes ?? 0),
      });
    } catch (err) {
      captureError('Could not read storage totals', err);
      res.status(500).json({ error: 'Could not read storage totals' });
    }
  });
}
