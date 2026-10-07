import { Pool } from 'pg';
import type { Config } from './config';

/** A Postgres pool from config: a connection string when given, fields otherwise. */
export function createPool(db: Config['db']): Pool {
  const pool = new Pool({
    ...(db.url
      ? { connectionString: db.url }
      : { user: db.user, password: db.password, host: db.host, port: db.port, database: db.database }),
    max: db.poolMax,
    ssl: db.ssl ? { rejectUnauthorized: false } : undefined,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
  pool.on('error', (err) => {
    console.error('Unexpected error on idle PostgreSQL client:', err);
  });
  return pool;
}
