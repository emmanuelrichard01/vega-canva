import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as Y from 'yjs';

/**
 * Does a restore actually reach anybody else?
 *
 * The reported symptom: a board restored from a backup looks complete to the
 * person who restored it and empty to everybody they share it with. That is a
 * *sync* claim, and it cannot be tested by inspecting the document the restore
 * wrote — which is why it went unnoticed. It needs a second document that has
 * only ever seen what travelled over the wire.
 *
 * Two second-documents are needed, because collaborators arrive by two routes
 * and they are not the same bytes:
 *
 * - **Live** — already connected, receiving incremental `update` events as the
 *   transaction commits. This is the person watching while you restore.
 * - **Later** — connecting afterwards and loading the server's stored
 *   snapshot, which is `encodeStateAsUpdate` of the room. This is the person
 *   who opens the link an hour later, and it is the one that matters for a
 *   shared link.
 *
 * A restore that satisfies one and not the other is exactly the shape of bug
 * that produces "fine on my end".
 */
vi.mock('../document/doc', async () => {
  const Y2 = await import('yjs');
  const doc = new Y2.Doc();
  return {
    doc,
    objectsMap: doc.getMap('objects'),
    groupsMap: doc.getMap('groups'),
    identitiesMap: doc.getMap('identities'),
    commentsMap: doc.getMap('comments'),
    metadataMap: doc.getMap('metadata'),
    provider: {
      awareness: {
        getLocalState: () => ({}),
        setLocalStateField: () => {},
        getStates: () => new Map(),
      },
    },
  };
});

const { restoreDocument } = await import('./restoreDocument');
const { doc, objectsMap } = await import('../document/doc');

const shape = (id: string, x: number) => ({
  id,
  type: 'shape',
  x,
  y: 0,
  width: 40,
  height: 40,
  geometry: { kind: 'rect' },
});

const importedFile = (ids: readonly string[]) => ({
  nodes: Object.fromEntries(ids.map((id, i) => [id, shape(id, i * 60)])),
  comments: [],
  title: 'Restored board',
});

describe('a restore reaches other people', () => {
  beforeEach(() => {
    Array.from(objectsMap.keys()).forEach((k) => objectsMap.delete(k));
  });

  it('reaches somebody already connected', () => {
    const live = new Y.Doc();
    // Seed the peer the way a real one starts: holding the same board.
    Y.applyUpdate(live, Y.encodeStateAsUpdate(doc));

    const seen: Uint8Array[] = [];
    const relay = (update: Uint8Array) => seen.push(update);
    doc.on('update', relay);

    restoreDocument(importedFile(['a', 'b', 'c']) as never, 'replace');

    doc.off('update', relay);
    seen.forEach((u) => Y.applyUpdate(live, u));

    expect(objectsMap.size).toBe(3);
    expect(live.getMap('objects').size).toBe(3);
    expect(live.getMap('metadata').get('name')).toBe('Restored board');
  });

  /**
   * The one that matters for a shared link: a person opening the board later
   * gets the server's stored snapshot and nothing else.
   */
  it('reaches somebody who opens the link afterwards', () => {
    restoreDocument(importedFile(['a', 'b', 'c']) as never, 'replace');

    // Exactly what the server's `Database.store` writes and `fetch` returns.
    const snapshot = Y.encodeStateAsUpdate(doc);
    const later = new Y.Doc();
    Y.applyUpdate(later, snapshot);

    expect(later.getMap('objects').size).toBe(3);
    expect(later.getMap('metadata').get('name')).toBe('Restored board');
  });

  /**
   * Replace deletes every existing object and writes the imported ones back
   * under **the same ids**, all inside one transaction. Deleting and re-adding
   * one key in a single Yjs transaction is the part most likely to encode into
   * something a peer resolves differently, so it gets its own case rather than
   * riding on the empty-board path above.
   */
  it('survives replacing a board with one that reuses its ids', () => {
    restoreDocument(importedFile(['a', 'b']) as never, 'replace');

    const live = new Y.Doc();
    Y.applyUpdate(live, Y.encodeStateAsUpdate(doc));
    expect(live.getMap('objects').size).toBe(2);

    const seen: Uint8Array[] = [];
    const relay = (u: Uint8Array) => seen.push(u);
    doc.on('update', relay);

    // Same ids, different contents — a backup of this board restored over it.
    restoreDocument(importedFile(['a', 'b']) as never, 'replace');

    doc.off('update', relay);
    seen.forEach((u) => Y.applyUpdate(live, u));

    expect(objectsMap.size).toBe(2);
    expect(live.getMap('objects').size).toBe(2);

    // And a fresh joiner agrees with the live peer.
    const later = new Y.Doc();
    Y.applyUpdate(later, Y.encodeStateAsUpdate(doc));
    expect(later.getMap('objects').size).toBe(2);
  });
});
