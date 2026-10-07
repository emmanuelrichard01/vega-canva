import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HistoryBuffer, KnownRooms } from './historyBuffer';

describe('HistoryBuffer limits and shutdown', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('caps the queue by bytes, dropping the oldest', () => {
    const write = vi.fn().mockRejectedValue(new Error('down'));
    const buffer = new HistoryBuffer({ write, maxBytes: 1000, maxBatch: 1000, flushIntervalMs: 60_000 });
    for (let i = 0; i < 10; i++) buffer.add('a', new Uint8Array(300));
    expect(buffer.bytes).toBeLessThanOrEqual(1000);
    expect(buffer.depth).toBe(3);
    expect(buffer.dropped).toBe(7);
  });

  it('writes updates that arrived during a flush without waiting for another add', async () => {
    let release: () => void = () => {};
    const write = vi
      .fn()
      .mockImplementationOnce(() => new Promise<void>((r) => (release = r)))
      .mockResolvedValue(undefined);
    const buffer = new HistoryBuffer({ write, flushIntervalMs: 10 });

    buffer.add('a', new Uint8Array([1]));
    void buffer.flush();
    buffer.add('a', new Uint8Array([2]));
    release();
    await vi.advanceTimersByTimeAsync(20);

    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[1][0].map((u: any) => u.update[0])).toEqual([2]);
  });

  it('drain waits for a flush in flight, then writes the rest', async () => {
    let release: () => void = () => {};
    const write = vi
      .fn()
      .mockImplementationOnce(() => new Promise<void>((r) => (release = r)))
      .mockResolvedValue(undefined);
    const buffer = new HistoryBuffer({ write, flushIntervalMs: 60_000 });

    buffer.add('a', new Uint8Array([1]));
    void buffer.flush();
    buffer.add('a', new Uint8Array([2]));
    const drained = buffer.drain();
    release();
    await drained;

    expect(write.mock.calls.map((c) => c[0].map((u: any) => u.update[0]))).toEqual([[1], [2]]);
  });

  it('reports a batch that still fails during drain and counts it as dropped', async () => {
    const onError = vi.fn();
    const buffer = new HistoryBuffer({ write: vi.fn().mockRejectedValue(new Error('down')), onError });
    buffer.add('a', new Uint8Array([1]));
    await buffer.drain();
    expect(onError).toHaveBeenCalledOnce();
    expect(buffer.dropped).toBe(1);
  });
});

describe('KnownRooms', () => {
  it('forgets every room of a failed batch', () => {
    const known = new KnownRooms();
    known.needsInsert('a');
    known.needsInsert('b');
    known.forgetAll(['a', 'b']);
    expect(known.needsInsert('a')).toBe(true);
    expect(known.needsInsert('b')).toBe(true);
  });
});
