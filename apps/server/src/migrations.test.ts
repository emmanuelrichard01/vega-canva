import { describe, it, expect, vi } from 'vitest';
import type { Pool } from 'pg';
import { migrate, MIGRATIONS } from './migrations';

/**
 * A Postgres stand-in that records what was asked of it.
 *
 * Enough to assert the ordering, the transaction boundaries and the lock,
 * which are the three things that make this safe to run from every instance
 * of a deployment at once. The SQL itself is Postgres's business.
 */
function fakePool(options: { applied?: number[]; failOn?: number } = {}) {
  const log: string[] = [];
  const applied = new Set(options.applied ?? []);

  const client = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      const text = String(sql).trim();
      const first = text.split(/\s+/).slice(0, 2).join(' ').toUpperCase();

      if (text.includes('pg_advisory_lock')) { log.push('LOCK'); return { rows: [] }; }
      if (text.includes('pg_advisory_unlock')) { log.push('UNLOCK'); return { rows: [] }; }
      if (text.startsWith('CREATE TABLE IF NOT EXISTS schema_migrations')) {
        log.push('ENSURE_TABLE');
        return { rows: [] };
      }
      if (text.startsWith('SELECT id FROM schema_migrations')) {
        return { rows: [...applied].map((id) => ({ id })) };
      }
      if (first === 'BEGIN' || first === 'COMMIT' || first === 'ROLLBACK') {
        log.push(first);
        return { rows: [] };
      }
      if (text.startsWith('INSERT INTO schema_migrations')) {
        log.push(`RECORD ${params?.[0]}`);
        return { rows: [] };
      }

      // A migration body. Identify it by matching against the real list.
      const migration = MIGRATIONS.find((m) => m.sql.trim() === text);
      const id = migration?.id ?? '?';
      if (options.failOn !== undefined && migration?.id === options.failOn) {
        log.push(`RUN ${id} (fails)`);
        throw new Error('syntax error at or near "oops"');
      }
      log.push(`RUN ${id}`);
      return { rows: [] };
    }),
    release: vi.fn(),
  };

  const pool = { connect: vi.fn(async () => client) } as unknown as Pool;
  return { pool, client, log };
}

describe('migrate', () => {
  it('applies every migration in order, each in its own transaction', async () => {
    const { pool, log } = fakePool();

    const applied = await migrate(pool);

    expect(applied).toEqual(MIGRATIONS.map((m) => m.id));
    expect(log[0]).toBe('ENSURE_TABLE');
    expect(log[1]).toBe('LOCK');
    expect(log.at(-1)).toBe('UNLOCK');

    // Each migration is BEGIN, run, record, COMMIT -- so a failure leaves the
    // database at the last complete version rather than half way through one.
    for (const m of MIGRATIONS) {
      const at = log.indexOf(`RUN ${m.id}`);
      expect(log[at - 1], `migration ${m.id}`).toBe('BEGIN');
      expect(log[at + 1]).toBe(`RECORD ${m.id}`);
      expect(log[at + 2]).toBe('COMMIT');
    }
  });

  it('skips what is already recorded, so it is safe to run on every boot', async () => {
    const { pool, log } = fakePool({ applied: [1, 2] });

    const applied = await migrate(pool);

    expect(applied).toEqual([3]);
    expect(log).not.toContain('RUN 1');
    expect(log).toContain('RUN 3');
  });

  it('does nothing at all when the database is up to date', async () => {
    const { pool, log } = fakePool({ applied: MIGRATIONS.map((m) => m.id) });

    expect(await migrate(pool)).toEqual([]);
    expect(log.filter((l) => l.startsWith('RUN'))).toEqual([]);
  });

  it('rolls back a failed migration and stops, rather than carrying on', async () => {
    const { pool, log } = fakePool({ failOn: 2 });

    await expect(migrate(pool)).rejects.toThrow(/Migration 2 .* failed/);

    expect(log).toContain('RUN 1');
    expect(log).toContain('ROLLBACK');
    // Migration 3 must not run: it is entitled to assume 2 succeeded.
    expect(log).not.toContain('RUN 3');
    // And the lock is always given back.
    expect(log.at(-1)).toBe('UNLOCK');
  });

  it('releases the client even when everything fails', async () => {
    const { pool, client } = fakePool({ failOn: 1 });

    await expect(migrate(pool)).rejects.toThrow();

    expect(client.release).toHaveBeenCalled();
  });

  it('has unique, gapless, ascending ids', () => {
    // Migrations are append-only and identified by number. A duplicate or a
    // reused id means one database records it as done and never runs the other.
    const ids = MIGRATIONS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(ids).toEqual(ids.map((_, i) => i + 1));
  });

  it('names every migration', () => {
    for (const m of MIGRATIONS) {
      expect(m.name.length, `migration ${m.id}`).toBeGreaterThan(0);
      expect(m.sql.trim().length).toBeGreaterThan(0);
    }
  });
});
