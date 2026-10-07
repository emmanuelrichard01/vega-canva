import { describe, expect, it } from 'vitest';
import { PING_MS, isPingGesture, placePing, readPing, stepPings, type LivePing } from './ping';

describe('readPing', () => {
  it('accepts a point and a stamp and nothing else', () => {
    expect(readPing({ x: 1, y: 2, at: 3 })).toEqual({ x: 1, y: 2, at: 3 });
    expect(readPing({ x: 1, y: 2 })).toBeNull();
    expect(readPing({ x: 'a', y: 2, at: 3 })).toBeNull();
    expect(readPing(null)).toBeNull();
    expect(readPing({ x: Infinity, y: 0, at: 1 })).toBeNull();
  });
});

describe('stepPings', () => {
  const ana = (at: number) => ({ clientId: 1, ping: { x: 10, y: 20, at } });

  it('starts a ping the first time it is seen, on this screen clock', () => {
    const seen = new Map<number, number>();
    // The sender's stamp is nowhere near this clock, and must not matter.
    const out = stepPings([], seen, [ana(5)], 1_000_000);
    expect(out).toHaveLength(1);
    expect(out[0].startedAt).toBe(1_000_000);
  });

  it('does not start the same ping twice while it is still in awareness', () => {
    const seen = new Map<number, number>();
    let live: LivePing[] = stepPings([], seen, [ana(5)], 0);
    live = stepPings(live, seen, [ana(5)], PING_MS + 10);
    expect(live).toHaveLength(0);
  });

  it('plays a new ping from the same person, and lets the old one finish', () => {
    const seen = new Map<number, number>();
    let live = stepPings([], seen, [ana(5)], 0);
    live = stepPings(live, seen, [ana(9)], 500);
    expect(live.map((p) => p.at)).toEqual([5, 9]);
    live = stepPings(live, seen, [ana(9)], PING_MS + 100);
    expect(live.map((p) => p.at)).toEqual([9]);
  });

  it('forgets people who left, so a rejoin with the same stamp plays', () => {
    const seen = new Map<number, number>();
    stepPings([], seen, [ana(5)], 0);
    stepPings([], seen, [], 10);
    expect(seen.size).toBe(0);
  });
});

describe('placePing', () => {
  it('leaves an on-screen point where it is', () => {
    expect(placePing({ x: 300, y: 200 }, 1000, 800)).toMatchObject({ x: 300, y: 200, inside: true });
  });
  it('pins an off-screen point to the edge it is past, and points that way', () => {
    const p = placePing({ x: 5000, y: 400 }, 1000, 800);
    expect(p.inside).toBe(false);
    expect(p.x).toBe(972);
    expect(Math.round(p.angle)).toBe(0);
  });
});

describe('isPingGesture', () => {
  const at = (x: number, y: number, shift = true, alt = true) => ({ x, y, shift, alt });
  it('needs both modifiers at both ends', () => {
    expect(isPingGesture(at(0, 0), at(1, 1))).toBe(true);
    expect(isPingGesture(at(0, 0, true, false), at(0, 0, true, false))).toBe(false);
    expect(isPingGesture(at(0, 0), at(0, 0, false, true))).toBe(false);
  });
  it('is not a drag', () => {
    expect(isPingGesture(at(0, 0), at(40, 0))).toBe(false);
  });
});
