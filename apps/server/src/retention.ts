/**
 * Retention for the Time Travel update log.
 *
 * Its own module, free of side effects, so the routes can read the limit
 * without opening the database pool that `db.ts` creates on import.
 *
 * `room_updates` is append-only, one row per document transaction. The room
 * snapshot is the canonical recovery state, so this log only feeds Time
 * Travel and is trimmed to the newest `MAX_UPDATES_PER_ROOM` rows per room.
 * Everything older is folded into `rooms.replay_base`, and each working
 * session that leaves the log is kept as one autosave in `room_versions` (see
 * `historyVersions.ts`), so trimming coarsens old history rather than losing it.
 *
 * The client reads the log in pages and builds its timeline in time-sliced
 * chunks, so the window is bounded by storage and load time, not by how long
 * one synchronous pass may block a tab.
 */
export const MAX_UPDATES_PER_ROOM = 1500;
