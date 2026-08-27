import { describe, it, expect, vi } from 'vitest';
import path from 'path';
import * as Y from 'yjs';

// --- Replicated / Extracted Core Invariants from Server ---

const ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'audio/webm',
  'audio/mp4',
  'audio/ogg',
  'audio/wav',
  'audio/mpeg',
  'audio/aac',
]);

const ALLOWED_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif',
  '.webm', '.mp4', '.ogg', '.wav', '.mp3', '.m4a', '.aac'
]);

const EXTENSION_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.webm': 'audio/webm',
  '.mp4': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
};

// Token Bucket Implementation matching server/index.ts
interface RateLimitBucket {
  tokens: number;
  lastRefill: number;
}

const createTestRateLimiter = (maxTokens: number, refillRatePerSec: number) => {
  const clients = new Map<string, RateLimitBucket>();

  return {
    check: (clientIp: string, now = Date.now()): boolean => {
      let bucket = clients.get(clientIp);
      if (!bucket) {
        bucket = { tokens: maxTokens, lastRefill: now };
        clients.set(clientIp, bucket);
      } else {
        const elapsedSec = (now - bucket.lastRefill) / 1000;
        bucket.tokens = Math.min(maxTokens, bucket.tokens + elapsedSec * refillRatePerSec);
        bucket.lastRefill = now;
      }

      if (bucket.tokens < 1) {
        return false;
      }
      bucket.tokens -= 1;
      return true;
    },
    reset: () => clients.clear(),
  };
};

describe('Server Security & Media Invariants', () => {
  it('strictly excludes SVGs from allowed upload mime types and extensions to prevent stored XSS', () => {
    expect(ALLOWED_MIME_TYPES.has('image/svg+xml')).toBe(false);
    expect(ALLOWED_EXTENSIONS.has('.svg')).toBe(false);
    expect(EXTENSION_TYPES['.svg']).toBeUndefined();
  });

  it('permits standard safe raster image formats', () => {
    expect(ALLOWED_MIME_TYPES.has('image/png')).toBe(true);
    expect(ALLOWED_MIME_TYPES.has('image/jpeg')).toBe(true);
    expect(ALLOWED_MIME_TYPES.has('image/webp')).toBe(true);
    expect(ALLOWED_MIME_TYPES.has('image/gif')).toBe(true);

    expect(ALLOWED_EXTENSIONS.has('.png')).toBe(true);
    expect(ALLOWED_EXTENSIONS.has('.jpg')).toBe(true);
    expect(ALLOWED_EXTENSIONS.has('.jpeg')).toBe(true);
    expect(ALLOWED_EXTENSIONS.has('.webp')).toBe(true);
  });

  it('permits standard audio formats for voice annotations', () => {
    expect(ALLOWED_MIME_TYPES.has('audio/webm')).toBe(true);
    expect(ALLOWED_MIME_TYPES.has('audio/mp4')).toBe(true);
    expect(ALLOWED_MIME_TYPES.has('audio/wav')).toBe(true);

    expect(ALLOWED_EXTENSIONS.has('.webm')).toBe(true);
    expect(ALLOWED_EXTENSIONS.has('.mp4')).toBe(true);
    expect(ALLOWED_EXTENSIONS.has('.wav')).toBe(true);
    expect(ALLOWED_EXTENSIONS.has('.mp3')).toBe(true);
  });

  it('maps extensions directly to canonical Content-Type overrides', () => {
    expect(EXTENSION_TYPES['.png']).toBe('image/png');
    expect(EXTENSION_TYPES['.jpg']).toBe('image/jpeg');
    expect(EXTENSION_TYPES['.webm']).toBe('audio/webm');
    expect(EXTENSION_TYPES['.unknown']).toBeUndefined();
  });
});

describe('Document & Room Validation', () => {
  const isValidRoomId = (roomId: string) => /^[a-zA-Z0-9_-]{1,128}$/.test(roomId);

  it('accepts valid alphanumeric, hyphenated and underscored room IDs', () => {
    expect(isValidRoomId('design-system-2026')).toBe(true);
    expect(isValidRoomId('room_alpha_1')).toBe(true);
    expect(isValidRoomId('a')).toBe(true);
  });

  it('rejects path-traversal attempts and illegal characters', () => {
    expect(isValidRoomId('../secrets')).toBe(false);
    expect(isValidRoomId('room/with/slashes')).toBe(false);
    expect(isValidRoomId('room?query=1')).toBe(false);
    expect(isValidRoomId('')).toBe(false);
    expect(isValidRoomId('a'.repeat(129))).toBe(false);
  });
});

describe('Token Bucket Rate Limiter', () => {
  it('allows bursts up to maxTokens and rejects excess requests', () => {
    const limiter = createTestRateLimiter(5, 1);
    const now = 1000000;

    // First 5 requests should pass
    for (let i = 0; i < 5; i++) {
      expect(limiter.check('127.0.0.1', now)).toBe(true);
    }

    // 6th request within the same millisecond should be throttled
    expect(limiter.check('127.0.0.1', now)).toBe(false);
  });

  it('refills tokens over elapsed time', () => {
    const limiter = createTestRateLimiter(5, 2); // 2 tokens per second
    const now = 1000000;

    for (let i = 0; i < 5; i++) {
      limiter.check('127.0.0.1', now);
    }
    expect(limiter.check('127.0.0.1', now)).toBe(false);

    // Advance by 1 second (should refill 2 tokens)
    const later = now + 1000;
    expect(limiter.check('127.0.0.1', later)).toBe(true);
    expect(limiter.check('127.0.0.1', later)).toBe(true);
    expect(limiter.check('127.0.0.1', later)).toBe(false);
  });

  it('isolates different client IPs', () => {
    const limiter = createTestRateLimiter(2, 1);
    const now = 1000000;

    expect(limiter.check('client-a', now)).toBe(true);
    expect(limiter.check('client-a', now)).toBe(true);
    expect(limiter.check('client-a', now)).toBe(false);

    // client-b has its own independent bucket
    expect(limiter.check('client-b', now)).toBe(true);
    expect(limiter.check('client-b', now)).toBe(true);
  });
});

describe('Time Travel & Replay Baseline Folding', () => {
  it('correctly folds pruned incremental Yjs updates into a baseline document', () => {
    // Simulate authoring 3 nodes across sequential updates
    const liveDoc = new Y.Doc();
    const map = liveDoc.getMap('objects');

    const updates: Uint8Array[] = [];

    liveDoc.on('update', (update) => {
      updates.push(update);
    });

    liveDoc.transact(() => {
      const nodeA = new Y.Map();
      nodeA.set('id', 'node-1');
      nodeA.set('type', 'sticky');
      nodeA.set('text', 'Initial idea');
      map.set('node-1', nodeA);
    });

    liveDoc.transact(() => {
      const nodeB = new Y.Map();
      nodeB.set('id', 'node-2');
      nodeB.set('type', 'shape');
      nodeB.set('width', 200);
      map.set('node-2', nodeB);
    });

    liveDoc.transact(() => {
      const nodeA = map.get('node-1') as Y.Map<unknown>;
      nodeA.set('text', 'Updated idea');
    });

    expect(updates.length).toBe(3);

    // Simulate pruning the first 2 updates into replay_base
    const doomedUpdates = updates.slice(0, 2);
    const retainedUpdates = updates.slice(2);

    const baseDoc = new Y.Doc();
    for (const update of doomedUpdates) {
      Y.applyUpdate(baseDoc, update);
    }
    const replayBaseBytes = Y.encodeStateAsUpdate(baseDoc);
    baseDoc.destroy();

    // Now reconstruct replay from baseline + retained updates
    const replayDoc = new Y.Doc();
    Y.applyUpdate(replayDoc, replayBaseBytes);

    for (const update of retainedUpdates) {
      Y.applyUpdate(replayDoc, update);
    }

    const replayMap = replayDoc.getMap('objects');
    expect(replayMap.has('node-1')).toBe(true);
    expect(replayMap.has('node-2')).toBe(true);

    const replayedNode1 = replayMap.get('node-1') as Y.Map<unknown>;
    expect(replayedNode1.get('text')).toBe('Updated idea');

    const replayedNode2 = replayMap.get('node-2') as Y.Map<unknown>;
    expect(replayedNode2.get('width')).toBe(200);

    liveDoc.destroy();
    replayDoc.destroy();
  });
});
