import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  IpDailyByteTracker,
  formatBytes,
  checkRoomStorageQuota,
  checkGlobalStorageQuota,
  cleanupFailedMedia,
} from './quota';

describe('IpDailyByteTracker', () => {
  let tracker: IpDailyByteTracker;

  beforeEach(() => {
    tracker = new IpDailyByteTracker();
  });

  afterEach(() => {
    tracker.stop();
  });

  it('tracks uploaded bytes and permits uploads under the daily cap', () => {
    const ip = '192.168.1.100';
    const cap = 500 * 1024 * 1024; // 500MB

    const check1 = tracker.check(ip, 10 * 1024 * 1024, cap);
    expect(check1.allowed).toBe(true);
    expect(check1.currentBytes).toBe(0);

    tracker.record(ip, 10 * 1024 * 1024);
    expect(tracker.getUsage(ip)).toBe(10 * 1024 * 1024);

    const check2 = tracker.check(ip, 20 * 1024 * 1024, cap);
    expect(check2.allowed).toBe(true);
    expect(check2.currentBytes).toBe(10 * 1024 * 1024);
  });

  it('rejects uploads that would exceed the daily cap', () => {
    const ip = '10.0.0.1';
    const cap = 50 * 1024 * 1024; // 50MB

    tracker.record(ip, 40 * 1024 * 1024);
    expect(tracker.getUsage(ip)).toBe(40 * 1024 * 1024);

    const check = tracker.check(ip, 15 * 1024 * 1024, cap);
    expect(check.allowed).toBe(false);
    expect(check.currentBytes).toBe(40 * 1024 * 1024);
  });

  it('prunes entries older than 24 hours', () => {
    const ip = '172.16.0.5';
    const now = 1000000000000;
    const oldTime = now - (25 * 60 * 60 * 1000); // 25 hours ago

    tracker.record(ip, 30 * 1024 * 1024, oldTime);
    expect(tracker.getUsage(ip, now)).toBe(0);

    tracker.prune(now);
    expect(tracker.size).toBe(0);
  });

  it('checks and records usage via Redis when configured', async () => {
    const redisStore: Record<string, string> = {};
    const mockRedis = {
      get: vi.fn().mockImplementation(async (key: string) => redisStore[key] || null),
      incrby: vi.fn().mockImplementation(async (key: string, inc: number) => {
        const cur = parseInt(redisStore[key] || '0', 10);
        redisStore[key] = String(cur + inc);
        return cur + inc;
      }),
      expire: vi.fn().mockResolvedValue(1),
    };

    const redisTracker = new IpDailyByteTracker(mockRedis);
    const ip = '1.1.1.1';
    const cap = 100 * 1024 * 1024; // 100MB

    const check1 = await redisTracker.checkAsync(ip, 50 * 1024 * 1024, cap);
    expect(check1.allowed).toBe(true);

    await redisTracker.recordAsync(ip, 50 * 1024 * 1024);
    expect(mockRedis.incrby).toHaveBeenCalled();
    expect(mockRedis.expire).toHaveBeenCalled();

    // 50MB used, trying to upload 60MB (total 110MB > 100MB cap) -> rejected
    const check2 = await redisTracker.checkAsync(ip, 60 * 1024 * 1024, cap);
    expect(check2.allowed).toBe(false);

    redisTracker.stop();
  });
});

describe('formatBytes', () => {
  it('formats bytes, kilobytes, megabytes, and gigabytes accurately', () => {
    expect(formatBytes(500)).toBe('500 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(50 * 1024 * 1024)).toBe('50.0 MB');
    expect(formatBytes(2.5 * 1024 * 1024 * 1024)).toBe('2.50 GB');
  });
});

describe('database quota checks', () => {
  it('checks room storage against pool query results', async () => {
    const mockPool: any = {
      query: vi.fn().mockResolvedValue({
        rows: [{ total: '150000000' }], // 150MB
      }),
    };

    const maxRoom = 200 * 1024 * 1024; // 200MB
    const okCheck = await checkRoomStorageQuota(mockPool, 'test-room', 20 * 1024 * 1024, maxRoom);
    expect(okCheck.allowed).toBe(true);
    expect(okCheck.currentBytes).toBe(150000000);

    const overCheck = await checkRoomStorageQuota(mockPool, 'test-room', 60 * 1024 * 1024, maxRoom);
    expect(overCheck.allowed).toBe(false);
  });

  it('checks global storage ceiling against pool query results', async () => {
    const mockPool: any = {
      query: vi.fn().mockResolvedValue({
        rows: [{ total: '9500000000' }], // 9.5GB
      }),
    };

    const maxGlobal = 10 * 1024 * 1024 * 1024; // 10GB (10,737,418,240 bytes)
    const okCheck = await checkGlobalStorageQuota(mockPool, 100 * 1024 * 1024, maxGlobal);
    expect(okCheck.allowed).toBe(true);

    // 9,500,000,000 + 1,500,000,000 = 11,000,000,000 > 10,737,418,240
    const overCheck = await checkGlobalStorageQuota(mockPool, 1500 * 1024 * 1024, maxGlobal);
    expect(overCheck.allowed).toBe(false);
  });
});

describe('cleanupFailedMedia', () => {
  it('calls S3 DeleteObjectCommand and DB deletion on failure', async () => {
    const mockS3: any = {
      send: vi.fn().mockResolvedValue({}),
    };
    const mockPool: any = {
      query: vi.fn().mockResolvedValue({}),
    };

    await cleanupFailedMedia(mockS3, 'test-bucket', 'room-1/media-123.png', mockPool, 'media-123');

    expect(mockS3.send).toHaveBeenCalled();
    expect(mockPool.query).toHaveBeenCalledWith('DELETE FROM media_refs WHERE id = $1', ['media-123']);
  });
});
