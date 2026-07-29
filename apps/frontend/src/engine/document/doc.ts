import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { IndexeddbPersistence } from 'y-indexeddb';
import { WS_URL } from '../../utils/endpoints';

/**
 * The collaborative document.
 *
 * This module owns the CRDT: the Y.Doc, the sync provider, offline
 * persistence, and the shared maps. It deliberately knows nothing about
 * React, the zustand store, or the scene graph — those subscribe to it, not
 * the other way around. Keeping the dependency one-directional is what stops
 * the document layer and the render layer from growing duplicate copies of
 * the same change-handling logic (which is exactly what had happened: two
 * separate `observeDeep` bridges, each with its own hand-rolled parent walk,
 * both feeding the same scene graph).
 */

/** Room id parsed from `/room/:id`. `home` keeps the landing page from opening a real room socket. */
export const roomId = window.location.pathname.split('/room/')[1] || 'home';

export const doc = new Y.Doc();

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

let currentStatus: ConnectionStatus = 'connecting';
const statusCallbacks = new Set<(status: ConnectionStatus) => void>();
const syncCallbacks = new Set<(synced: boolean) => void>();

export const getConnectionStatus = () => currentStatus;

export const onStatusChange = (cb: (status: ConnectionStatus) => void) => {
  statusCallbacks.add(cb);
  return () => statusCallbacks.delete(cb);
};

export const onSyncedChange = (cb: (synced: boolean) => void) => {
  syncCallbacks.add(cb);
  return () => syncCallbacks.delete(cb);
};

export const provider = new HocuspocusProvider({
  url: WS_URL,
  name: roomId,
  document: doc,
  onConnect: () => {
    currentStatus = 'connected';
    statusCallbacks.forEach((cb) => cb('connected'));
  },
  onDisconnect: () => {
    currentStatus = 'disconnected';
    statusCallbacks.forEach((cb) => cb('disconnected'));
  },
  onSynced: () => {
    syncCallbacks.forEach((cb) => cb(true));
  },
});

/** Offline persistence — edits made while disconnected merge up on reconnect. */
export const indexeddbProvider = new IndexeddbPersistence(roomId, doc);

/** Canvas objects, keyed by node id. */
export const objectsMap = doc.getMap<Y.Map<unknown>>('objects');

/** Room-level metadata (title, schema version). */
export const metadataMap = doc.getMap<string>('metadata');

/** Comment threads, keyed by thread id. */
export const commentsMap = doc.getMap<Y.Map<unknown>>('comments');

/** Append-only authoring log used by the activity feed. */
export const historyArray = doc.getArray<unknown>('history');

export const undoManager = new Y.UndoManager(objectsMap, {
  captureTimeout: 500, // Group rapid changes into one undo step
});

/** Escape hatch for debugging in the browser console. */
(window as unknown as Record<string, unknown>).objectsMap = objectsMap;
