import type * as Y from 'yjs';

/**
 * What the sync chip needs beyond "connected or not": how many local edits are
 * waiting to merge, and when the room last agreed with the server.
 *
 * Counted from the Yjs update stream -- one cheap integer increment per local
 * transaction, no per-frame work -- and published to subscribers at most every
 * `throttleMs`, so a drag that fires sixty updates a second is sixty increments
 * and two React renders. Cleared on sync.
 */
export interface SyncMetaSnapshot {
  /** Local transactions made while the connection was down, not yet merged. */
  queued: number;
  /** Epoch ms of the last time the server and this tab agreed, or null if never. */
  lastSyncedAt: number | null;
}

export interface SyncMeta {
  get(): SyncMetaSnapshot;
  subscribe(cb: () => void): () => void;
  setOnline(online: boolean): void;
  markSynced(): void;
  destroy(): void;
}

export function createSyncMeta(
  doc: Y.Doc,
  isRemoteOrigin: (origin: unknown) => boolean,
  opts: { throttleMs?: number; now?: () => number; online?: boolean } = {}
): SyncMeta {
  const throttleMs = opts.throttleMs ?? 400;
  const now = opts.now ?? Date.now;
  let online = opts.online ?? false;
  let queued = 0;
  let lastSyncedAt: number | null = null;
  let snapshot: SyncMetaSnapshot = { queued, lastSyncedAt };
  let timer: ReturnType<typeof setTimeout> | null = null;
  const subs = new Set<() => void>();

  const publish = () => {
    timer = null;
    if (snapshot.queued === queued && snapshot.lastSyncedAt === lastSyncedAt) return;
    snapshot = { queued, lastSyncedAt };
    subs.forEach((cb) => cb());
  };
  const schedule = (immediate = false) => {
    if (immediate) {
      if (timer) clearTimeout(timer);
      publish();
    } else if (!timer) timer = setTimeout(publish, throttleMs);
  };

  const onUpdate = (_u: Uint8Array, origin: unknown) => {
    if (isRemoteOrigin(origin)) return;
    if (online) {
      // Connected: the edit goes straight up, so the room is as synced as it was.
      lastSyncedAt = now();
      return;
    }
    queued += 1;
    schedule();
  };
  doc.on('update', onUpdate);

  return {
    get: () => snapshot,
    subscribe(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    setOnline(next) {
      online = next;
    },
    markSynced() {
      queued = 0;
      lastSyncedAt = now();
      schedule(true);
    },
    destroy() {
      doc.off('update', onUpdate);
      if (timer) clearTimeout(timer);
      subs.clear();
    },
  };
}
