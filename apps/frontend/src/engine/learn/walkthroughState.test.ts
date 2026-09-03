import { beforeEach, describe, expect, it, vi } from 'vitest';
import { walkthroughState } from './walkthroughState';
import { learnState } from './learnState';
import type { Snapshot } from './walkthrough';
import type { AnyNode } from '../model/schema';

/**
 * The sequencing, which is where a walkthrough can go wrong in ways the pure
 * observation functions cannot.
 *
 * Two of these are about *when* the digest is taken, and they are the whole
 * reason it lives in the store rather than in the component. A digest taken
 * once at the start would let everything the first step created count toward
 * the second; a digest taken lazily on the first observation would let
 * whatever was already on the board count toward the first.
 */

const node = (id: string, type = 'shape'): AnyNode =>
  ({ id, type, x: 0, y: 0, width: 10, height: 10 }) as unknown as AnyNode;

const snap = (nodes: AnyNode[], selected: string[] = []): Snapshot => ({
  objects: Object.fromEntries(nodes.map((n) => [n.id, n])),
  selected,
});

/** The sticky walkthrough: make a note, then chain a second one. */
const STICKY = 'sticky-chain';

/**
 * A working store, because the one in this environment is a bare object.
 *
 * `localStorage` here has no `getItem` at all, which the module's own
 * `try`/`catch` swallows — so without this every persistence assertion would
 * pass vacuously against a store that never held anything. Installing a real
 * one is the difference between testing the behaviour and testing the guard.
 */
function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  };
}

beforeEach(() => {
  walkthroughState.stop();
  vi.stubGlobal('localStorage', memoryStorage());
});

describe('starting', () => {
  it('does nothing for a lesson with no walkthrough', () => {
    walkthroughState.start('offline', snap([]));
    expect(walkthroughState.getSnapshot().walk).toBeNull();
  });

  it('takes the board as it stands, so what is there already does not count', () => {
    /**
     * Start the sticky walkthrough on a board that already has sticky notes on
     * it. Step one asks for a note; the notes already present are not it.
     * Without a digest at start, the first observation would find them and the
     * reader would watch step one complete itself.
     */
    const board = snap([node('old-1', 'sticky'), node('old-2', 'sticky')]);
    walkthroughState.start(STICKY, board);

    expect(walkthroughState.observe(board)).toBe(false);
    expect(walkthroughState.getSnapshot().index).toBe(0);
  });
});

describe('advancing', () => {
  it('moves on when the gesture happens, and not before', () => {
    walkthroughState.start(STICKY, snap([]));
    expect(walkthroughState.getSnapshot().index).toBe(0);

    // A shape is not a sticky note.
    expect(walkthroughState.observe(snap([node('a')]))).toBe(false);
    expect(walkthroughState.getSnapshot().index).toBe(0);

    expect(walkthroughState.observe(snap([node('a'), node('s1', 'sticky')]))).toBe(true);
    expect(walkthroughState.getSnapshot().index).toBe(1);
  });

  it('re-takes the digest, so the first step cannot satisfy the second', () => {
    /**
     * The bug this prevents is silent and would make the feature look finished:
     * both steps of the sticky walkthrough ask for a new note, so a digest kept
     * from the start would see the note made for step one still sitting there
     * and complete step two on the same frame. The walkthrough would flash past
     * and mark itself done.
     */
    walkthroughState.start(STICKY, snap([]));
    const afterFirst = snap([node('s1', 'sticky')]);
    walkthroughState.observe(afterFirst);
    expect(walkthroughState.getSnapshot().index).toBe(1);

    // The same board again. Nothing new has happened.
    expect(walkthroughState.observe(afterFirst)).toBe(false);
    expect(walkthroughState.getSnapshot().walk, 'it finished on its own').not.toBeNull();

    // Now a second note.
    expect(walkthroughState.observe(snap([node('s1', 'sticky'), node('s2', 'sticky')]))).toBe(true);
    expect(walkthroughState.getSnapshot().walk, 'it should have finished').toBeNull();
  });
});

describe('finishing', () => {
  it('records it, and retires the lesson behind it', () => {
    walkthroughState.start(STICKY, snap([]));
    walkthroughState.observe(snap([node('s1', 'sticky')]));
    walkthroughState.observe(snap([node('s1', 'sticky'), node('s2', 'sticky')]));

    expect(walkthroughState.isDone(STICKY)).toBe(true);
    // Otherwise finishing the walkthrough for sticky notes would be followed
    // by a coach mark offering to teach sticky notes.
    expect(learnState.isLearned(STICKY)).toBe(true);
  });

  it('survives a reload, because completion is the part worth persisting', () => {
    walkthroughState.start(STICKY, snap([]));
    walkthroughState.observe(snap([node('s1', 'sticky')]));
    walkthroughState.observe(snap([node('s1', 'sticky'), node('s2', 'sticky')]));
    expect(JSON.parse(localStorage.getItem('vega_walkthroughs_v1') ?? '[]')).toContain(STICKY);
  });
});

describe('leaving', () => {
  it('does not count as having done it', () => {
    // Somebody who stops halfway has not performed the gestures. Marking it
    // done would take the walkthrough off the shelf on the strength of them
    // having opened it.
    //
    // A different walkthrough from the one `finishing` completes, deliberately:
    // `done` is module state that outlives a single test, so asserting "not
    // done" on the one another test finishes would pass or fail on file order.
    const LINE = 'line-route';
    walkthroughState.start(LINE, snap([]));
    walkthroughState.observe(snap([node('a')]));
    walkthroughState.stop();

    expect(walkthroughState.getSnapshot().walk).toBeNull();
    expect(walkthroughState.isDone(LINE)).toBe(false);
  });

  it('ignores an observation once nothing is running', () => {
    walkthroughState.stop();
    expect(walkthroughState.observe(snap([node('s1', 'sticky')]))).toBe(false);
  });
});

describe('subscribers', () => {
  it('are told when a step lands', () => {
    let calls = 0;
    const off = walkthroughState.subscribe(() => calls++);
    walkthroughState.start(STICKY, snap([]));
    const at = calls;
    walkthroughState.observe(snap([node('s1', 'sticky')]));
    expect(calls).toBeGreaterThan(at);
    off();
  });
});
