import type { Pool } from 'pg';

/**
 * Schema changes, numbered and recorded.
 *
 * ## Why not `CREATE TABLE IF NOT EXISTS`
 *
 * That is what this replaced, and it works right up until it does not. Every
 * additive change had to be written as its own `ALTER TABLE ... ADD COLUMN IF
 * NOT EXISTS`, appended to a script that re-runs in full on every boot, and
 * there was no record anywhere of which version a given database was at.
 *
 * Three things follow from that, all of which bite in production rather than
 * in development. A change that is not expressible as "add if absent" -- a
 * backfill, a type change, a rename, an index built concurrently -- has no
 * home. Two servers starting at once race each other through the same
 * statements. And nobody can answer "is this database up to date" without
 * reading the schema by hand.
 *
 * ## How this one works
 *
 * A numbered list, applied in order, each inside a transaction, with the
 * number recorded in `schema_migrations`. An advisory lock means the second
 * server to start waits for the first rather than racing it. Applying is
 * idempotent: a migration already recorded is skipped.
 *
 * **Migrations are append-only.** Never edit one that has shipped -- a
 * deployed database has already recorded it and will not run it again, so an
 * edit changes what new databases get and nothing else, which is how two
 * environments end up with different schemas and the same version number.
 */

export interface Migration {
  id: number;
  name: string;
  sql: string;
}

/**
 * Migration 1 is the schema as it stood under the old bootstrap script.
 *
 * Written with `IF NOT EXISTS` throughout on purpose: an existing deployment
 * has these tables already and no `schema_migrations` row to say so, so this
 * has to be safe to run against a database that is already in this state. It
 * is the only migration allowed to be defensive that way -- everything after
 * it can assume the state its predecessor left.
 */
const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: 'initial schema',
    sql: `
      CREATE TABLE IF NOT EXISTS rooms (
        id TEXT PRIMARY KEY,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        last_active_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS room_snapshots (
        room_id TEXT REFERENCES rooms(id) ON DELETE CASCADE PRIMARY KEY,
        state BYTEA,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS media_refs (
        id TEXT PRIMARY KEY,
        room_id TEXT REFERENCES rooms(id) ON DELETE CASCADE,
        url TEXT,
        mime_type TEXT,
        size_bytes BIGINT
      );

      CREATE TABLE IF NOT EXISTS room_updates (
        id SERIAL PRIMARY KEY,
        room_id TEXT REFERENCES rooms(id) ON DELETE CASCADE,
        update_data BYTEA NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Time Travel replays this table in order for a single room, so the read
      -- is always room-scoped and ordered. Without this index that is a full
      -- scan of every update ever recorded, for every room.
      CREATE INDEX IF NOT EXISTS room_updates_room_id_idx
        ON room_updates (room_id, id);

      -- How many update rows retention has discarded for this room, ever.
      ALTER TABLE rooms
        ADD COLUMN IF NOT EXISTS updates_trimmed BIGINT NOT NULL DEFAULT 0;

      -- The document as it stood at the moment retention cut the log.
      --
      -- Without this, trimming does not merely shorten a replay, it *empties*
      -- it: Yjs updates are deltas against structs created by earlier updates,
      -- so discarding the beginning of the log discards every object's
      -- creation and the retained updates reference structs that never arrive.
      ALTER TABLE rooms
        ADD COLUMN IF NOT EXISTS replay_base BYTEA;
    `,
  },
  {
    id: 2,
    name: 'index rooms by activity, and media by room',
    sql: `
      -- Retention and any future reaping of dormant rooms both want to find
      -- rooms by when they were last touched. Without this that is a full scan
      -- of every room the deployment has ever seen.
      CREATE INDEX IF NOT EXISTS rooms_last_active_idx
        ON rooms (last_active_at);

      -- Deleting a room cascades to its media rows, and cleaning up the
      -- objects behind them means listing a room's media. Both are lookups by
      -- room_id against a table that only had a primary key on its own id.
      CREATE INDEX IF NOT EXISTS media_refs_room_id_idx
        ON media_refs (room_id);
    `,
  },
  {
    id: 3,
    name: 'record how a media object is stored',
    sql: `
      -- The storage key, so an object can be deleted from the bucket when its
      -- room goes. The URL column holds a *public* address that predates the
      -- media proxy and cannot be turned back into a key reliably.
      ALTER TABLE media_refs
        ADD COLUMN IF NOT EXISTS storage_key TEXT;

      ALTER TABLE media_refs
        ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
    `,
  },
  {
    id: 4,
    name: 'keep what a board shows when its link is shared',
    sql: `
      -- A board's name and the silhouette of its contents, as its own clients
      -- last described them, for the card a link unfurls into. One row per
      -- room, replaced on every upload, and gone with the room.
      CREATE TABLE room_cards (
        room_id TEXT PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
        name TEXT NOT NULL DEFAULT '',
        hidden BOOLEAN NOT NULL DEFAULT FALSE,
        preview JSONB,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `,
  },
];

/** Postgres advisory lock id. Arbitrary, but must be stable across versions. */
const MIGRATION_LOCK = 8_472_213;

export async function migrate(pool: Pool, migrations: Migration[] = MIGRATIONS): Promise<number[]> {
  const client = await pool.connect();
  const applied: number[] = [];

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Session-scoped, so it is released even if this process is killed --
    // a transaction-scoped lock would be released at the first COMMIT below,
    // which is exactly when the next migration needs it.
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK]);

    try {
      const { rows } = await client.query<{ id: number }>('SELECT id FROM schema_migrations');
      const done = new Set(rows.map((r) => r.id));

      for (const migration of [...migrations].sort((a, b) => a.id - b.id)) {
        if (done.has(migration.id)) continue;

        // One transaction per migration: a failure leaves the database at the
        // last complete version rather than half way through a broken one.
        await client.query('BEGIN');
        try {
          await client.query(migration.sql);
          await client.query(
            'INSERT INTO schema_migrations (id, name) VALUES ($1, $2)',
            [migration.id, migration.name]
          );
          await client.query('COMMIT');
          applied.push(migration.id);
          console.log(`Applied migration ${migration.id}: ${migration.name}`);
        } catch (err) {
          await client.query('ROLLBACK');
          throw new Error(
            `Migration ${migration.id} (${migration.name}) failed: ${(err as Error).message}`
          );
        }
      }
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK]);
    }
  } finally {
    client.release();
  }

  return applied;
}

export { MIGRATIONS };
