import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { commenterMayApply } from './commenterFilter';

/**
 * A board shaped like the client's: nodes in `objects`, each a Y.Map with a
 * `reactions` Y.Array, and threads in `comments`.
 */
function board(): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    const node = new Y.Map<unknown>();
    node.set('id', 'n1');
    node.set('x', 10);
    node.set('reactions', new Y.Array<string>());
    doc.getMap('objects').set('n1', node);
    const thread = new Y.Map<unknown>();
    thread.set('id', 't1');
    doc.getMap('comments').set('t1', thread);
  });
  return doc;
}

/** What a client holding a copy of `server` sends after running `edit`. */
function updateFrom(server: Y.Doc, edit: (client: Y.Doc) => void): Uint8Array {
  const client = new Y.Doc();
  Y.applyUpdate(client, Y.encodeStateAsUpdate(server));
  const before = Y.encodeStateVector(client);
  edit(client);
  return Y.encodeStateAsUpdate(client, before);
}

const node = (doc: Y.Doc) => doc.getMap<Y.Map<unknown>>('objects').get('n1')!;

describe('commenterMayApply', () => {
  it('allows a new comment thread and a reply', () => {
    const server = board();
    const update = updateFrom(server, (c) => {
      const thread = new Y.Map<unknown>();
      thread.set('id', 't2');
      c.getMap('comments').set('t2', thread);
      (c.getMap('comments').get('t1') as Y.Map<unknown>).set('resolved', true);
    });
    expect(commenterMayApply(server, update)).toEqual({ ok: true });
  });

  it('allows deleting a comment thread', () => {
    const server = board();
    const update = updateFrom(server, (c) => c.getMap('comments').delete('t1'));
    expect(commenterMayApply(server, update)).toEqual({ ok: true });
  });

  it('allows a reaction exactly as the client writes one', () => {
    const server = board();
    const update = updateFrom(server, (c) => {
      c.transact(() => {
        (node(c).get('reactions') as Y.Array<string>).push(['👍|me']);
        node(c).set('updatedAt', Date.now());
      });
    });
    expect(commenterMayApply(server, update)).toEqual({ ok: true });
  });

  it('allows upgrading a legacy note to the reactions array', () => {
    const server = new Y.Doc();
    const legacy = new Y.Map<unknown>();
    legacy.set('reactions', { '👍': ['a'] });
    server.getMap('objects').set('n1', legacy);
    const update = updateFrom(server, (c) => node(c).set('reactions', new Y.Array<string>()));
    expect(commenterMayApply(server, update)).toEqual({ ok: true });
  });

  it('refuses moving a node', () => {
    const server = board();
    const update = updateFrom(server, (c) => node(c).set('x', 999));
    expect(commenterMayApply(server, update)).toMatchObject({ ok: false });
  });

  it('refuses creating or deleting a node', () => {
    const server = board();
    const create = updateFrom(server, (c) => c.getMap('objects').set('n2', new Y.Map()));
    const remove = updateFrom(server, (c) => c.getMap('objects').delete('n1'));
    expect(commenterMayApply(server, create)).toMatchObject({ ok: false });
    expect(commenterMayApply(server, remove)).toMatchObject({ ok: false });
  });

  it('refuses a reaction smuggled in with an edit', () => {
    const server = board();
    const update = updateFrom(server, (c) => {
      c.transact(() => {
        (node(c).get('reactions') as Y.Array<string>).push(['👍|me']);
        node(c).set('text', 'defaced');
      });
    });
    expect(commenterMayApply(server, update)).toMatchObject({ ok: false });
  });

  it('refuses other roots, including ones that did not exist', () => {
    const server = board();
    for (const root of ['groups', 'metadata', 'history', 'brand-new']) {
      const update = updateFrom(server, (c) => c.getMap(root).set('k', 'v'));
      expect(commenterMayApply(server, update), root).toMatchObject({ ok: false });
    }
  });

  it('refuses an update that depends on changes the server has not seen', () => {
    const server = board();
    // A client ahead of the server: its second edit depends on its first,
    // which is never sent. Applied, the second would sit pending until
    // somebody else's update completed it, past this check.
    const client = new Y.Doc();
    Y.applyUpdate(client, Y.encodeStateAsUpdate(server));
    const thread = new Y.Map<unknown>();
    client.getMap('comments').set('t3', thread);
    const afterFirst = Y.encodeStateVector(client);
    thread.set('text', 'hello');
    const secondOnly = Y.encodeStateAsUpdate(client, afterFirst);
    expect(commenterMayApply(server, secondOnly)).toMatchObject({ ok: false });
  });

  it('leaves the server document untouched', () => {
    const server = board();
    const before = Y.encodeStateAsUpdate(server);
    commenterMayApply(server, updateFrom(server, (c) => node(c).set('x', 1)));
    expect(Y.encodeStateAsUpdate(server)).toEqual(before);
  });
});
