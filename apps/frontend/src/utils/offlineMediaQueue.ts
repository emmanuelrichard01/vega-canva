import { updateNode } from '../engine/document';
import { mediaUploadUrl } from './endpoints';
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

export const processOfflineMediaQueue = async (): Promise<void> => {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    const getAllReq = store.getAll();
    getAllReq.onsuccess = async () => {
      const pending: PendingUpload[] = getAllReq.result || [];
      if (pending.length === 0) return;

      for (const item of pending) {
        try {
          const formData = new FormData();
          formData.append("media", item.fileBlob, item.fileName);

          const res = await fetch(mediaUploadUrl(item.roomId), {
            method: 'POST',
            body: formData,
          });

          const data = await res.json();
          if (data.url) {
            // One canonical field for the asset URL, so there is no second
            // copy that can be left pointing at the dead local blob.
            updateNode(item.objectId, { src: data.url });

            // Only after the document holds the real URL. Releasing first
            // would blank the picture for however long the write takes.
            releaseLocalMedia(item.id);

            // Remove from queue
            const delTx = db.transaction(STORE_NAME, 'readwrite');
            delTx.objectStore(STORE_NAME).delete(item.id);
          }
        } catch (e) {
          console.warn(`Retry upload for item ${item.id} failed, will retry on next sync`, e);
        }
      }
    };
  } catch (err) {
    console.error("Failed processing offline media queue", err);
  }
};

// Setup online listener
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    console.log("Network online: processing pending offline media uploads...");
    processOfflineMediaQueue();
  });
}
