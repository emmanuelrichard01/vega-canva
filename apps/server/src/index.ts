import { Hocuspocus } from "@hocuspocus/server";
import { Database } from "@hocuspocus/extension-database";
import { Redis } from "@hocuspocus/extension-redis";
import express from "express";
import cors from "cors";
import multer from "multer";
import multerS3 from "multer-s3";
import { S3Client, CreateBucketCommand, PutBucketPolicyCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import path from "path";
import { nanoid } from "nanoid";
import { WebSocketServer } from "ws";
import { pool, initDb, startRetentionSweep, MAX_UPDATES_PER_ROOM } from "./db";

// Initialize Postgres schema, then start trimming the append-only update log.
initDb().then(startRetentionSweep);

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
if (process.env.TRUST_PROXY) {
  // A number is a hop count, which is what you want behind n known proxies;
  // anything else (an IP, a subnet, "loopback") is passed through as-is.
  const hops = Number(process.env.TRUST_PROXY);
  app.set('trust proxy', Number.isFinite(hops) ? hops : process.env.TRUST_PROXY);
}
// Configurable CORS support (wildcard default in dev, or comma-separated list of origins)
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
  : '*';

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

// Lightweight, sliding-window token bucket rate limiter for API protection
interface RateLimitBucket {
  tokens: number;
  lastRefill: number;
}

const createRateLimiter = (maxTokens: number, refillRatePerSec: number) => {
  const clients = new Map<string, RateLimitBucket>();
  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [ip, bucket] of clients.entries()) {
      if (now - bucket.lastRefill > 10 * 60 * 1000) {
        clients.delete(ip);
      }
    }
  }, 5 * 60 * 1000);
  cleanupTimer.unref?.();

  return (req: any, res: any, next: any) => {
    const clientIp = String(req.ip || req.socket?.remoteAddress || 'unknown');
    const now = Date.now();
    let bucket = clients.get(clientIp);
    if (!bucket) {
      bucket = { tokens: maxTokens, lastRefill: now };
      clients.set(clientIp, bucket);
    } else {
      const elapsedSec = (now - bucket.lastRefill) / 1000;
      bucket.tokens = Math.min(maxTokens, bucket.tokens + elapsedSec * refillRatePerSec);
      bucket.lastRefill = now;
    }

    if (bucket.tokens < 1) {
      return res.status(429).json({ error: "Too many requests. Please try again later." });
    }
    bucket.tokens -= 1;
    next();
  };
};

const mediaUploadLimiter = createRateLimiter(30, 1); // 30 bursts, 1 upload per second refill
const historyLimiter = createRateLimiter(60, 2);     // 60 bursts, 2 requests per second refill

// MinIO S3 Configuration
const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT || "http://localhost:9000",
  region: "us-east-1",
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY || "canva_admin",
    secretAccessKey: process.env.S3_SECRET_KEY || "canva_password",
  },
  forcePathStyle: true,
});

const s3Bucket = process.env.S3_BUCKET || "vega-canva-media";

// Initialize S3 Bucket and set public read policy with retry loop
const initS3 = async (retries = 10, delayMs = 2000) => {
  for (let i = 0; i < retries; i++) {
    try {
      await s3.send(new CreateBucketCommand({ Bucket: s3Bucket }));
      
      const policy = {
        Version: "2012-10-17",
        Statement: [{
          Sid: "PublicReadGetObject",
          Effect: "Allow",
          Principal: "*",
          Action: "s3:GetObject",
          Resource: `arn:aws:s3:::${s3Bucket}/*`
        }]
      };
      await s3.send(new PutBucketPolicyCommand({ Bucket: s3Bucket, Policy: JSON.stringify(policy) }));
      console.log("MinIO S3 Bucket ready and public");
      return;
    } catch(e: any) {
      if (e.name === 'BucketAlreadyOwnedByYou' || e.name === 'BucketAlreadyExists') {
        console.log("MinIO S3 Bucket ready and public");
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

/**
 * What may be uploaded.
 *
 * ## Why SVG is not on this list
 *
 * An SVG is a document, not an image. It can carry `<script>`, `<foreignObject>`
 * and event handlers, and a browser that navigates directly to one served as
 * `image/svg+xml` executes all of it **on the origin that served it** — which
 * here is the API, same-origin with the media proxy and anything else it ever
 * hosts. Uploading a file is not supposed to be a way to run code on the
 * server's origin, and for SVG it silently was.
 *
 * The proxy below now also sends `nosniff` and a `default-src 'none'` policy,
 * so this is the second of two locks rather than the only one. Both are here
 * because either alone fails to a mistake: a future route that serves media
 * without the headers, or a future entry added back to this list.
 *
 * Nothing else needs to change to keep vector work: the board's own SVG import
 * parses the file in the browser and creates real nodes, and the exporter
 * writes SVG out. Neither round-trips through object storage.
 */
const ALLOWED_MIME_TYPES = new Set([
  // Images
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  // Audio
  'audio/webm',
  'audio/mp4',
  'audio/ogg',
  'audio/wav',
  'audio/mpeg',
  'audio/aac',
]);

const ALLOWED_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif',
  '.webm', '.mp4', '.ogg', '.wav', '.mp3', '.m4a', '.aac'
]);

/**
 * The Content-Type a stored object is served as, decided by **us**.
 *
 * `file.mimetype` is whatever the client's multipart body claimed, and the
 * filter below checks it — but a check is not a guarantee: a request may
 * declare `image/png`, carry an SVG, and be stored with a `.png` key and a
 * `image/png` type it does not deserve. The filter's job is to refuse obvious
 * junk; it cannot vouch for the bytes.
 *
 * So the proxy never echoes the stored type back. It maps the extension —
 * which the upload path sanitised into a known set — to a type from this table,
 * and anything it cannot place is served as a download rather than as content.
 */
const EXTENSION_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.webm': 'audio/webm',
  '.mp4': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
};

// Set up Multer-S3 for direct object storage uploads with strict security filters
const upload = multer({
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max file size
  },
  fileFilter: (_req: any, file: any, cb: any) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_MIME_TYPES.has(file.mimetype) || !ALLOWED_EXTENSIONS.has(ext)) {
      return cb(new Error("Invalid file type. Only standard images and audio recordings are accepted."), false);
    }
    cb(null, true);
  },
  storage: multerS3({
    s3: s3,
    bucket: s3Bucket,
    key: (req: any, file: any, cb: any) => {
      const mediaId = nanoid();
      // Sanitize room ID to avoid path traversal
      const rawRoomId = String(req.params.roomId || 'global');
      const roomId = rawRoomId.replace(/[^a-zA-Z0-9_-]/g, '') || 'global';
      const ext = path.extname(file.originalname).toLowerCase();
      const safeExt = ALLOWED_EXTENSIONS.has(ext) ? ext : '.bin';
      cb(null, `${roomId}/${mediaId}${safeExt}`);
    }
  })
});

// S3 Upload endpoint with rate limiting
app.post("/rooms/:roomId/media", mediaUploadLimiter, (req: any, res: any, next: any) => {
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

  const rawRoomId = String(req.params.roomId || 'global');
  const roomId = rawRoomId.replace(/[^a-zA-Z0-9_-]/g, '') || 'global';
  const publicBase = process.env.PUBLIC_S3_URL || `${req.protocol}://${req.hostname}:9000`;
  const url = `${publicBase}/${s3Bucket}/${req.file.key}`;
  const mediaId = path.basename(req.file.key).split('.')[0]; 

  try {
    // Ensure room exists in db before inserting media ref
    await pool.query(
      `INSERT INTO rooms (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`,
      [roomId]
    );

    await pool.query(
      `INSERT INTO media_refs (id, room_id, url, mime_type, size_bytes) 
       VALUES ($1, $2, $3, $4, $5)`,
      [mediaId, roomId, url, req.file.mimetype, req.file.size]
    );

    res.json({ id: mediaId, url, mimeType: req.file.mimetype, sizeBytes: req.file.size });
  } catch (err) {
    console.error("Error inserting media ref:", err);
    res.status(500).json({ error: "Database error processing media upload." });
  }
});

// Streaming media proxy endpoint: serves S3 objects reliably across arbitrary network topologies
app.get("/rooms/:roomId/media/:mediaKey", async (req: any, res: any) => {
  const rawRoomId = String(req.params.roomId || '');
  const roomId = rawRoomId.replace(/[^a-zA-Z0-9_-]/g, '');
  const rawKey = String(req.params.mediaKey || '');
  const mediaKey = path.basename(rawKey);

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
    const type = EXTENSION_TYPES[path.extname(mediaKey).toLowerCase()];
    res.setHeader("Content-Type", type ?? "application/octet-stream");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    if (!type) {
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
app.get("/rooms/:roomId/history", historyLimiter, async (req, res) => {
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
    // Sanitize and validate document/room ID
    if (!documentName || !/^[a-zA-Z0-9_-]{1,128}$/.test(documentName)) {
      throw new Error("Invalid room identifier");
    }

    // Optional token validation hook: if a token secret is configured in environment, verify it
    if (process.env.AUTH_SECRET && token !== process.env.AUTH_SECRET) {
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
    try {
      await pool.query(
        `INSERT INTO rooms (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`,
        [documentName]
      );
      await pool.query(
        `INSERT INTO room_updates (room_id, update_data) VALUES ($1, $2)`,
        [documentName, Buffer.from(update)]
      );
    } catch (err) {
      // History is a bonus feature — never let a logging failure break live sync.
      console.error("Failed to append history update:", err);
    }
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
