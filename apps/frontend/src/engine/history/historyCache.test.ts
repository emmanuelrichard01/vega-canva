import { describe, expect, it, vi } from 'vitest';
import { HistoryError, loadHistoryCached, type HistoryCacheIO, type HistoryPage } from './historyApi';
import { isUsableCache, type CachedHistory } from './historyCache';
import type { RawUpdate } from './sessionTimeline';

const row = (id: number): RawUpdate => ({ id, createdAt: new Date(id * 1000).toISOString(), update: `u${id}` });

function memoryCache(initial: CachedHistory | null): HistoryCacheIO & { value: CachedHistory | null } {
  const io = {
    value: initial,
    read: async () => io.value,
    write: async (e: Omit<CachedHistory, 'v' | 'savedAt'>) => {
      io.value = { v: 1, savedAt: Date.now(), ...e };
    },
    clear: async () => {
      io.value = null;
    },
  };
  return io;
}

function server(pages: Record<string, HistoryPage>) {
  return vi.fn(async (_room: string, after: number | null) => {
    const page = pages[String(after)];
    if (!page) throw new Error(`unexpected after=${after}`);
    return page;
  });
}

describe('loadHistoryCached', () => {
  it('reads the whole log on a first open and saves it', async () => {
    const cache = memoryCache(null);
    const fetchPage = server({
      null: { updates: [row(1), row(2)], nextAfter: 2, baseline: 'BASE', total: 3, trimmedCount: 4 },
      2: { updates: [row(3)], nextAfter: null, trimmedCount: 4 },
    });
    const seen: number[] = [];
    const first = vi.fn();
    await loadHistoryCached('r', { onFirst: first, onRows: (rows) => rows.forEach((r) => seen.push(r.id!)) }, undefined, cache, fetchPage);
    expect(seen).toEqual([1, 2, 3]);
    expect(first.mock.calls[0][1]).toEqual({ fromCache: false });
    await Promise.resolve();
    expect(cache.value?.rows.map((r) => r.id)).toEqual([1, 2, 3]);
    expect(cache.value?.baseline).toBe('BASE');
    expect(cache.value?.trimmedCount).toBe(4);
  });

  it('hands over the cached copy first, then fetches only newer rows', async () => {
    const cache = memoryCache({ v: 1, roomId: 'r', baseline: 'BASE', trimmedCount: 4, rows: [row(1), row(2)], savedAt: Date.now() });
    const fetchPage = server({ 2: { updates: [row(3)], nextAfter: null, trimmedCount: 4 } });
    const events: string[] = [];
    await loadHistoryCached(
      'r',
      {
        onFirst: (page, info) => events.push(`first:${info.fromCache}:${page.baseline}`),
        onRows: (rows) => events.push(`rows:${rows.map((r) => r.id).join(',')}`),
        onCached: () => events.push('cached'),
      },
      undefined,
      cache,
      fetchPage
    );
    expect(events).toEqual(['first:true:BASE', 'rows:1,2', 'cached', 'rows:3']);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(cache.value?.rows.map((r) => r.id)).toEqual([1, 2, 3]);
  });

  it('drops the copy and asks for a restart when retention trimmed the log since', async () => {
    const cache = memoryCache({ v: 1, roomId: 'r', baseline: null, trimmedCount: 4, rows: [row(1)], savedAt: Date.now() });
    const fetchPage = server({ 1: { updates: [], nextAfter: null, trimmedCount: 9 } });
    const err = await loadHistoryCached('r', { onFirst: () => {}, onRows: () => {} }, undefined, cache, fetchPage).catch((e) => e);
    expect(err).toBeInstanceOf(HistoryError);
    expect((err as HistoryError).status).toBe(409);
    expect(cache.value).toBeNull();
  });

  it('rejects stale, foreign or malformed cache entries', () => {
    const ok: CachedHistory = { v: 1, roomId: 'r', baseline: null, trimmedCount: 0, rows: [row(1)], savedAt: 1000 };
    expect(isUsableCache(ok, 'r', 2000)).toBe(true);
    expect(isUsableCache(ok, 'other', 2000)).toBe(false);
    expect(isUsableCache(ok, 'r', 1000 + 15 * 86_400_000)).toBe(false);
    expect(isUsableCache({ ...ok, rows: [{ createdAt: '', update: '' }] }, 'r', 2000)).toBe(false);
    expect(isUsableCache({ ...ok, rows: [] }, 'r', 2000)).toBe(false);
    expect(isUsableCache(null, 'r', 2000)).toBe(false);
  });
});
