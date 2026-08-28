/**
 * A sliding-window token bucket, per client address.
 *
 * ## What this protects
 *
 * The two REST routes. Uploads cost object storage and bandwidth; the history
 * endpoint reads and serialises up to `MAX_UPDATES_PER_ROOM` rows of binary
 * data per call, which is cheap once and expensive in a loop.
 *
 * ## What it does not protect, and you should know before relying on it
 *
 * **The buckets live in this process.** Run two instances behind a load
 * balancer and a client gets one full allowance per instance, which is the
 * usual reason a limiter quietly stops limiting: nothing fails, the numbers
 * are simply wrong, and only in the deployment where it matters most.
 *
 * Moving it to Redis is the fix, and it is deliberately not done here: this
 * server only needs Redis to run multiple instances at all (see the fan-out
 * extension in `index.ts`), so the honest arrangement is that whoever turns on
 * horizontal scaling turns on shared rate limiting in the same change. Until
 * then a single instance is limited correctly and the comment says why.
 *
 * The WebSocket path is not limited at all. Connection cost is bounded by
 * Hocuspocus and by the document itself, and a per-message limiter on a CRDT
 * sync stream throttles legitimate collaboration long before it throttles
 * anything else.
 */

interface Bucket {
  tokens: number;
  lastRefill: number;
}

export interface RateLimiter {
  /** True when the request may proceed. */
  take(clientId: string, now?: number): boolean;
  /** For tests and for the readiness payload. */
  size(): number;
  stop(): void;
}

/**
 * @param maxTokens  the burst allowance
 * @param refillPerSec  the sustained rate
 */
export function createRateLimiter(maxTokens: number, refillPerSec: number): RateLimiter {
  const clients = new Map<string, Bucket>();

  // Buckets for addresses nobody is using any more are just a slow leak.
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [id, bucket] of clients.entries()) {
      if (now - bucket.lastRefill > 10 * 60 * 1000) clients.delete(id);
    }
  }, 5 * 60 * 1000);
  cleanup.unref?.();

  return {
    take(clientId: string, now = Date.now()): boolean {
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
    },
    size: () => clients.size,
    stop: () => clearInterval(cleanup),
  };
}

/** The same thing, as Express middleware. */
export function rateLimit(maxTokens: number, refillPerSec: number) {
  const limiter = createRateLimiter(maxTokens, refillPerSec);

  return (req: any, res: any, next: any) => {
    // `req.ip` is only trustworthy when `trust proxy` matches the deployment.
    // See the note where that is configured.
    const clientId = String(req.ip || req.socket?.remoteAddress || 'unknown');
    if (!limiter.take(clientId)) {
      return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }
    next();
  };
}
