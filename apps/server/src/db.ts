import { readConfig } from "./config";
import { createPool } from "./pool";
import { migrate } from "./migrations";
import { MAX_UPDATES_PER_ROOM } from "./retention";
import { pruneRoomUpdatesWith } from "./historyRetention";

const config = readConfig();

export const pool = createPool(config.db);

export { MAX_UPDATES_PER_ROOM } from "./retention";
const PRUNE_INTERVAL_MS = 10 * 60 * 1000;

/** Trim one room's update log; see `historyRetention.ts`. */
export const pruneRoomUpdates = (roomId: string) => pruneRoomUpdatesWith(pool, roomId);

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
