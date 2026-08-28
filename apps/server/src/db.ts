import { Pool } from "pg";
import * as Y from "yjs";
import { readConfig } from "./config";
import { migrate } from "./migrations";

const config = readConfig();

export const pool = new Pool({
  user: config.db.user,
  password: config.db.password,
  host: config.db.host,
  port: config.db.port,
  database: config.db.database,
  max: config.db.poolMax,
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

/**
 * How far back the sweep looks for rooms worth checking.
 *
 * Generously wider than the interval, so a sweep that is late, or a room
 * touched a moment before the previous pass, is still caught.
 */
const SWEEP_WINDOW = "6 hours";

/** Periodic sweep, so rooms nobody touches still get cleaned up. */
export const startRetentionSweep = () => {
  const sweep = async () => {
    try {
      /**
       * Only rooms that have been touched lately.
       *
       * This was `GROUP BY room_id HAVING COUNT(*)` across the whole of
       * `room_updates` -- a full scan of every update ever recorded by every
       * room, every ten minutes, growing with the deployment for the life of
       * it. And almost all of that work is wasted by construction: a room only
       * exceeds the cap by *writing*, and a room that has not been written to
       * since the last pass cannot have crossed it since the last pass.
       *
       * Scoping to recent activity turns the scan into an index lookup on
       * `rooms_last_active_idx` followed by a bounded per-room count against
       * `room_updates_room_id_idx`. A dormant room is never read at all, which
       * is correct: it was pruned when it was active and nothing has changed.
       */
      const { rows } = await pool.query<{ room_id: string }>(
        `SELECT u.room_id
           FROM room_updates u
           JOIN rooms r ON r.id = u.room_id
          WHERE r.last_active_at > NOW() - $2::interval
          GROUP BY u.room_id
         HAVING COUNT(*) > $1`,
        [MAX_UPDATES_PER_ROOM, SWEEP_WINDOW]
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

/**
 * Bring the schema up to date, or refuse to run.
 *
 * ## Why this throws now
 *
 * It used to log the failure and return, so a server that could not reach its
 * database started anyway and served every request as a 500. That is the worst
 * of the available behaviours: the process is up, so an orchestrator considers
 * it healthy and routes traffic to it, and nothing escalates. Failing to start
 * is loud, and loud is what you want at three in the morning.
 *
 * The retries stay, because a database that is *still starting* is the normal
 * case in a compose or Kubernetes cold start and is not a failure.
 */
export const initDb = async (retries = 10, delayMs = 2000) => {
  let lastError: unknown;

  for (let i = 0; i < retries; i++) {
    try {
      const applied = await migrate(pool);
      console.log(
        applied.length > 0
          ? `Database schema up to date (applied ${applied.length} migration(s))`
          : "Database schema up to date"
      );
      return;
    } catch (error: any) {
      lastError = error;
      console.warn(
        `Database connection attempt ${i + 1}/${retries} failed (${error.message}). Retrying in ${delayMs}ms...`
      );
      if (i < retries - 1) await new Promise((res) => setTimeout(res, delayMs));
    }
  }

  throw new Error(
    `Database unavailable after ${retries} attempts: ${(lastError as Error)?.message ?? lastError}`
  );
};

/** A cheap round trip, for the readiness probe. */
export const pingDb = async (): Promise<boolean> => {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
};
