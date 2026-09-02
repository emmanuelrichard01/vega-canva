import fs from 'node:fs';
import pg from 'pg';
const env = fs.readFileSync('.env', 'utf8');
const url = (env.match(/^DATABASE_URL=(.*)$/m) || [])[1]?.trim().replace(/^["']|["']$/g, '');
if (!url) { console.error('no DATABASE_URL'); process.exit(1); }
const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
const q = await pool.query(`
  SELECT r.id,
         COALESCE(octet_length(s.state), 0) AS snapshot_bytes,
         s.updated_at,
         r.last_active_at
  FROM rooms r
  LEFT JOIN room_snapshots s ON s.room_id = r.id
  ORDER BY r.last_active_at DESC NULLS LAST
  LIMIT 25`);
console.log('room_id'.padEnd(18), 'bytes'.padStart(10), '  snapshot_updated');
for (const r of q.rows) {
  console.log(String(r.id).padEnd(18), String(r.snapshot_bytes).padStart(10), ' ', r.updated_at ? new Date(r.updated_at).toISOString() : 'NEVER');
}
await pool.end();
