import { describe, expect, it } from 'vitest';
import {
  LIBRARY_KIND,
  looksLikeLibrary,
  mergeLibrary,
  parseLibrary,
  serializeLibrary,
  type LibraryBoard,
} from './libraryIndex';

const b = (id: string, lastAccessed: number, name = id): LibraryBoard => ({ id, name, lastAccessed });

describe('a library file round-trips', () => {
  it('survives serialize and parse', () => {
    const text = serializeLibrary([b('a', 300)], [{ ...b('c', 100), removedAt: 900 }]);
    const out = parseLibrary(text);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.file.boards).toEqual([b('a', 300)]);
    expect(out.file.removed[0].removedAt).toBe(900);
  });

  it('carries the removed shelf too', () => {
    // The shelf is the record of addresses this device stopped keeping, and it
    // is the half most worth having in a file: those are precisely the boards
    // no longer reachable from the grid.
    const text = serializeLibrary([], [{ ...b('gone', 1), removedAt: 5 }]);
    const out = parseLibrary(text);
    expect(out.ok && out.file.removed).toHaveLength(1);
  });
});

describe('a library file says what it is', () => {
  it('is recognised before it is read', () => {
    expect(looksLikeLibrary(serializeLibrary([b('a', 1)], []))).toBe(true);
  });

  it('does not claim a board export', () => {
    /**
     * The discriminator earns its place here. A board export and a library
     * index are both JSON with an array in them, arriving through the same
     * picker and the same drop target — told apart by shape, one gets opened
     * as the other and reports an error about the wrong file.
     */
    expect(looksLikeLibrary('{"document":{"nodes":[]}}')).toBe(false);
    expect(looksLikeLibrary('not json at all')).toBe(false);
  });

  it('refuses a file that is not one', () => {
    const out = parseLibrary('{"kind":"something-else","boards":[]}');
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toContain('not a Vega Studio board list');
  });

  it('says so when the list is empty rather than succeeding silently', () => {
    const out = parseLibrary(JSON.stringify({ kind: LIBRARY_KIND, boards: [], removed: [] }));
    expect(out.ok).toBe(false);
  });
});

describe('parsing keeps the address above everything else', () => {
  it('drops entries with no id, because the id is the board', () => {
    const out = parseLibrary(JSON.stringify({ kind: LIBRARY_KIND, boards: [{ name: 'no id' }, b('ok', 1)] }));
    expect(out.ok && out.file.boards.map((x) => x.id)).toEqual(['ok']);
  });

  it('keeps an entry whose date is missing or nonsense', () => {
    // The id cannot be reconstructed; a timestamp can be lived without.
    // Refusing the whole board over its date throws away the address in order
    // to protect a sort order.
    const out = parseLibrary(JSON.stringify({ kind: LIBRARY_KIND, boards: [{ id: 'x', name: 'X' }] }));
    expect(out.ok && out.file.boards[0]).toEqual({ id: 'x', name: 'X', lastAccessed: 0 });
  });

  it('names an entry that arrived without one', () => {
    const out = parseLibrary(JSON.stringify({ kind: LIBRARY_KIND, boards: [{ id: 'x' }] }));
    expect(out.ok && out.file.boards[0].name).toBe('Untitled board');
  });
});

describe('loading a list merges, and never removes', () => {
  it('adds what this device did not have', () => {
    const out = mergeLibrary([b('a', 10)], [b('b', 20)]);
    expect(out.added).toBe(1);
    expect(out.boards.map((x) => x.id)).toEqual(['b', 'a']);
  });

  it('never drops a board this device holds', () => {
    /**
     * The property the whole feature rests on. A file saved before three
     * boards were opened must not take those three addresses away — that is
     * exactly the unrecoverable loss the shelf exists to prevent, and doing it
     * as a side effect of an action taken to be *safer* is the worst version
     * of it.
     */
    const mine = [b('a', 10), b('b', 20), b('c', 30)];
    const out = mergeLibrary(mine, [b('z', 5)]);
    for (const m of mine) expect(out.boards.some((x) => x.id === m.id)).toBe(true);
  });

  it('counts only genuinely new addresses', () => {
    expect(mergeLibrary([b('a', 10)], [b('a', 99)]).added).toBe(0);
  });

  it('keeps the more recent visit when both know the board', () => {
    const out = mergeLibrary([b('a', 10, 'old name')], [b('a', 99, 'new name')]);
    expect(out.boards[0]).toEqual(b('a', 99, 'new name'));
  });

  it('leaves the older record alone when the file is behind', () => {
    const out = mergeLibrary([b('a', 99, 'current')], [b('a', 10, 'stale')]);
    expect(out.boards[0].name).toBe('current');
  });

  it('orders by last visit, so the grid is not left in an order nothing chose', () => {
    const out = mergeLibrary([b('a', 10)], [b('b', 30), b('c', 20)]);
    expect(out.boards.map((x) => x.id)).toEqual(['b', 'c', 'a']);
  });

  it('is idempotent', () => {
    const once = mergeLibrary([b('a', 10)], [b('b', 20)]);
    const twice = mergeLibrary(once.boards, [b('b', 20)]);
    expect(twice.boards).toEqual(once.boards);
    expect(twice.added).toBe(0);
  });
});
