import type { Pool } from 'pg';
import { DeleteObjectCommand, type S3Client } from '@aws-sdk/client-s3';

/**
 * In-memory sliding 24-hour byte tracker per client IP.
 *
 * Rate limiting requests per second stops spam bursts, but does nothing against
 * an attacker or heavy user uploading thirty 50MB files spread evenly across a day.
 * This tracks total byte volume within a 24-hour window per IP.
 */
interface IpUploadWindow {
  uploads: Array<{ timestamp: number; bytes: number }>;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export class IpDailyByteTracker {
  private clients = new Map<string, IpUploadWindow>();
  private pruneTimer: NodeJS.Timeout | null = null;

  constructor() {
    // Prune entries older than 24 hours every 15 minutes
    this.pruneTimer = setInterval(() => {
      this.prune(Date.now());
    }, 15 * 60 * 1000);
    this.pruneTimer.unref?.();
  }

  /** Prunes old records and removes inactive IP entries. */
  public prune(now = Date.now()): void {
    const cutoff = now - ONE_DAY_MS;
    for (const [ip, window] of this.clients.entries()) {
      window.uploads = window.uploads.filter((u) => u.timestamp > cutoff);
      if (window.uploads.length === 0) {
        this.clients.delete(ip);
      }
    }
  }

  /** Total bytes uploaded by this IP in the last 24 hours. */
  public getUsage(ip: string, now = Date.now()): number {
    const window = this.clients.get(ip);
    if (!window) return 0;
    const cutoff = now - ONE_DAY_MS;
    return window.uploads
      .filter((u) => u.timestamp > cutoff)
      .reduce((sum, u) => sum + u.bytes, 0);
  }

  /**
   * Check if adding `incomingBytes` would exceed the daily cap.
   */
  public check(
    ip: string,
    incomingBytes: number,
    maxDailyBytes: number,
    now = Date.now()
  ): { allowed: boolean; currentBytes: number; maxBytes: number } {
    const currentBytes = this.getUsage(ip, now);
    if (currentBytes + incomingBytes > maxDailyBytes) {
      return { allowed: false, currentBytes, maxBytes: maxDailyBytes };
    }
    return { allowed: true, currentBytes, maxBytes: maxDailyBytes };
  }

  /** Record an accepted upload. */
  public record(ip: string, bytes: number, now = Date.now()): void {
    let window = this.clients.get(ip);
    if (!window) {
      window = { uploads: [] };
      this.clients.set(ip, window);
    }
    window.uploads.push({ timestamp: now, bytes });
  }

  /** Stop maintenance timer (for tests/shutdown). */
  public stop(): void {
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }
  }

  public get size(): number {
    return this.clients.size;
  }
}

export const ipDailyTracker = new IpDailyByteTracker();

/** Formats byte counts into human-readable strings (e.g. "200 MB"). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Checks whether a room has sufficient remaining quota for an incoming upload.
 */
export async function checkRoomStorageQuota(
  pool: Pool,
  roomId: string,
  incomingBytes: number,
  maxRoomBytes: number
): Promise<{ allowed: boolean; currentBytes: number; maxBytes: number }> {
  const result = await pool.query<{ total: string }>(
    `SELECT COALESCE(SUM(size_bytes), 0)::text AS total FROM media_refs WHERE room_id = $1`,
    [roomId]
  );
  const currentBytes = Number(result.rows[0]?.total ?? 0);
  if (currentBytes + incomingBytes > maxRoomBytes) {
    return { allowed: false, currentBytes, maxBytes: maxRoomBytes };
  }
  return { allowed: true, currentBytes, maxBytes: maxRoomBytes };
}

/**
 * Checks whether total global storage is within the safety ceiling.
 */
export async function checkGlobalStorageQuota(
  pool: Pool,
  incomingBytes: number,
  maxGlobalBytes: number
): Promise<{ allowed: boolean; currentBytes: number; maxBytes: number }> {
  const result = await pool.query<{ total: string }>(
    `SELECT COALESCE(SUM(size_bytes), 0)::text AS total FROM media_refs`
  );
  const currentBytes = Number(result.rows[0]?.total ?? 0);
  if (currentBytes + incomingBytes > maxGlobalBytes) {
    return { allowed: false, currentBytes, maxBytes: maxGlobalBytes };
  }
  return { allowed: true, currentBytes, maxBytes: maxGlobalBytes };
}

/**
 * Clean up an S3 object and DB row if an upload fails during processing,
 * preventing orphaned files and upward storage accounting drift.
 */
export async function cleanupFailedMedia(
  s3: S3Client,
  bucket: string,
  storageKey: string,
  pool?: Pool,
  mediaId?: string
): Promise<void> {
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: storageKey }));
  } catch (err) {
    console.warn(`Failed to clean up S3 object ${storageKey} on error:`, err);
  }

  if (pool && mediaId) {
    try {
      await pool.query(`DELETE FROM media_refs WHERE id = $1`, [mediaId]);
    } catch {
      /* ignore db cleanup error */
    }
  }
}
