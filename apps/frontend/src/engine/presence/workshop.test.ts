import { describe, expect, it } from 'vitest';
import { addTime, formatClock, liveOffset, pauseTimer, readTimer, remainingMs, resumeTimer, startTimer, writeTimer } from './workshopTimer';
import { clickDot, pickVoteTarget, readSession, tallyVotes } from './vote';
import { emoteIndexAt } from './emote';

describe('workshop timer', () => {
  it('counts down from a stored end time with no ticks', () => {
    const t = startTimer(5 * 60_000, 1_000);
    expect(remainingMs(t, 1_000)).toBe(300_000);
    expect(remainingMs(t, 61_000)).toBe(240_000);
    expect(remainingMs(t, 9_999_999)).toBe(0);
  });

  it('agrees across clients whose clocks differ, using the live offset', () => {
    const writerNow = 1_000_000;
    const t = startTimer(60_000, writerNow);
    const readerNow = writerNow + 7_000 + 120; // 7s fast clock, 120ms latency
    const offset = liveOffset(t, readerNow);
    // Both clients, 10s later by their own clocks, see 50s minus the latency.
    expect(remainingMs(t, writerNow + 10_000)).toBe(50_000);
    expect(remainingMs(t, readerNow + 10_000, offset)).toBe(50_000);
  });

  it('pauses, resumes and adds a minute without drift', () => {
    let t = startTimer(120_000, 0);
    t = pauseTimer(t, 30_000);
    expect(t).toMatchObject({ status: 'paused', remainingMs: 90_000 });
    expect(remainingMs(t, 999_999)).toBe(90_000);
    t = resumeTimer(t, 100_000);
    expect(remainingMs(t, 100_000)).toBe(90_000);
    t = addTime(t, 60_000, 110_000);
    expect(remainingMs(t, 110_000)).toBe(140_000);
  });

  it('round-trips and rejects junk', () => {
    const t = startTimer(1000, 5);
    expect(readTimer(writeTimer(t))).toEqual(t);
    expect(readTimer('{"status":"running"}')).toBeNull();
    expect(readTimer(undefined)).toBeNull();
  });

  it('formats clocks, rounding the last second up', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(1)).toBe('0:01');
    expect(formatClock(247_000)).toBe('4:07');
    expect(formatClock(3_723_000)).toBe('1:02:03');
  });
});

describe('dot voting', () => {
  it('places dots up to the allowance, then takes one back from the clicked object', () => {
    let dots: string[] = [];
    dots = clickDot(dots, 'a', 2);
    dots = clickDot(dots, 'a', 2);
    expect(dots).toEqual(['a', 'a']);
    expect(clickDot(dots, 'b', 2)).toEqual(['a', 'a']);
    expect(clickDot(dots, 'a', 2)).toEqual(['a']);
  });

  it('tallies per object, caps each voter and drops deleted objects', () => {
    const t = tallyVotes({ ann: ['a', 'a', 'b'], bo: ['b', 'c', 'gone', 'a'], cy: [] }, 2, (id) => id !== 'gone');
    expect(t.counts.get('a')).toBe(2);
    expect(t.counts.get('b')).toBe(1);
    expect(t.counts.get('c')).toBe(1);
    expect(t.total).toBe(4);
    expect(t.voters).toBe(2);
    expect(t.ranked[0]).toEqual({ id: 'a', count: 2 });
  });

  it('picks the smallest object under the click', () => {
    const frame = { id: 'f', type: 'frame', x: 0, y: 0, width: 500, height: 500 };
    const note = { id: 'n', type: 'sticky', x: 10, y: 10, width: 100, height: 100 };
    expect(pickVoteTarget([frame, note], { x: 20, y: 20 })).toBe('n');
    expect(pickVoteTarget([frame, note], { x: 300, y: 300 })).toBe('f');
    expect(pickVoteTarget([frame, note], { x: 900, y: 900 })).toBeNull();
  });

  it('reads a stored session and clamps the allowance', () => {
    expect(readSession(JSON.stringify({ id: 'x', perPerson: 99, by: 'u', startedAt: 1, revealed: true }))).toMatchObject({ perPerson: 20, revealed: true });
    expect(readSession('nope')).toBeNull();
  });
});

describe('emote wheel', () => {
  it('maps pointer direction to slices clockwise from the top', () => {
    expect(emoteIndexAt(0, -60)).toBe(0);
    expect(emoteIndexAt(60, 0)).toBe(2);
    expect(emoteIndexAt(0, 60)).toBe(4);
    expect(emoteIndexAt(-60, 0)).toBe(6);
    expect(emoteIndexAt(3, 3)).toBe(-1);
  });
});
