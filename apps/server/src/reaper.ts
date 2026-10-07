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

type QueryPool = Pick<Pool, 'query'>;

interface MediaRow {
  room_id?: string;
  url?: string | null;
  storage_key: string | null;
  size_bytes?: string;
}

/**
 * The object a media row owns. Rows written before migration 3 have no
 * `storage_key`; every upload has always been stored as
 * `<room>/<object name>`, and the object name is the last segment of its URL.
 */
export function objectKeyOf(row: MediaRow): string | null {
  if (row.storage_key) return row.storage_key;
  if (!row.room_id || !row.url) return null;
  const name = row.url.split('?')[0].split('/').pop();
  return name ? `${row.room_id}/${name}` : null;
}

async function deleteObjects(s3: S3Client, bucket: string, keys: string[]): Promise<number> {
  let deleted = 0;
  for (let i = 0; i < keys.length; i += 1000) {
    const chunk = keys.slice(i, i + 1000);
    try {
      await s3.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true },
        })
      );
      deleted += chunk.length;
    } catch (err) {
      console.error('Error deleting S3 batch during room reaping:', err);
    }
  }
  return deleted;
}

/**
 * Reap inactive rooms and everything that belongs to them.
 *
 * 1. Find the rooms inactive past the threshold and the objects they own.
 * 2. Delete those objects. A failure here leaves the database rows in place,
 *    so the next run tries again rather than orphaning the objects.
 * 3. Delete the rooms in one statement that re-checks inactivity, so a room
 *    opened since step 1 survives. The rows cascade to snapshots, the update
 *    log and media refs. The same statement returns every media key the
 *    cascade removes, including any uploaded after step 1, and those objects
 *    are deleted too.
 */
export async function reapInactiveRooms(
  pool: QueryPool,
  s3: S3Client,
  bucket: string,
  options: ReapOptions
): Promise<ReapResult> {
  const { maxAgeDays, dryRun = false } = options;
  const intervalStr = `${Math.max(1, maxAgeDays)} days`;

  const roomsRes = await pool.query<{ id: string; last_active_at: Date }>(
    `SELECT id, last_active_at FROM rooms
      WHERE last_active_at < NOW() - $1::interval
      ORDER BY last_active_at ASC`,
    [intervalStr]
  );

  const roomIds = roomsRes.rows.map((r) => r.id);
  if (roomIds.length === 0) {
    return { reapedRooms: 0, roomIds: [], deletedObjects: 0, freedBytes: 0, dryRun };
  }

  const mediaRes = await pool.query<MediaRow>(
    `SELECT room_id, url, storage_key, size_bytes FROM media_refs WHERE room_id = ANY($1::text[])`,
    [roomIds]
  );

  const storageKeys = mediaRes.rows.map(objectKeyOf).filter((k): k is string => Boolean(k));
  const freedBytes = mediaRes.rows.reduce((sum, m) => sum + Number(m.size_bytes || 0), 0);

  if (dryRun) {
    return {
      reapedRooms: roomIds.length,
      roomIds,
      deletedObjects: storageKeys.length,
      freedBytes,
      dryRun: true,
    };
  }

  let deletedObjects = await deleteObjects(s3, bucket, storageKeys);

  // Every sub-statement sees the snapshot from before the DELETE, so the join
  // still finds the media rows the cascade is about to remove.
  const deleteRes = await pool.query<MediaRow & { room_id: string }>(
    `WITH doomed AS (
       DELETE FROM rooms
        WHERE id = ANY($1::text[]) AND last_active_at < NOW() - $2::interval
        RETURNING id
     )
     SELECT d.id AS room_id, m.url, m.storage_key
       FROM doomed d LEFT JOIN media_refs m ON m.room_id = d.id`,
    [roomIds, intervalStr]
  );

  const rows = deleteRes.rows ?? [];
  const reaped = [...new Set(rows.map((r) => r.room_id))];
  const alreadyDeleted = new Set(storageKeys);
  const late = rows
    .map(objectKeyOf)
    .filter((k): k is string => Boolean(k) && !alreadyDeleted.has(k as string));
  if (late.length > 0) deletedObjects += await deleteObjects(s3, bucket, late);

  return {
    reapedRooms: reaped.length,
    roomIds: reaped,
    deletedObjects,
    freedBytes,
    dryRun: false,
  };
}
