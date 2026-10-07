import { beforeEach, describe, expect, it, vi } from 'vitest';

const nodes = new Map<string, { src?: string }>();
const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];
const queued: unknown[] = [];
const released: string[] = [];

vi.mock('../document', () => ({
  readNode: (id: string) => nodes.get(id) ?? null,
  updateNode: (id: string, patch: Record<string, unknown>) => {
    updates.push({ id, patch });
    const node = nodes.get(id);
    if (node) Object.assign(node, patch);
  },
}));
vi.mock('../../utils/endpoints', () => ({
  mediaUploadUrl: (roomId: string) => `https://api.test/rooms/${roomId}/media`,
  roomRequestHeaders: () => ({ 'X-Invite-Token': 'tok' }),
}));
vi.mock('../../utils/offlineMediaQueue', () => ({
  queueOfflineMedia: async (item: unknown) => {
    queued.push(item);
  },
}));
vi.mock('../../utils/pendingMedia', () => ({
  localSrcFor: (id: string) => `local:${id}`,
  uploadIdFromSrc: (src: string) => (src.startsWith('local:') ? src.slice(6) : null),
  releaseLocalMedia: (id: string) => {
    released.push(id);
  },
}));

import {
  __resetUploads,
  canRetryUpload,
  getUploadState,
  retryUpload,
  uploadFraction,
  uploadMedia,
  type Transport,
} from './upload';

const file = new File([new Uint8Array(1000)], 'photo.png', { type: 'image/png' });
const request = { uploadId: 'u1', objectId: 'n1', roomId: 'room-abcdefgh', file, mediaType: 'image' as const };

beforeEach(() => {
  __resetUploads();
  nodes.clear();
  updates.length = 0;
  queued.length = 0;
  released.length = 0;
  nodes.set('n1', { src: 'local:u1' });
});

describe('uploadMedia', () => {
  it('reports progress, then swaps the src and releases the local bytes', async () => {
    const seen: Array<number | null> = [];
    const transport: Transport = async (url, _form, headers, onProgress) => {
      expect(url).toBe('https://api.test/rooms/room-abcdefgh/media');
      expect(headers['X-Invite-Token']).toBe('tok');
      onProgress(250, 1000);
      seen.push(uploadFraction(getUploadState('u1')));
      onProgress(1000, 1000);
      seen.push(uploadFraction(getUploadState('u1')));
      return { status: 200, body: { url: 'https://cdn.test/a.png' } };
    };

    await expect(uploadMedia(request, transport)).resolves.toBe('done');
    expect(seen).toEqual([0.25, 1]);
    expect(nodes.get('n1')?.src).toBe('https://cdn.test/a.png');
    expect(released).toEqual(['u1']);
    expect(getUploadState('u1')).toBeNull();
  });

  it('queues for later when the request never reaches a server', async () => {
    const transport: Transport = async () => ({ status: 0, body: null });
    await expect(uploadMedia(request, transport)).resolves.toBe('queued');
    expect(queued).toHaveLength(1);
    expect(getUploadState('u1')).toEqual({ phase: 'queued' });
    expect(updates).toHaveLength(0);
  });

  it('keeps the bytes and the server reason on refusal, and retries', async () => {
    const refuse: Transport = async () => ({ status: 413, body: { error: 'Daily upload allowance used up.' } });
    await expect(uploadMedia(request, refuse)).resolves.toBe('failed');
    expect(getUploadState('u1')).toEqual({ phase: 'failed', reason: 'Daily upload allowance used up.' });
    expect(released).toHaveLength(0);
    expect(canRetryUpload('u1')).toBe(true);

    const accept: Transport = async () => ({ status: 201, body: { url: 'https://cdn.test/b.png' } });
    await expect(retryUpload('u1', accept)).resolves.toBe('done');
    expect(nodes.get('n1')?.src).toBe('https://cdn.test/b.png');
    expect(canRetryUpload('u1')).toBe(false);
  });

  it('falls back to a plain reason when the server gives none', async () => {
    const transport: Transport = async () => ({ status: 500, body: null });
    await uploadMedia(request, transport);
    expect(getUploadState('u1')).toEqual({ phase: 'failed', reason: 'The server could not store this file.' });
  });

  it('leaves a node alone that no longer shows this upload', async () => {
    nodes.set('n1', { src: 'https://cdn.test/other.png' });
    const transport: Transport = async () => ({ status: 200, body: { url: 'https://cdn.test/a.png' } });
    await uploadMedia(request, transport);
    expect(updates).toHaveLength(0);
    expect(nodes.get('n1')?.src).toBe('https://cdn.test/other.png');
  });

  it('has nothing to retry for an unknown upload', () => {
    expect(retryUpload('nope')).toBeNull();
  });
});
