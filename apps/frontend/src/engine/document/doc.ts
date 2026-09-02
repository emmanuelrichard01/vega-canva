import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { IndexeddbPersistence } from 'y-indexeddb';
import { WS_URL } from '../../utils/endpoints';
import { getRoomRole } from '../model/permissions';
import { currentInvite } from '../room/invite';
import { resolveRoomRoute } from '../room/route';

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

/**
 * Which board this tab is for.
 *
 * Two ways in. `/room/:id` names the board directly; `/i/<token>` names it
 * inside a signed invite, which is how a link can carry a role the server
 * will enforce. `home` keeps the landing page from opening a real socket.
 */
const invite = typeof window !== 'undefined' ? currentInvite() : null;

const route = resolveRoomRoute(
  typeof window !== 'undefined' ? window.location?.pathname : undefined,
  invite?.roomId ?? null
);

export const roomId = route.roomId;

export const doc = new Y.Doc();

/**
 * The landing page, and nothing else. Derived with `roomId`, never beside it
 * -- see `engine/room/route.ts` for the bug that came of asking twice.
 */
const isHome = route.isHome;

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

let currentStatus: ConnectionStatus = isHome ? 'disconnected' : 'connecting';
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

/**
 * What this tab tells the server about itself.
 *
 * Two unrelated things share the one token slot Hocuspocus gives us, so they
 * travel as one JSON object:
 *
 * - `secret` is `AUTH_SECRET`, the deployment-wide front door for a private
 *   instance. It had no way to reach the server at all before this -- the
 *   field was simply never sent -- so setting `AUTH_SECRET` locked every
 *   client out of its own deployment, silently, with a generic
 *   "Unauthorized room connection". Omitted entirely when unset, because an
 *   empty string is a value the server would have to special-case.
 * - `role` is view mode, and it is a *statement of intent, not a credential*.
 *   The server honours it so a tab that has put its own tools away does not
 *   sync edits anyway; see `engine/model/permissions.ts` for why that is the
 *   whole of what it can mean.
 */
const AUTH_SECRET = import.meta.env.VITE_AUTH_SECRET as string | undefined;

const connectionToken = JSON.stringify({
  role: getRoomRole(),
  /**
   * The signed half. `role` above is what this tab says about itself and is
   * worth nothing; `invite` is what the server signed, and it outranks the
   * claim -- see `shareToken.ts`.
   */
  ...(invite ? { invite: invite.token } : {}),
  ...(AUTH_SECRET ? { secret: AUTH_SECRET } : {}),
});

export const provider = new HocuspocusProvider({
  url: WS_URL,
  name: roomId,
  document: doc,
  token: connectionToken,
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

if (isHome) {
  provider.disconnect();
}

/** Offline persistence — edits made while disconnected merge up on reconnect. */
export const indexeddbProvider =
  typeof indexedDB !== 'undefined' && !isHome
    ? new IndexeddbPersistence(roomId, doc)
    : (null as unknown as IndexeddbPersistence);

/** Canvas objects, keyed by node id. */
export const objectsMap = doc.getMap<Y.Map<unknown>>('objects');

/** Room-level metadata (title, schema version). */
export const metadataMap = doc.getMap<string>('metadata');

/**
 * Display identity per Yjs clientID: `{ name, color }`.
 *
 * Authorship is denormalised onto each node at creation, which covers "who made
 * this" but not "who changed it". The session timeline attributes every edit by
 * the clientID on the update, and could only put a name to clients that had
 * created something — so anyone who joined and only *edited* showed up as "a
 * collaborator". Recording identity in the document puts it in the update log,
 * where replay can read it back long after that person has disconnected.
 */
export const identitiesMap = doc.getMap<{ name: string; color: string }>('identities');

/**
 * Groups, keyed by group id: `{ id, parentId?, name? }`.
 *
 * A map of its own rather than entries in `objectsMap`, because `objectsMap`
 * means "things that draw" and every renderer, exporter, bounds pass and
 * physics body iterates it on that assumption. A group draws nothing — its
 * bounds are its contents' bounds and always were — so putting one in there
 * would mean teaching a dozen consumers to skip a type, for the privilege of
 * storing a record with no geometry beside records that are nothing but.
 *
 * A group is still identified by its members' `parentId`, exactly as before.
 * What this map adds is the group's *own* parent, which is the whole of
 * nesting: previously the only thing that could hold a `parentId` was a node,
 * and a group is not one, so a group could never contain a group.
 */
export const groupsMap = doc.getMap<{ id: string; parentId?: string; name?: string }>('groups');

/** Comment threads, keyed by thread id. */
export const commentsMap = doc.getMap<Y.Map<unknown>>('comments');

/** Append-only authoring log used by the activity feed. */
export const historyArray = doc.getArray<unknown>('history');

/**
 * Both maps, because grouping writes to both in one transaction.
 *
 * Tracking only `objectsMap` would make undo tear a group apart: the members'
 * `parentId` would roll back while the group record they pointed at stayed,
 * leaving an empty folder and, one step further back, nodes pointing at a
 * group that no longer exists. A group is one act and has to undo as one.
 */
export const undoManager = new Y.UndoManager([objectsMap, groupsMap], {
  captureTimeout: 500, // Group rapid changes into one undo step
});

/** Escape hatch for debugging in the browser console. */
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).objectsMap = objectsMap;
}
