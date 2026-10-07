import { afterEach, describe, expect, it, vi } from 'vitest';
import { HistoryError, loadHistory } from './historyApi';

const page = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('loadHistory', () => {
  it('follows the cursor until the server says there is no next page', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(page({ updates: [{ id: 1, createdAt: 'x', update: '' }], nextAfter: 1, trimmedCount: 0, baseline: null }))
      .mockResolvedValueOnce(page({ updates: [{ id: 2, createdAt: 'x', update: '' }], nextAfter: null, trimmedCount: 0 }));
    vi.stubGlobal('fetch', fetchMock);
    const rows: number[] = [];
    const first = vi.fn();
    await loadHistory('room-1', { onFirst: first, onRows: (r) => r.forEach((u) => rows.push(u.id!)) });
    expect(rows).toEqual([1, 2]);
    expect(first).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[1][0])).toContain('after=1');
  });

  it('gives up with a restartable error when retention folds rows mid-load', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(page({ updates: [], nextAfter: 5, trimmedCount: 0 }))
        .mockResolvedValueOnce(page({ updates: [], nextAfter: null, trimmedCount: 40 }))
    );
    const err = await loadHistory('room-1', { onFirst: () => {}, onRows: () => {} }).catch((e) => e);
    expect(err).toBeInstanceOf(HistoryError);
    expect(err.status).toBe(409);
  });

  it('waits out a rate limit instead of failing', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 429, headers: { 'Retry-After': '1' } }))
      .mockResolvedValueOnce(page({ updates: [], nextAfter: null }));
    vi.stubGlobal('fetch', fetchMock);
    const done = loadHistory('room-1', { onFirst: () => {}, onRows: () => {} });
    await vi.advanceTimersByTimeAsync(1000);
    await done;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
