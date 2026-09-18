import IORedis from 'ioredis';

/**
 * One Redis connection for the things that must agree across instances.
 *
 * ## Why this exists rather than reusing the Hocuspocus extension's
 *
 * `quota.ts` was handed its client by reaching into the Hocuspocus Redis
 * extension and taking `(extension as any).pub`. That works today and is one
 * library upgrade away from returning `undefined` — at which point nothing
 * fails: the tracker simply falls back to memory, every instance keeps its own
 * counters, and the quota stops being a quota. `rateLimit.ts` says so in its
 * own header and asks for exactly this instead.
 *
 * So the connection comes from config, like every other piece of deployment
 * truth, and the extension keeps its own. Two connections is the correct number
 * here anyway: the extension's are occupied by pub/sub, and a connection in
 * subscriber mode cannot run the commands the limiter and the quota need.
 *
 * ## Why the errors are swallowed and the retries give up
 *
 * ioredis reconnects forever by default and emits an `error` event on every
 * attempt. With no listener that is an unhandled event; with a listener and no
 * cap it is a line of log per second for as long as Redis is down, which buries
 * the outage it is reporting. So attempts are capped and the log is rate
 * limited, and everything that uses this client already falls back to memory
 * when a call fails — the limiter and the quota both catch and degrade rather
 * than refuse traffic.
 *
 * Degrading is the right failure here: a Redis outage should make the limits
 * per-instance again, which is where they were before this existed. It should
 * not take the API down.
 */

export interface SharedRedis {
  eval(script: string, numKeys: number, key: string, ...args: (string | number)[]): Promise<unknown>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode?: string, duration?: number): Promise<unknown>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
  quit(): Promise<unknown>;
}

/** How many reconnects before it stops trying and stays on the memory path. */
const MAX_RETRIES = 10;
/** No more than one connection-error line per this many ms. */
const LOG_EVERY_MS = 30_000;

export function createSharedRedis(
  options: { host: string | null; port: number },
  log: (message: string, meta?: Record<string, unknown>) => void
): SharedRedis | null {
  if (!options.host) return null;

  const client = new IORedis({
    host: options.host,
    port: options.port,
    // Commands issued while the connection is down fail fast instead of
    // queueing. A limiter that waits for Redis to come back is a limiter that
    // holds every request open during an outage; failing is what lets the
    // caller fall back to its in-memory bucket immediately.
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    retryStrategy: (attempt: number) => (attempt > MAX_RETRIES ? null : Math.min(attempt * 200, 3000)),
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
