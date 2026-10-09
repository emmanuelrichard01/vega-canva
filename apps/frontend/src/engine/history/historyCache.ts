import type { RawUpdate } from './sessionTimeline';

/**
 * The room's update log, kept in IndexedDB between visits.
 *
 * The log only ever grows at the end, and retention only ever folds rows away
 * from the front (bumping the room's trim counter). So a copy taken earlier
 * stays valid as long as the trim counter has not moved: the next open replays
 * it at once and asks the server only for rows after the last id it holds.
 * When the counter has moved the copy is discarded and the log is read whole.
 *
 * Everything here is best effort. IndexedDB is missing in some private
 * windows, throws when storage is blocked, and can be slow to open on a cold
 * profile; every failure reads as "nothing cached" and the caller falls back
 * to the network.
 */

export interface CachedHistory {
  v: 1;
  roomId: string;
  baseline: string | null;
  trimmedCount: number;
  rows: RawUpdate[];
  savedAt: number;
}

const DB_NAME = 'vega-history';
const STORE = 'logs';
/** Older than this and the copy is not trusted (the room could have been reset). */
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
/** Rooms kept; the least recently saved go first. */
const MAX_ROOMS = 12;
/** Skip caching an outsized log rather than fill the quota. Base64 characters. */
const MAX_CHARS = 24 * 1024 * 1024;
/** A cold IndexedDB open can take a while; past this the network is faster. */
const OPEN_TIMEOUT_MS = 800;

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    let settled = false;
    const done = (db: IDBDatabase | null) => {
      if (settled) {
        db?.close();
        return;
      }
      settled = true;
      resolve(db);
    };
    try {
      if (typeof indexedDB === 'undefined') return done(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE, { keyPath: 'roomId' }).createIndex('savedAt', 'savedAt');
        }
      };
      req.onsuccess = () => done(req.result);
      req.onerror = () => done(null);
      req.onblocked = () => done(null);
      setTimeout(() => done(null), OPEN_TIMEOUT_MS);
    } catch {
      done(null);
    }
  }).then((db) => {
    if (!db) dbPromise = null;
    return db;
  });
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise<T | undefined>((resolve) => {
        if (!db) return resolve(undefined);
        try {
          const tx = db.transaction(STORE, mode);
          const req = fn(tx.objectStore(STORE));
          tx.oncomplete = () => resolve(req ? req.result : undefined);
          tx.onerror = () => resolve(undefined);
          tx.onabort = () => resolve(undefined);
        } catch {
          resolve(undefined);
        }
      })
  );
}

/** A plausible cached log for this room, or null. */
export function isUsableCache(value: unknown, roomId: string, now = Date.now()): value is CachedHistory {
  const c = value as Partial<CachedHistory> | null;
  return Boolean(
    c &&
      c.v === 1 &&
      c.roomId === roomId &&
      Array.isArray(c.rows) &&
      c.rows.length > 0 &&
      typeof c.trimmedCount === 'number' &&
      typeof c.savedAt === 'number' &&
      now - c.savedAt < MAX_AGE_MS &&
      (c.baseline === null || typeof c.baseline === 'string') &&
      typeof c.rows[c.rows.length - 1]?.id === 'number'
  );
}

export async function readCachedHistory(roomId: string): Promise<CachedHistory | null> {
  const value = await run<CachedHistory>('readonly', (s) => s.get(roomId)).catch(() => undefined);
  return isUsableCache(value, roomId) ? value : null;
}

export async function writeCachedHistory(entry: Omit<CachedHistory, 'v' | 'savedAt'>): Promise<void> {
  let chars = entry.baseline?.length ?? 0;
  for (const r of entry.rows) chars += r.update.length;
  if (chars > MAX_CHARS || entry.rows.length === 0 || typeof entry.rows[entry.rows.length - 1]?.id !== 'number') return;
  const value: CachedHistory = { v: 1, savedAt: Date.now(), ...entry };
  await run('readwrite', (s) => s.put(value)).catch(() => undefined);
  await prune().catch(() => undefined);
}

export async function clearCachedHistory(roomId: string): Promise<void> {
  await run('readwrite', (s) => s.delete(roomId)).catch(() => undefined);
}

/** Drop the least recently saved rooms past the cap, reading keys only (never the logs). */
async function prune(): Promise<void> {
  await run('readwrite', (s) => {
    const count = s.count();
    count.onsuccess = () => {
      let excess = count.result - MAX_ROOMS;
      if (excess <= 0) return;
      const cursor = s.index('savedAt').openKeyCursor();
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (!c || excess <= 0) return;
        s.delete(c.primaryKey);
        excess--;
        c.continue();
      };
    };
  });
}
