import type { Server as HttpServer } from 'http';
import { Hocuspocus, isTransactionOrigin, type Extension } from '@hocuspocus/server';
import { Database } from '@hocuspocus/extension-database';
import { nanoid } from 'nanoid';
import { WebSocketServer } from 'ws';
import type { Pool } from 'pg';
import type { Config } from './config';
import { checkRoomId } from './rooms';
import { readConnectionClaim } from './connection';
import { readSessionFromRequest, verifySessionToken, type SessionPayload } from './session';
import { explainFailure, verifyShareToken } from './shareToken';
import { createRateLimiter } from './rateLimit';
import type { SharedRedis } from './redisClient';
import { commenterMayApply } from './commenterFilter';
import { ConnectionCounter, upgradeClientAddress, type TrustFn } from './clientAddress';
import { secretMatches } from './routes/admin';
import { captureError, logger } from './observability';

/**
 * The collaboration server: Hocuspocus on a `ws` server sharing the HTTP port.
 *
 * ## The access model
 *
 * There are no accounts. **The room id is the capability**: whoever holds it
 * can open the board and edit it, so the id must be unguessable (the floor in
 * `config.minRoomIdLength`; new ids are `nanoid(10)`).
 *
 * A role arrives one of two ways. From a signed invite, the role was decided
 * by this server and cannot be edited, so it is enforced. Declared by the
 * client on a bare room id, it is a courtesy: a tab in view mode does not
 * sync edits its own interface has put away, and nothing more, because the
 * same client could simply declare "editor". `ENFORCE_SHARE_TOKENS` refuses
 * bare room ids, which is what makes roles binding for everyone.
 *
 * Enforcement, per role:
 * - viewer: the connection is read-only (`connectionConfig.readOnly`).
 * - commenter: each update must pass `commenterMayApply`.
 * - everyone: no update may grow the document past `maxDocumentBytes`.
 *
 * A refused update is handled the way Hocuspocus handles a read-only
 * connection: it is not applied and the client is told it did not sync.
 * Because a client's updates are causally chained, everything that client
 * sends afterwards depends on the refused one and stays unapplied too, until
 * it reloads with a fresh client id. The client's own permission gate is
 * what keeps a commenter from attempting a refused write in the first place.
 */

export interface CollabDeps {
  config: Config;
  pool: Pick<Pool, 'query'>;
  sessionSecret: string;
  history: { add(roomId: string, update: Uint8Array): void };
  roomActivity: { touch(roomId: string): unknown };
  sharedRedis: SharedRedis | null;
  /** Extra Hocuspocus extensions, such as Redis fan-out between instances. */
  extensions?: Extension[];
  /** Express's `trust proxy fn`, so socket addresses agree with `req.ip`. */
  trust?: TrustFn;
}

/** Set by the bridge from the socket, never from the client. */
const ADDRESS_HEADER = 'x-vega-client-address';
const REFUSAL_LOG_MS = 60_000;

/**
 * A refusal the client can read. Hocuspocus sends `reason` in its
 * permission-denied message; a plain Error reaches the client as the generic
 * "permission-denied".
 */
function deny(reason: string): Error {
  return Object.assign(new Error(reason), { reason });
}

function headerObject(headers: unknown): Record<string, string> {
  if (headers && typeof (headers as Headers).forEach === 'function' && typeof (headers as Headers).get === 'function') {
    const out: Record<string, string> = {};
    (headers as Headers).forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  return (headers as Record<string, string>) ?? {};
}

export function createCollab(deps: CollabDeps) {
  const { config, pool } = deps;
  const limits = config.collab;

  /** Encoded size of each loaded document: exact at load and store, approximate between. */
  const documentBytes = new Map<string, number>();
  /** Connections made read-only for the one message being handled. */
  const refusedForMessage = new WeakSet<object>();
  const lastRefusalLog = new Map<string, number>();
  const roomCreateLimiter = createRateLimiter(
    limits.roomCreateBurst,
    limits.roomCreatePerMinute / 60,
    deps.sharedRedis,
    'rl:room-create'
  );

  const noteRefusal = (documentName: string, reason: string) => {
    const now = Date.now();
    const last = lastRefusalLog.get(documentName) ?? 0;
    if (now - last < REFUSAL_LOG_MS) return;
    if (lastRefusalLog.size > 1024) lastRefusalLog.clear();
    lastRefusalLog.set(documentName, now);
    logger.warn('Refused a document update', { room: documentName, reason });
  };

  const database = new Database({
    fetch: async ({ documentName }: { documentName: string }) => {
      const res = await pool.query(`SELECT state FROM room_snapshots WHERE room_id = $1`, [documentName]);
      const state: Uint8Array | null = res.rows[0]?.state ?? null;
      documentBytes.set(documentName, state?.byteLength ?? 0);
      return state;
    },
    store: async ({ documentName, state }: { documentName: string; state: Buffer }) => {
      documentBytes.set(documentName, state.byteLength);
      try {
        await pool.query(
          `INSERT INTO rooms (id) VALUES ($1) ON CONFLICT (id) DO UPDATE SET last_active_at = NOW()`,
          [documentName]
        );
        // The compacted snapshot: the canonical recovery state.
        await pool.query(
          `INSERT INTO room_snapshots (room_id, state) VALUES ($1, $2)
           ON CONFLICT (room_id) DO UPDATE SET state = $2, updated_at = NOW()`,
          [documentName, state]
        );
      } catch (err) {
        captureError('Could not store a board snapshot', err, { room: documentName });
        throw err;
      }
    },
  });

  /** A room with no row and nothing loaded is being created by this connection. */
  const isNewRoom = async (documentName: string): Promise<boolean> => {
    if (hocuspocus.documents.has(documentName)) return false;
    try {
      const res = await pool.query('SELECT 1 FROM rooms WHERE id = $1', [documentName]);
      return res.rows.length === 0;
    } catch {
      // A database hiccup must not stop people opening boards.
      return false;
    }
  };

  const hocuspocus = new Hocuspocus({
    extensions: [...(deps.extensions ?? []), database],

    onAuthenticate: async (payload: any) => {
      const { documentName, token, requestParameters, connectionConfig } = payload;
      const headers = headerObject(payload.requestHeaders);

      const check = checkRoomId(documentName, config.minRoomIdLength);
      if (!check.ok) throw deny(check.reason ?? 'Invalid room identifier');

      const claim = readConnectionClaim(
        token,
        requestParameters?.get?.('role') ?? requestParameters?.get?.('permission')
      );

      // A front door for a private deployment, not authorization.
      if (config.authSecret && !secretMatches(claim.secret, config.authSecret)) {
        throw deny('Unauthorized room connection');
      }

      let role = claim.role;
      let via: 'invite' | 'room-id' = 'room-id';
      if (claim.invite) {
        const verified = verifyShareToken(claim.invite, config.shareSecret);
        if (!verified.ok) throw deny(explainFailure(verified.reason));
        // Bound to a room: an invite for one board is refused on another.
        if (verified.payload.r !== documentName) throw deny('This invite link is for a different board.');
        role = verified.payload.o;
        via = 'invite';
      } else if (config.enforceShareTokens) {
        throw deny('A signed invite link is required to access this board.');
      }

      const address = headers[ADDRESS_HEADER] ?? 'unknown';
      if ((await isNewRoom(documentName)) && !(await roomCreateLimiter.takeAsync(address))) {
        throw deny('Too many new boards from this address. Please try again shortly.');
      }

      // Opening a board is what "active" means to the reaper.
      deps.roomActivity.touch(documentName);

      let sessionUser: SessionPayload | null = null;
      if (claim.sessionToken) {
        const verified = verifySessionToken(claim.sessionToken, deps.sessionSecret);
        if (verified.ok) sessionUser = verified.session;
      }
      if (!sessionUser) {
        sessionUser = readSessionFromRequest({ headers }, deps.sessionSecret).session;
      }

      // Hocuspocus reads read-only from the connection config, not from the
      // value this hook returns.
      if (connectionConfig) connectionConfig.readOnly = role === 'viewer';

      return {
        user: {
          id: sessionUser?.uid || nanoid(),
          isAnonymous: sessionUser?.anon ?? true,
          room: documentName,
          role,
          via,
        },
      };
    },

    beforeSync: async ({ type, payload, connection, document, documentName, context }: any) => {
      // Step 1 only asks what the client is missing; it changes nothing.
      if (type === 0 || !connection || connection.readOnly) return;

      const refuse = (reason: string) => {
        connection.readOnly = true;
        refusedForMessage.add(connection);
        noteRefusal(documentName, reason);
      };

      const size = documentBytes.get(documentName) ?? 0;
      if (size + payload.byteLength > limits.maxDocumentBytes) {
        refuse('document size limit');
        return;
      }
      if (context?.user?.role === 'commenter') {
        const verdict = commenterMayApply(document, payload);
        if (!verdict.ok) refuse(`commenter ${verdict.reason}`);
      }
    },

    afterHandleMessage: async ({ connection }: any) => {
      if (connection && refusedForMessage.has(connection)) {
        refusedForMessage.delete(connection);
        connection.readOnly = false;
      }
    },

    onChange: async ({ documentName, update, transactionOrigin }: any) => {
      documentBytes.set(documentName, (documentBytes.get(documentName) ?? 0) + update.byteLength);
      // Every instance holding the document sees a fanned-out update; only
      // the one that received it from a client records it.
      if (isTransactionOrigin(transactionOrigin) && transactionOrigin.source === 'redis') return;
      // Buffered, not written: see `historyBuffer.ts`.
      deps.history.add(documentName, update);
    },

    afterUnloadDocument: async ({ documentName }: any) => {
      documentBytes.delete(documentName);
    },
  });

  const connections = new ConnectionCounter(limits.maxConnectionsPerIp);
  let wss: WebSocketServer | null = null;

  /** Serve the collaboration socket on an existing HTTP server. */
  function attach(httpServer: HttpServer): WebSocketServer {
    // `maxPayload` bounds a single frame; ws closes the socket (1009) past it.
    wss = new WebSocketServer({ server: httpServer, maxPayload: limits.maxPayloadBytes });
    wss.on('error', (err) => captureError('WebSocket server error', err));

    wss.on('connection', (socket: any, request: any) => {
      const address = upgradeClientAddress(request, deps.trust);
      if (!connections.acquire(address)) {
        socket.close(1008, 'Too many connections from this address');
        return;
      }
      socket.once('close', () => connections.release(address));

      try {
        // Hocuspocus v4 takes a WHATWG Request. The address header is set
        // here from the socket, replacing anything the client sent.
        const headers = new Headers();
        for (const [key, value] of Object.entries(request.headers ?? {})) {
          if (key === ADDRESS_HEADER || value === undefined) continue;
          headers.set(key, Array.isArray(value) ? value.join(', ') : String(value));
        }
        headers.set(ADDRESS_HEADER, address);
        const host = request.headers?.host || 'localhost';
        const fetchRequest = new Request(`http://${host}${request.url || '/'}`, { headers });

        const connection = hocuspocus.handleConnection(socket, fetchRequest);

        socket.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
          try {
            const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as any);
            connection.handleMessage(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
          } catch (err: any) {
            logger.warn('Error processing WebSocket message frame', { error: String(err?.message ?? err) });
          }
        });
        socket.on('close', (code: number, reason: Buffer) => {
          try {
            connection.handleClose({ code, reason: reason?.toString() ?? '' });
          } catch (err: any) {
            logger.warn('Error handling WebSocket close', { error: String(err?.message ?? err) });
          }
        });
        socket.on('error', (err: Error) => {
          logger.warn('WebSocket error', { error: err.message });
        });
      } catch (err) {
        captureError('Failed to initialise a WebSocket connection', err);
        try {
          socket.close(1011, 'Internal server error during handshake');
        } catch {
          /* already closed */
        }
      }
    });
    return wss;
  }

  /**
   * Write every open board to Postgres before the process exits.
   *
   * Stores are debounced, so without this a deploy discards every edit made
   * since the last store, and only people with the edit still in IndexedDB
   * keep it. `flushPendingStores` starts the writes without awaiting them, so
   * completion is "documents remaining reaches zero", the same condition the
   * library's own `Server.destroy` waits for. The timeout keeps one board that
   * refuses to store from holding up the rest.
   */
  async function flushDocuments(timeoutMs = 8000): Promise<void> {
    const open = hocuspocus.getDocumentsCount();
    if (open === 0) return;
    logger.info(`Flushing ${open} open document(s) before exit`);

    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = (reason: string) => {
        if (settled) return;
        settled = true;
        logger.info(`Document flush finished (${reason})`);
        resolve();
      };
      const timer = setTimeout(() => {
        finish(`timeout after ${timeoutMs}ms, ${hocuspocus.getDocumentsCount()} still open`);
      }, timeoutMs);

      // The hook only has to exist for the duration of the shutdown.
      hocuspocus.configuration.extensions.push({
        async afterUnloadDocument({ instance }: any) {
          if (instance.getDocumentsCount() === 0) {
            clearTimeout(timer);
            finish('all documents stored');
          }
        },
      } as Extension);

      // Closing first makes the stores final: a connected client can write
      // again in the middle of the flush.
      hocuspocus.closeConnections();
      hocuspocus.flushPendingStores();
    });
  }

  return {
    hocuspocus,
    attach,
    flushDocuments,
    documentBytes,
    get wss() {
      return wss;
    },
  };
}

export type Collab = ReturnType<typeof createCollab>;
