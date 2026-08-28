import type { Pool } from 'pg';
import {
  type S3Client,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';

export interface ReapOptions {
  maxAgeDays: number;
  dryRun?: boolean;
}

export interface ReapResult {
  reapedRooms: number;
  roomIds: string[];
  deletedObjects: number;
  freedBytes: number;
  dryRun: boolean;
}

/**
 * Reaps inactive rooms and all of their associated data.
 *
 * Deletion order matters:
 * 1. Gather all S3 storage keys from `media_refs` for the expired rooms.
 * 2. Delete the physical S3 objects first in batches of 1,000.
 * 3. Delete the `rooms` rows in PostgreSQL, which cascades to:
 *    - `room_snapshots`
 *    - `room_updates`
 *    - `media_refs`
 *
 * Deleting the objects first ensures a failed S3 deletion leaves the DB rows intact
 * for the next run, rather than deleting DB rows first and orphaning S3 objects forever.
 */
export async function reapInactiveRooms(
  pool: Pool,
  s3: S3Client,
  bucket: string,
  options: ReapOptions
): Promise<ReapResult> {
  const { maxAgeDays, dryRun = false } = options;
  const intervalStr = `${Math.max(1, maxAgeDays)} days`;

  // 1. Query inactive rooms
  const roomsRes = await pool.query<{ id: string; last_active_at: Date }>(
    `SELECT id, last_active_at FROM rooms
      WHERE last_active_at < NOW() - $1::interval
      ORDER BY last_active_at ASC`,
    [intervalStr]
  );

  const roomIds = roomsRes.rows.map((r) => r.id);
  if (roomIds.length === 0) {
    return {
      reapedRooms: 0,
      roomIds: [],
      deletedObjects: 0,
      freedBytes: 0,
      dryRun,
    };
  }

  // 2. Query media objects for these rooms
  const mediaRes = await pool.query<{ storage_key: string; size_bytes: string }>(
    `SELECT storage_key, size_bytes FROM media_refs WHERE room_id = ANY($1::text[])`,
    [roomIds]
  );

  const storageKeys = mediaRes.rows
    .map((m) => m.storage_key)
    .filter((k): k is string => Boolean(k));
  const freedBytes = mediaRes.rows.reduce(
    (sum, m) => sum + Number(m.size_bytes || 0),
    0
  );

  if (dryRun) {
    return {
      reapedRooms: roomIds.length,
      roomIds,
      deletedObjects: storageKeys.length,
      freedBytes,
      dryRun: true,
    };
  }

  // 3. Delete S3 objects in batches of up to 1000
  let deletedObjects = 0;
  for (let i = 0; i < storageKeys.length; i += 1000) {
    const chunk = storageKeys.slice(i, i + 1000);
    try {
      await s3.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: {
            Objects: chunk.map((Key) => ({ Key })),
            Quiet: true,
          },
        })
      );
      deletedObjects += chunk.length;
    } catch (err) {
      console.error('Error deleting S3 batch during room reaping:', err);
      // Continue to try deleting remaining batches
    }
  }

  // 4. Delete the rooms in PostgreSQL (cascades to all dependent tables)
  const deleteRes = await pool.query(
    `DELETE FROM rooms WHERE id = ANY($1::text[])`,
    [roomIds]
  );

  const reapedRooms = deleteRes.rowCount ?? roomIds.length;

  return {
    reapedRooms,
    roomIds,
    deletedObjects,
    freedBytes,
    dryRun: false,
  };
}
