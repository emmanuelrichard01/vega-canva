import { describe, it, expect, vi, beforeEach } from 'vitest';
import { queueOfflineMedia, processOfflineMediaQueue, drainOfflineMediaQueue, type PendingUpload, type QueueDeps } from './offlineMediaQueue';

describe('offlineMediaQueue', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('handles missing indexedDB gracefully without throwing unhandled exceptions', async () => {
    const originalIndexedDB = globalThis.indexedDB;
    // @ts-expect-error - simulating non-browser environment
    delete globalThis.indexedDB;

    const dummyUpload: PendingUpload = {
      id: 'upload-1',
      objectId: 'obj-1',
      roomId: 'room-test',
      fileBlob: new Blob(['test-audio'], { type: 'audio/webm' }),
      fileName: 'voice-note.webm',
      fileType: 'audio/webm',
      mediaType: 'audio',
    };

    // Should catch and log error rather than crashing
    await expect(queueOfflineMedia(dummyUpload)).resolves.toBeUndefined();
    await expect(processOfflineMediaQueue()).resolves.toBeUndefined();

    // Restore
    globalThis.indexedDB = originalIndexedDB;
  });
});

describe('draining the offline media queue', () => {
  const item = (id: string, roomId: string, objectId = `obj-${id}`): PendingUpload => ({
    id,
    objectId,
    roomId,
    fileBlob: new Blob(['x']),
    fileName: `${id}.png`,
    fileType: 'image/png',
    mediaType: 'image',
  });

  function harness(pending: PendingUpload[], nodes: Record<string, { src: unknown }>, opts: { refuse?: boolean } = {}) {
    const removed: string[] = [];
    const released: string[] = [];
    const uploaded: string[] = [];
    const deps: QueueDeps = {
      roomId: 'room-a',
      canWrite: () => true,
      whenSynced: () => Promise.resolve(),
      list: async () => pending,
      remove: async (id) => void removed.push(id),
      upload: async (i) => (uploaded.push(i.id), `https://cdn/${i.id}`),
      readSrc: (objectId) => (nodes[objectId] ? nodes[objectId].src : undefined),
      setSrc: (objectId, src) => {
        if (!opts.refuse && nodes[objectId]) nodes[objectId].src = src;
      },
      release: (id) => void released.push(id),
    };
    return { deps, removed, released, uploaded };
  }

  it("leaves another room's items alone", async () => {
    const h = harness([item('a', 'room-a'), item('b', 'room-b')], { 'obj-a': { src: 'local:a' } });
    await drainOfflineMediaQueue(h.deps);
    expect(h.uploaded).toEqual(['a']);
    expect(h.removed).toEqual(['a']);
  });

  it('keeps the entry when the document did not take the new URL', async () => {
    const h = harness([item('a', 'room-a')], { 'obj-a': { src: 'local:a' } }, { refuse: true });
    await drainOfflineMediaQueue(h.deps);
    expect(h.removed).toEqual([]);
    expect(h.released).toEqual([]);
  });

  it('drops the entry for a node deleted since, without uploading it', async () => {
    const h = harness([item('a', 'room-a')], {});
    await drainOfflineMediaQueue(h.deps);
    expect(h.uploaded).toEqual([]);
    expect(h.removed).toEqual(['a']);
  });

  it('does nothing for a session that cannot edit', async () => {
    const h = harness([item('a', 'room-a')], { 'obj-a': { src: 'local:a' } });
    await drainOfflineMediaQueue({ ...h.deps, canWrite: () => false });
    expect(h.uploaded).toEqual([]);
  });
});
