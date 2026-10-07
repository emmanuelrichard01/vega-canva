import { describe, it, expect } from 'vitest';
import {
  changedSinceOpened,
  cleanBoardName,
  libraryGroups,
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
    const groups = libraryGroups(boards, { pins: { d: 1 }, names: { a: 'Roadmap' }, sort: 'recent', query: 'road', now: NOW });
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
  it('names one, two, or one and a count', () => {
    const p = (name: string) => ({ name, color: '#000' });
    expect(presenceLine({ online: [], onlineCount: 0 })).toBeNull();
    expect(presenceLine({ online: [p('Ana')], onlineCount: 1 })).toBe('Ana is here');
    expect(presenceLine({ online: [p('Ana'), p('Ben')], onlineCount: 2 })).toBe('Ana and Ben are here');
    expect(presenceLine({ online: [p('Ana'), p('Ben')], onlineCount: 3 })).toBe('Ana and 2 others are here');
    expect(presenceLine({ online: [p('Ana')], onlineCount: 2 })).toBe('Ana and 1 other are here');
  });
});

describe('changedSinceOpened', () => {
  const b = board('a', 'Alpha', 60 * MIN);
  it('is true only for a stored change well after the last open', () => {
    const at = (ms: number) => ({ id: 'a', exists: true, updatedAt: new Date(ms).toISOString(), title: null, online: [], onlineCount: 0 });
    expect(changedSinceOpened(b, at(NOW))).toBe(true);
    expect(changedSinceOpened(b, at(b.lastAccessed + 30_000))).toBe(false);
    expect(changedSinceOpened(b, undefined)).toBe(false);
  });
});
