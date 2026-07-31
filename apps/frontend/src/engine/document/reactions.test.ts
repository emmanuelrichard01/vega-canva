import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { applyReactionToggle, seedReactions } from './reactions';
import { normalizeReactions } from './normalize';

/**
 * A document holding one sticky, built the way `createNode` builds one — the
 * reactions container seeded up front. A helper that skips that step is
 * testing a node the app never creates, and will report a bug in the seeding
 * as a bug in the toggling.
 */
function makeClient(initialReactions?: unknown) {
  const doc = new Y.Doc();
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const node = new Y.Map<unknown>();
  doc.transact(() => {
    node.set('id', 's1');
    node.set('type', 'sticky');
    seedReactions(node, initialReactions);
    objects.set('s1', node);
  });
  return { doc, node };
}

/** A sticky written by an older client: `reactions` is a plain value. */
function makeLegacyClient(reactions: unknown) {
  const doc = new Y.Doc();
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const node = new Y.Map<unknown>();
  doc.transact(() => {
    node.set('id', 's1');
    node.set('type', 'sticky');
    node.set('reactions', reactions);
    objects.set('s1', node);
  });
  return { doc, node };
}

/** Exchange updates both ways, as a sync server would. */
function sync(a: Y.Doc, b: Y.Doc) {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
}

/**
 * Two clients looking at **one** sticky.
 *
 * The note is created once and replicated, which is what actually happens: one
 * person drops it and everyone else receives it. Creating a node with the same
 * id independently in both documents instead is a different scenario entirely
 * — concurrent `set` on the same map key, where one whole `Y.Map` is discarded
 * — and it makes these tests fail for a reason that has nothing to do with
 * reactions.
 */
function makePair(initialReactions?: unknown) {
  const author = makeClient(initialReactions);
  const peerDoc = new Y.Doc();
  sync(author.doc, peerDoc);

  const peerNode = peerDoc.getMap<Y.Map<unknown>>('objects').get('s1')!;
  return {
    a: { doc: author.doc, node: author.node },
    b: { doc: peerDoc, node: peerNode },
    sync: () => sync(author.doc, peerDoc),
  };
}

const reactionsOf = (node: Y.Map<unknown>) =>
  normalizeReactions((node.toJSON() as { reactions?: unknown }).reactions);

describe('reaction toggling', () => {
  it('adds your id, and removes it when you pick the same emoji again', () => {
    const { node } = makeClient();

    applyReactionToggle(node, '👍', 'ada');
    expect(reactionsOf(node)).toEqual({ '👍': ['ada'] });

    applyReactionToggle(node, '👍', 'ada');
    expect(reactionsOf(node)).toEqual({});
  });

  it('cannot be stacked by one person', () => {
    // The bug this replaces: `count + 1` per click let one person react five
    // times and show "👍 5".
    const { node } = makeClient();
    for (let i = 0; i < 5; i++) applyReactionToggle(node, '👍', 'ada');
    expect(reactionsOf(node)['👍']).toEqual(['ada']);
  });

  it('drops an emoji once its last reactor leaves, rather than showing an empty chip', () => {
    const { node } = makeClient();
    applyReactionToggle(node, '🎉', 'ada');
    applyReactionToggle(node, '🎉', 'dana');
    applyReactionToggle(node, '🎉', 'ada');
    expect(reactionsOf(node)).toEqual({ '🎉': ['dana'] });
    applyReactionToggle(node, '🎉', 'dana');
    expect(reactionsOf(node)).toEqual({});
  });

  it('upgrades a legacy count in place, keeping the tally', () => {
    const { node } = makeLegacyClient({ '👍': 2 });
    applyReactionToggle(node, '👍', 'ada');
    const after = reactionsOf(node)['👍'];
    expect(after).toHaveLength(3);
    expect(after).toContain('ada');
    // The two it inherited cannot be attributed, so nobody can un-react them.
    expect(after.filter((id) => id.startsWith('legacy:'))).toHaveLength(2);
  });

  it('keeps both reactions when two people react at the same moment', () => {
    // The headline fix. With a bare count, both clients read the same number,
    // both wrote number + 1, and whichever update arrived second erased the
    // other — in the one feature that exists to be used simultaneously.
    const { a, b, sync: exchange } = makePair();

    // Neither has seen the other's write yet.
    applyReactionToggle(a.node, '👍', 'ada');
    applyReactionToggle(b.node, '👍', 'dana');

    exchange();

    const merged = reactionsOf(a.node)['👍'];
    expect(merged).toHaveLength(2);
    expect(merged).toEqual(expect.arrayContaining(['ada', 'dana']));
    // Both sides converge on the same answer, which is the other half of it.
    expect(reactionsOf(b.node)['👍']).toEqual(merged);
  });

  it('keeps concurrent reactions with different emoji', () => {
    const { a, b, sync: exchange } = makePair();

    applyReactionToggle(a.node, '👍', 'ada');
    applyReactionToggle(b.node, '🎉', 'dana');
    exchange();

    expect(reactionsOf(a.node)).toEqual({ '👍': ['ada'], '🎉': ['dana'] });
    expect(reactionsOf(b.node)).toEqual({ '👍': ['ada'], '🎉': ['dana'] });
  });

  it('lets one person remove their reaction while another adds one', () => {
    const { a, b, sync: exchange } = makePair();
    applyReactionToggle(a.node, '👍', 'ada');
    exchange();

    applyReactionToggle(a.node, '👍', 'ada'); // Ada takes hers back
    applyReactionToggle(b.node, '👍', 'dana'); // Dana adds one
    exchange();

    expect(reactionsOf(a.node)['👍']).toEqual(['dana']);
    expect(reactionsOf(b.node)['👍']).toEqual(['dana']);
  });

  it('ignores a toggle with no emoji or no author', () => {
    const { node } = makeClient();
    applyReactionToggle(node, '', 'ada');
    applyReactionToggle(node, '👍', '');
    expect(reactionsOf(node)).toEqual({});
  });
});
