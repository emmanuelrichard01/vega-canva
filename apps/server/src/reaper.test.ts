import { describe, it, expect, vi } from 'vitest';
import { objectKeyOf, reapInactiveRooms } from './reaper';

describe('objectKeyOf', () => {
  it('derives the key of media recorded before storage keys existed', () => {
    expect(objectKeyOf({ room_id: 'room-1', url: 'https://api.example.com/rooms/room-1/media/abc.png', storage_key: null })).toBe('room-1/abc.png');
    expect(objectKeyOf({ room_id: 'room-1', url: null, storage_key: 'room-1/x.png' })).toBe('room-1/x.png');
  });
});

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
          rows: [{ room_id: "room-1", storage_key: "room-1/img1.png" }],
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
    const [sql, params] = mockPool.query.mock.calls[2];
    expect(sql).toContain("DELETE FROM rooms");
    // Inactivity is re-checked in the delete itself.
    expect(sql).toContain("last_active_at < NOW() - $2::interval");
    expect(params).toEqual([["room-1"], "30 days"]);
  });

  it("also deletes media uploaded between the scan and the delete", async () => {
    const mockPool: any = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ id: "room-1", last_active_at: new Date() }] })
        .mockResolvedValueOnce({ rows: [{ storage_key: "room-1/old.png", size_bytes: "10" }] })
        .mockResolvedValueOnce({
          rows: [
            { room_id: "room-1", storage_key: "room-1/old.png" },
            { room_id: "room-1", storage_key: "room-1/late.png" },
          ],
        }),
    };
    const mockS3: any = { send: vi.fn().mockResolvedValue({}) };

    const result = await reapInactiveRooms(mockPool, mockS3, "test-bucket", { maxAgeDays: 30 });

    const deletedKeys = mockS3.send.mock.calls.flatMap((c: any) =>
      c[0].input.Delete.Objects.map((o: any) => o.Key)
    );
    expect(deletedKeys).toEqual(["room-1/old.png", "room-1/late.png"]);
    expect(result.deletedObjects).toBe(2);
  });

  it("keeps a room that became active again before the delete", async () => {
    const mockPool: any = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ id: "room-1", last_active_at: new Date() }] })
        .mockResolvedValueOnce({ rows: [] })
        // The re-check in the DELETE matched nothing.
        .mockResolvedValueOnce({ rows: [] }),
    };
    const mockS3: any = { send: vi.fn().mockResolvedValue({}) };

    const result = await reapInactiveRooms(mockPool, mockS3, "test-bucket", { maxAgeDays: 30 });
    expect(result.reapedRooms).toBe(0);
    expect(result.roomIds).toEqual([]);
  });
});
