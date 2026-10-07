/**
 * The server process: reads config, connects to its dependencies, and serves
 * the HTTP API (`app.ts`) and the collaboration socket (`collab.ts`) on one
 * port. Everything with logic lives in those modules, which take their
 * dependencies as arguments so they can be tested without this file.
 */
import { randomBytes } from 'crypto';
import { Redis as RedisExtension } from '@hocuspocus/extension-redis';
import { readConfig } from './config';
import { initServerObservability, logger, captureError } from './observability';
import { pool, initDb, pingDb, startRetentionSweep } from './db';
import { createS3Client, ensureBucket } from './s3';
import { createSharedRedis, redisConnectionOptions } from './redisClient';
import { ipDailyTracker } from './quota';
import { HistoryBuffer, KnownRooms, type PendingUpdate } from './historyBuffer';
import { RoomActivity } from './roomActivity';
import { reapInactiveRooms } from './reaper';
import { createApp } from './app';
import { createCollab, type Collab } from './collab';
import { hocuspocusLive, type LiveReader } from './routes/status';
import { createShutdown } from './shutdown';
import { closeRaster } from './share/raster';

const config = readConfig();
initServerObservability(config.sentryDsn);

let dbReady = false;
let draining = false;

// `initDb` throws rather than carrying on: a process that is up but cannot
// reach its database would be routed traffic and answer every request with 500.
initDb()
  .then(() => {
    dbReady = true;
    startRetentionSweep();
  })
  .catch((err) => {
    captureError('Database unavailable; exiting', err);
    process.exit(1);
  });

/**
 * Production refuses to start without SESSION_SECRET (`config.ts`). In
 * development a per-process key is fine: identities reset on restart.
 */
const sessionSecret = (() => {
  if (config.sessionSecret) return config.sessionSecret;
  logger.warn('SESSION_SECRET is not set; anonymous sessions use a per-process key and reset on restart.');
  return randomBytes(32).toString('base64url');
})();

const sharedRedis = createSharedRedis(config.redis, (message, meta) => logger.warn(message, meta));
if (sharedRedis) {
  ipDailyTracker.setRedis(sharedRedis);
  logger.info('Shared Redis configured: limits and upload quotas are cluster-wide');
}

const s3 = createS3Client(config.s3);
void ensureBucket(s3, config.s3.bucket);

const knownRooms = new KnownRooms();
const history = new HistoryBuffer({
  flushIntervalMs: config.history.flushIntervalMs,
  maxBytes: config.history.maxBytes,
  write: async (batch: PendingUpdate[]) => {
    const fresh = [...new Set(batch.map((b) => b.roomId))].filter((id) => knownRooms.needsInsert(id));
    if (fresh.length > 0) {
      await pool.query(`INSERT INTO rooms (id) SELECT unnest($1::text[]) ON CONFLICT (id) DO NOTHING`, [fresh]);
    }
    // One multi-row insert of two parallel arrays, whatever the batch size.
    await pool.query(
      `INSERT INTO room_updates (room_id, update_data)
       SELECT * FROM unnest($1::text[], $2::bytea[])`,
      [batch.map((b) => b.roomId), batch.map((b) => Buffer.from(b.update))]
    );
  },
  onError: (err, batch) => {
    // History is a convenience; live sync is the product. Never throw from here.
    captureError('Failed to append history updates', err, { updates: batch.length });
    // The rows may not exist after all; the retry creates them again.
    knownRooms.forgetAll(batch.map((b) => b.roomId));
  },
});

// Bound once the collaboration server exists; until then no board is live here.
let readLive: LiveReader = () => null;

const app = createApp({
  config,
  pool,
  s3,
  bucket: config.s3.bucket,
  sharedRedis,
  sessionSecret,
  quota: ipDailyTracker,
  health: {
    databaseReady: async () => dbReady && (await pingDb()),
    draining: () => draining,
    historyDepth: () => history.depth,
    historyDropped: () => history.dropped,
  },
  reap: (options) => reapInactiveRooms(pool, s3, config.s3.bucket, options),
  live: (roomId) => readLive(roomId),
});

/**
 * Redis fan-out is needed only when more than one instance serves the same
 * documents, so it is opt-in.
 */
const extensions = [];
if (config.redis) {
  const options = redisConnectionOptions(config.redis);
  extensions.push(new RedisExtension({ host: options.host ?? 'localhost', port: options.port ?? 6379, options }));
  logger.info('Redis extension enabled (multi-instance document fan-out)');
}

const collab: Collab = createCollab({
  config,
  pool,
  sessionSecret,
  history,
  roomActivity: new RoomActivity(pool),
  sharedRedis,
  extensions,
  trust: app.get('trust proxy fn'),
});

readLive = hocuspocusLive(collab.hocuspocus as any);

// 0.0.0.0, not loopback, so another machine on the network can open a room link.
const httpServer = app.listen(config.port, '0.0.0.0', () => {
  logger.info(`Server running on port ${config.port} (all interfaces)`);
});
const wss = collab.attach(httpServer);

const shutdown = createShutdown({
  httpServer,
  wss,
  flushDocuments: () => collab.flushDocuments(),
  drainHistory: async () => {
    await history.drain();
    if (history.dropped > 0) logger.warn(`History buffer dropped ${history.dropped} update(s) under backpressure`);
  },
  closers: [closeRaster, async () => sharedRedis?.quit(), () => pool.end()],
  onDraining: () => {
    draining = true;
  },
});

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
