import { Pool } from "pg";
import * as Y from "yjs";

export const pool = new Pool({
  user: process.env.POSTGRES_USER || "canva_user",
  password: process.env.POSTGRES_PASSWORD || "canva_password",
  host: process.env.POSTGRES_HOST || "localhost",
  port: parseInt(process.env.POSTGRES_PORT || "5432"),
  database: process.env.POSTGRES_DB || "vega_canva",
  max: parseInt(process.env.DB_POOL_MAX || "20", 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on("error", (err) => {
  console.error("Unexpected error on idle PostgreSQL client:", err);
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
/**
 * How much authoring history a replay scrubs through.
 *
 * **2000 was chosen when the log was the only record and was far too many.**
 * Applying Yjs updates gets slower as the document accumulates them — measured
 * in Chrome on a real room: the first two hundred took 489ms and the *next*
 * two hundred took 1,856ms, for the same count. The cost is superlinear, so
 * two thousand is not ten times the first two hundred, it is the tens of
 * seconds of frozen tab that Time Travel was reported for.
 *
 * A smaller window is only safe because of `replay_base`. Before that, trimming
 * discarded the object creations and a trimmed room replayed as an empty board,
 * so the log had to be long enough to reach back to the start of the session —
 * which no fixed number can guarantee anyway. With a baseline, the window is
 * just how far back you can *scrub*: everything before it is still on screen,
 * it simply is not steppable.
 *
 * 400 keeps the load comfortably inside a second and still covers a
 * substantial working session.
 */
export const MAX_UPDATES_PER_ROOM = 400;
const PRUNE_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Trim the update log for one room down to the retention limit.
 *
 * The number of discarded rows is accumulated onto the room, because it is the
 * only record that they existed. `room_updates.id` is a global SERIAL, so gaps
 * in it say nothing about whether *this* room was trimmed — and without that
 * fact the client can only guess, which is what Time Travel was doing when it
 * inferred "partial history" from having exactly the cap's worth of rows. That
 * guess is wrong in both directions: a room sitting at exactly 2000 rows that
 * was never trimmed reads as partial, and a trimmed room that has since fallen
 * below the cap reads as complete.
 */
export const pruneRoomUpdates = async (roomId: string) => {
  /**
   * Fold what is about to be discarded into the replay baseline first.
   *
   * A Yjs update is a delta against structs created by earlier updates, so
   * deleting the head of the log deletes every object's *creation* and leaves
   * the survivors referring to structs that never arrive. A trimmed room
   * therefore replayed as a completely empty board — not a shorter history, no
   * history at all. Measured on a real room here: after applying four hundred
   * retained updates the replay document held **zero** objects.
   *
   * Rolling rather than rebuilt: the existing baseline plus the rows leaving
   * now is the new baseline, so each prune costs only the updates it is
   * actually discarding rather than the room's whole history.
   */
  const cutoff = await pool.query<{ min_id: string | null }>(
    `SELECT MIN(id) AS min_id FROM (
       SELECT id FROM room_updates WHERE room_id = $1 ORDER BY id DESC LIMIT $2
     ) AS keep`,
    [roomId, MAX_UPDATES_PER_ROOM]
  );
  const keepFrom = cutoff.rows[0]?.min_id;
  if (keepFrom == null) return 0;

  const doomed = await pool.query<{ update_data: Buffer }>(
    `SELECT update_data FROM room_updates
      WHERE room_id = $1 AND id < $2 ORDER BY id ASC`,
    [roomId, keepFrom]
  );

  if (doomed.rows.length > 0) {
    const existing = await pool.query<{ replay_base: Buffer | null }>(
      `SELECT replay_base FROM rooms WHERE id = $1`,
      [roomId]
    );

    const doc = new Y.Doc();
    const base = existing.rows[0]?.replay_base;
    if (base) {
      try {
        Y.applyUpdate(doc, new Uint8Array(base));
      } catch (err) {
        // A corrupt baseline is recoverable: the rows about to be discarded
        // are still here, so rebuilding from them loses only what was already
        // folded in, rather than taking the prune down with it.
        console.error("Replay baseline unreadable, rebuilding:", err);
      }
    }
    for (const row of doomed.rows) {
      try {
        Y.applyUpdate(doc, new Uint8Array(row.update_data));
      } catch {
        /* one unreadable row must not stop the fold */
      }
    }

    await pool.query(`UPDATE rooms SET replay_base = $2 WHERE id = $1`, [
      roomId,
      Buffer.from(Y.encodeStateAsUpdate(doc)),
    ]);
    doc.destroy();
  }

  const result = await pool.query(
    `DELETE FROM room_updates WHERE room_id = $1 AND id < $2`,
    [roomId, keepFrom]
  );

  const discarded = result.rowCount ?? 0;
  if (discarded > 0) {
    await pool.query(
      `UPDATE rooms SET updates_trimmed = COALESCE(updates_trimmed, 0) + $2 WHERE id = $1`,
      [roomId, discarded]
    );
  }
  return discarded;
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

          -- How many update rows retention has discarded for this room, ever.
          -- Added separately because CREATE TABLE IF NOT EXISTS will not alter
          -- a table that already exists on a deployed database.
          ALTER TABLE rooms
            ADD COLUMN IF NOT EXISTS updates_trimmed BIGINT NOT NULL DEFAULT 0;

          -- The document as it stood at the moment retention cut the log.
          --
          -- Without this, trimming does not merely shorten a replay, it
          -- *empties* it. Yjs updates are deltas against structs created by
          -- earlier updates, so discarding the beginning of the log discards
          -- every object's creation — and the retained updates then reference
          -- structs that never arrive. Replaying a trimmed room produced a
          -- document with **zero objects** in it, which is exactly what "most
          -- objects never show up during playback" looks like from the outside.
          --
          -- Seeding replay from this baseline and applying the retained
          -- updates on top reconstructs the board correctly, and it is what
          -- makes a bounded log safe to keep bounded.
          ALTER TABLE rooms
            ADD COLUMN IF NOT EXISTS replay_base BYTEA;
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
