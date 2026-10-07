/**
 * Retention for the Time Travel update log.
 *
 * Its own module, free of side effects, so the routes can read the limit
 * without opening the database pool that `db.ts` creates on import.
 *
 * `room_updates` is append-only, one row per document transaction. The room
 * snapshot is the canonical recovery state, so this log only feeds Time
 * Travel and is trimmed to the newest `MAX_UPDATES_PER_ROOM` rows per room,
 * with everything older folded into `rooms.replay_base`.
 *
 * Applying Yjs updates gets superlinearly slower as a document accumulates
 * them (measured in Chrome: the first two hundred took 489ms, the next two
 * hundred 1,856ms). 400 keeps a replay inside a second and still covers a
 * substantial working session; the baseline means everything before the
 * window is still on screen, just not steppable.
 */
export const MAX_UPDATES_PER_ROOM = 400;
