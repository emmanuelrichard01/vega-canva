import type { Pool } from 'pg';
import { MAX_UPDATES_PER_ROOM } from './retention';
import {
  MAX_AUTO_VERSIONS,
  foldWithCheckpoints,
  mergeAuthors,
  type VersionAuthor,
} from './historyVersions';

type Queryable = Pick<Pool, 'query'>;

/**
 * Trim one room's update log to the retention limit.
 *
 * Before rows are deleted they are folded twice over:
 *
 *  - into `rooms.replay_base`, because a Yjs update is a delta against structs
 *    created by earlier updates. Deleting the head of the log without this
 *    deletes every object's creation, and the survivors replay as an empty
 *    board.
 *  - into autosaves, one per working session (`planCheckpoints`), so the
 *    sessions leaving the steppable log can still be opened as versions.
 *
 * The number of discarded rows is accumulated onto the room, because it is the
 * only record that they existed: `room_updates.id` is a global SERIAL, so its
 * gaps say nothing about this room.
 */
export async function pruneRoomUpdatesWith(
  pool: Queryable,
  roomId: string,
  keep = MAX_UPDATES_PER_ROOM
): Promise<number> {
  const cutoff = await pool.query<{ min_id: string | null }>(
    `SELECT MIN(id) AS min_id FROM (
       SELECT id FROM room_updates WHERE room_id = $1 ORDER BY id DESC LIMIT $2
     ) AS keep`,
    [roomId, keep]
  );
  const keepFrom = cutoff.rows[0]?.min_id;
  if (keepFrom == null) return 0;

  const doomed = await pool.query<{ update_data: Buffer; created_at: Date | string }>(
    `SELECT update_data, created_at FROM room_updates
      WHERE room_id = $1 AND id < $2 ORDER BY id ASC`,
    [roomId, keepFrom]
  );

  if (doomed.rows.length > 0) {
    const existing = await pool.query<{ replay_base: Buffer | null }>(
      `SELECT replay_base FROM rooms WHERE id = $1`,
      [roomId]
    );
    const previous = await pool.query<{ id: string; ended_at: Date | string; authors: VersionAuthor[] | null }>(
      `SELECT id, ended_at, authors FROM room_versions
        WHERE room_id = $1 AND kind = 'auto'
        ORDER BY ended_at DESC LIMIT 1`,
      [roomId]
    );
    const last = previous.rows[0] ?? null;
    const base = existing.rows[0]?.replay_base;

    const { baseline, checkpoints } = foldWithCheckpoints(
      base ? new Uint8Array(base) : null,
      doomed.rows.map((row) => ({
        at: new Date(row.created_at).getTime(),
        update: new Uint8Array(row.update_data),
      })),
      last ? new Date(last.ended_at).getTime() : null
    );

    await pool.query(`UPDATE rooms SET replay_base = $2 WHERE id = $1`, [roomId, Buffer.from(baseline)]);

    for (const checkpoint of checkpoints) {
      if (checkpoint.extends && last) {
        await pool.query(
          `UPDATE room_versions
              SET state = $2, ended_at = $3, update_count = update_count + $4, authors = $5::jsonb
            WHERE id = $1`,
          [
            last.id,
            Buffer.from(checkpoint.state),
            new Date(checkpoint.endedAt),
            checkpoint.updateCount,
            JSON.stringify(mergeAuthors(last.authors ?? [], checkpoint.authors)),
          ]
        );
        continue;
      }
      await pool.query(
        `INSERT INTO room_versions (room_id, kind, state, started_at, ended_at, update_count, authors)
         VALUES ($1, 'auto', $2, $3, $4, $5, $6::jsonb)`,
        [
          roomId,
          Buffer.from(checkpoint.state),
          new Date(checkpoint.startedAt),
          new Date(checkpoint.endedAt),
          checkpoint.updateCount,
          JSON.stringify(checkpoint.authors),
        ]
      );
    }

    // The oldest autosaves go once there are too many. Named versions are
    // never counted or removed here.
    await pool.query(
      `DELETE FROM room_versions
        WHERE room_id = $1 AND kind = 'auto' AND id NOT IN (
          SELECT id FROM room_versions
           WHERE room_id = $1 AND kind = 'auto'
           ORDER BY ended_at DESC LIMIT $2
        )`,
      [roomId, MAX_AUTO_VERSIONS]
    );
  }

  const result = await pool.query(`DELETE FROM room_updates WHERE room_id = $1 AND id < $2`, [
    roomId,
    keepFrom,
  ]);

  const discarded = result.rowCount ?? 0;
  if (discarded > 0) {
    await pool.query(
      `UPDATE rooms SET updates_trimmed = COALESCE(updates_trimmed, 0) + $2 WHERE id = $1`,
      [roomId, discarded]
    );
  }
  return discarded;
}
