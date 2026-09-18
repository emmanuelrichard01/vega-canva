import { describe, it, expect } from 'vitest';
import { groupBoards, MIN_FOR_GROUPS, sortBoards, whenOpened, type ShelfBoard } from './boardShelf';

const NOW = new Date('2026-09-17T18:00:00Z').getTime();
const ago = (ms: number): number => NOW - ms;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const board = (name: string, at: number): ShelfBoard => ({ id: name.toLowerCase(), name, lastAccessed: at });

describe('whenOpened', () => {
  it('speaks in one voice, coarse to fine', () => {
    expect(whenOpened(ago(10_000), NOW)).toBe('just now');
    expect(whenOpened(ago(MIN), NOW)).toBe('1 minute ago');
    expect(whenOpened(ago(42 * MIN), NOW)).toBe('42 minutes ago');
    expect(whenOpened(ago(HOUR), NOW)).toBe('1 hour ago');
    expect(whenOpened(ago(5 * HOUR), NOW)).toBe('5 hours ago');
    expect(whenOpened(ago(30 * HOUR), NOW)).toBe('yesterday');
    expect(whenOpened(ago(4 * DAY), NOW)).toBe('4 days ago');
  });

  it('becomes a date once counting days stops helping', () => {
    expect(whenOpened(ago(40 * DAY), NOW)).toMatch(/^\d+ \w+$/);
    // A different year says so; the same year does not need to.
    expect(whenOpened(ago(400 * DAY), NOW)).toMatch(/2025/);
    expect(whenOpened(ago(40 * DAY), NOW)).not.toMatch(/2026/);
  });

  it('never counts backwards when a clock disagrees', () => {
    expect(whenOpened(NOW + 60_000, NOW)).toBe('just now');
  });
});

describe('sortBoards', () => {
  const boards = [board('Zebra', ago(DAY)), board('apple', ago(3 * DAY)), board('Mango', ago(MIN))];

  it('puts the last opened first', () => {
    expect(sortBoards(boards, 'recent').map((b) => b.name)).toEqual(['Mango', 'Zebra', 'apple']);
  });

  it('sorts by name without caring about case', () => {
    expect(sortBoards(boards, 'name').map((b) => b.name)).toEqual(['apple', 'Mango', 'Zebra']);
  });

  it('leaves the original alone', () => {
    const before = boards.map((b) => b.name);
    sortBoards(boards, 'name');
    expect(boards.map((b) => b.name)).toEqual(before);
  });
});

describe('groupBoards', () => {
  it('leaves a small library ungrouped', () => {
    const few = [board('A', ago(MIN)), board('B', ago(40 * DAY))];
    const groups = groupBoards(few, NOW);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('');
    expect(groups[0].boards.map((b) => b.name)).toEqual(['A', 'B']);
  });

  it('splits a bigger one by when it was last open', () => {
    const many: ShelfBoard[] = [
      board('Now', ago(MIN)),
      board('Morning', ago(6 * HOUR)),
      board('Tuesday', ago(3 * DAY)),
      board('Last week', ago(9 * DAY)),
      board('Last month', ago(20 * DAY)),
      board('March', ago(180 * DAY)),
      board('Older still', ago(400 * DAY)),
    ];
    expect(many.length).toBeGreaterThanOrEqual(MIN_FOR_GROUPS);
    const groups = groupBoards(many, NOW);
    expect(groups.map((g) => g.label)).toEqual(['Today', 'Earlier this week', 'Earlier this month', 'Older']);
    expect(groups[0].boards.map((b) => b.name)).toEqual(['Now', 'Morning']);
    expect(groups[1].boards.map((b) => b.name)).toEqual(['Tuesday']);
    expect(groups[2].boards.map((b) => b.name)).toEqual(['Last week', 'Last month']);
    expect(groups[3].boards.map((b) => b.name)).toEqual(['March', 'Older still']);
  });

  it('drops a stretch with nothing in it rather than heading an empty row', () => {
    const boards = Array.from({ length: 8 }, (_, i) => board(`Old ${i}`, ago((60 + i) * DAY)));
    expect(groupBoards(boards, NOW).map((g) => g.label)).toEqual(['Older']);
  });

  it('keeps every board exactly once', () => {
    const boards = Array.from({ length: 12 }, (_, i) => board(`B${i}`, ago(i * 7 * HOUR)));
    const grouped = groupBoards(boards, NOW).flatMap((g) => g.boards.map((b) => b.id));
    expect(new Set(grouped).size).toBe(12);
  });

  it('has nothing to say about an empty library', () => {
    expect(groupBoards([], NOW)).toEqual([]);
  });
});
