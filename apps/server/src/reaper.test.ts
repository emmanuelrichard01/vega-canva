import { describe, it, expect, vi } from 'vitest';
import { reapInactiveRooms } from './reaper';

describe('reapInactiveRooms', () => {
  it('returns zero counts when no rooms are inactive', async () => {
    const mockPool: any = {
      query: vi.fn().mockResolvedValueOnce({ rows: [] }), // rooms query
    };
    const mockS3: any = {
      send: vi.fn(),
    };

    const result = await reapInactiveRooms(mockPool, mockS3, 'test-bucket', {
      maxAgeDays: 30,
      dryRun: false,
    });

    expect(result.reapedRooms).toBe(0);
    expect(result.deletedObjects).toBe(0);
    expect(mockS3.send).not.toHaveBeenCalled();
  });

  it('performs dry-run without executing S3 or DB deletions', async () => {
    const mockPool: any = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{ id: 'room-1', last_active_at: new Date() }],
        })
        .mockResolvedValueOnce({
          rows: [
            { storage_key: 'room-1/img1.png', size_bytes: '1000' },
            { storage_key: 'room-1/img2.png', size_bytes: '2000' },
          ],
        }),
    };
    const mockS3: any = {
      send: vi.fn(),
    };

    const result = await reapInactiveRooms(mockPool, mockS3, 'test-bucket', {
      maxAgeDays: 30,
      dryRun: true,
    });

    expect(result.dryRun).toBe(true);
    expect(result.reapedRooms).toBe(1);
    expect(result.deletedObjects).toBe(2);
    expect(result.freedBytes).toBe(3000);
    expect(mockS3.send).not.toHaveBeenCalled();
    // Only 2 SELECT queries were run, no DELETE query
    expect(mockPool.query).toHaveBeenCalledTimes(2);
  });

  it('executes batch S3 deletion and DB delete when dryRun is false', async () => {
    const mockPool: any = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{ id: 'room-1', last_active_at: new Date() }],
        })
        .mockResolvedValueOnce({
          rows: [{ storage_key: 'room-1/img1.png', size_bytes: '5000' }],
        })
        .mockResolvedValueOnce({
          rowCount: 1,
        }),
    };
    const mockS3: any = {
      send: vi.fn().mockResolvedValue({}),
    };

    const result = await reapInactiveRooms(mockPool, mockS3, 'test-bucket', {
      maxAgeDays: 30,
      dryRun: false,
    });

    expect(result.dryRun).toBe(false);
    expect(result.reapedRooms).toBe(1);
    expect(result.deletedObjects).toBe(1);
    expect(mockS3.send).toHaveBeenCalled();
    expect(mockPool.query).toHaveBeenCalledWith(
      'DELETE FROM rooms WHERE id = ANY($1::text[])',
      [['room-1']]
    );
  });
});
