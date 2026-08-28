/**
 * The history log, written in batches instead of a row at a time.
 *
 * ## The problem
 *
 * `onChange` fires once per Yjs transaction, and a transaction is not a
 * user-visible action -- dragging a shape emits one every few frames. Each one
 * used to perform **two** round trips to Postgres: an `INSERT INTO rooms ...
 * ON CONFLICT DO NOTHING`, which is only meaningful the first time a room is
 * ever seen, and the actual append.
 *
 * At roughly thirty transactions a second on a single board being actively
 * worked in, that is sixty queries a second from one user. The connection pool
 * is twenty. A handful of concurrent boards saturates the database with
 * bookkeeping while the sync itself, which is in memory, is doing nothing at
 * all -- so the first thing to fall over under load is the feature nobody is
 * using rather than the one everybody is.
 *
 * ## The shape of the fix
 *
 * Updates accumulate in memory and flush on a timer, or when the buffer gets
 * big, whichever comes first. One multi-row insert replaces N single-row ones,
 * and the room upsert happens once per room per process rather than once per
 * frame.
 *
 * ## What this trades away, and why it is acceptable
 *
 * A crash loses whatever has not flushed yet -- at most `flushIntervalMs` of
 * history. That is fine, and it would not be fine for the document: the
 * canonical state is `room_snapshots`, written by Hocuspocus's own debounced
 * persistence, and this table only feeds Time Travel's scrubber. Losing the
 * last two seconds of *scrubbable history* after a hard kill costs somebody
 * the ability to step through a moment they can still see on their screen.
 *
 * The flush on shutdown means the ordinary case -- a deploy -- loses nothing.
 */

export interface PendingUpdate {
  roomId: string;
  update: Uint8Array;
}

export interface HistoryBufferOptions {
  /** How long a batch may sit before it is written. */
  flushIntervalMs?: number;
  /** How many updates may queue before a flush is triggered early. */
  maxBatch?: number;
  /**
   * A ceiling on the queue, after which the oldest are dropped.
   *
   * Backpressure, not politeness. If the database is unreachable the flush
   * keeps failing and the queue is the only thing that grows; without a cap
   * the process runs out of memory, which takes live sync down with it. Live
   * sync is the product and history is a convenience, so the convenience is
   * what gets dropped.
   */
  maxQueue?: number;
  /** Writes one batch. Rejecting means the batch is retried in the next flush. */
  write: (batch: PendingUpdate[]) => Promise<void>;
  onError?: (err: unknown) => void;
}

export class HistoryBuffer {
  private queue: PendingUpdate[] = [];
  private timer: NodeJS.Timeout | undefined;
  private flushing = false;
  private stopped = false;
  private droppedCount = 0;

  private readonly flushIntervalMs: number;
  private readonly maxBatch: number;
  private readonly maxQueue: number;
  private readonly write: (batch: PendingUpdate[]) => Promise<void>;
  private readonly onError: (err: unknown) => void;

  constructor(options: HistoryBufferOptions) {
    this.flushIntervalMs = options.flushIntervalMs ?? 1000;
    this.maxBatch = options.maxBatch ?? 200;
    this.maxQueue = options.maxQueue ?? 5000;
    this.write = options.write;
    this.onError = options.onError ?? (() => {});
  }

  /** How many updates were dropped because the queue was full. */
  get dropped(): number {
    return this.droppedCount;
  }

  get depth(): number {
    return this.queue.length;
  }

  add(roomId: string, update: Uint8Array): void {
    if (this.stopped) return;

    this.queue.push({ roomId, update });

    if (this.queue.length > this.maxQueue) {
      const overflow = this.queue.length - this.maxQueue;
      this.queue.splice(0, overflow);
      this.droppedCount += overflow;
    }

    if (this.queue.length >= this.maxBatch) {
      void this.flush();
      return;
    }

    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = undefined;
        void this.flush();
      }, this.flushIntervalMs);
      this.timer.unref?.();
    }
  }

  /**
   * Write everything queued.
   *
   * Re-entrant calls are ignored rather than queued: a flush already in flight
   * will pick up anything added since it started, on its next pass, and two
   * overlapping writers would interleave rows and lose the ordering that
   * replay depends on.
   */
  async flush(): Promise<void> {
    if (this.flushing || this.queue.length === 0) return;
    this.flushing = true;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }

    const batch = this.queue;
    this.queue = [];

    try {
      await this.write(batch);
    } catch (err) {
      this.onError(err);
      // Put them back at the front so ordering survives a failed write, and
      // let the cap deal with it if the database stays down.
      this.queue = batch.concat(this.queue);
      if (this.queue.length > this.maxQueue) {
        const overflow = this.queue.length - this.maxQueue;
        this.queue.splice(0, overflow);
        this.droppedCount += overflow;
      }
    } finally {
      this.flushing = false;
    }
  }

  /** Flush and stop accepting anything further. For shutdown. */
  async drain(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    await this.flush();
  }
}

/**
 * The rooms this process has already made sure exist.
 *
 * The upsert is idempotent and cheap, and it was still being run on every
 * transaction for a fact that cannot change once it is true. A set in memory
 * turns it into once per room per process. Being wrong costs nothing: a room
 * missing from the set is inserted again, which the `ON CONFLICT` handles.
 */
export class KnownRooms {
  private seen = new Set<string>();

  constructor(private readonly limit = 10_000) {}

  /** True when this room still needs its row created. */
  needsInsert(roomId: string): boolean {
    if (this.seen.has(roomId)) return false;
    if (this.seen.size >= this.limit) {
      // A long-lived process on a busy deployment should not accumulate every
      // room id it has ever seen. Dropping the whole set costs one redundant
      // upsert per active room afterwards.
      this.seen.clear();
    }
    this.seen.add(roomId);
    return true;
  }

  forget(roomId: string): void {
    this.seen.delete(roomId);
  }
}
