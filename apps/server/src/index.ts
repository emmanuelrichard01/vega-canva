import { Hocuspocus } from "@hocuspocus/server";
import { Database } from "@hocuspocus/extension-database";
import { Redis } from "@hocuspocus/extension-redis";
import express from "express";
import cors from "cors";
import multer from "multer";
import multerS3 from "multer-s3";
import { S3Client, CreateBucketCommand, PutBucketPolicyCommand } from "@aws-sdk/client-s3";
import path from "path";
import { nanoid } from "nanoid";
import { WebSocketServer } from "ws";
import { pool, initDb, startRetentionSweep, MAX_UPDATES_PER_ROOM } from "./db";

// Initialize Postgres schema, then start trimming the append-only update log.
initDb().then(startRetentionSweep);

const app = express();
app.use(cors());
app.use(express.json());

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

// Supported media MIME types and corresponding allowed extensions
const ALLOWED_MIME_TYPES = new Set([
  // Images
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  // Audio
  'audio/webm',
  'audio/mp4',
  'audio/ogg',
  'audio/wav',
  'audio/mpeg',
  'audio/aac',
]);

const ALLOWED_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg',
  '.webm', '.mp4', '.ogg', '.wav', '.mp3', '.m4a', '.aac'
]);

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

// S3 Upload endpoint
app.post("/rooms/:roomId/media", (req: any, res: any, next: any) => {
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
  // Derive the public base URL from whatever host the browser actually used to reach us
  // (localhost, a LAN IP, or a real domain) instead of hardcoding localhost — otherwise
  // media only ever loads for whoever is running the containers.
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
    res.status(500).json({ error: "Database error" });
  }
});

// History endpoint for Time Travel session replay
app.get("/rooms/:roomId/history", async (req, res) => {
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
  // Hocuspocus v4 expects a WHATWG `Request` rather than a Node IncomingMessage.
  // Rebuild one from the upgrade request so the document name is still parsed
  // from the URL path exactly as before.
  const host = request.headers.host || `localhost:${PORT}`;
  const fetchRequest = new Request(`http://${host}${request.url || "/"}`, {
    headers: request.headers as any,
  });

  // v4's `handleConnection` only *creates* the ClientConnection — unlike v2/v3 it
  // no longer subscribes to the socket itself. The caller owns transport plumbing
  // and must forward every frame in via `handleMessage` (and the close in via
  // `handleClose`). Dropping the returned object on the floor meant the server
  // accepted every WebSocket and then never read a single byte: clients sent
  // Auth + SyncStep1 + Awareness and waited forever, so every session sat at
  // "Offline", nothing synced between tabs, and nothing was ever persisted.
  const connection = server.handleConnection(socket, fetchRequest);

  socket.on("message", (data: Buffer | ArrayBuffer | Buffer[]) => {
    const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as any);
    connection.handleMessage(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
  });

  socket.on("close", (code: number, reason: Buffer) => {
    connection.handleClose({ code, reason: reason?.toString() ?? "" });
  });

  socket.on("error", (err: Error) => {
    console.error("WebSocket error:", err.message);
  });
});
