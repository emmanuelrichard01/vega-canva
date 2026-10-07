import type { Express, RequestHandler } from 'express';
import type { Pool } from 'pg';
import { requireRole, type AccessPolicy } from '../access';
import { captureError, logger } from '../observability';
import {
  MAX_NAMED_VERSIONS,
  composeState,
  readPositiveInt,
  readVersionInput,
  type VersionAuthor,
} from '../historyVersions';

export interface VersionRouteDeps {
  pool: Pick<Pool, 'query'>;
  access: AccessPolicy;
  requireRoom: RequestHandler;
  limiter: RequestHandler;
}

interface VersionRow {
  id: string;
  kind: 'auto' | 'named';
  name: string | null;
  description: string | null;
  started_at: Date | string;
  ended_at: Date | string;
  update_count: number | string;
  authors: VersionAuthor[] | null;
  created_by_name: string | null;
  state?: Buffer;
}

const iso = (v: Date | string) => (v instanceof Date ? v : new Date(v)).toISOString();

export function toVersion(row: VersionRow) {
  return {
    id: Number(row.id),
    kind: row.kind,
    name: row.name ?? null,
    description: row.description ?? null,
    startedAt: iso(row.started_at),
    endedAt: iso(row.ended_at),
    updateCount: Number(row.update_count ?? 0),
    authors: Array.isArray(row.authors) ? row.authors : [],
    createdByName: row.created_by_name ?? null,
  };
}

const LIST_COLUMNS = `id, kind, name, description, started_at, ended_at, update_count, authors, created_by_name`;

/**
 * Autosaved and named versions.
 *
 * Reading is open to anyone who may read the board; every write needs an
 * editor, the same line the document itself draws. Named versions are stored
 * here rather than in the Yjs document; see `historyVersions.ts` for why.
 */
export function registerVersionRoutes(app: Express, deps: VersionRouteDeps): void {
  const { pool } = deps;
  const viewer = requireRole(deps.access, 'viewer');
  const editor = requireRole(deps.access, 'editor');

  const versionId = (req: any, res: any): number | null => {
    const id = readPositiveInt(req.params.versionId);
    if (!id) {
      res.status(400).json({ error: 'Unknown version.' });
      return null;
    }
    return id;
  };

  app.get('/rooms/:roomId/versions', deps.requireRoom, viewer, deps.limiter, async (req: any, res: any) => {
    const roomId = req.params.roomId;
    try {
      const { rows } = await pool.query<VersionRow>(
        `SELECT ${LIST_COLUMNS} FROM room_versions
          WHERE room_id = $1
          ORDER BY ended_at DESC, id DESC
          LIMIT 700`,
        [roomId]
      );
      res.json({ roomId, versions: rows.map(toVersion) });
    } catch (err) {
      captureError('Error listing versions', err, { roomId });
      res.status(500).json({ error: 'Failed to list versions' });
    }
  });

  app.get('/rooms/:roomId/versions/:versionId', deps.requireRoom, viewer, deps.limiter, async (req: any, res: any) => {
    const roomId = req.params.roomId;
    const id = versionId(req, res);
    if (id === null) return;
    try {
      const { rows } = await pool.query<VersionRow>(
        `SELECT ${LIST_COLUMNS}, state FROM room_versions WHERE room_id = $1 AND id = $2`,
        [roomId, id]
      );
      const row = rows[0];
      if (!row) return res.status(404).json({ error: 'That version no longer exists.' });
      res.json({ ...toVersion(row), state: row.state ? row.state.toString('base64') : null });
    } catch (err) {
      captureError('Error reading version', err, { roomId });
      res.status(500).json({ error: 'Failed to read version' });
    }
  });

  /**
   * Name a version.
   *
   * With `atUpdateId`, the version is the document as it stood after that row
   * of the log: the baseline plus every row up to it. Without, it is the board
   * now: the persisted snapshot, then the baseline and every retained row on
   * top. Applying both is safe because Yjs updates are idempotent, and it
   * covers edits the snapshot's debounce has not written yet.
   */
  app.post('/rooms/:roomId/versions', deps.requireRoom, editor, deps.limiter, async (req: any, res: any) => {
    const roomId = req.params.roomId;
    const input = readVersionInput(req.body);
    if (!input.ok) return res.status(400).json({ error: input.error });
    const at = readPositiveInt(req.body?.atUpdateId);
    if (req.body?.atUpdateId !== undefined && req.body?.atUpdateId !== null && !at) {
      return res.status(400).json({ error: 'atUpdateId must be a row id.' });
    }
    const createdBy =
      typeof req.body?.createdByName === 'string' ? req.body.createdByName.trim().slice(0, 60) || null : null;

    try {
      const count = await pool.query<{ n: string }>(
        `SELECT COUNT(*) AS n FROM room_versions WHERE room_id = $1 AND kind = 'named'`,
        [roomId]
      );
      if (Number(count.rows[0]?.n ?? 0) >= MAX_NAMED_VERSIONS) {
        return res.status(409).json({
          error: `This board already keeps ${MAX_NAMED_VERSIONS} named versions. Delete one to name another.`,
        });
      }

      const base = await pool.query<{ replay_base: Buffer | null }>(
        `SELECT replay_base FROM rooms WHERE id = $1`,
        [roomId]
      );
      const parts: (Uint8Array | null)[] = [];
      let endedAt = new Date();

      if (at) {
        const target = await pool.query<{ created_at: Date | string }>(
          `SELECT created_at FROM room_updates WHERE room_id = $1 AND id = $2`,
          [roomId, at]
        );
        if (!target.rows[0]) {
          return res.status(404).json({ error: 'That moment is no longer in the history log.' });
        }
        endedAt = new Date(target.rows[0].created_at);
      } else {
        const snapshot = await pool.query<{ state: Buffer | null }>(
          `SELECT state FROM room_snapshots WHERE room_id = $1`,
          [roomId]
        );
        const state = snapshot.rows[0]?.state;
        if (state) parts.push(new Uint8Array(state));
      }

      const replayBase = base.rows[0]?.replay_base;
      if (replayBase) parts.push(new Uint8Array(replayBase));
      const rows = await pool.query<{ update_data: Buffer }>(
        `SELECT update_data FROM room_updates
          WHERE room_id = $1 AND id <= $2
          ORDER BY id ASC`,
        [roomId, at ?? Number.MAX_SAFE_INTEGER]
      );
      for (const row of rows.rows) parts.push(new Uint8Array(row.update_data));

      const state = composeState(parts);

      await pool.query(`INSERT INTO rooms (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`, [roomId]);
      const inserted = await pool.query<VersionRow>(
        `INSERT INTO room_versions (room_id, kind, name, description, state, started_at, ended_at, created_by_name)
         VALUES ($1, 'named', $2, $3, $4, $5, $5, $6)
         RETURNING ${LIST_COLUMNS}`,
        [roomId, input.name, input.description || null, Buffer.from(state), endedAt, createdBy]
      );
      logger.info('Version named', { room: roomId, bytes: state.byteLength });
      res.status(201).json(toVersion(inserted.rows[0]));
    } catch (err) {
      captureError('Error naming version', err, { roomId });
      res.status(500).json({ error: 'Failed to save the version' });
    }
  });

  /**
   * Rename a version. Naming an autosave keeps it: it becomes a named version.
   * PUT rather than PATCH because the CORS policy allows PUT.
   */
  app.put('/rooms/:roomId/versions/:versionId', deps.requireRoom, editor, deps.limiter, async (req: any, res: any) => {
    const roomId = req.params.roomId;
    const id = versionId(req, res);
    if (id === null) return;
    const input = readVersionInput(req.body);
    if (!input.ok) return res.status(400).json({ error: input.error });
    try {
      const { rows } = await pool.query<VersionRow>(
        `UPDATE room_versions
            SET kind = 'named', name = $3, description = $4
          WHERE room_id = $1 AND id = $2
          RETURNING ${LIST_COLUMNS}`,
        [roomId, id, input.name, input.description || null]
      );
      if (!rows[0]) return res.status(404).json({ error: 'That version no longer exists.' });
      res.json(toVersion(rows[0]));
    } catch (err) {
      captureError('Error renaming version', err, { roomId });
      res.status(500).json({ error: 'Failed to rename the version' });
    }
  });

  /** Delete a named version. Autosaves are retention's to remove. */
  app.delete('/rooms/:roomId/versions/:versionId', deps.requireRoom, editor, deps.limiter, async (req: any, res: any) => {
    const roomId = req.params.roomId;
    const id = versionId(req, res);
    if (id === null) return;
    try {
      const result = await pool.query(
        `DELETE FROM room_versions WHERE room_id = $1 AND id = $2 AND kind = 'named'`,
        [roomId, id]
      );
      if (!result.rowCount) return res.status(404).json({ error: 'No named version with that id.' });
      res.status(204).end();
    } catch (err) {
      captureError('Error deleting version', err, { roomId });
      res.status(500).json({ error: 'Failed to delete the version' });
    }
  });
}
