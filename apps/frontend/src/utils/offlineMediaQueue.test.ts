import { describe, it, expect, vi, beforeEach } from 'vitest';
import { queueOfflineMedia, processOfflineMediaQueue, type PendingUpload } from './offlineMediaQueue';

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
