import type { Pool } from 'pg';

/**
 * Keeps `rooms.last_active_at` honest.
 *
 * ## The bug this fixes
 *
 * `last_active_at` was written in exactly one place: the `store` callback of
 * the Hocuspocus Database extension, which fires on debounced persistence --
 * that is, **only when the document changed**. A board a team opens and reads
 * every day but never edits had a frozen timestamp.
 *
 * That was harmless while nothing read the column. `reaper.ts` now does, and
 * it hard-deletes: the room row, and by cascade its snapshot, its update log
 * and its media rows, plus the objects behind them. So the reference board
 * everybody consults and nobody edits was precisely the row most likely to be
 * collected, and there are no backups to undo it with.
 *
 * Refreshing on connection is the fix, because opening a board is the thing
 * "active" was always meant to mean.
 *
 * ## Why UPDATE and not UPSERT
 *
 * `store` uses `INSERT ... ON CONFLICT DO UPDATE`, and copying that here
 * would let anyone mint unlimited empty `rooms` rows by connecting to random
 * ids -- a write endpoint reachable before any content exists. A bare UPDATE
 * is a no-op for a room that has never been stored, which is correct: a room
 * with nothing in it has nothing to protect from the reaper, and `store`
 * creates the row the moment there is.
 */

/**
 * How long a room's timestamp is considered fresh enough to skip the write.
 *
 * Without it, a flapping connection writes on every retry. The interval only
 * needs to be small relative to the TTL it feeds -- days -- so five minutes
 * is far finer than the decision it informs while collapsing a reconnect
 * storm into one statement.
 */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export class RoomActivity {
  private lastTouched = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private pool: Pool, private intervalMs = TOUCH_INTERVAL_MS) {
    // The map is a cache, not a record. Entries older than the interval can
    // never suppress a write again, so holding them is pure growth.
    this.timer = setInterval(() => this.prune(), this.intervalMs);
    this.timer.unref?.();
  }

  private prune(now = Date.now()): void {
    for (const [id, at] of this.lastTouched) {
      if (now - at > this.intervalMs) this.lastTouched.delete(id);
    }
  }

  /**
   * Mark a room as active. Safe to call on every connection.
   *
   * Never throws and never blocks the caller: this runs on the authentication
   * path, and a database hiccup must not stop people opening a board. The
   * cost of losing one is a timestamp that is five minutes stale.
   */
  touch(roomId: string, now = Date.now()): boolean {
    const last = this.lastTouched.get(roomId);
    if (last !== undefined && now - last < this.intervalMs) return false;

    this.lastTouched.set(roomId, now);
    void this.pool
      .query('UPDATE rooms SET last_active_at = NOW() WHERE id = $1', [roomId])
      .catch(() => {
        // Allow a retry rather than pretending the write landed.
        this.lastTouched.delete(roomId);
      });
    return true;
  }

  /** For tests and the readiness payload. */
  get size(): number {
    return this.lastTouched.size;
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
