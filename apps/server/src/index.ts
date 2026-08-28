import { Hocuspocus } from "@hocuspocus/server";
import { Database } from "@hocuspocus/extension-database";
import { Redis } from "@hocuspocus/extension-redis";
import express from "express";
import cors from "cors";
import multer from "multer";
import multerS3 from "multer-s3";
import { S3Client, CreateBucketCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import path from "path";
import { nanoid } from "nanoid";
import { timingSafeEqual } from "crypto";
import { WebSocketServer } from "ws";
import { pool, initDb, pingDb, startRetentionSweep, MAX_UPDATES_PER_ROOM } from "./db";
import { readConfig } from "./config";
import { isAllowedUpload, safeExtension, serveAs } from "./media";
import { checkRoomId, sanitizeRoomId } from "./rooms";
import { rateLimit } from "./rateLimit";
import { HistoryBuffer, KnownRooms, type PendingUpdate } from "./historyBuffer";

const config = readConfig();

/**
 * Whether the schema is ready. The readiness probe reads it.
 *
 * `initDb` now throws rather than logging and carrying on, because a process
 * that is up but cannot reach its database is the worst of the options: an
 * orchestrator sees a live process, routes traffic to it, and nothing
 * escalates while every request returns a 500.
 */
let dbReady = false;

initDb()
  .then(() => {
    dbReady = true;
    startRetentionSweep();
  })
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });

const app = express();

/**
 * Believe the proxy about who the client is, when there is one.
 *
 * `req.ip` reads the socket's peer address unless Express is told otherwise,
 * and behind a reverse proxy — which is every deployment that terminates TLS —
 * that address is the proxy's. The rate limiters below key on it, so all of
 * them would share one bucket: a single busy client could lock everybody out,
 * and a malicious one would be throttled alongside the people it is attacking.
 *
 * Off by default and enabled explicitly, because the opposite mistake is worse.
 * `trust proxy` makes Express believe `X-Forwarded-For`, which any client can
 * send — so switching it on without a proxy in front lets anyone claim a fresh
 * IP per request and opt out of rate limiting entirely. It is a deployment
 * fact, so it comes from the deployment.
 */
if (config.trustProxy !== null) {
  app.set('trust proxy', config.trustProxy);
}

/**
 * Origins allowed to call this API. `'*'` is unreachable in production --
 * `readConfig` refuses to start without an explicit list. See `config.ts`.
 */
const allowedOrigins = config.allowedOrigins;

app.use(cors({
  origin: (origin, callback) => {
    if (allowedOrigins === '*' || !origin) {
      callback(null, true);
    } else if (Array.isArray(allowedOrigins) && allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Origin not allowed by CORS'));
    }
  }
}));
app.use(express.json());

// Per-process, which is correct for one instance and silently wrong for many.
// See the note in `rateLimit.ts`.
const mediaUploadLimiter = rateLimit(30, 1); // 30 bursts, 1 upload per second refill
const historyLimiter = rateLimit(60, 2);     // 60 bursts, 2 requests per second refill

/**
 * Compare a supplied token against the configured one without leaking its
 * length or its contents through how long the comparison takes.
 *
 * `!==` on strings returns at the first differing byte. Against a network
 * attacker that difference is small and noisy, but it is free to remove and
 * there is no argument for keeping a timing-variable comparison on a secret.
 */
const secretMatches = (supplied: unknown, expected: string): boolean => {
  if (typeof supplied !== 'string') return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  // `timingSafeEqual` throws on a length mismatch, which would itself be a
  // length oracle, so both are hashed to a fixed width first.
  if (a.length !== b.length) {
    // Still do the work, so the early exit is not observable.
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
};

/**
 * The Time Travel log, written in batches.
 *
 * Declared here so the readiness probe and the shutdown path can both reach
 * it. `KnownRooms` removes the other half of the old cost: an upsert per
 * transaction for a fact that cannot change once it is true.
 */
const knownRooms = new KnownRooms();

const history = new HistoryBuffer({
  flushIntervalMs: Number(process.env.HISTORY_FLUSH_MS || 1000),
  write: async (batch: PendingUpdate[]) => {
    const fresh = [...new Set(batch.map((b) => b.roomId))].filter((id) =>
      knownRooms.needsInsert(id)
    );
    if (fresh.length > 0) {
      await pool.query(
        `INSERT INTO rooms (id) SELECT unnest($1::text[]) ON CONFLICT (id) DO NOTHING`,
        [fresh]
      );
    }

    // One multi-row insert. `unnest` of two parallel arrays keeps this a
    // single parameterised statement whatever the batch size, rather than
    // building N placeholders into the SQL text.
    await pool.query(
      `INSERT INTO room_updates (room_id, update_data)
       SELECT * FROM unnest($1::text[], $2::bytea[])`,
      [batch.map((b) => b.roomId), batch.map((b) => Buffer.from(b.update))]
    );
  },
  onError: (err) => {
    // History is a convenience; live sync is the product. Never throw from here.
    console.error("Failed to append history updates:", err);
    // A failed insert means these rooms may not exist after all.
    knownRooms.forget('');
  },
});

// MinIO S3 Configuration
const s3 = new S3Client({
  endpoint: config.s3.endpoint,
  region: "us-east-1",
  credentials: {
    accessKeyId: config.s3.accessKey,
    secretAccessKey: config.s3.secretKey,
  },
  forcePathStyle: true,
});

const s3Bucket = config.s3.bucket;

/**
 * Create the bucket. **Do not make it public.**
 *
 * This used to attach a `PublicReadGetObject` policy with `Principal: "*"`,
 * and the upload route handed back a direct object URL, which the client wrote
 * into the document. Two things followed from that, and the second is the one
 * that mattered.
 *
 * Everything anyone ever uploaded was world-readable to whoever had the URL --
 * defensible, at a stretch, since the URL contains a random media id. But the
 * app never used the proxy below, so all the work in it was doing nothing: the
 * `nosniff` header, the content-security-policy, the refusal to echo back a
 * content type the client chose. Media was served by object storage with the
 * type it was uploaded with, which is exactly the situation those headers
 * exist to prevent.
 *
 * The bucket is private now and the proxy is the only way in. That also means
 * media access follows room access, which is where it belonged.
 */
const initS3 = async (retries = 10, delayMs = 2000) => {
  for (let i = 0; i < retries; i++) {
    try {
      await s3.send(new CreateBucketCommand({ Bucket: s3Bucket }));
      console.log("Object storage bucket ready (private)");
      return;
    } catch (e: any) {
      if (e.name === 'BucketAlreadyOwnedByYou' || e.name === 'BucketAlreadyExists') {
        console.log("Object storage bucket ready (private)");
        return;
      }
      console.warn(`S3 connection attempt ${i + 1}/${retries} failed (${e.message}). Retrying in ${delayMs}ms...`);
      if (i < retries - 1) {
        await new Promise(res => setTimeout(res, delayMs));
      } else {
        console.error("S3 Setup failed after maximum retries:", e);
      }
    }
  }
};
initS3();

// Set up Multer-S3 for direct object storage uploads with strict security filters
const upload = multer({
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max file size
  },
  fileFilter: (_req: any, file: any, cb: any) => {
    if (!isAllowedUpload(file.mimetype, file.originalname)) {
      return cb(new Error("Invalid file type. Only standard images and audio recordings are accepted."), false);
    }
    cb(null, true);
  },
  storage: multerS3({
    s3: s3,
    bucket: s3Bucket,
    key: (req: any, file: any, cb: any) => {
      const mediaId = nanoid();
      // The route has already validated this room id; sanitising again is the
      // belt to that braces, because this value becomes a storage path.
      const roomId = sanitizeRoomId(req.params.roomId) || 'global';
      cb(null, `${roomId}/${mediaId}${safeExtension(file.originalname)}`);
    }
  })
});

/**
 * Liveness: is this process running at all.
 *
 * Deliberately checks nothing else. A liveness probe that touches the database
 * restarts the application every time the database hiccups, which converts a
 * recoverable dependency outage into a restart loop that guarantees one.
 */
app.get("/healthz", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

/**
 * Readiness: should this process be given traffic.
 *
 * This one *does* check the database, because a server that cannot reach it
 * can serve nothing useful and should be taken out of rotation rather than
 * restarted. The two probes answer different questions and an orchestrator
 * does different things with the answers.
 */
app.get("/readyz", async (_req, res) => {
  const database = dbReady && (await pingDb());
  res.status(database ? 200 : 503).json({
    status: database ? "ready" : "not-ready",
    database,
    historyQueue: history.depth,
    historyDropped: history.dropped,
  });
});

/**
 * How a browser reaches this server, for URLs we store in the document.
 *
 * Configured in production and derived in development. Derived is wrong to
 * rely on: the value is written into the board and loaded months later by
 * other people, and deriving it means the address of a picture depends on
 * which Host header happened to carry the upload that created it.
 */
const publicApiBase = (req: any): string =>
  config.publicApiUrl || `${req.protocol}://${req.get('host')}`;

/** Rejects a room this server will not serve, before anything touches storage. */
const requireRoom = (req: any, res: any, next: any) => {
  const check = checkRoomId(req.params.roomId, config.minRoomIdLength);
  if (!check.ok) return res.status(400).json({ error: check.reason });
  next();
};

// S3 Upload endpoint with rate limiting
app.post("/rooms/:roomId/media", requireRoom, mediaUploadLimiter, (req: any, res: any, next: any) => {
  upload.single("media")(req, res, (err: any) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: "File exceeds the 50MB size limit." });
      }
      return res.status(400).json({ error: err.message || "Upload validation failed." });
    }
    next();
  });
}, async (req: any, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  const roomId = sanitizeRoomId(req.params.roomId) || 'global';
  const storageKey = req.file.key as string;
  const objectName = path.basename(storageKey);
  const mediaId = objectName.split('.')[0];

  /**
   * The proxy's address, not the object store's.
   *
   * This used to hand back `PUBLIC_S3_URL/bucket/key` -- a direct, public
   * object URL -- and the client wrote it into the document. So every piece of
   * media in every board bypassed the route below and all of its protections,
   * and the bucket had to be world-readable for it to work at all.
   */
  const url = `${publicApiBase(req)}/rooms/${roomId}/media/${objectName}`;

  try {
    // Ensure room exists in db before inserting media ref
    await pool.query(
      `INSERT INTO rooms (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`,
      [roomId]
    );

    await pool.query(
      `INSERT INTO media_refs (id, room_id, url, mime_type, size_bytes, storage_key)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [mediaId, roomId, url, req.file.mimetype, req.file.size, storageKey]
    );

    res.json({ id: mediaId, url, mimeType: req.file.mimetype, sizeBytes: req.file.size });
  } catch (err) {
    console.error("Error inserting media ref:", err);
    res.status(500).json({ error: "Database error processing media upload." });
  }
});

/**
 * The only way to read stored media.
 *
 * Not merely a convenience for awkward network topologies any more -- with the
 * bucket private this is the sole path, which is what makes the headers below
 * worth having.
 */
app.get("/rooms/:roomId/media/:mediaKey", requireRoom, async (req: any, res: any) => {
  const roomId = sanitizeRoomId(req.params.roomId);
  const mediaKey = path.basename(String(req.params.mediaKey || ''));

  if (!roomId || !mediaKey) {
    return res.status(400).json({ error: "Invalid room or media parameter" });
  }

  const s3Key = `${roomId}/${mediaKey}`;
  try {
    const s3Res = await s3.send(
      new GetObjectCommand({
        Bucket: s3Bucket,
        Key: s3Key,
      })
    );

    /**
     * Headers that make this route incapable of serving an active document.
     *
     * It used to send `s3Res.ContentType` — a value that originated in the
     * client's own upload request — with nothing else. So a file uploaded as
     * `image/svg+xml` came back as `image/svg+xml`, and a browser navigating to
     * it ran whatever script was inside, on this origin.
     *
     *  - The type comes from our own extension table, never from the object.
     *  - `nosniff` stops the browser second-guessing that type and finding
     *    markup in a file we called an image.
     *  - `default-src 'none'` neutralises anything that does get parsed as a
     *    document: no scripts, no subresources, no network.
     *  - Anything whose extension we cannot place is offered as a download
     *    rather than rendered, which is the safe default for an unknown file.
     */
    const { type, render } = serveAs(mediaKey);
    res.setHeader("Content-Type", type);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    if (!render) {
      res.setHeader("Content-Disposition", `attachment; filename="${mediaKey}"`);
    }
    if (s3Res.ContentLength) {
      res.setHeader("Content-Length", s3Res.ContentLength);
    }
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");

    const stream = s3Res.Body as any;
    if (stream && typeof stream.pipe === "function") {
      stream.pipe(res);
    } else {
      const bytes = await s3Res.Body?.transformToByteArray();
      if (bytes) {
        res.send(Buffer.from(bytes));
      } else {
        res.status(404).json({ error: "Media not found" });
      }
    }
  } catch (err: any) {
    if (err.name === "NoSuchKey" || err.Code === "NoSuchKey") {
      return res.status(404).json({ error: "Media not found" });
    }
    console.error("Error streaming media from S3:", err);
    res.status(500).json({ error: "Failed to fetch media stream" });
  }
});

// History endpoint for Time Travel session replay with rate limiting
app.get("/rooms/:roomId/history", requireRoom, historyLimiter, async (req, res) => {
  const roomId = req.params.roomId;
  try {
    /**
     * Bounded by the query, not by housekeeping.
     *
     * This used to be an unbounded `ORDER BY id ASC` over every row the room
     * had ever written, on the assumption that the retention sweep keeps the
     * table at `MAX_UPDATES_PER_ROOM`. The sweep runs every **ten minutes**, so
     * that assumption holds only between bursts: a room being actively worked
     * in hands back everything accumulated since the last pass, and a drag
     * emits a transaction every few frames. Ten minutes of real use is tens of
     * thousands of rows.
     *
     * The client then had to parse all of it, replay all of it into a scratch
     * document and build a moment per transaction — on the main thread. That is
     * the "loading Time Travel freezes the tab" report, and no amount of work on
     * the client fixes it, because the client was being handed an unbounded
     * amount of work by an endpoint that promised a bounded one.
     *
     * Newest rows are selected and then re-sorted ascending, so the window is
     * the most *recent* history rather than the oldest — which is the half
     * anyone scrubbing actually wants.
     */
    const result = await pool.query(
      `SELECT update_data, created_at FROM (
         SELECT id, update_data, created_at
           FROM room_updates
          WHERE room_id = $1
          ORDER BY id DESC
          LIMIT $2
       ) AS recent
       ORDER BY id ASC`,
      [roomId, MAX_UPDATES_PER_ROOM]
    );
    const updates = result.rows.map(row => ({
      createdAt: row.created_at,
      update: row.update_data.toString("base64")
    }));

    // Whether retention has discarded anything for this room, so replay can say
    // plainly that it does not reach the beginning instead of presenting a
    // partial session as the whole story.
    const trimmedResult = await pool.query<{
      updates_trimmed: string;
      total: string;
      replay_base: Buffer | null;
    }>(
      `SELECT COALESCE(r.updates_trimmed, 0) AS updates_trimmed,
              r.replay_base,
              (SELECT COUNT(*) FROM room_updates WHERE room_id = $1) AS total
         FROM rooms r WHERE r.id = $1`,
      [roomId]
    );
    const trimmedCount = Number(trimmedResult.rows[0]?.updates_trimmed ?? 0);
    const total = Number(trimmedResult.rows[0]?.total ?? updates.length);
    /**
     * The document as it stood before the retained window begins.
     *
     * Yjs updates are deltas, so without this a trimmed log replays as an
     * empty board: the object creations were in the discarded rows, and every
     * retained update refers to structs that never arrive. Seeding from the
     * baseline is what makes a bounded log a shorter *history* rather than no
     * history at all.
     */
    const replayBase = trimmedResult.rows[0]?.replay_base ?? null;
    // Rows the sweep has not reached yet are just as absent from this response
    // as rows it deleted, so both count toward "this does not reach the start".
    const withheld = Math.max(0, total - updates.length);

    res.json({
      roomId,
      updates,
      baseline: replayBase ? replayBase.toString("base64") : null,
      trimmed: trimmedCount > 0 || withheld > 0,
      trimmedCount: trimmedCount + withheld,
      retentionLimit: MAX_UPDATES_PER_ROOM,
    });
  } catch (err) {
    console.error("Error fetching room history:", err);
    res.status(500).json({ error: "Failed to fetch room history" });
  }
});

/**
 * Redis is only required to fan out updates/awareness across *multiple* sync-server
 * instances. A single instance (the demo and hackathon setup) doesn't need it, and
 * when Redis isn't running ioredis emits an unhandled error event on every retry —
 * flooding the console and burying real errors. So it's opt-in.
 */
const extensions: any[] = [];

if (process.env.REDIS_HOST) {
  extensions.push(
    new Redis({
      port: parseInt(process.env.REDIS_PORT || "6379"),
      host: process.env.REDIS_HOST,
    })
  );
  console.log("Redis extension enabled (multi-instance fan-out)");
}

extensions.push(
  new Database({
    fetch: async ({ documentName }: any) => {
      // Fetch from Postgres
      const res = await pool.query(
        `SELECT state FROM room_snapshots WHERE room_id = $1`,
        [documentName]
      );
      if (res.rows.length > 0 && res.rows[0].state) {
        return res.rows[0].state;
      }
      return null;
    },
    store: async ({ documentName, state }: any) => {
      // Ensure room exists
      await pool.query(
        `INSERT INTO rooms (id) VALUES ($1) ON CONFLICT (id) DO UPDATE SET last_active_at = NOW()`,
        [documentName]
      );

      // Store the compacted snapshot — this is the canonical recovery state.
      await pool.query(
        `INSERT INTO room_snapshots (room_id, state) VALUES ($1, $2)
         ON CONFLICT (room_id) DO UPDATE SET state = $2, updated_at = NOW()`,
        [documentName, state]
      );
    },
  })
);

// Create the Hocuspocus instance.
// v4 exports `Hocuspocus` as the document/connection engine; the `Server` class is a
// standalone HTTP server we don't want here, since we're attaching to our own Express
// HTTP server so REST endpoints and WebSockets share one port.
const server = new Hocuspocus({
  extensions,

  /**
   * Validate and authenticate incoming document connection requests.
   * Ensures room IDs are structurally valid and prevents malformed room queries.
   */
  onAuthenticate: async ({ documentName, token }) => {
    /**
     * The access model, stated plainly.
     *
     * There are no accounts and no per-room permissions: **the room id is the
     * capability**. Whoever holds it can open the board and edit it, which the
     * share dialog says out loud. That model is legitimate and it has exactly
     * one hard requirement -- the id must be unguessable.
     *
     * The check here was `{1,128}`. One character. Every board whose address
     * was short enough for somebody to have typed by hand was reachable by
     * walking a few thousand ids, and the library's join box passes a bare id
     * straight through, so such boards are easy to create by accident. The
     * floor in `config.minRoomIdLength` is what keeps the model honest;
     * `nanoid(10)` is what makes new ids unguessable.
     *
     * `AUTH_SECRET` remains a single shared token for the whole deployment --
     * a front door for a private instance, not authorization. It cannot
     * express "this person, this board", and it should not be mistaken for it.
     */
    const check = checkRoomId(documentName, config.minRoomIdLength);
    if (!check.ok) throw new Error(check.reason ?? "Invalid room identifier");

    if (config.authSecret && !secretMatches(token, config.authSecret)) {
      throw new Error("Unauthorized room connection");
    }

    return {
      user: {
        id: nanoid(),
        room: documentName,
      },
    };
  },

  /**
   * Time Travel history log.
   *
   * This records *incremental* Yjs updates, not full document snapshots. The
   * previous implementation pushed the entire encoded document state into
   * room_updates on every debounced save, which meant (a) the table grew by the
   * size of the whole document on each write, and (b) replay was not actually a
   * sequence of deltas — every entry re-stated the full document, so scrubbing
   * could not show incremental authoring.
   *
   * onChange gives us the true delta for each transaction, which is what
   * Y.applyUpdate expects when the client replays them in order.
   */
  onChange: async ({ documentName, update }: any) => {
    // Buffered, not written. See `historyBuffer.ts`: this fires once per Yjs
    // transaction, which during a drag is every few frames, and it used to
    // cost two round trips to Postgres each time. Adding to the buffer is
    // synchronous; the signature is async because Hocuspocus requires it.
    history.add(documentName, update);
  },
});

// Start Express and attach Hocuspocus WebSocket Server.
// Binding 0.0.0.0 (not just loopback) is what lets a second machine on the same
// network open a shared room link and actually reach this server.
const PORT = parseInt(process.env.PORT || "3000");
const httpServer = app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT} (all interfaces)`);
});

const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (socket: any, request: any) => {
  try {
    // Hocuspocus v4 expects a WHATWG `Request` rather than a Node IncomingMessage.
    // Rebuild one from the upgrade request so the document name is still parsed
    // from the URL path exactly as before.
    const host = request.headers.host || `localhost:${PORT}`;
    const fetchRequest = new Request(`http://${host}${request.url || "/"}`, {
      headers: request.headers as any,
    });

    const connection = server.handleConnection(socket, fetchRequest);

    socket.on("message", (data: Buffer | ArrayBuffer | Buffer[]) => {
      try {
        const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as any);
        connection.handleMessage(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
      } catch (err: any) {
        console.error("Error processing WebSocket message frame:", err.message);
      }
    });

    socket.on("close", (code: number, reason: Buffer) => {
      try {
        connection.handleClose({ code, reason: reason?.toString() ?? "" });
      } catch (err: any) {
        console.error("Error handling WebSocket close:", err.message);
      }
    });

    socket.on("error", (err: Error) => {
      console.error("WebSocket error:", err.message);
    });
  } catch (err: any) {
    console.error("Failed to initialize WebSocket client connection:", err);
    try {
      socket.close(1011, "Internal server error during handshake");
    } catch {
      /* socket already closed */
    }
  }
});

// Graceful shutdown handling for clean termination and resource drainage
const gracefulShutdown = async (signal: string) => {
  console.log(`\nReceived ${signal}. Starting graceful shutdown...`);

  // 1. Close WebSocket server
  wss.close(() => {
    console.log("WebSocket server closed.");
  });

  /**
   * Ask the clients to leave, rather than cutting them off.
   *
   * `terminate()` destroys the socket immediately: a Yjs client mid-sync loses
   * whatever it had not yet flushed, and — worse for a deploy — sees an abrupt
   * transport failure rather than a close frame, so its reconnect backoff
   * treats a routine restart like a network fault.
   *
   * 1001 "going away" is the code for exactly this. The clients flush, close
   * cleanly, and reconnect promptly to whichever instance replaces this one.
   * The forced-shutdown timer below is still the backstop for any that do not.
   */
  for (const client of wss.clients) {
    client.close(1001, "Server shutting down");
  }

  // 2. Stop accepting new HTTP requests
  httpServer.close(async () => {
    console.log("HTTP server closed.");
    try {
      /**
       * Write whatever history is still buffered, before the pool goes.
       *
       * This is what makes batching safe. A hard kill can lose up to one flush
       * interval of scrubbable history -- acceptable, because the canonical
       * document lives in `room_snapshots` and this table only feeds Time
       * Travel. A *deploy* is the common case and loses nothing, because of
       * this line.
       */
      await history.drain();
      if (history.dropped > 0) {
        console.warn(`History buffer dropped ${history.dropped} update(s) under backpressure.`);
      }

      // 3. Drain PostgreSQL connection pool
      await pool.end();
      console.log("PostgreSQL pool drained successfully.");
    } catch (err) {
      console.error("Error closing PostgreSQL pool:", err);
    }
    process.exit(0);
  });

  // Safety timeout if connections refuse to drain
  setTimeout(() => {
    console.error("Forced shutdown after timeout.");
    process.exit(1);
  }, 10000).unref();
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
