import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createSyncMeta } from './syncMeta';

describe('syncMeta', () => {
  it('counts local updates while offline, throttled, and clears on sync', () => {
    vi.useFakeTimers();
    const doc = new Y.Doc();
    const meta = createSyncMeta(doc, (o) => o === 'remote', { online: false, now: () => 1234, throttleMs: 400 });
    const seen: number[] = [];
    meta.subscribe(() => seen.push(meta.get().queued));
    const m = doc.getMap('m');
    for (let i = 0; i < 50; i++) m.set('k' + i, i);
    Y.applyUpdate(new Y.Doc(), Y.encodeStateAsUpdate(doc));
    doc.transact(() => m.set('r', 1), 'remote');
    expect(meta.get().queued).toBe(0); // not yet published
    vi.advanceTimersByTime(450);
    expect(seen).toEqual([50]);
    meta.markSynced();
    expect(meta.get()).toEqual({ queued: 0, lastSyncedAt: 1234 });
    meta.setOnline(true);
    m.set('x', 1);
    vi.advanceTimersByTime(450);
    expect(meta.get().queued).toBe(0);
    meta.destroy();
    vi.useRealTimers();
  });
});
