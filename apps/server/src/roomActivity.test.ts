import { describe, it, expect, vi } from 'vitest';
import type { Pool } from 'pg';
import { RoomActivity } from './roomActivity';

function fakePool(behaviour: 'ok' | 'fail' = 'ok') {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const pool = {
    query: vi.fn(async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      if (behaviour === 'fail') throw new Error('connection terminated');
      return { rows: [] };
    }),
  } as unknown as Pool;
  return { pool, calls };
}

describe('RoomActivity', () => {
  it('updates rather than upserting', async () => {
    /**
     * The difference matters: `store` uses INSERT ... ON CONFLICT, and
     * copying that here would let anyone mint unlimited empty `rooms` rows by
     * connecting to random ids -- a write reachable before any content
     * exists. A room with nothing in it has nothing to protect.
     */
    const { pool, calls } = fakePool();
    const activity = new RoomActivity(pool);

    activity.touch('room-abcdefgh');
    await vi.waitFor(() => expect(calls.length).toBe(1));

    expect(calls[0].sql).toMatch(/^UPDATE rooms SET last_active_at = NOW\(\) WHERE id = \$1$/);
    expect(calls[0].sql).not.toMatch(/INSERT/i);
    expect(calls[0].params).toEqual(['room-abcdefgh']);

    activity.stop();
  });

  it('collapses a reconnect storm into one write', async () => {
    const { pool, calls } = fakePool();
    const activity = new RoomActivity(pool, 60_000);

    for (let i = 0; i < 25; i++) activity.touch('room-abcdefgh');
    await vi.waitFor(() => expect(calls.length).toBe(1));

    activity.stop();
  });

  it('writes again once the interval has passed', async () => {
    const { pool, calls } = fakePool();
    const activity = new RoomActivity(pool, 60_000);
    const t0 = Date.now();

    expect(activity.touch('room-abcdefgh', t0)).toBe(true);
    expect(activity.touch('room-abcdefgh', t0 + 59_000)).toBe(false);
    expect(activity.touch('room-abcdefgh', t0 + 61_000)).toBe(true);

    await vi.waitFor(() => expect(calls.length).toBe(2));
    activity.stop();
  });

  it('tracks rooms independently', async () => {
    const { pool, calls } = fakePool();
    const activity = new RoomActivity(pool, 60_000);

    activity.touch('room-aaaaaaaa');
    activity.touch('room-bbbbbbbb');
    activity.touch('room-aaaaaaaa');

    await vi.waitFor(() => expect(calls.length).toBe(2));
    expect(calls.map((c) => c.params[0])).toEqual(['room-aaaaaaaa', 'room-bbbbbbbb']);

    activity.stop();
  });

  it('never throws or rejects when the database is unreachable', async () => {
    // This runs on the authentication path: a database hiccup must not stop
    // anyone from opening a board.
    const { pool } = fakePool('fail');
    const activity = new RoomActivity(pool);

    expect(() => activity.touch('room-abcdefgh')).not.toThrow();
    await new Promise((r) => setTimeout(r, 10));

    activity.stop();
  });

  it('allows a retry after a failed write instead of pretending it landed', async () => {
    const { pool, calls } = fakePool('fail');
    const activity = new RoomActivity(pool, 60_000);
    const t0 = Date.now();

    activity.touch('room-abcdefgh', t0);
    await vi.waitFor(() => expect(activity.size).toBe(0));

    // Same instant, and it tries again -- because the first one did not stick.
    expect(activity.touch('room-abcdefgh', t0)).toBe(true);
    await vi.waitFor(() => expect(calls.length).toBe(2));

    activity.stop();
  });

  it('does not grow without bound', async () => {
    const { pool } = fakePool();
    const activity = new RoomActivity(pool, 20);

    for (let i = 0; i < 50; i++) activity.touch(`room-${i}`);
    expect(activity.size).toBe(50);

    await vi.waitFor(() => expect(activity.size).toBe(0), { timeout: 1000 });
    activity.stop();
  });
});
