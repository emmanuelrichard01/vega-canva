/**
 * Maintenance script: reap inactive rooms and their media.
 *
 * ## Usage
 *
 *   npx tsx scripts/reap-rooms.ts                    # report only, changes nothing
 *   npx tsx scripts/reap-rooms.ts --apply            # delete expired rooms and their objects
 *   npx tsx scripts/reap-rooms.ts --days 30 --apply  # custom retention threshold
 *
 * `REAP_APPLY=true` is the same as `--apply`, for schedulers that set
 * environment rather than arguments. Without either it only reports.
 *
 * ## Configuration
 *
 * The same variables as the server, read strictly: the database from
 * `DATABASE_URL` (or `POSTGRES_HOST`/`USER`/`PASSWORD`/`DB`, with
 * `POSTGRES_SSL`), object storage from `S3_ENDPOINT`/`S3_BUCKET`/
 * `S3_ACCESS_KEY`/`S3_SECRET_KEY`, and `ROOM_TTL_DAYS`. A missing credential is
 * an error unless `NODE_ENV=development`, so a scheduled run never falls back
 * to the published development password.
 */

import { readMaintenanceConfig } from '../src/config';
import { createPool } from '../src/pool';
import { createS3Client } from '../src/s3';
import { reapInactiveRooms } from '../src/reaper';
import { formatBytes } from '../src/quota';

const config = readMaintenanceConfig();

const apply = process.argv.includes('--apply') || process.env.REAP_APPLY === 'true';
const daysIdx = process.argv.indexOf('--days');
const maxAgeDays =
  daysIdx !== -1 && process.argv[daysIdx + 1] ? parseInt(process.argv[daysIdx + 1], 10) : config.roomTtlDays;

if (!Number.isFinite(maxAgeDays) || maxAgeDays < 1) {
  console.error(`--days must be a whole number of days, got "${process.argv[daysIdx + 1]}"`);
  process.exit(2);
}

const pool = createPool({ ...config.db, poolMax: 2 });
const s3 = createS3Client(config.s3);

async function main() {
  console.log(`\n--- Room & Media Reaper ---`);
  console.log(`Retention threshold: ${maxAgeDays} days of inactivity`);
  console.log(`Mode: ${apply ? 'APPLY (destructive)' : 'DRY-RUN (inspection only)'}\n`);

  try {
    const result = await reapInactiveRooms(pool, s3, config.s3.bucket, { maxAgeDays, dryRun: !apply });

    console.log(`Results:`);
    console.log(`  - Inactive rooms ${apply ? 'reaped' : 'identified'}: ${result.reapedRooms}`);
    if (result.roomIds.length > 0) {
      console.log(`    Room IDs: ${result.roomIds.slice(0, 10).join(', ')}${result.roomIds.length > 10 ? '...' : ''}`);
    }
    console.log(`  - Media objects ${apply ? 'deleted' : 'to delete'}: ${result.deletedObjects}`);
    console.log(`  - Storage ${apply ? 'freed' : 'to free'}: ${formatBytes(result.freedBytes)}`);

    if (!apply && result.reapedRooms > 0) {
      console.log(`\nTo execute this cleanup, rerun with --apply (or REAP_APPLY=true).\n`);
    }
  } catch (err) {
    console.error('Error running room reaper:', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void main();
