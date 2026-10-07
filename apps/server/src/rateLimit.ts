/**
 * A token bucket per client, in Redis when one is configured and in this
 * process otherwise.
 *
 * ## What it protects
 *
 * The REST routes (uploads, history, invites, link previews, share cards and
 * the admin routes) and, on the WebSocket path, the creation of new boards.
 * The link-preview route uses `createRateLimiter` directly rather than the
 * middleware, because it can tell in advance whether a request will do any
 * outbound work and only charges those that will.
 *
 * Individual WebSocket messages are not limited: a per-message limit on a CRDT
 * sync stream throttles legitimate collaboration long before anything else.
 * The socket path is bounded instead by frame and document size, connections
 * per address and new boards per address (`collab.ts`).
 *
 * ## Where the buckets live
 *
 * With Redis (`REDIS_URL`/`REDIS_HOST`), every instance shares one bucket per
 * client. Without it each process keeps its own, which is right for one
 * instance and quietly wrong for two: a client gets a full allowance per
 * instance and nothing reports it.
 *
 * If Redis goes away, `takeAsync` falls back to this process's memory rather
 * than refusing traffic, and the client fails commands fast rather than
 * queueing them, so a limiter never waits on a connection that is not coming
 * back.
 */

interface Bucket {
  tokens: number;
  lastRefill: number;
}

export interface RedisLike {
  eval(script: string, numKeys: number, key: string, ...args: (string | number)[]): Promise<unknown>;
}

export interface RateLimiter {
  /** True when the request may proceed (synchronous in-memory check). */
  take(clientId: string, now?: number): boolean;
  /** Async check (checks Redis if attached, falling back to local memory). */
  takeAsync(clientId: string, now?: number): Promise<boolean>;
  /** For tests and for the readiness payload. */
  size(): number;
  stop(): void;
}

const LUA_TOKEN_BUCKET = `
local key = KEYS[1]
local maxTokens = tonumber(ARGV[1])
local refillPerSec = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local cost = tonumber(ARGV[4]) or 1

local data = redis.call('HMGET', key, 'tokens', 'lastRefill')
local tokens = tonumber(data[1])
local lastRefill = tonumber(data[2])

if not tokens or not lastRefill then
  tokens = maxTokens
  lastRefill = now
else
  local elapsed = math.max(0, (now - lastRefill) / 1000)
  tokens = math.min(maxTokens, tokens + elapsed * refillPerSec)
  lastRefill = now
end

if tokens >= cost then
  tokens = tokens - cost
  redis.call('HMSET', key, 'tokens', tokens, 'lastRefill', lastRefill)
  redis.call('EXPIRE', key, 600)
  return 1
else
  redis.call('HMSET', key, 'tokens', tokens, 'lastRefill', lastRefill)
  redis.call('EXPIRE', key, 600)
  return 0
end
`;

/**
 * @param maxTokens  the burst allowance
 * @param refillPerSec  the sustained rate
 * @param redis  optional Redis client for distributed multi-instance token buckets
 * @param prefix key namespace prefix for Redis keys
 */
export function createRateLimiter(
  maxTokens: number,
  refillPerSec: number,
  redis?: RedisLike | null,
  prefix = 'ratelimit'
): RateLimiter {
  const clients = new Map<string, Bucket>();

  // Buckets for addresses nobody is using any more are pruned to prevent memory growth.
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [id, bucket] of clients.entries()) {
      if (now - bucket.lastRefill > 10 * 60 * 1000) clients.delete(id);
    }
  }, 5 * 60 * 1000);
  cleanup.unref?.();

  const takeInMemory = (clientId: string, now = Date.now()): boolean => {
    let bucket = clients.get(clientId);
    if (!bucket) {
      bucket = { tokens: maxTokens, lastRefill: now };
      clients.set(clientId, bucket);
    } else {
      const elapsedSec = (now - bucket.lastRefill) / 1000;
      bucket.tokens = Math.min(maxTokens, bucket.tokens + elapsedSec * refillPerSec);
      bucket.lastRefill = now;
    }

    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  };

  return {
    take(clientId: string, now = Date.now()): boolean {
      return takeInMemory(clientId, now);
    },

    async takeAsync(clientId: string, now = Date.now()): Promise<boolean> {
      if (redis) {
        try {
          const key = `${prefix}:${clientId}`;
          const res = await redis.eval(LUA_TOKEN_BUCKET, 1, key, maxTokens, refillPerSec, now, 1);
          return Number(res) === 1;
        } catch {
          // If Redis fails, fall back to in-memory so availability is preserved
          return takeInMemory(clientId, now);
        }
      }
      return takeInMemory(clientId, now);
    },

    size: () => clients.size,
    stop: () => clearInterval(cleanup),
  };
}

/** The same thing, as Express middleware. Supports both in-memory and Redis distributed limiting. */
export function rateLimit(
  maxTokens: number,
  refillPerSec: number,
  redis?: RedisLike | null,
  prefix?: string
) {
  const limiter = createRateLimiter(maxTokens, refillPerSec, redis, prefix);

  return async (req: any, res: any, next: any) => {
    const clientId = String(req.ip || req.socket?.remoteAddress || 'unknown');
    const allowed = await limiter.takeAsync(clientId);
    if (!allowed) {
      return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }
    next();
  };
}
