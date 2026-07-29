import { Pool } from "pg";

export const pool = new Pool({
  user: process.env.POSTGRES_USER || "canva_user",
  password: process.env.POSTGRES_PASSWORD || "canva_password",
  host: process.env.POSTGRES_HOST || "localhost",
  port: parseInt(process.env.POSTGRES_PORT || "5432"),
  database: process.env.POSTGRES_DB || "vega_canva",
});

/**
 * Retention for the Time Travel update log.
 *
 * `room_updates` is append-only — one row per document transaction — and had
 * no retention at all: a single room in development had already accumulated
 * 1,723 rows. Left alone it grows without bound for the life of the
 * deployment, and every replay has to read all of it.
 *
 * The room *snapshot* is the canonical recovery state, so this log is purely
 * for scrubbing recent authoring history and can be trimmed freely.
 */
export const MAX_UPDATES_PER_ROOM = 2000;
const PRUNE_INTERVAL_MS = 10 * 60 * 1000;

/** Trim the update log for one room down to the retention limit. */
export const pruneRoomUpdates = async (roomId: string) => {
  await pool.query(
    `DELETE FROM room_updates
      WHERE room_id = $1
        AND id < (
          SELECT MIN(id) FROM (
            SELECT id FROM room_updates
             WHERE room_id = $1
             ORDER BY id DESC
             LIMIT $2
          ) AS keep
        )`,
    [roomId, MAX_UPDATES_PER_ROOM]
  );
};

/** Periodic sweep, so rooms nobody touches still get cleaned up. */
export const startRetentionSweep = () => {
  const sweep = async () => {
    try {
      const { rows } = await pool.query<{ room_id: string }>(
        `SELECT room_id FROM room_updates
          GROUP BY room_id HAVING COUNT(*) > $1`,
        [MAX_UPDATES_PER_ROOM]
      );
      for (const row of rows) await pruneRoomUpdates(row.room_id);
      if (rows.length > 0) console.log(`Pruned update log for ${rows.length} room(s)`);
    } catch (err) {
      // Retention is housekeeping — never let it take the server down.
      console.error("Retention sweep failed:", err);
    }
  };

  const timer = setInterval(sweep, PRUNE_INTERVAL_MS);
  timer.unref?.();
  void sweep();
};

export const initDb = async (retries = 10, delayMs = 2000) => {
  for (let i = 0; i < retries; i++) {
    try {
      const client = await pool.connect();
      try {
        await client.query(`
          CREATE TABLE IF NOT EXISTS rooms (
            id TEXT PRIMARY KEY,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            last_active_at TIMESTAMPTZ DEFAULT NOW()
          );

          CREATE TABLE IF NOT EXISTS room_snapshots (
            room_id TEXT REFERENCES rooms(id) ON DELETE CASCADE PRIMARY KEY,
            state BYTEA,
            updated_at TIMESTAMPTZ DEFAULT NOW()
          );

          CREATE TABLE IF NOT EXISTS media_refs (
            id TEXT PRIMARY KEY,
            room_id TEXT REFERENCES rooms(id) ON DELETE CASCADE,
            url TEXT,
            mime_type TEXT,
            size_bytes BIGINT
          );

          CREATE TABLE IF NOT EXISTS room_updates (
            id SERIAL PRIMARY KEY,
            room_id TEXT REFERENCES rooms(id) ON DELETE CASCADE,
            update_data BYTEA NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW()
          );

          -- Time Travel replays this table in order for a single room, so the
          -- read is always room-scoped and ordered. Without this index that is
          -- a full scan of every update ever recorded, for every room.
          CREATE INDEX IF NOT EXISTS room_updates_room_id_idx
            ON room_updates (room_id, id);
        `);
        console.log("Database initialized successfully");
        return;
      } finally {
        client.release();
      }
    } catch (error: any) {
      console.warn(`Database connection attempt ${i + 1}/${retries} failed (${error.message}). Retrying in ${delayMs}ms...`);
      if (i < retries - 1) {
        await new Promise(res => setTimeout(res, delayMs));
      } else {
        console.error("Database connection failed after maximum retries:", error);
      }
    }
  }
};
