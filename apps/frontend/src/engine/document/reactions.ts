/**
 * Sticky reactions, as a CRDT structure.
 *
 * **This module imports Yjs and the normalizer and nothing else** — in
 * particular not `doc.ts`, which builds the provider and touches `window`.
 * Same rule as the physics simulation, for the same reason: the only
 * interesting behaviour here is what happens when two people act at once, and
 * that can only be tested by driving two real documents in Node. `mutations.ts`
 * is the adapter that finds a node in *the* document and opens a transaction.
 *
 * ## Why reactions are stored differently from every other field
 *
 * Every other field on a node — position, text, colour — is edited by one
 * person at a time, so a plain value with last-write-wins is both correct and
 * simplest. Reactions are the opposite: they are *designed* to be written by
 * several people in the same instant.
 *
 * As `emoji → count`, incremented on click, two people reacting simultaneously
 * both read the same number, both wrote number + 1, and one reaction silently
 * vanished.
 *
 * ## Why it is one flat array and not a map of arrays
 *
 * `Y.Map<emoji, Y.Array<authorId>>` looks like the natural shape and is a
 * trap. **Concurrent `set` on the same key is last-write-wins**, so any
 * container created on demand can be created twice and one copy — with the
 * reaction inside it — is thrown away. That bites twice: once when two people
 * react to a brand-new note, and again when two people react with the same
 * *new* emoji to any note. Seeding the outer map at creation fixes only the
 * first.
 *
 * One `Y.Array<string>` of `emoji\0authorId` entries has exactly one container,
 * created once with the node. Every operation after that is an insert or a
 * delete on that array, and Yjs merges both. There is no key to race for.
 *
 * Both failures above were found by the tests in `reactions.test.ts`, after the
 * nested version had been written and looked obviously correct.
 */

import * as Y from 'yjs';
import { encodeReaction, normalizeReactions } from './normalize';

/**
 * Install the `reactions` container on a node being created.
 *
 * Called from `createNode` inside its transaction. Anything that creates a
 * sticky must go through it, or the first two concurrent reactions on that
 * note race to create the container and one is lost.
 */
export function seedReactions(ymap: Y.Map<unknown>, initial?: unknown): void {
  const list = new Y.Array<string>();
  const entries: string[] = [];
  for (const [emoji, ids] of Object.entries(normalizeReactions(initial))) {
    for (const id of ids) entries.push(encodeReaction(emoji, id));
  }
  if (entries.length) list.push(entries);
  ymap.set('reactions', list);
}

/**
 * Add `authorId` to an emoji's reactors, or remove it if already there.
 *
 * Idempotent per person: reacting twice with the same emoji leaves you having
 * reacted once and then not at all — never twice.
 */
export function applyReactionToggle(
  ymap: Y.Map<unknown>,
  emoji: string,
  authorId: string
): void {
  if (!emoji || !authorId) return;

  let list = ymap.get('reactions');

  // A note written before this shape existed. Upgraded on first use, which is
  // the one remaining place two clients can race — and only ever once per
  // legacy note, with the loser's reaction recoverable by clicking again.
  if (!(list instanceof Y.Array)) {
    seedReactions(ymap, list);
    list = ymap.get('reactions');
  }

  const array = list as Y.Array<string>;
  const token = encodeReaction(emoji, authorId);
  const index = array.toArray().indexOf(token);

  // `delete` by index is safe under concurrency: Yjs resolves it against the
  // item that was at that position locally, not against whatever slides into
  // the slot once someone else's insert merges in.
  if (index === -1) array.push([token]);
  else array.delete(index, 1);

  ymap.set('updatedAt', Date.now());
}
