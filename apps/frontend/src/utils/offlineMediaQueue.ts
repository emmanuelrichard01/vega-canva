import { readNode, roomId as currentRoomId, updateNode, whenSynced } from '../engine/document';
import { canEditObjects } from '../engine/model/permissions';
import { mediaUploadUrl, roomRequestHeaders } from './endpoints';
import { registerLocalMedia, releaseLocalMedia } from './pendingMedia';

const DB_NAME = 'vega_offline_media_db';
const STORE_NAME = 'pending_uploads';

const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB is not available in this environment'));
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

export interface PendingUpload {
  id: string;
  objectId: string;
  roomId: string;
  fileBlob: Blob;
  fileName: string;
  fileType: string;
  mediaType: 'image' | 'audio';
}

export const queueOfflineMedia = async (upload: PendingUpload): Promise<void> => {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(upload);
  } catch (err) {
    console.error("Failed to queue offline media", err);
  }
};

/**
 * Put the queued bytes back within reach, so a board opened offline draws its
 * pictures instead of a row of empty rectangles.
 *
 * This is the half that was missing. The blobs have always been here -- the
 * queue has stored them since it was written -- but nothing read them back
 * except the upload retry, so between opening the board and reconnecting the
 * images were unrecoverable in appearance and perfectly recoverable in fact.
 *
 * Runs on board open, ahead of and independent of any network state: having
 * the file is not conditional on being online, and this is the case where the
 * person is *not* coming back online any time soon.
 */
export const hydratePendingMedia = async (): Promise<void> => {
  try {
    const db = await openDB();
    const store = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => {
      for (const item of (req.result || []) as PendingUpload[]) {
        if (item.fileBlob) registerLocalMedia(item.id, item.fileBlob);
      }
    };
  } catch (err) {
    // A board with no pictures back is worse than one with them, and better
    // than one that does not open. Every caller treats this as best-effort.
    console.warn('Could not restore pending media from the offline queue', err);
  }
};

function listPending(db: IDBDatabase): Promise<PendingUpload[]> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve((req.result || []) as PendingUpload[]);
    req.onerror = () => reject(req.error);
  });
}

function removePending(db: IDBDatabase, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** What draining the queue needs from the outside world; injectable for tests. */
export interface QueueDeps {
  roomId: string;
  canWrite: () => boolean;
  whenSynced: () => Promise<void>;
  list: () => Promise<PendingUpload[]>;
  remove: (id: string) => Promise<void>;
  upload: (item: PendingUpload) => Promise<string | null>;
  readSrc: (objectId: string) => unknown | undefined;
  setSrc: (objectId: string, src: string) => void;
  release: (id: string) => void;
}

/**
 * Upload this room's queued media and point each node at its real URL.
 *
 * Every step is there because skipping it lost media for good:
 *  - **This room only.** The queue is per browser, not per room; a node from
 *    another room is not in this document, so its write did nothing while its
 *    entry was still deleted.
 *  - **After sync.** "Connected" arrives before the server's state does; a node
 *    that exists on the server could look missing a moment earlier.
 *  - **Verified before the entry goes.** The entry and its local blob are
 *    released only once the document actually holds the uploaded URL. A
 *    refused write (a viewer) or a failed upload keeps it for the next try.
 *    A node that is gone after sync was deleted; its entry is dropped.
 */
export async function drainOfflineMediaQueue(deps: QueueDeps): Promise<void> {
  if (!deps.canWrite()) return;
  const mine = (await deps.list()).filter((item) => item.roomId === deps.roomId);
  if (mine.length === 0) return;

  await deps.whenSynced();

  for (const item of mine) {
    try {
      if (deps.readSrc(item.objectId) === undefined) {
        deps.release(item.id);
        await deps.remove(item.id);
        continue;
      }
      const url = await deps.upload(item);
      if (!url) continue;
      deps.setSrc(item.objectId, url);
      if (deps.readSrc(item.objectId) !== url) continue;
      // Only after the document holds the real URL: releasing first would
      // blank the picture for however long the write takes.
      deps.release(item.id);
      await deps.remove(item.id);
    } catch (e) {
      console.warn(`Retry upload for item ${item.id} failed, will retry on next sync`, e);
    }
  }
}

async function uploadPending(item: PendingUpload): Promise<string | null> {
  const formData = new FormData();
  formData.append('media', item.fileBlob, item.fileName);
  const res = await fetch(mediaUploadUrl(item.roomId), { method: 'POST', headers: roomRequestHeaders(), body: formData });
  if (!res.ok) return null;
  const data = await res.json();
  return typeof data?.url === 'string' ? data.url : null;
}

let running: Promise<void> | null = null;
let again = false;

/**
 * Drain the queue, one run at a time.
 *
 * A connection that flaps calls this repeatedly; overlapping runs uploaded the
 * same file twice. A call made during a run schedules one more pass instead.
 */
export const processOfflineMediaQueue = (): Promise<void> => {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    try {
      const db = await openDB();
      do {
        again = false;
        await drainOfflineMediaQueue({
          roomId: currentRoomId,
          canWrite: canEditObjects,
          whenSynced,
          list: () => listPending(db),
          remove: (id) => removePending(db, id),
          upload: uploadPending,
          readSrc: (objectId) => {
            const node = readNode(objectId);
            return node ? (node.src ?? null) : undefined;
          },
          setSrc: (objectId, src) => updateNode(objectId, { src }),
          release: releaseLocalMedia,
        });
      } while (again);
    } catch (err) {
      console.error("Failed processing offline media queue", err);
    } finally {
      running = null;
    }
  })();
  return running;
};

// Setup online listener
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    void processOfflineMediaQueue();
  });
}
