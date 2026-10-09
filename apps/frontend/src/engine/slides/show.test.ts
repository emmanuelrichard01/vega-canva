import { describe, expect, it } from 'vitest';
import { elapsed, formatElapsed, IDLE_SHOW, reduceShow, show, type ShowCommand, type ShowState } from './show';

const run = (cmds: ShowCommand[], from: ShowState = IDLE_SHOW) => cmds.reduce(reduceShow, from);
const started = (index = 0) => run([{ type: 'start', ids: ['a', 'b', 'c', 'd'], index, now: 1000 }]);

describe('the show', () => {
  it('does nothing until it starts, and will not start an empty deck', () => {
    expect(run([{ type: 'next' }])).toBe(IDLE_SHOW);
    expect(run([{ type: 'start', ids: [], index: 0, now: 0 }])).toBe(IDLE_SHOW);
  });

  it('moves through the deck and stops at either end', () => {
    expect(run([{ type: 'next' }, { type: 'next' }], started()).index).toBe(2);
    expect(run([{ type: 'previous' }], started()).index).toBe(0);
    expect(run([{ type: 'last' }, { type: 'next' }], started()).index).toBe(3);
    expect(run([{ type: 'first' }], started(3)).index).toBe(0);
    expect(started(99).index).toBe(3);
  });

  it('jumps to a typed number, clamped, and ignores nonsense', () => {
    expect(run([{ type: 'goto-number', number: 3 }], started()).index).toBe(2);
    expect(run([{ type: 'goto-number', number: 40 }], started()).index).toBe(3);
    expect(run([{ type: 'goto-number', number: 0 }], started(1)).index).toBe(1);
    expect(run([{ type: 'goto', index: Number.NaN }], started(1)).index).toBe(1);
    expect(run([{ type: 'goto-id', id: 'c' }], started()).index).toBe(2);
    expect(run([{ type: 'goto-id', id: 'zz' }], started(1)).index).toBe(1);
  });

  it('blanks to black or white, toggles back, and clears the blank on any move', () => {
    const black = run([{ type: 'blank', blank: 'black' }], started());
    expect(black.blank).toBe('black');
    expect(run([{ type: 'blank', blank: 'black' }], black).blank).toBeNull();
    expect(run([{ type: 'blank', blank: 'white' }], black).blank).toBe('white');
    const moved = run([{ type: 'next' }], black);
    expect(moved.blank).toBeNull();
    expect(moved.index).toBe(1);
    // Moving "next" from the last slide still brings the screen back.
    expect(run([{ type: 'blank', blank: 'black' }, { type: 'next' }], started(3)).blank).toBeNull();
  });

  it('keeps the slide on screen when the deck changes under it', () => {
    const atC = started(2);
    const reordered = run([{ type: 'deck', ids: ['c', 'a', 'b', 'd'] }], atC);
    expect(reordered.ids[reordered.index]).toBe('c');
    // The current slide was deleted or skipped: stay at the same place.
    const removed = run([{ type: 'deck', ids: ['a', 'b', 'd'] }], atC);
    expect(removed.ids[removed.index]).toBe('d');
    expect(run([{ type: 'deck', ids: [] }], atC)).toBe(IDLE_SHOW);
    expect(run([{ type: 'deck', ids: ['a', 'b', 'c', 'd'] }], atC)).toBe(atC);
  });

  it('times the talk, pausing and resetting', () => {
    let s = started();
    expect(elapsed(s, 4000)).toBe(3000);
    s = run([{ type: 'timer-toggle', now: 4000 }], s);
    expect(elapsed(s, 60_000)).toBe(3000);
    s = run([{ type: 'timer-toggle', now: 10_000 }], s);
    expect(elapsed(s, 12_000)).toBe(5000);
    s = run([{ type: 'timer-reset', now: 12_000 }], s);
    expect(elapsed(s, 13_000)).toBe(1000);
    expect(formatElapsed(65_000)).toBe('1:05');
    expect(formatElapsed(3_725_000)).toBe('1:02:05');
  });

  it('invites the room and arms the laser on request, and stopping forgets all of it', () => {
    const s = run([{ type: 'everyone', on: true }, { type: 'laser', on: true }], started());
    expect(s.everyone && s.laser).toBe(true);
    expect(run([{ type: 'stop' }], s)).toBe(IDLE_SHOW);
    expect(run([{ type: 'start', ids: ['a'], index: 0, now: 0, everyone: true }]).everyone).toBe(true);
  });

  it('tells its listeners only when something changed', () => {
    let calls = 0;
    const off = show.subscribe(() => calls++);
    show.dispatch({ type: 'start', ids: ['a', 'b'], index: 0, now: 0 });
    show.dispatch({ type: 'previous' });
    show.dispatch({ type: 'next' });
    show.dispatch({ type: 'stop' });
    off();
    expect(calls).toBe(3);
  });
});
