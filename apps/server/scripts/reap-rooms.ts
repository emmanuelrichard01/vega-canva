/**
 * Maintenance script: reap inactive rooms and orphaned media.
 *
 * ## Usage
 *
 *   npx tsx scripts/reap-rooms.ts                    # report only, changes nothing
 *   npx tsx scripts/reap-rooms.ts --apply            # delete expired rooms and S3 objects
 *   npx tsx scripts/reap-rooms.ts --days 30 --apply  # custom retention threshold
 */

import { Pool } from 'pg';
import { S3Client } from '@aws-sdk/client-s3';
import { reapInactiveRooms } from '../src/reaper';
import { formatBytes } from '../src/quota';

const apply = process.argv.includes('--apply');
const daysIdx = process.argv.indexOf('--days');
const maxAgeDays = daysIdx !== -1 && process.argv[daysIdx + 1]
  ? parseInt(process.argv[daysIdx + 1], 10)
  : parseInt(process.env.ROOM_TTL_DAYS || '90', 10);

const pool = new Pool({
  user: process.env.POSTGRES_USER || 'canva_user',
  password: process.env.POSTGRES_PASSWORD || 'canva_password',
  host: process.env.POSTGRES_HOST || 'localhost',
  port: Number(process.env.POSTGRES_PORT || 5432),
  database: process.env.POSTGRES_DB || 'vega_canva',
});

const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT || 'http://localhost:9000',
  region: 'us-east-1',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY || 'canva_admin',
    secretAccessKey: process.env.S3_SECRET_KEY || 'canva_password',
  },
  forcePathStyle: true,
});

const bucket = process.env.S3_BUCKET || 'vega-canva-media';

async function main() {
  console.log(`\n--- Room & Media Reaper ---`);
  console.log(`Retention threshold: ${maxAgeDays} days of inactivity`);
  console.log(`Mode: ${apply ? 'APPLY (destructive)' : 'DRY-RUN (inspection only)'}\n`);

  try {
    const result = await reapInactiveRooms(pool, s3, bucket, {
      maxAgeDays,
      dryRun: !apply,
    });

    console.log(`Results:`);
    console.log(`  - Inactive rooms identified: ${result.reapedRooms}`);
    if (result.roomIds.length > 0) {
      console.log(`    Room IDs: ${result.roomIds.slice(0, 10).join(', ')}${result.roomIds.length > 10 ? '...' : ''}`);
    }
    console.log(`  - S3 media objects to delete: ${result.deletedObjects}`);
    console.log(`  - Storage to free: ${formatBytes(result.freedBytes)}`);

    if (!apply && result.reapedRooms > 0) {
      console.log(`\nTo execute this cleanup, rerun with --apply:`);
      console.log(`  npx tsx scripts/reap-rooms.ts --days ${maxAgeDays} --apply\n`);
    } else if (apply) {
      console.log(`\nCleanup successfully applied.\n`);
    }
  } catch (err) {
    console.error('Error running room reaper:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

void main();
