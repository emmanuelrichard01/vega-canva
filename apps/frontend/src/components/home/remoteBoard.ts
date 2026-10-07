import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { IndexeddbPersistence } from 'y-indexeddb';
import { WS_URL } from '../../utils/endpoints';
import { storageGet } from '../../utils/safeStorage';
import { EXPORT_ENVELOPE_VERSION } from '../../engine/export/DocumentImport';
import { SCHEMA_VERSION } from '../../engine/model/schema';
import { roomFingerprint } from '../../engine/room/roomCode';

/**
 * Reaching a board from the dashboard without opening it.
 *
 * Each call opens its own short-lived document for one room and destroys it
 * afterwards. Loaded on demand, so the dashboard pays nothing for it until
 * somebody renames, duplicates or downloads a board.
 *
 * Every connection carries the invite the board was opened through, when it
 * was, so the server grants exactly the access this device has — never more,
 * which a claimed role without the invite would ask for.
 */

const AUTH_SECRET = import.meta.env.VITE_AUTH_SECRET as string | undefined;

export interface Access {
  /** The signed invite, when the board was reached through one. */
  invite?: string;
}

function token(role: 'viewer' | 'editor', access: Access): string {
  const session = storageGet('vega_session_token');
  return JSON.stringify({
    role,
    ...(access.invite ? { invite: access.invite } : {}),
    ...(AUTH_SECRET ? { secret: AUTH_SECRET } : {}),
    ...(session ? { sessionToken: session } : {}),
  });
}

function settle<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(fallback), ms);
    promise.then(
      (value) => { window.clearTimeout(timer); resolve(value); },
      () => { window.clearTimeout(timer); resolve(fallback); }
    );
  });
}

type Connection = 'synced' | 'refused' | 'unreachable';

interface Session {
  doc: Y.Doc;
  provider: HocuspocusProvider;
  local: IndexeddbPersistence | null;
  connection: Connection;
  close: () => void;
}

/**
 * One room, opened for a moment.
 *
 * `withLocal` attaches this device's copy. A rename runs without it, so a
 * write the server refuses is thrown away with the document instead of
 * waiting in IndexedDB to be resent when the board opens.
 */
async function openRoom(
  roomId: string,
  opts: { role: 'viewer' | 'editor'; access: Access; withLocal: boolean; timeoutMs: number; seed?: (doc: Y.Doc) => void }
): Promise<Session> {
  const doc = new Y.Doc();
  const local = opts.withLocal && typeof indexedDB !== 'undefined' ? new IndexeddbPersistence(roomId, doc) : null;
  if (local) await settle(local.whenSynced.then(() => true), opts.timeoutMs, false);
  opts.seed?.(doc);

  let resolveConnection: (value: Connection) => void = () => {};
  const connected = new Promise<Connection>((resolve) => { resolveConnection = resolve; });
  const provider = new HocuspocusProvider({
    url: WS_URL,
    name: roomId,
    document: doc,
    token: token(opts.role, opts.access),
    onSynced: () => resolveConnection('synced'),
    onAuthenticationFailed: () => resolveConnection('refused'),
  });
  const connection = await settle(connected, opts.timeoutMs, 'unreachable' as Connection);

  return {
    doc,
    provider,
    local,
    connection,
    close: () => {
      provider.destroy();
      void local?.destroy();
      doc.destroy();
    },
  };
}

/** Resolves true once every local change has been acknowledged by the server. */
function acknowledged(provider: HocuspocusProvider, timeoutMs: number): Promise<boolean> {
  return settle(new Promise<boolean>((resolve) => {
    const check = () => { if (!provider.hasUnsyncedChanges) resolve(true); };
    provider.on('unsyncedChanges', check);
    window.setTimeout(check, 50);
  }), timeoutMs, false);
}

export type RenameResult = 'renamed' | 'offline' | 'refused';

/**
 * Give a board a new name, as the board itself: `metadata.name`, which the
 * header shows. `refused` means the server will not take writes from this
 * device's link (a view or comment invite, or a deployment that requires
 * invites); `offline` means it could not be reached, and trying later may work.
 */
export async function renameRemote(roomId: string, name: string, access: Access, timeoutMs = 6000): Promise<RenameResult> {
  const session = await openRoom(roomId, { role: 'editor', access, withLocal: false, timeoutMs });
  try {
    if (session.connection === 'refused') return 'refused';
    if (session.connection !== 'synced') return 'offline';
    session.doc.getMap<string>('metadata').set('name', name);
    // Connected and synced, so a write that is never acknowledged was refused:
    // the server drops writes from read-only connections without a reply.
    return (await acknowledged(session.provider, timeoutMs)) ? 'renamed' : 'refused';
  } finally {
    session.close();
  }
}

/** Every string in a node tree that points at another board's media. */
function countMediaRefs(value: unknown, needle: string): number {
  if (typeof value === 'string') return value.includes(needle) ? 1 : 0;
  if (Array.isArray(value)) return value.reduce((n, v) => n + countMediaRefs(v, needle), 0);
  if (value && typeof value === 'object') {
    let n = 0;
    for (const v of Object.values(value as Record<string, unknown>)) n += countMediaRefs(v, needle);
    return n;
  }
  return 0;
}

export interface DuplicatePlan {
  /** The whole source document, every shared map included. */
  update: Uint8Array;
  objectCount: number;
  /** Images and audio that would still be served from the source board. */
  mediaCount: number;
  /** The server's copy was read; otherwise only this device's copy was. */
  fromServer: boolean;
}

/**
 * Read a board in full for copying. `null` when there is nothing to read:
 * never opened here and unreachable now.
 */
export async function planDuplicate(sourceId: string, access: Access, timeoutMs = 6000): Promise<DuplicatePlan | null> {
  const session = await openRoom(sourceId, { role: 'viewer', access, withLocal: true, timeoutMs });
  try {
    const objects = session.doc.getMap<Y.Map<unknown>>('objects');
    const fromServer = session.connection === 'synced';
    if (objects.size === 0 && !fromServer) return null;
    return {
      update: Y.encodeStateAsUpdate(session.doc),
      objectCount: objects.size,
      mediaCount: countMediaRefs(objects.toJSON(), `/rooms/${sourceId}/`),
      fromServer,
    };
  } finally {
    session.close();
  }
}

export type DuplicateResult = 'server' | 'device';

/**
 * Write a copy into a new board: the whole document — objects, groups,
 * comments, guides, fonts and the rest — under a new name. Kept on this
 * device first, so the copy exists even if the server cannot be reached, and
 * sent to the server when it can.
 */
export async function writeDuplicate(newId: string, plan: DuplicatePlan, name: string, timeoutMs = 8000): Promise<DuplicateResult> {
  await assertRoomFor(plan.update.byteLength);
  const session = await openRoom(newId, {
    role: 'editor',
    access: {},
    withLocal: true,
    timeoutMs,
    seed: (doc) => {
      doc.transact(() => {
        Y.applyUpdate(doc, plan.update);
        doc.getMap<string>('metadata').set('name', name);
      });
    },
  });
  let result: DuplicateResult = 'device';
  try {
    if (session.connection === 'synced' && (await acknowledged(session.provider, timeoutMs))) result = 'server';
  } finally {
    session.close();
  }
  // Only this device holds the copy, so it has to be there to be worth opening.
  if (result === 'device') await assertStored(newId, plan.objectCount, timeoutMs);
  return result;
}

const namedError = (name: 'QuotaExceededError' | 'NotStoredError', message: string) => Object.assign(new Error(message), { name });

/**
 * Refuse up front when the browser says there is not room for the copy.
 * IndexedDB reports a full disk only as a failed background write, which
 * nothing waits on, so asking first is the one way to fail before writing.
 */
async function assertRoomFor(bytes: number): Promise<void> {
  try {
    const estimate = await navigator.storage?.estimate?.();
    if (!estimate?.quota || estimate.usage === undefined) return;
    if (estimate.quota - estimate.usage < bytes * 2) throw namedError('QuotaExceededError', 'Not enough storage for the copy.');
  } catch (err) {
    if ((err as { name?: string })?.name === 'QuotaExceededError') throw err;
  }
}

/** Read the copy back from this device, and fail if it did not land. */
async function assertStored(roomId: string, objectCount: number, timeoutMs: number): Promise<void> {
  if (typeof indexedDB === 'undefined') throw namedError('NotStoredError', 'This browser cannot store boards.');
  const doc = new Y.Doc();
  const local = new IndexeddbPersistence(roomId, doc);
  try {
    const synced = await settle(local.whenSynced.then(() => true), timeoutMs, false);
    if (!synced || doc.getMap('objects').size < objectCount) throw namedError('NotStoredError', 'The copy was not stored.');
  } finally {
    void local.destroy();
    doc.destroy();
  }
}

export interface BoardSnapshot {
  /** A JSON export envelope, readable by `parseDocumentExport`. */
  text: string;
  objectCount: number;
  fromServer: boolean;
}

/** The board as a JSON backup file. `null` when there is nothing to save. */
export async function snapshotBoard(
  roomId: string,
  opts: { title: string; access: Access; timeoutMs?: number }
): Promise<BoardSnapshot | null> {
  const session = await openRoom(roomId, { role: 'viewer', access: opts.access, withLocal: true, timeoutMs: opts.timeoutMs ?? 6000 });
  try {
    const objects: Record<string, unknown> = {};
    session.doc.getMap<Y.Map<unknown>>('objects').forEach((node, id) => {
      objects[id] = node instanceof Y.Map ? node.toJSON() : node;
    });
    const count = Object.keys(objects).length;
    if (count === 0) return null;

    const comments: unknown[] = [];
    session.doc.getMap<Y.Map<unknown>>('comments').forEach((thread) => {
      comments.push(thread instanceof Y.Map ? thread.toJSON() : thread);
    });

    const envelope = {
      version: EXPORT_ENVELOPE_VERSION,
      exportedAt: new Date().toISOString(),
      title: opts.title,
      room: { fingerprint: roomFingerprint(roomId) },
      schemaVersion: SCHEMA_VERSION,
      objects,
      comments,
      metadata: { selectedOnly: false, objectCount: count, commentCount: comments.length },
    };
    return { text: JSON.stringify(envelope), objectCount: count, fromServer: session.connection === 'synced' };
  } finally {
    session.close();
  }
}
