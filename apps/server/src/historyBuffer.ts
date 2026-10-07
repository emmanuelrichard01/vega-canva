/**
 * The Time Travel log, written in batches instead of a row at a time.
 *
 * `onChange` fires once per Yjs transaction, and a drag emits one every few
 * frames. Updates accumulate in memory and flush on a timer, or early when the
 * buffer gets big, so one multi-row insert replaces N single-row ones.
 *
 * A crash loses whatever has not flushed yet, at most `flushIntervalMs` of
 * history. The canonical document is `room_snapshots`; this table only feeds
 * Time Travel's scrubber. `drain` on shutdown means a deploy loses nothing.
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
   * Ceilings on the queue, by count and by bytes, past which the oldest are
   * dropped. If the database is unreachable the queue is the only thing that
   * grows; live sync is the product and history a convenience, so history is
   * what gets dropped rather than the process running out of memory.
   */
  maxQueue?: number;
  maxBytes?: number;
  /** Writes one batch. Rejecting means the batch is retried in the next flush. */
  write: (batch: PendingUpdate[]) => Promise<void>;
  onError?: (err: unknown, batch: PendingUpdate[]) => void;
}

export class HistoryBuffer {
  private queue: PendingUpdate[] = [];
  private queuedBytes = 0;
  private timer: NodeJS.Timeout | undefined;
  private inFlight: Promise<void> | null = null;
  private stopped = false;
  private droppedCount = 0;

  private readonly flushIntervalMs: number;
  private readonly maxBatch: number;
  private readonly maxQueue: number;
  private readonly maxBytes: number;
  private readonly write: (batch: PendingUpdate[]) => Promise<void>;
  private readonly onError: (err: unknown, batch: PendingUpdate[]) => void;

  constructor(options: HistoryBufferOptions) {
    this.flushIntervalMs = options.flushIntervalMs ?? 1000;
    this.maxBatch = options.maxBatch ?? 200;
    this.maxQueue = options.maxQueue ?? 5000;
    this.maxBytes = options.maxBytes ?? 64 * 1024 * 1024;
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

  get bytes(): number {
    return this.queuedBytes;
  }

  add(roomId: string, update: Uint8Array): void {
    if (this.stopped) return;

    this.queue.push({ roomId, update });
    this.queuedBytes += update.byteLength;
    this.enforceCaps();

    if (this.queue.length >= this.maxBatch) {
      void this.flush();
      return;
    }
    this.schedule();
  }

  private enforceCaps(): void {
    let drop = Math.max(0, this.queue.length - this.maxQueue);
    let bytes = this.queuedBytes;
    for (let i = 0; i < drop; i++) bytes -= this.queue[i].update.byteLength;
    while (bytes > this.maxBytes && drop < this.queue.length) {
      bytes -= this.queue[drop].update.byteLength;
      drop++;
    }
    if (drop === 0) return;
    this.queue.splice(0, drop);
    this.queuedBytes = bytes;
    this.droppedCount += drop;
  }

  private schedule(): void {
    if (this.timer || this.stopped || this.queue.length === 0) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, this.flushIntervalMs);
    this.timer.unref?.();
  }

  /**
   * Write everything queued.
   *
   * One writer at a time, so rows keep the order replay depends on. A call
   * made while a write is in flight waits for it and then writes whatever
   * arrived meanwhile, so nothing queued during a flush is left waiting for
   * the next `add`.
   */
  async flush(): Promise<void> {
    while (this.inFlight) await this.inFlight;
    if (this.queue.length === 0) return;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }

    const batch = this.queue;
    const batchBytes = this.queuedBytes;
    this.queue = [];
    this.queuedBytes = 0;

    this.inFlight = (async () => {
      try {
        await this.write(batch);
      } catch (err) {
        this.onError(err, batch);
        // Back at the front so ordering survives a failed write; the caps
        // deal with it if the database stays down.
        this.queue = batch.concat(this.queue);
        this.queuedBytes += batchBytes;
        this.enforceCaps();
      }
    })();

    try {
      await this.inFlight;
    } finally {
      this.inFlight = null;
    }
    // Anything that arrived during the write, or a batch put back after a
    // failure, still needs a timer.
    this.schedule();
  }

  /**
   * Stop accepting updates and write what is queued, for shutdown.
   *
   * Waits for any flush already running, then makes one more attempt per
   * remaining batch. A batch that still fails is reported through `onError`
   * and given up on: shutdown cannot wait for a database that is down.
   */
  async drain(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    while (this.inFlight) await this.inFlight;
    if (this.queue.length === 0) return;

    const batch = this.queue;
    this.queue = [];
    this.queuedBytes = 0;
    try {
      await this.write(batch);
    } catch (err) {
      this.onError(err, batch);
      this.droppedCount += batch.length;
    }
  }
}

/**
 * The rooms this process has already made sure exist.
 *
 * Turns the per-transaction `INSERT INTO rooms ... ON CONFLICT` into once per
 * room per process. Being wrong costs nothing: a room missing from the set is
 * inserted again, which the `ON CONFLICT` handles.
 */
export class KnownRooms {
  private seen = new Set<string>();

  constructor(private readonly limit = 10_000) {}

  /** True when this room still needs its row created. */
  needsInsert(roomId: string): boolean {
    if (this.seen.has(roomId)) return false;
    if (this.seen.size >= this.limit) {
      // Dropping the whole set costs one redundant upsert per active room.
      this.seen.clear();
    }
    this.seen.add(roomId);
    return true;
  }

  forget(roomId: string): void {
    this.seen.delete(roomId);
  }

  /** Forget every room in a batch whose write failed, so the next one re-creates them. */
  forgetAll(roomIds: Iterable<string>): void {
    for (const id of roomIds) this.seen.delete(id);
  }
}
