/**
 * A sliding-window token bucket, per client address, with optional Redis cluster backing.
 *
 * ## What this protects
 *
 * The two REST routes. Uploads cost object storage and bandwidth; the history
 * endpoint reads and serialises up to `MAX_UPDATES_PER_ROOM` rows of binary
 * data per call, which is cheap once and expensive in a loop.
 *
 * ## Where the buckets actually live: in this process
 *
 * **Nothing passes a Redis client.** `index.ts` constructs both limiters as
 * `rateLimit(30, 1)` and `rateLimit(60, 2)`, so every request takes the
 * in-memory path and the Lua below is unreachable. Run two instances behind a
 * load balancer and a client gets one full allowance per instance, which is
 * the usual way a limiter quietly stops limiting: nothing fails, the numbers
 * are simply wrong, and only in the deployment where it matters most.
 *
 * That is correct for the current deployment -- one Render instance -- and it
 * is written down here because the paragraph that used to sit in this spot
 * claimed the opposite. It said all instances "share the exact same rate
 * limit allowances", which was true of the Lua script and false of the
 * server, and it replaced an accurate warning. The code got no safer; the
 * document that told the truth was the thing that changed.
 *
 * ## Turning the Redis path on
 *
 * Pass a client to `rateLimit(...)`. The Lua below is a correct atomic token
 * bucket and is covered by tests; only the wiring is missing. Do it in the
 * same change as horizontal scaling, not after -- and construct a client from
 * config rather than reaching into the Hocuspocus Redis extension's private
 * `.pub` field, which is what `quota.ts` currently does and what will break
 * silently on a library upgrade.
 *
 * The WebSocket path is not limited at all. Connection cost is bounded by
 * Hocuspocus and by the document itself, and a per-message limiter on a CRDT
 * sync stream throttles legitimate collaboration long before anything else.
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
