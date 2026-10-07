import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  NAMES_KEY,
  RECENTS_KEY,
  batchIds,
  canEditBoard,
  changedSinceOpened,
  cleanBoardName,
  focusAfterRemoval,
  inviteExpired,
  libraryGroups,
  mutatePins,
  mutateRecents,
  readNames,
  readRecents,
  reconcileName,
  rememberBoard,
  upsertRecent,
  nextCell,
  presenceLine,
  togglePin,
  type CellRect,
} from './library';

const NOW = Date.UTC(2026, 9, 5, 12);
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const board = (id: string, name: string, agoMs: number) => ({ id, name, lastAccessed: NOW - agoMs });

describe('libraryGroups', () => {
  const boards = [
    board('a', 'Alpha', 5 * MIN),
    board('b', 'Bravo', 2 * DAY),
    board('c', 'Charlie', 40 * DAY),
    board('d', 'Delta', 10 * MIN),
  ];

  it('leads with pinned boards, newest pin first, and keeps them out of the rest', () => {
    const groups = libraryGroups(boards, { pins: { c: 1, b: 2 }, names: {}, sort: 'recent', query: '', now: NOW });
    expect(groups[0]).toMatchObject({ id: 'pinned', label: 'Pinned' });
    expect(groups[0].boards.map((b) => b.id)).toEqual(['b', 'c']);
    const rest = groups.slice(1).flatMap((g) => g.boards.map((b) => b.id));
    expect(rest).toEqual(['a', 'd']);
  });

  it('labels an otherwise unlabelled run that follows the pins', () => {
    const groups = libraryGroups(boards, { pins: { c: 1 }, names: {}, sort: 'recent', query: '', now: NOW });
    expect(groups[1].label).toBe('Recent');
  });

  it('has no pinned group when nothing is pinned', () => {
    const groups = libraryGroups(boards, { pins: {}, names: {}, sort: 'recent', query: '', now: NOW });
    expect(groups.some((g) => g.id === 'pinned')).toBe(false);
  });

  it('searches as one flat list that pins do not reorder, using local names', () => {
    const groups = libraryGroups(boards, { pins: { d: 1 }, names: { a: { name: 'Roadmap', sent: false } }, sort: 'recent', query: 'road', now: NOW });
    expect(groups).toHaveLength(1);
    expect(groups[0].boards.map((b) => b.name)).toEqual(['Roadmap']);
    expect(libraryGroups(boards, { pins: {}, names: {}, sort: 'recent', query: 'zzz', now: NOW })).toEqual([]);
  });

  it('sorts by name after the pins', () => {
    const groups = libraryGroups(boards, { pins: { a: 1 }, names: {}, sort: 'name', query: '', now: NOW });
    expect(groups.map((g) => g.label)).toEqual(['Pinned', 'All boards']);
    expect(groups[1].boards.map((b) => b.name)).toEqual(['Bravo', 'Charlie', 'Delta']);
  });
});

describe('togglePin', () => {
  it('pins and unpins without mutating the input', () => {
    const pins = {};
    const once = togglePin(pins, 'x', 7);
    expect(once).toEqual({ x: 7 });
    expect(pins).toEqual({});
    expect(togglePin(once, 'x')).toEqual({});
  });
});

describe('cleanBoardName', () => {
  it('collapses whitespace and refuses an empty name', () => {
    expect(cleanBoardName('  Q4   roadmap \n')).toBe('Q4 roadmap');
    expect(cleanBoardName('   ')).toBeNull();
    expect(cleanBoardName('x'.repeat(500))).toHaveLength(120);
  });
});

describe('nextCell', () => {
  // Two groups: a row of three, then a heading gap, then a row of two.
  const grid: CellRect[] = [
    { left: 0, top: 0, width: 100, height: 80 },
    { left: 110, top: 0, width: 100, height: 80 },
    { left: 220, top: 0, width: 100, height: 80 },
    { left: 0, top: 140, width: 100, height: 80 },
    { left: 110, top: 140, width: 100, height: 80 },
  ];

  it('steps through reading order with left and right, clamped at the ends', () => {
    expect(nextCell(grid, 1, 'ArrowRight')).toBe(2);
    expect(nextCell(grid, 2, 'ArrowRight')).toBe(3);
    expect(nextCell(grid, 0, 'ArrowLeft')).toBe(0);
    expect(nextCell(grid, 4, 'ArrowRight')).toBe(4);
  });

  it('moves down to the nearest card in the next row, across a group gap', () => {
    expect(nextCell(grid, 1, 'ArrowDown')).toBe(4);
    // The column has no card below it, so the nearest one in that row.
    expect(nextCell(grid, 2, 'ArrowDown')).toBe(4);
    expect(nextCell(grid, 3, 'ArrowDown')).toBe(3);
  });

  it('moves up the same way', () => {
    expect(nextCell(grid, 4, 'ArrowUp')).toBe(1);
    expect(nextCell(grid, 0, 'ArrowUp')).toBe(0);
  });

  it('works for a single-column list', () => {
    const list: CellRect[] = [0, 1, 2].map((i) => ({ left: 0, top: i * 52, width: 600, height: 52 }));
    expect(nextCell(list, 0, 'ArrowDown')).toBe(1);
    expect(nextCell(list, 2, 'ArrowUp')).toBe(1);
  });

  it('handles Home, End and an empty grid', () => {
    expect(nextCell(grid, 3, 'Home')).toBe(0);
    expect(nextCell(grid, 0, 'End')).toBe(4);
    expect(nextCell([], 0, 'ArrowDown')).toBe(-1);
  });
});

describe('presenceLine', () => {
  it('says how many, never who', () => {
    expect(presenceLine({ onlineCount: 0 })).toBeNull();
    expect(presenceLine({ onlineCount: 1 })).toBe('1 person here');
    expect(presenceLine({ onlineCount: 3 })).toBe('3 people here');
  });
});

describe('changedSinceOpened', () => {
  const b = board('a', 'Alpha', 60 * MIN);
  it('is true only for a stored change well after the last open', () => {
    const at = (ms: number) => ({ id: 'a', exists: true, updatedAt: new Date(ms).toISOString(), title: null, onlineCount: 0 });
    expect(changedSinceOpened(b, at(NOW))).toBe(true);
    expect(changedSinceOpened(b, at(b.lastAccessed + 30_000))).toBe(false);
    expect(changedSinceOpened(b, undefined)).toBe(false);
  });
});

/** A `localStorage` that two "tabs" can share, as the real one is shared. */
function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, String(v)); },
    removeItem: (k: string) => { data.delete(k); },
    clear: () => data.clear(),
    key: (i: number) => [...data.keys()][i] ?? null,
    get length() { return data.size; },
  };
}

describe('library storage', () => {
  const g = globalThis as { window?: unknown };
  let storage: ReturnType<typeof memoryStorage>;
  beforeEach(() => {
    storage = memoryStorage();
    g.window = { localStorage: storage };
  });
  afterEach(() => { delete g.window; });

  it('merges against what is stored, so another tab’s write survives', () => {
    rememberBoard(board('a', 'Alpha', 0));
    // This tab read the list before another tab added a board.
    const stale = readRecents();
    storage.setItem(RECENTS_KEY, JSON.stringify([board('b', 'Bravo', 0), ...stale]));
    mutateRecents((list) => list.map((r) => (r.id === 'a' ? { ...r, name: 'Alpha 2' } : r)));
    expect(readRecents().map((r) => [r.id, r.name])).toEqual([['b', 'Bravo'], ['a', 'Alpha 2']]);
  });

  it('never caps the list, and keeps every pinned board', () => {
    for (let i = 0; i < 40; i += 1) rememberBoard(board(`room${i}`, `Board ${i}`, 0));
    mutatePins(() => ({ room0: 1 }));
    expect(readRecents()).toHaveLength(40);
    expect(readRecents().some((r) => r.id === 'room0')).toBe(true);
  });

  it('keeps how a board was reached when a later visit does not say', () => {
    rememberBoard({ ...board('a', 'Alpha', 0), invite: 'tok', role: 'viewer' });
    rememberBoard(board('a', 'Alpha', 0));
    expect(readRecents()[0]).toMatchObject({ invite: 'tok', role: 'viewer' });
  });

  it('reads the older bare-string names and drops junk', () => {
    storage.setItem(NAMES_KEY, JSON.stringify({ a: 'Old style', b: { name: 'New', sent: true, was: 'Prev' }, c: 7, d: { name: ' ' } }));
    expect(readNames()).toEqual({ a: { name: 'Old style', sent: false }, b: { name: 'New', sent: true, was: 'Prev' } });
  });

  it('survives storage that throws', () => {
    g.window = { get localStorage() { throw new Error('blocked'); } };
    expect(readRecents()).toEqual([]);
    expect(() => rememberBoard(board('a', 'Alpha', 0))).not.toThrow();
  });
});

describe('upsertRecent', () => {
  it('moves the board to the front without duplicating it', () => {
    const list = [board('a', 'A', 0), board('b', 'B', 0)];
    expect(upsertRecent(list, board('b', 'B2', 0)).map((r) => r.name)).toEqual(['B2', 'A']);
  });
});

describe('reconcileName', () => {
  it('settles when the server reports the typed name', () => {
    expect(reconcileName({ name: 'New', sent: true, was: 'Old' }, 'New')).toBe('settled');
  });
  it('waits while the server still reports the name it had', () => {
    expect(reconcileName({ name: 'New', sent: true, was: 'Old' }, 'Old')).toBe('pending');
    expect(reconcileName({ name: 'New', sent: false, was: 'Old' }, 'Other')).toBe('pending');
  });
  it('gives way to a rename made somewhere else afterwards', () => {
    expect(reconcileName({ name: 'New', sent: true, was: 'Old' }, 'Theirs')).toBe('superseded');
  });
});

describe('roles', () => {
  it('lets a bare address or an edit invite rename, and nothing else', () => {
    expect(canEditBoard(board('a', 'A', 0))).toBe(true);
    expect(canEditBoard({ ...board('a', 'A', 0), role: 'editor' })).toBe(true);
    expect(canEditBoard({ ...board('a', 'A', 0), role: 'commenter' })).toBe(false);
    expect(canEditBoard({ ...board('a', 'A', 0), role: 'viewer' })).toBe(false);
  });
  it('knows when an invite has run out', () => {
    expect(inviteExpired({ ...board('a', 'A', 0), inviteExpires: NOW - 1 }, NOW)).toBe(true);
    expect(inviteExpired({ ...board('a', 'A', 0), inviteExpires: NOW + DAY }, NOW)).toBe(false);
    expect(inviteExpired({ ...board('a', 'A', 0), inviteExpires: null }, NOW)).toBe(false);
  });
});

describe('focusAfterRemoval', () => {
  it('moves to the card that takes its place, or the one before at the end', () => {
    expect(focusAfterRemoval(0, 3)).toBe(0);
    expect(focusAfterRemoval(2, 3)).toBe(1);
    expect(focusAfterRemoval(0, 1)).toBe(-1);
  });
});

describe('batchIds', () => {
  it('splits a large library into requests of 50 distinct ids', () => {
    const ids = Array.from({ length: 120 }, (_, i) => `room${String(i).padStart(4, '0')}`);
    const batches = batchIds([...ids, ids[0]]);
    expect(batches.map((b) => b.length)).toEqual([50, 50, 20]);
    expect(new Set(batches.flat()).size).toBe(120);
  });
});
