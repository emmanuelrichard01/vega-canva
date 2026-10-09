import IORedis, { type RedisOptions } from 'ioredis';
import type { Config } from './config';

/**
 * One Redis connection for the things that must agree across instances.
 *
 * The rate limiters and the upload quota use this client. The Hocuspocus Redis
 * extension keeps its own connections, which are occupied by pub/sub: a
 * connection in subscriber mode cannot run the commands the limiter and the
 * quota need.
 *
 * ## Failure behaviour
 *
 * Commands fail fast while the connection is down (`enableOfflineQueue:
 * false`), and every caller falls back to its in-memory bucket when a call
 * fails, so an outage makes limits per-instance rather than refusing traffic.
 *
 * Reconnection never stops. The backoff is capped, so a long outage costs one
 * attempt every few seconds, and connection errors are logged at most once per
 * `LOG_EVERY_MS` so the log does not bury the outage it is reporting.
 */

export interface SharedRedis {
  eval(script: string, numKeys: number, key: string, ...args: (string | number)[]): Promise<unknown>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode?: string, duration?: number): Promise<unknown>;
  incr(key: string): Promise<number>;
  incrby(key: string, increment: number): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  quit(): Promise<unknown>;
}

/** No more than one connection-error line per this many ms. */
const LOG_EVERY_MS = 30_000;
/** The longest wait between reconnection attempts. */
const MAX_BACKOFF_MS = 5_000;

/** Exponential backoff, capped; never `null`, which would end reconnection for good. */
export function reconnectDelay(attempt: number): number {
  return Math.min(100 * 2 ** Math.min(attempt, 16), MAX_BACKOFF_MS);
}

/**
 * Connection options for ioredis, from config.
 *
 * Shared with the Hocuspocus extension so both connections authenticate and
 * use TLS the same way.
 */
export function redisConnectionOptions(redis: NonNullable<Config['redis']>): RedisOptions {
  const fromUrl: RedisOptions = {};
  if (redis.url) {
    const url = new URL(redis.url);
    fromUrl.host = url.hostname;
    fromUrl.port = url.port ? Number(url.port) : 6379;
    if (url.username) fromUrl.username = decodeURIComponent(url.username);
    if (url.password) fromUrl.password = decodeURIComponent(url.password);
    if (url.protocol === 'rediss:') fromUrl.tls = {};
    const db = url.pathname.replace(/^\//, '');
    if (db) fromUrl.db = Number(db);
  }
  return {
    host: redis.host ?? undefined,
    port: redis.port,
    ...(redis.password ? { password: redis.password } : {}),
    ...(redis.tls ? { tls: {} } : {}),
    ...fromUrl,
  };
}

export function createSharedRedis(
  redis: Config['redis'],
  log: (message: string, meta?: Record<string, unknown>) => void
): SharedRedis | null {
  if (!redis) return null;

  const client = new IORedis({
    ...redisConnectionOptions(redis),
    // ioredis 6 defaults to RESP3, which needs `HELLO 3` (Redis 6+) and is
    // not supported by every managed Redis. RESP2 is what v5 spoke and what
    // the Hocuspocus extension's own ioredis 5 client still uses.
    protocol: 2,
    // Fail fast rather than queue: a limiter that waits for Redis holds every
    // request open during an outage.
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    retryStrategy: reconnectDelay,
  });

  let lastLoggedAt = 0;
  client.on('error', (err: Error) => {
    const now = Date.now();
    if (now - lastLoggedAt < LOG_EVERY_MS) return;
    lastLoggedAt = now;
    log('Shared Redis unavailable; limits and quotas are per-instance until it returns', {
      error: err.message,
    });
  });

  return client as unknown as SharedRedis;
}
