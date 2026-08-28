import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { createRateLimiter } from './rateLimit';

/**
 * What is left in this file is the replay-baseline fold, which is the one
 * behaviour here that is a property of the *algorithm* rather than of a module.
 *
 * The rest moved. This file used to open with its own copies of
 * `ALLOWED_MIME_TYPES`, `ALLOWED_EXTENSIONS`, `EXTENSION_TYPES`, the room-id
 * regex and the token bucket -- transcribed from `index.ts` and asserted
 * against. That tests the transcription: deleting an entry from the server and
 * forgetting the copy here leaves a green suite describing the behaviour of
 * code that no longer exists, which is worse than no test at all because it
 * reads like coverage. Those now live in `media.ts`, `rooms.ts` and
 * `rateLimit.ts` and are asserted against the real thing in
 * `server.units.test.ts`.
 */

describe('Token Bucket Rate Limiter', () => {
  it('allows bursts up to maxTokens and rejects excess requests', () => {
    const limiter = createRateLimiter(5, 1);
    const now = 1000000;

    for (let i = 0; i < 5; i++) {
      expect(limiter.take('127.0.0.1', now)).toBe(true);
    }

    // The sixth within the same millisecond is throttled.
    expect(limiter.take('127.0.0.1', now)).toBe(false);
  });

  it('refills tokens over elapsed time', () => {
    const limiter = createRateLimiter(5, 2); // 2 tokens per second
    const now = 1000000;

    for (let i = 0; i < 5; i++) limiter.take('127.0.0.1', now);
    expect(limiter.take('127.0.0.1', now)).toBe(false);

    // One second later, two tokens back.
    const later = now + 1000;
    expect(limiter.take('127.0.0.1', later)).toBe(true);
    expect(limiter.take('127.0.0.1', later)).toBe(true);
    expect(limiter.take('127.0.0.1', later)).toBe(false);
  });

  it('isolates different client IPs', () => {
    const limiter = createRateLimiter(2, 1);
    const now = 1000000;

    expect(limiter.take('client-a', now)).toBe(true);
    expect(limiter.take('client-a', now)).toBe(true);
    expect(limiter.take('client-a', now)).toBe(false);

    // client-b has its own independent bucket.
    expect(limiter.take('client-b', now)).toBe(true);
    expect(limiter.take('client-b', now)).toBe(true);
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
