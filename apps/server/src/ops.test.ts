import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import { createShutdown } from './shutdown';
import { reconnectDelay, redisConnectionOptions } from './redisClient';
import { ConnectionCounter, upgradeClientAddress } from './clientAddress';
import { decideMint } from './routes/rooms';

describe('shutdown', () => {
  const deps = (overrides: Partial<Parameters<typeof createShutdown>[0]> = {}) => {
    const exit = vi.fn();
    return {
      exit,
      shutdown: createShutdown({
        httpServer: { close: vi.fn() } as any,
        wss: null,
        flushDocuments: vi.fn().mockResolvedValue(undefined),
        drainHistory: vi.fn().mockResolvedValue(undefined),
        closers: [],
        onDraining: vi.fn(),
        exit,
        ...overrides,
      }),
    };
  };

  it('drains, then exits cleanly', async () => {
    const onDraining = vi.fn();
    const { shutdown, exit } = deps({ onDraining });
    await shutdown('SIGTERM');
    expect(onDraining).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('forces an exit when a step hangs', async () => {
    vi.useFakeTimers();
    const { shutdown, exit } = deps({
      flushDocuments: () => new Promise(() => {}),
      forceAfterMs: 1000,
    });
    void shutdown('SIGTERM');
    await vi.advanceTimersByTimeAsync(1000);
    expect(exit).toHaveBeenCalledWith(1);
    vi.useRealTimers();
  });

  it('exits at once on a second signal', async () => {
    const { shutdown, exit } = deps({ flushDocuments: () => new Promise(() => {}) });
    void shutdown('SIGTERM');
    await shutdown('SIGINT');
    expect(exit).toHaveBeenCalledWith(1);
  });
});

describe('shared Redis', () => {
  it('keeps reconnecting, with a capped backoff', () => {
    for (const attempt of [1, 10, 11, 100, 10_000]) {
      const delay = reconnectDelay(attempt);
      expect(delay).toBeGreaterThan(0);
      expect(delay).toBeLessThanOrEqual(5000);
    }
  });

  it('reads credentials and TLS from a URL', () => {
    const options = redisConnectionOptions({
      url: 'rediss://user:p%40ss@cache.example.com:6380/2',
      host: null,
      port: 6379,
      password: null,
      tls: false,
    });
    expect(options).toMatchObject({ host: 'cache.example.com', port: 6380, username: 'user', password: 'p@ss', db: 2 });
    expect(options.tls).toBeDefined();
  });
});

describe('client address of a WebSocket upgrade', () => {
  const request = (peer: string, xff?: string) =>
    Object.assign(new EventEmitter(), {
      socket: { remoteAddress: peer },
      headers: xff ? { 'x-forwarded-for': xff } : {},
    }) as any;

  it('ignores X-Forwarded-For when no proxy is trusted', () => {
    expect(upgradeClientAddress(request('10.0.0.1', '1.2.3.4'), undefined)).toBe('10.0.0.1');
  });

  it('takes the first untrusted hop, like req.ip', () => {
    const oneHop = (_addr: string, hop: number) => hop < 1;
    expect(upgradeClientAddress(request('10.0.0.1', '6.6.6.6, 1.2.3.4'), oneHop)).toBe('1.2.3.4');
  });

  it('counts sockets per address against a ceiling', () => {
    const counter = new ConnectionCounter(2);
    expect(counter.acquire('a')).toBe(true);
    expect(counter.acquire('a')).toBe(true);
    expect(counter.acquire('a')).toBe(false);
    counter.release('a');
    expect(counter.acquire('a')).toBe(true);
  });
});

describe('decideMint', () => {
  const now = 1_000_000_000_000;

  it('refuses a role above the holder’s', () => {
    expect(decideMint({ role: 'commenter', expiresAt: 0 }, 'editor', 0, false, now)).toMatchObject({ ok: false });
  });

  it('caps the lifetime at the holder’s remaining lifetime', () => {
    const expiresAt = Math.floor(now / 1000) + 60;
    expect(decideMint({ role: 'editor', expiresAt }, 'viewer', 0, false, now)).toEqual({ ok: true, ttlSeconds: 60 });
    expect(decideMint({ role: 'editor', expiresAt }, 'viewer', 3600, false, now)).toEqual({ ok: true, ttlSeconds: 60 });
  });

  it('lets the admin mint anything', () => {
    expect(decideMint({ role: null, expiresAt: 0 }, 'editor', 0, true, now)).toEqual({ ok: true, ttlSeconds: 0 });
  });
});
