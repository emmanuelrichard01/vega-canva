import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRateLimiter, type RedisLike } from './rateLimit';

describe('createRateLimiter (In-Memory)', () => {
  let limiter: ReturnType<typeof createRateLimiter>;

  beforeEach(() => {
    limiter = createRateLimiter(5, 1); // 5 max tokens, 1 token/sec refill
  });

  afterEach(() => {
    limiter.stop();
  });

  it('allows bursts up to maxTokens', () => {
    const client = 'client-1';
    for (let i = 0; i < 5; i++) {
      expect(limiter.take(client)).toBe(true);
    }
    // 6th immediate request should be rejected
    expect(limiter.take(client)).toBe(false);
  });

  it('refills tokens over time', () => {
    const client = 'client-2';
    const startTime = 1000000;

    // Exhaust tokens
    for (let i = 0; i < 5; i++) {
      expect(limiter.take(client, startTime)).toBe(true);
    }
    expect(limiter.take(client, startTime)).toBe(false);

    // 2 seconds later -> 2 tokens refilled
    const after2s = startTime + 2000;
    expect(limiter.take(client, after2s)).toBe(true);
    expect(limiter.take(client, after2s)).toBe(true);
    expect(limiter.take(client, after2s)).toBe(false);
  });

  it('isolates different clients', () => {
    const clientA = 'user-a';
    const clientB = 'user-b';

    for (let i = 0; i < 5; i++) {
      expect(limiter.take(clientA)).toBe(true);
    }
    expect(limiter.take(clientA)).toBe(false);

    // Client B still has full allowance
    expect(limiter.take(clientB)).toBe(true);
    expect(limiter.size()).toBe(2);
  });
});

describe('createRateLimiter (Redis-backed with fallback)', () => {
  it('calls Redis EVAL and parses allowed response', async () => {
    const mockRedis: RedisLike = {
      eval: vi.fn().mockResolvedValue(1),
    };

    const limiter = createRateLimiter(10, 2, mockRedis, 'test-rate');
    const allowed = await limiter.takeAsync('1.2.3.4');

    expect(allowed).toBe(true);
    expect(mockRedis.eval).toHaveBeenCalledWith(
      expect.stringContaining('local key = KEYS[1]'),
      1,
      'test-rate:1.2.3.4',
      10,
      2,
      expect.any(Number),
      1
    );
    limiter.stop();
  });

  it('rejects when Redis returns 0', async () => {
    const mockRedis: RedisLike = {
      eval: vi.fn().mockResolvedValue(0),
    };

    const limiter = createRateLimiter(10, 2, mockRedis, 'test-rate');
    const allowed = await limiter.takeAsync('1.2.3.4');

    expect(allowed).toBe(false);
    limiter.stop();
  });

  it('falls back gracefully to in-memory on Redis error', async () => {
    const mockRedis: RedisLike = {
      eval: vi.fn().mockRejectedValue(new Error('Redis connection lost')),
    };

    const limiter = createRateLimiter(3, 1, mockRedis, 'test-rate');

    // In-memory fallback handles requests
    expect(await limiter.takeAsync('fallback-client')).toBe(true);
    expect(await limiter.takeAsync('fallback-client')).toBe(true);
    expect(await limiter.takeAsync('fallback-client')).toBe(true);
    expect(await limiter.takeAsync('fallback-client')).toBe(false);
    limiter.stop();
  });
});
